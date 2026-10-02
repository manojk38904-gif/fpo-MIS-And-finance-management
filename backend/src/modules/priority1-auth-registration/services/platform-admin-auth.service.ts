import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { PasswordHasher } from '../../../common/security/password-hasher.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { SESSION_STORE_PORT } from '../../../common/session/session-store.port.js';
import type { SessionStorePort } from '../../../common/session/session-store.port.js';
import { REDIS_CLIENT } from '../../../common/session/redis-client.provider.js';
import { JwtPayload } from '../../../common/auth/jwt-payload.interface.js';
import { PlatformAdminAccountEntity, PlatformAdminStatus } from '../entities/platform-admin-account.entity.js';
import { PlatformAdminRefreshTokenEntity } from '../entities/platform-admin-refresh-token.entity.js';
import { TotpService } from './totp.service.js';
import type { RequestMetadata } from './auth.service.js';

const GENERIC_LOGIN_ERROR = 'Username or Password is incorrect.';

interface MfaPendingPayload {
  sub: string;
  mfaPending: true;
  /** Correction-pass item 18 — single-use nonce: once consumed by a
   *  successful step-2, this exact ticket cannot be replayed again even
   *  within its own remaining 5-minute JWT expiry window. */
  jti: string;
}

/**
 * SYS-01-B — Platform Super Admin / Support Admin login. No FPO-Code field
 * (tenant-context-free). MFA/TOTP is mandatory, never optional, verified as
 * a distinct second step. No self-service "Forgot Password" (frozen —
 * Section C of the spec's Final Summary: this is an intentionally-flagged
 * open point for Priority #18 to design the secure out-of-band reset
 * process; not invented here).
 *
 * Deliberately a SEPARATE service/table hierarchy from tenant AuthService —
 * never mixed into Priority #13's tenant-user truth (kickoff instruction
 * #10). All platform_admin_* tables are non-RLS, platform-level.
 *
 * Correction-pass item 18 hardening:
 *  - An expired lock is cleared (status restored to ACTIVE) the moment a
 *    correct password is presented after the lock window has passed —
 *    mirroring tenant AuthService's identical behaviour — rather than
 *    leaving a stale LOCKED label that happens not to block anything.
 *  - A SUSPENDED admin is re-checked at step-2 (MFA) as well as step-1: an
 *    admin suspended BETWEEN the two steps cannot still complete login and
 *    receive tokens.
 *  - The MFA-pending ticket is single-use (jti tracked in Redis), not merely
 *    time-bounded — it cannot be replayed to attempt the TOTP step multiple
 *    times after one has already succeeded.
 *  - refresh() re-checks the admin's CURRENT status (item 2), not just the
 *    refresh-token row's own validity.
 */
