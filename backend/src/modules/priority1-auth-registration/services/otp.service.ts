import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SecretTokenHasher } from '../../../common/security/secret-token-hasher.js';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { EMAIL_DELIVERY_PORT } from '../../../common/delivery/email-delivery.port.js';
import type { EmailDeliveryPort, EmailTemplate } from '../../../common/delivery/email-delivery.port.js';
import { OtpPurpose, OtpVerificationEntity } from '../entities/otp-verification.entity.js';

const TEMPLATE_BY_PURPOSE: Record<OtpPurpose, EmailTemplate> = {
  [OtpPurpose.REGISTRATION]: 'REGISTRATION_OTP',
  [OtpPurpose.PASSWORD_RESET]: 'PASSWORD_RESET_OTP',
};

/**
 * SYS-03 — reusable Email-OTP component (Registration + Password-Reset).
 * TTL, attempt-limit and resend-cooldown are all configurable (never
 * hard-coded, per the frozen text's own instruction not to invent fixed
 * limits where the spec leaves them configurable) — defaults below are
 * illustrative starting values, overridable via env/config, exactly like
 * SYS-05's password-complexity illustrative-not-hardcoded principle.
 *
 * otpHash is a deterministic HMAC (never the raw OTP value) — never logged,
 * never audited. Audit only records generate/verify/fail/resend EVENTS.
 *
 * Correction-pass item 7 — SUBJECT BINDING. An OTP is bound to
 * `subjectId + purpose + identifier`, not merely `purpose + identifier`. An
 * OTP issued for one subject (e.g. Registration A) can never verify a
 * request naming a different subject (Registration B), even if both happen
 * to use the same email address. `subjectId` must be supplied by the CALLER
 * from its own independently-known context (e.g. RegistrationService passes
 * its own registrationId) — never trusted from client input directly.
 *
 * Correction-pass item 8 — NO RAW OTP LOGGING, anywhere, including dev. The
 * previous `console.log`/`OTP_DEV_ECHO` hook is removed entirely; delivery
 * goes through EmailDeliveryPort, whose test binding (InMemoryEmailDeliveryAdapter)
 * is how tests observe an OTP, never a log line.
 */
@Injectable()
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: SecretTokenHasher,
    config: ConfigService,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
    @Inject(EMAIL_DELIVERY_PORT) private readonly emailDelivery: EmailDeliveryPort,
  ) {
    this.ttlSeconds = config.get<number>('otp.ttlSeconds') ?? 600; // 10 minutes, per SYS-03 helper-card example
    this.maxAttempts = config.get<number>('otp.maxAttempts') ?? 3;
    this.resendCooldownSeconds = config.get<number>('otp.resendCooldownSeconds') ?? 30;
  }

  async generate(identifier: string, purpose: OtpPurpose, tenantId: string | null, subjectId: string): Promise<{ otpVerificationId: string }> {
    const repo = this.dataSource.getRepository(OtpVerificationEntity);
    const now = new Date();

    const recent = await repo
      .createQueryBuilder('o')
      .where('o.identifier = :identifier', { identifier })
      .andWhere('o.purpose = :purpose', { purpose })
      .andWhere('o.subjectId = :subjectId', { subjectId })
      .andWhere('o.consumedAt IS NULL')
      .andWhere('o.resendAvailableAt > :now', { now })
      .getOne();
    if (recent) {
      throw new HttpException('Please wait before requesting another OTP.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const otp = this.hasher.generateNumericOtp(6);
    const entity = repo.create({
      tenantId,
      identifier,
      purpose,
      subjectId,
      otpHash: this.hasher.hash(`${subjectId}:${purpose}:${identifier}:${otp}`),
      attempts: 0,
      maxAttempts: this.maxAttempts,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      resendAvailableAt: new Date(now.getTime() + this.resendCooldownSeconds * 1000),
      consumedAt: null,
    });
    const saved = await repo.save(entity);

    await this.audit.record({
      eventType: 'otp.generated',
      tenantId,
      subjectId: saved.id,
      metadata: { purpose, identifierMasked: maskIdentifier(identifier) },
    });

    await this.emailDelivery.send({
      to: identifier,
      template: TEMPLATE_BY_PURPOSE[purpose],
      data: { otp, ttlMinutes: String(Math.round(this.ttlSeconds / 60)) },
    });

    return { otpVerificationId: saved.id };
  }

  async verify(otpVerificationId: string, purpose: OtpPurpose, subjectId: string, candidateOtp: string): Promise<{ identifier: string; tenantId: string | null }> {
    const repo = this.dataSource.getRepository(OtpVerificationEntity);
    const record = await repo.findOne({ where: { id: otpVerificationId, purpose, subjectId } });

    if (!record || record.consumedAt) {
      await this.audit.record({ eventType: 'otp.verify.failed', tenantId: null, subjectId: otpVerificationId, metadata: { reason: 'not_found_or_consumed' } });
      throw new BadRequestException('Invalid or expired OTP.');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      await this.audit.record({ eventType: 'otp.verify.failed', tenantId: record.tenantId, subjectId: record.id, metadata: { reason: 'expired' } });
      throw new BadRequestException('Invalid or expired OTP.');
    }
    if (record.attempts >= record.maxAttempts) {
      await this.audit.record({ eventType: 'otp.verify.failed', tenantId: record.tenantId, subjectId: record.id, metadata: { reason: 'attempt_limit' } });
      throw new BadRequestException('Too many incorrect attempts. Please request a new OTP.');
    }

    const isCorrect = this.hasher.verify(`${subjectId}:${purpose}:${record.identifier}:${candidateOtp}`, record.otpHash);

    // Correction-pass item 13 — atomic consumption. A conditional UPDATE
    // (WHERE consumedAt IS NULL) is the compare-and-set: only the first of
    // several concurrent verify calls for the SAME record can ever flip
    // consumedAt from NULL, so at most one can succeed even if two requests
    // read the same not-yet-consumed row at the same time.
    if (!isCorrect) {
      await repo.increment({ id: record.id }, 'attempts', 1);
      await this.audit.record({
        eventType: 'otp.verify.failed',
        tenantId: record.tenantId,
        subjectId: record.id,
        metadata: { reason: 'incorrect', remainingAttempts: record.maxAttempts - (record.attempts + 1) },
      });
      throw new BadRequestException(`Incorrect OTP (${record.maxAttempts - (record.attempts + 1)} attempts remaining).`);
    }

    const updateResult = await repo
      .createQueryBuilder()
      .update(OtpVerificationEntity)
      .set({ consumedAt: new Date() })
      .where('id = :id', { id: record.id })
      .andWhere('consumedAt IS NULL')
      .execute();

    if (!updateResult.affected) {
      // Another concurrent call already consumed it first.
      await this.audit.record({ eventType: 'otp.verify.failed', tenantId: record.tenantId, subjectId: record.id, metadata: { reason: 'already_consumed_concurrently' } });
      throw new BadRequestException('Invalid or expired OTP.');
    }

    await this.audit.record({ eventType: 'otp.verify.success', tenantId: record.tenantId, subjectId: record.id });

    return { identifier: record.identifier, tenantId: record.tenantId };
  }
}

function maskIdentifier(identifier: string): string {
  const at = identifier.indexOf('@');
  if (at <= 1) return '***';
  return `${identifier[0]}***${identifier.slice(at)}`;
}
