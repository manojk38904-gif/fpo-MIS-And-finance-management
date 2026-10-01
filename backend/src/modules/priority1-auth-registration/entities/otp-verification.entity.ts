import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * SYS-03 — reusable Email-OTP component (Registration + Password-Reset;
 * Mobile is future-ready-only per Owner Decision #3, not implemented here).
 *
 * PLATFORM-level table, no RLS: registration-flow OTPs are inherently
 * pre-tenant (no tenant exists yet), so a generic tenant-scoped RLS policy
 * would make them unreadable under any context (deny-by-default denies rows
 * with no matching tenant context, AND NULL tenant_id never equality-matches
 * anything in SQL). tenantId here is a nullable FILTER column only, used by
 * service-layer queries for the password-reset case (SYS-06) where a tenant
 * is already known — it carries no RLS enforcement of its own.
 *
 * otpHash: a deterministic HMAC (SecretTokenHasher), never the raw OTP value
 * and never a randomly-salted hash (argon2 cannot support lookup-by-hash).
 */
export enum OtpPurpose {
  REGISTRATION = 'REGISTRATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

@Entity('otp_verification')
export class OtpVerificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  tenantId!: string | null;

  /**
   * Correction-pass item 7 — OTP subject-binding. An OTP must be bound to
   * `subjectId + purpose + identifier`, never to `purpose + identifier`
   * alone — otherwise an OTP issued for one subject (e.g. Registration A)
   * could verify a request naming a DIFFERENT subject that happens to share
   * the same identifier (e.g. Registration B using the same email). For
   * REGISTRATION this is the `fpo_registration.id`; for PASSWORD_RESET it is
   * the tenant user's own `user_account.id` (tenantId already narrows it,
   * but the explicit userId closes the same binding gap for this purpose
   * too). OtpService.verify() requires the caller's own independently-known
   * subjectId to match this column — never trusts a client-supplied one.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  @Index()
  subjectId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  identifier!: string;

  @Column({ type: 'enum', enum: OtpPurpose })
  purpose!: OtpPurpose;

  @Column({ type: 'varchar', length: 64 })
  otpHash!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'int' })
  maxAttempts!: number;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz' })
  resendAvailableAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