@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly passwordHasher: PasswordHasher,
    private readonly secretHasher: SecretTokenHasher,
    private readonly totpService: TotpService,
    private readonly config: ConfigService,
    @Inject(SESSION_STORE_PORT) private readonly sessionStore: SessionStorePort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  /** Step 1 — password. Returns a short-lived, single-use mfaSessionToken; no tenant/access token yet. */
  async loginStep1Password(usernameOrEmail: string, password: string, meta: RequestMetadata): Promise<{ mfaSessionToken: string }> {
    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const admin = await repo
      .createQueryBuilder('a')
      .where('a.username = :id OR a.email = :id', { id: usernameOrEmail })
      .getOne();

    if (!admin) {
      await this.audit.record({ eventType: 'platform_admin.login.failure', tenantId: null, metadata: { reason: 'unknown_user', ...ipMeta(meta) } });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (admin.status === PlatformAdminStatus.LOCKED && admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Account temporarily locked. Try again in ${minutesLeft} minute(s).`);
    }
    if (admin.status === PlatformAdminStatus.SUSPENDED) {
      throw new ForbiddenException('This account is suspended.');
    }

    const passwordOk = await this.passwordHasher.verify(admin.passwordHash, password);
    if (!passwordOk) {
      await this.registerFailedAttempt(admin);
      await this.audit.record({ eventType: 'platform_admin.login.failure', tenantId: null, actorUserId: admin.id, metadata: { reason: 'bad_password', ...ipMeta(meta) } });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (!admin.totpEnabled || !admin.totpSecret) {
      // MFA is mandatory and non-negotiable for this role — an account
      // without TOTP enrolled cannot complete login (frozen Prerequisites).
      await this.audit.record({ eventType: 'platform_admin.login.blocked_mfa_not_enrolled', tenantId: null, actorUserId: admin.id });
      throw new ForbiddenException('Multi-factor authentication is required for this account but is not yet enrolled. Contact Platform Support.');
    }

    // Item 18 — clear a stale (now-expired) lock on a successful password,
    // same as the tenant-login flow already does.
    admin.failedLoginAttempts = 0;
    if (admin.status === PlatformAdminStatus.LOCKED) admin.status = PlatformAdminStatus.ACTIVE;
    await repo.save(admin);

    // Signed with the REFRESH secret, not the access secret, so this
    // short-lived ticket can never be mistaken for — or accepted by — the
    // normal JwtStrategy/OptionalJwtAuthGuard as a general bearer token
    // (signature mismatch -> rejected outright). It is only ever verified
    // manually, right here, for the single purpose of completing MFA.
    const jti = randomUUID();
    const mfaPayload: MfaPendingPayload = { sub: admin.id, mfaPending: true, jti };
    const mfaSecret = this.config.get<string>('jwt.refreshSecret')!;
    const ttlSeconds = this.config.get<number>('session.mfaTicketTtlSeconds') ?? 300;
    const mfaSessionToken = await this.jwtService.signAsync(mfaPayload, { secret: mfaSecret, expiresIn: `${ttlSeconds}s` });
    await this.audit.record({ eventType: 'platform_admin.login.password_step_success', tenantId: null, actorUserId: admin.id, metadata: { ...ipMeta(meta) } });
    return { mfaSessionToken };
  }

  /** Step 2 — TOTP. Only now are real access/refresh tokens issued. */
  async loginStep2Mfa(mfaSessionToken: string, totpCode: string, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    let decoded: MfaPendingPayload;
    try {
      const mfaSecret = this.config.get<string>('jwt.refreshSecret')!;
      decoded = await this.jwtService.verifyAsync<MfaPendingPayload>(mfaSessionToken, { secret: mfaSecret });
    } catch {
      throw new UnauthorizedException('MFA session expired or invalid. Please log in again.');
    }
    if (!decoded.mfaPending || !decoded.jti) {
      throw new UnauthorizedException('MFA session expired or invalid. Please log in again.');
    }

    // Item 18 — single-use ticket. A SETNX-style atomic claim: only the
    // first consumer of this jti ever succeeds, even under a race.
    const ticketKey = `fpo:mfa-ticket-used:${decoded.jti}`;
    const ttlSeconds = this.config.get<number>('session.mfaTicketTtlSeconds') ?? 300;
    const claimed = await this.redis.set(ticketKey, '1', 'EX', ttlSeconds, 'NX');
    if (claimed !== 'OK') {
      throw new UnauthorizedException('MFA session expired or invalid. Please log in again.');
    }

    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const admin = await repo.findOne({ where: { id: decoded.sub } });
    if (!admin || !admin.totpSecret) {
      throw new UnauthorizedException('MFA session expired or invalid. Please log in again.');
    }
    // Item 18 — re-check status here too: an admin suspended/locked between
    // step 1 and step 2 must not receive tokens.
    if (admin.status !== PlatformAdminStatus.ACTIVE) {
      throw new ForbiddenException('This account is no longer eligible to complete login. Contact Platform Support.');
    }

    const totpOk = await this.totpService.verify(totpCode, admin.totpSecret);
    if (!totpOk) {
      await this.audit.record({ eventType: 'platform_admin.login.mfa_failed', tenantId: null, actorUserId: admin.id, metadata: { ...ipMeta(meta) } });
      throw new UnauthorizedException('Incorrect authentication code.');
    }

    admin.lastLoginAt = new Date();
    await repo.save(admin);
    const tokens = await this.issueTokens(admin, meta);
    await this.audit.record({ eventType: 'platform_admin.login.success', tenantId: null, actorUserId: admin.id, metadata: { ...ipMeta(meta) } });
    return tokens;
  }

  private async registerFailedAttempt(admin: PlatformAdminAccountEntity): Promise<void> {
    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const maxAttempts = this.config.get<number>('accountLockout.maxFailedAttempts') ?? 5;
    const lockoutMinutes = this.config.get<number>('accountLockout.lockoutMinutes') ?? 15;
    admin.failedLoginAttempts += 1;
    let justLocked = false;
    if (admin.failedLoginAttempts >= maxAttempts) {
      admin.status = PlatformAdminStatus.LOCKED;
      admin.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      justLocked = true;
    }
    await repo.save(admin);
    if (justLocked) {
      await this.sessionStore.revokeAllSessionsForSubject('PLATFORM_ADMIN', admin.id);
      await this.audit.record({ eventType: 'platform_admin.account.lockout', tenantId: null, actorUserId: admin.id });
    }
  }

  private async issueTokens(admin: PlatformAdminAccountEntity, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    const adminId = admin.id;
    const expiryDays = this.config.get<number>('refreshToken.expiryDays') ?? 30;
    const ttlSeconds = expiryDays * 24 * 60 * 60;

    const session = await this.sessionStore.createSession({
      subjectType: 'PLATFORM_ADMIN',
      userId: adminId,
      tenantId: null,
      mfaCompleted: true, // only ever created right after a successful step-2
      ttlSeconds,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const payload: JwtPayload = { sub: adminId, tenantId: null, isPlatformSuperAdmin: true, platformRole: admin.role, sid: session.sessionId };
    const accessToken = await this.jwtService.signAsync(payload);

    const rawRefresh = this.secretHasher.generateOpaqueSecret();
    const repo = this.dataSource.getRepository(PlatformAdminRefreshTokenEntity);
    await repo.save(
      repo.create({
        adminId,
        sessionId: session.sessionId,
        tokenHash: this.secretHasher.hash(rawRefresh),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        revokedAt: null,
        rotatedToTokenId: null,
      }),
    );
    return { accessToken, refreshToken: rawRefresh };
  }

  async refresh(rawRefreshToken: string, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    const repo = this.dataSource.getRepository(PlatformAdminRefreshTokenEntity);
    const tokenHash = this.secretHasher.hash(rawRefreshToken);
    const record = await repo.findOne({ where: { tokenHash } });
    if (!record) throw new UnauthorizedException('Invalid refresh token.');

    // Item 13 — atomic rotation, identical CAS pattern to tenant AuthService.
    const casResult = await repo
      .createQueryBuilder()
      .update(PlatformAdminRefreshTokenEntity)
      .set({ revokedAt: new Date() })
      .where('id = :id', { id: record.id })
      .andWhere('revokedAt IS NULL')
      .execute();

    if (!casResult.affected) {
      await repo.update({ adminId: record.adminId }, { revokedAt: new Date() });
      if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
      await this.audit.record({ eventType: 'platform_admin.refresh_token.reuse_detected', tenantId: null, actorUserId: record.adminId, metadata: { ...ipMeta(meta) } });
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
      throw new UnauthorizedException('Refresh token expired.');
    }

    // Item 2 — re-check CURRENT admin state, not just the token row.
    const admin = await this.dataSource.getRepository(PlatformAdminAccountEntity).findOne({ where: { id: record.adminId } });
    if (!admin || admin.status !== PlatformAdminStatus.ACTIVE) {
      throw new UnauthorizedException('This account is no longer eligible to refresh its session.');
    }

    const newTokens = await this.issueTokens(admin, meta);
    const newHash = this.secretHasher.hash(newTokens.refreshToken);
    const newRecord = await repo.findOne({ where: { tokenHash: newHash } });
    // Same fix as AuthService.refreshTenantToken: `record` predates the
    // atomic CAS update above (still has revokedAt=null in memory), so a
    // full entity save here would silently un-revoke the token. Update only
    // the one column that actually needs to change.
    await repo.update({ id: record.id }, { rotatedToTokenId: newRecord?.id ?? null });
    if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
    return newTokens;
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const repo = this.dataSource.getRepository(PlatformAdminRefreshTokenEntity);
    const tokenHash = this.secretHasher.hash(rawRefreshToken);
    const record = await repo.findOne({ where: { tokenHash } });
    if (!record) return;
    await repo.update({ tokenHash }, { revokedAt: new Date() });
    if (record.sessionId) await this.sessionStore.revokeSession(record.sessionId);
    await this.audit.record({ eventType: 'platform_admin.logout', tenantId: null, actorUserId: record.adminId });
  }
}

function ipMeta(meta: RequestMetadata): Record<string, string> {
  return {
    ip: meta.ipAddress ?? 'unknown',
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : 'unknown',
  };
}
