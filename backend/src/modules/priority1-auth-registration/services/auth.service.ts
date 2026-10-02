import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { PasswordHasher } from '../../../common/security/password-hasher.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { PASSWORD_POLICY_PORT } from '../../../common/security/password-policy.port.js';
import type { PasswordPolicyPort } from '../../../common/security/password-policy.port.js';
import { SESSION_STORE_PORT } from '../../../common/session/session-store.port.js';
import type { SessionStorePort } from '../../../common/session/session-store.port.js';
import { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../entities/user-account.entity.js';
import { SetupTokenEntity } from '../entities/setup-token.entity.js';
import { UserRefreshTokenEntity } from '../entities/user-refresh-token.entity.js';
import { ONBOARDING_STEPS, OnboardingStepProgressEntity, OnboardingStepStatus } from '../entities/onboarding-step-progress.entity.js';

/** Generic, non-enumerating error — point 8: never reveals which of FPO Code / Username / Password was wrong. */
const GENERIC_LOGIN_ERROR = 'FPO Code, Username or Password is incorrect.';

export interface RequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TenantTokenPair {
  accessToken: string;
  refreshToken: string;
  onboardingComplete: boolean;
  isInitialFpoAdmin: boolean;
}

/**
 * Correction-pass items 1/2/13/16:
 *  - Every login/refresh issues (or carries forward) a Redis session via
 *    SessionStorePort — Redis, not `user_refresh_token`, is what decides
 *    whether an access token is currently usable (see JwtStrategy).
 *  - Logout and lockout REVOKE that Redis session immediately — already-
 *    issued access tokens stop working on their very next request, not only
 *    once their own short JWT expiry elapses.
 *  - setup-token consumption and refresh-token rotation are both atomic
 *    (conditional UPDATE / compare-and-set), so two concurrent requests for
 *    the SAME secret can never both succeed.
 *  - Every audit event below now carries IP/device metadata (masked where
 *    appropriate) — this IS Priority #1's login-history/security-event
 *    telemetry; there is no second, separate event store (item 15).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
    private readonly jwtService: JwtService,
    private readonly passwordHasher: PasswordHasher,
    private readonly secretHasher: SecretTokenHasher,
    private readonly config: ConfigService,
    @Inject(PASSWORD_POLICY_PORT) private readonly passwordPolicy: PasswordPolicyPort,
    @Inject(SESSION_STORE_PORT) private readonly sessionStore: SessionStorePort,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  // ---------------------------------------------------------------- SYS-01-A
  async tenantLogin(fpoCode: string, usernameOrEmailOrMobile: string, password: string, meta: RequestMetadata): Promise<TenantTokenPair> {
    // fpo_registration is platform-level (no RLS) — safe to query directly.
    const regRepo = this.dataSource.getRepository(FpoRegistrationEntity);
    const tenant = await regRepo.findOne({ where: { fpoCode } });

    if (!tenant) {
      await this.audit.record({ eventType: 'auth.login.failure', tenantId: null, metadata: { reason: 'unknown_fpo_code', ...ipMeta(meta) } });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (tenant.status !== FpoRegistrationStatus.ACTIVE || (await this.isTenantSubscriptionSuspended(tenant.id))) {
      await this.audit.record({ eventType: 'auth.login.failure', tenantId: tenant.id, metadata: { reason: 'tenant_not_active', ...ipMeta(meta) } });
      throw new ForbiddenException('This FPO account is not currently active. Please contact your Admin.');
    }

    // tenant.id is now independently, legitimately known — safe to open a
    // known-tenant transaction for the RLS-protected user_account lookup.
    //
    // IMPORTANT: this callback must never THROW to signal an ordinary login
    // failure. KnownTenantTransactionRunner wraps this in a real DB
    // transaction and rolls it back on any thrown error — which would
    // silently discard the very failed-attempt increment / lockout write
    // this code is trying to persist. Every branch below returns a plain
    // outcome value instead; the transaction always COMMITS, and the actual
    // exception is thrown once, after it has committed, from the outer
    // tenantLogin() body.
    const outcome = await this.knownTenantTx.run(tenant.id, async (manager) => {
      const userRepo = manager.getRepository(UserAccountEntity);
      const user = await userRepo
        .createQueryBuilder('u')
        .where('u.tenantId = :tenantId', { tenantId: tenant.id })
        .andWhere('(u.username = :id OR u.email = :id OR u.mobile = :id)', { id: usernameOrEmailOrMobile })
        .getOne();

      if (!user) {
        await this.audit.record({ eventType: 'auth.login.failure', tenantId: tenant.id, metadata: { reason: 'unknown_user', ...ipMeta(meta) } });
        return { kind: 'generic_error' as const };
      }

      if (user.status === UserAccountStatus.LOCKED && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        await this.audit.record({ eventType: 'auth.login.failure', tenantId: tenant.id, actorUserId: user.id, metadata: { reason: 'locked', ...ipMeta(meta) } });
        return { kind: 'locked' as const, minutesLeft };
      }

      if (user.status === UserAccountStatus.SUSPENDED) {
        await this.audit.record({ eventType: 'auth.login.failure', tenantId: tenant.id, actorUserId: user.id, metadata: { reason: 'suspended', ...ipMeta(meta) } });
        return { kind: 'suspended' as const };
      }

      const passwordOk = user.passwordHash ? await this.passwordHasher.verify(user.passwordHash, password) : false;
      if (!passwordOk) {
        const justLocked = await this.registerFailedAttempt(userRepo, user);
        await this.audit.record({
          eventType: 'auth.login.failure',
          tenantId: tenant.id,
          actorUserId: user.id,
          metadata: { reason: 'bad_password', ...ipMeta(meta) },
        });
        if (justLocked) {
          await this.audit.record({ eventType: 'auth.account.lockout', tenantId: tenant.id, actorUserId: user.id, metadata: { ...ipMeta(meta) } });
        }
        return { kind: 'generic_error' as const };
      }

      user.failedLoginAttempts = 0;
      user.status = UserAccountStatus.ACTIVE;
      await userRepo.save(user);

      const onboardingComplete = await this.isOnboardingComplete(manager, tenant.id);
      const tokens = await this.issueTenantTokens(tenant.id, user.id, user.roleId, meta);
      await this.audit.record({ eventType: 'auth.login.success', tenantId: tenant.id, actorUserId: user.id, metadata: { ...ipMeta(meta) } });

      return { kind: 'success' as const, value: { ...tokens, onboardingComplete, isInitialFpoAdmin: user.isInitialFpoAdmin } };
    });

    switch (outcome.kind) {
      case 'success':
        return outcome.value;
      case 'locked':
        throw new ForbiddenException(`Your account is temporarily locked. Please try again in ${outcome.minutesLeft} minute(s).`);
      case 'suspended':
        throw new ForbiddenException('This account is suspended. Please contact your Admin.');
      case 'generic_error':
      default:
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
  }

  /** Returns true iff this failed attempt is the one that just triggered lockout (and revokes any existing sessions). */
  private async registerFailedAttempt(userRepo: Repository<UserAccountEntity>, user: UserAccountEntity): Promise<boolean> {
    const maxAttempts = this.config.get<number>('accountLockout.maxFailedAttempts') ?? 5;
    const lockoutMinutes = this.config.get<number>('accountLockout.lockoutMinutes') ?? 15;

    user.failedLoginAttempts += 1;
    let justLocked = false;
    if (user.failedLoginAttempts >= maxAttempts) {
      user.status = UserAccountStatus.LOCKED;
      user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      justLocked = true;
    }
    await userRepo.save(user);
    if (justLocked) {
      // Item 2 — lockout must prevent continued use of an already-issued
      // access token, not just block future logins.
      await this.sessionStore.revokeAllSessionsForSubject('TENANT_USER', user.id);
    }
    return justLocked;
  }

  private async isOnboardingComplete(manager: EntityManager, tenantId: string): Promise<boolean> {
    const repo = manager.getRepository(OnboardingStepProgressEntity);
    const rows = await repo.find({ where: { tenantId } });
    const byStep = new Map(rows.map((r) => [r.stepNumber, r.status]));
    return ONBOARDING_STEPS.every((step) => {
      const status = byStep.get(step.stepNumber) ?? OnboardingStepStatus.PENDING;
      return status === OnboardingStepStatus.COMPLETE || (step.skippable && status === OnboardingStepStatus.SKIPPED);
    });
  }

  // --------------------------------------------------------------- Tokens
  // setup_token / user_refresh_token are NOT RLS-protected (lookup-by-secret
  // access pattern — see entity docs) so these can use dataSource directly.
  private async issueTenantTokens(tenantId: string, userId: string, roleId: string | null, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    const expiryDays = this.config.get<number>('refreshToken.expiryDays') ?? 30;
    const ttlSeconds = expiryDays * 24 * 60 * 60;

    const session = await this.sessionStore.createSession({
      subjectType: 'TENANT_USER',
      userId,
      tenantId,
      mfaCompleted: true, // no MFA step exists for tenant users (frozen scope)
      ttlSeconds,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const payload: JwtPayload = { sub: userId, tenantId, isPlatformSuperAdmin: false, roleId, sid: session.sessionId };
    const accessToken = await this.jwtService.signAsync(payload);

    const rawRefresh = this.secretHasher.generateOpaqueSecret();
    const repo = this.dataSource.getRepository(UserRefreshTokenEntity);
    await repo.save(
      repo.create({
        tenantId,
        userId,
        sessionId: session.sessionId,
        tokenHash: this.secretHasher.hash(rawRefresh),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        revokedAt: null,
        rotatedToTokenId: null,
      }),
    );
    return { accessToken, refreshToken: rawRefresh };
  }

  async refreshTenantToken(rawRefreshToken: string, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    const repo = this.dataSource.getRepository(UserRefreshTokenEntity);
    const tokenHash = this.secretHasher.hash(rawRefreshToken);
    const record = await repo.findOne({ where: { tokenHash } });

    if (!record) throw new UnauthorizedException('Invalid refresh token.');

    // Correction-pass item 13 — atomic rotation. A conditional UPDATE
    // (WHERE revokedAt IS NULL) is the compare-and-set: of several
    // concurrent refresh calls presenting the SAME raw token, only the first
    // can ever flip revokedAt from NULL, so only one successor chain can
    // ever be issued even under a genuine race.
    const casResult = await repo
      .createQueryBuilder()
      .update(UserRefreshTokenEntity)
      .set({ revokedAt: new Date() })
      .where('id = :id', { id: record.id })
      .andWhere('revokedAt IS NULL')
      .execute();

    if (!casResult.affected) {
      // Either already rotated (a legitimate prior refresh) or REUSED
      // (compromise) — reuse of an already-rotated token is treated as
      // compromise and the entire chain + its session are revoked.
      await repo.update({ userId: record.userId }, { revokedAt: new Date() });
      if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
      await this.audit.record({ eventType: 'auth.refresh_token.reuse_detected', tenantId: record.tenantId, actorUserId: record.userId, metadata: { ...ipMeta(meta) } });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
      throw new UnauthorizedException('Refresh token expired.');
    }

    // Item 2 — refresh must re-check CURRENT tenant/user state, not just
    // trust the refresh-token row's own validity.
    const tenant = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: record.tenantId } });
    if (!tenant || tenant.status !== FpoRegistrationStatus.ACTIVE || (await this.isTenantSubscriptionSuspended(record.tenantId))) {
      throw new UnauthorizedException('This FPO account is not currently active.');
    }
    const user = await this.knownTenantTx.run(record.tenantId, (manager) =>
      manager.getRepository(UserAccountEntity).findOne({ where: { id: record.userId, tenantId: record.tenantId } }),
    );
    if (!user || user.status !== UserAccountStatus.ACTIVE) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    const newTokens = await this.issueTenantTokens(record.tenantId, record.userId, user.roleId, meta);
    const newHash = this.secretHasher.hash(newTokens.refreshToken);
    const newRecord = await repo.findOne({ where: { tokenHash: newHash } });
    // Correction-pass item 13 fix: `record` is the in-memory snapshot read
    // BEFORE the atomic CAS update above, so it still carries revokedAt=null.
    // A full `repo.save(record)` here would overwrite the row with that stale
    // snapshot and silently UN-REVOKE the very token the CAS step just
    // revoked — defeating reuse detection entirely. A targeted column-only
    // update leaves whatever the CAS step already committed untouched.
    await repo.update({ id: record.id }, { rotatedToTokenId: newRecord?.id ?? null });
    // Old session is superseded by the new one issued in issueTenantTokens —
    // revoke it explicitly so a captured old access token cannot linger.
    if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);

    return newTokens;
  }

  async logoutTenant(rawRefreshToken: string): Promise<void> {
    const repo = this.dataSource.getRepository(UserRefreshTokenEntity);
    const tokenHash = this.secretHasher.hash(rawRefreshToken);
    const record = await repo.findOne({ where: { tokenHash } });
    if (!record) return;
    await repo.update({ tokenHash }, { revokedAt: new Date() });
    if (record.sessionId) {
      // Item 2 — logout must invalidate the session; an already-issued
      // access token stops working on its very next request.
      await this.sessionStore.revokeSession(record.sessionId);
    }
    await this.audit.record({ eventType: 'auth.logout', tenantId: record.tenantId, actorUserId: record.userId });
  }

  // ---------------------------------------------------------------- SYS-05
  async setupPassword(rawSetupToken: string, newPassword: string, confirmNewPassword: string): Promise<void> {
    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException('New password and confirmation do not match.');
    }
    await this.passwordPolicy.assertValid(newPassword);

    const tokenRepo = this.dataSource.getRepository(SetupTokenEntity);
    const tokenHash = this.secretHasher.hash(rawSetupToken);
    const record = await tokenRepo.findOne({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      await this.audit.record({
        eventType: 'setup_token.rejected',
        tenantId: record?.tenantId ?? null,
        metadata: { reason: !record ? 'not_found' : record.usedAt ? 'already_used' : 'expired' },
      });
      throw new BadRequestException('This setup link is no longer valid. Please contact Platform Support.');
    }

    // Correction-pass item 13 — atomic consumption. Only the FIRST of
    // several concurrent setup-password submissions for the SAME token can
    // ever flip usedAt from NULL; a loser sees affected=0 and is rejected
    // BEFORE it ever touches the user's password.
    const casResult = await tokenRepo
      .createQueryBuilder()
      .update(SetupTokenEntity)
      .set({ usedAt: new Date() })
      .where('id = :id', { id: record.id })
      .andWhere('usedAt IS NULL')
      .execute();

    if (!casResult.affected) {
      await this.audit.record({ eventType: 'setup_token.rejected', tenantId: record.tenantId, metadata: { reason: 'concurrently_consumed' } });
      throw new BadRequestException('This setup link is no longer valid. Please contact Platform Support.');
    }

    await this.knownTenantTx.run(record.tenantId, async (manager) => {
      const userRepo = manager.getRepository(UserAccountEntity);
      const user = await userRepo.findOne({ where: { id: record.userId } });
      if (!user) throw new BadRequestException('This setup link is no longer valid. Please contact Platform Support.');

      user.passwordHash = await this.passwordHasher.hash(newPassword);
      user.status = UserAccountStatus.ACTIVE;
      await userRepo.save(user);
    });

    await this.audit.record({ eventType: 'setup_token.used', tenantId: record.tenantId, actorUserId: record.userId });
    await this.audit.record({ eventType: 'auth.password_set', tenantId: record.tenantId, actorUserId: record.userId });
    // No second compulsory password-change step is ever triggered after this (CA-1).
  }
  private async isTenantSubscriptionSuspended(tenantId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      'SELECT "state" FROM "tenant_subscription" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [tenantId],
    );
    return (rows as Array<{ state?: string }>)[0]?.state === 'SUSPENDED';
  }

}

function ipMeta(meta: RequestMetadata): Record<string, string> {
  return {
    ip: meta.ipAddress ?? 'unknown',
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : 'unknown',
  };
}
