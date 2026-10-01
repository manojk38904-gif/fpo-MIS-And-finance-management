import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { PasswordHasher } from '../../../common/security/password-hasher.js';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { PASSWORD_POLICY_PORT } from '../../../common/security/password-policy.port.js';
import type { PasswordPolicyPort } from '../../../common/security/password-policy.port.js';
import { SESSION_STORE_PORT } from '../../../common/session/session-store.port.js';
import type { SessionStorePort } from '../../../common/session/session-store.port.js';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../entities/user-account.entity.js';
import { OtpPurpose } from '../entities/otp-verification.entity.js';
import { OtpService } from './otp.service.js';

/** The ONE wording the frozen spec fixes exactly — never changed per branch. */
const GENERIC_STEP1_MESSAGE =
  'If an account matching the information provided exists, a reset code has been sent to the registered email.';

/**
 * SYS-06 — Forgot/Reset Password. Owner Decision #5: Step-1 response is
 * byte-identical whether or not the account exists (account-enumeration
 * prevention). A reset proceeds only if a real OTP was actually generated
 * for a real account; otherwise Step-2 always fails with the same generic
 * OTP error SYS-03 already uses — never distinguishing "account not found"
 * from "OTP incorrect".
 *
 * Correction-pass item 7 — the OTP's subjectId is the user's own account id
 * (not merely tenant+email), so a reset OTP can never be replayed against a
 * different account. Item 1/2 — a successful reset revokes every existing
 * session for that user (password-reset must invalidate already-issued
 * access tokens, not just future logins). Item 10 — the new password is
 * validated against the single authoritative PasswordPolicyPort.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
    private readonly otpService: OtpService,
    private readonly passwordHasher: PasswordHasher,
    private readonly secretHasher: SecretTokenHasher,
    @Inject(PASSWORD_POLICY_PORT) private readonly passwordPolicy: PasswordPolicyPort,
    @Inject(SESSION_STORE_PORT) private readonly sessionStore: SessionStorePort,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async requestReset(fpoCode: string, usernameOrEmailOrMobile: string): Promise<{ message: string; resetRequestId: string }> {
    const start = Date.now();
    const regRepo = this.dataSource.getRepository(FpoRegistrationEntity);
    const tenant = await regRepo.findOne({ where: { fpoCode, status: FpoRegistrationStatus.ACTIVE } });

    let realUser: UserAccountEntity | null = null;
    if (tenant) {
      realUser = await this.knownTenantTx.run(tenant.id, (manager) =>
        manager
          .getRepository(UserAccountEntity)
          .createQueryBuilder('u')
          .where('u.tenantId = :tenantId', { tenantId: tenant.id })
          .andWhere('(u.username = :id OR u.email = :id OR u.mobile = :id)', { id: usernameOrEmailOrMobile })
          .getOne(),
      );
    }

    if (tenant && realUser && realUser.status !== UserAccountStatus.SUSPENDED) {
      const { otpVerificationId } = await this.otpService.generate(realUser.email, OtpPurpose.PASSWORD_RESET, tenant.id, realUser.id);
      await this.audit.record({ eventType: 'password_reset.requested', tenantId: tenant.id, actorUserId: realUser.id });
      await this.equalizeTiming(start);
      return { message: GENERIC_STEP1_MESSAGE, resetRequestId: otpVerificationId };
    }

    // No real account: still perform equivalent-cost work (a hash operation)
    // and return an unusable, random reference so Step-2 always fails
    // generically — never a distinguishable response or timing (best-effort;
    // true constant-time guarantees are an infra/load-balancer-level concern
    // out of this pass's scope, honestly noted in the progress record).
    this.secretHasher.hash(usernameOrEmailOrMobile);
    await this.audit.record({ eventType: 'password_reset.requested_unknown_account', tenantId: null, metadata: {} });
    await this.equalizeTiming(start);
    return { message: GENERIC_STEP1_MESSAGE, resetRequestId: randomUUID() };
  }

  private async equalizeTiming(start: number): Promise<void> {
    const minimumMs = 120;
    const elapsed = Date.now() - start;
    if (elapsed < minimumMs) {
      await new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
    }
  }

  async resetPassword(resetRequestId: string, otp: string, newPassword: string, confirmNewPassword: string): Promise<void> {
    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException('New password and confirmation do not match.');
    }
    await this.passwordPolicy.assertValid(newPassword);

    // We don't yet know the subjectId (userId) the OTP was bound to without
    // reading the row — OtpService.verify requires it to match, so we first
    // peek the record's own subjectId via a narrow, read-only lookup scoped
    // to this one OTP id, then verify with that as the expected subject.
    // This still never trusts a client-supplied subjectId: the subject comes
    // from the server's own OTP row, not from the request.
    const peeked = await this.peekOtpSubject(resetRequestId);
    const result = peeked ? await this.otpService.verify(resetRequestId, OtpPurpose.PASSWORD_RESET, peeked.subjectId, otp).catch(() => null) : null;

    // Deliberately the SAME generic error shape as SYS-03 — never
    // distinguishes "no such request" from "wrong OTP" (Owner Decision #5).
    if (!result || !result.tenantId) {
      throw new BadRequestException('Invalid or expired OTP.');
    }

    const tenantId = result.tenantId;
    const userId = peeked!.subjectId;

    await this.knownTenantTx.run(tenantId, async (manager) => {
      const userRepo = manager.getRepository(UserAccountEntity);
      const user = await userRepo.findOne({ where: { id: userId, tenantId } });
      if (!user) throw new BadRequestException('Invalid or expired OTP.');

      user.passwordHash = await this.passwordHasher.hash(newPassword);
      user.failedLoginAttempts = 0;
      if (user.status === UserAccountStatus.LOCKED) user.status = UserAccountStatus.ACTIVE;
      await userRepo.save(user);
    });

    // Item 1/2 — password reset invalidates every existing session for this
    // user immediately (an attacker who had an old session open is logged
    // out the moment the legitimate owner resets their password).
    await this.sessionStore.revokeAllSessionsForSubject('TENANT_USER', userId);

    await this.audit.record({ eventType: 'password_reset.completed', tenantId, actorUserId: userId });
  }

  /** Read-only peek at which subject an OTP row was bound to — never trusts a client value. */
  private async peekOtpSubject(otpVerificationId: string): Promise<{ subjectId: string } | null> {
    const row = await this.dataSource.query(
      `SELECT "subjectId" FROM otp_verification WHERE id = $1 AND purpose = $2 LIMIT 1`,
      [otpVerificationId, OtpPurpose.PASSWORD_RESET],
    );
    if (!row[0]?.subjectId) return null;
    return { subjectId: row[0].subjectId };
  }
}
