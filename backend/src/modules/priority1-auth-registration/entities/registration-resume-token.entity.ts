import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Correction-pass item 6 — secure Save-&-Exit / resume. Knowledge of a
 * registration's bare UUID is NOT, by itself, authority to read or edit it
 * (SYS-02's own sensitive fields include PAN/bank details). This table is
 * the same lookup-by-secret-hash pattern as SetupTokenEntity/
 * UserRefreshTokenEntity — deliberately NOT RLS-protected (pre-tenant, and
 * the row must be found FROM the secret), expiring, and re-issuable: issuing
 * a fresh token invalidates every prior one for the same registration (one
 * live resume token per registration at a time), which is this
 * implementation's "controlled re-issuance". The raw token is only ever
 * returned once (at creation/re-issuance, to be emailed) and never logged.
 */
@Entity('registration_resume_token')
export class RegistrationResumeTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  registrationId!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
