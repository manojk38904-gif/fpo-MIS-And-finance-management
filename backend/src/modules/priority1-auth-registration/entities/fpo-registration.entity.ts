import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * SYS-02 — FPO Self-Registration. This is a PLATFORM-level table (no RLS,
 * no tenant_id) because it is explicitly the pre-tenant record: the tenant
 * does not exist yet while status is DRAFT/OTP_VERIFIED/SUBMITTED/
 * UNDER_VERIFICATION, and this same row becomes the tenant's own identity
 * once APPROVED → ACTIVE (its id IS the tenant_id used everywhere else in
 * the system, per the frozen shared-DB + tenant_id + RLS strategy).
 *
 * Field list is exactly the frozen Priority #1 v1.2 SYS-02 field list
 * (Step 1-3 + Step 5 terms) — nothing invented, nothing omitted.
 *
 * Approval itself (status DRAFT.../SUBMITTED/UNDER_VERIFICATION → APPROVED)
 * is Priority #18's SA-01 screen — out of this task's scope. This table and
 * TenantActivationService below expose only the narrow, documented hook that
 * SYS-02's own spec text says happens "right after" that approval action
 * (FPO-Code generation, Initial-Admin creation, setup-link issuance) — see
 * TenantActivationService for the exact boundary.
 */
export enum FpoRegistrationStatus {
  DRAFT = 'DRAFT',
  OTP_VERIFIED = 'OTP_VERIFIED',
  SUBMITTED = 'SUBMITTED',
  UNDER_VERIFICATION = 'UNDER_VERIFICATION',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ACTIVE = 'ACTIVE',
}

/**
 * Correction-pass item 5: a DRAFT must be able to genuinely hold incomplete
 * Step 1-4 data (e.g. just `fpoName`, saved and resumed later). Every
 * business field below is therefore DB-nullable — completeness is enforced
 * exactly once, at SUBMIT time, in RegistrationService.submit()'s own
 * explicit mandatory-field loop, which is unaffected by this column-level
 * relaxation (nullable at the DB layer is not the same as optional at
 * submit time, and submit's check was never weakened).
 */
@Entity('fpo_registration')
export class FpoRegistrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Step 1 — Organisation
  @Column({ type: 'varchar', length: 255, nullable: true })
  fpoName!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index({ unique: false })
  cin!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  registrationNumber!: string | null;

  @Column({ type: 'date', nullable: true })
  incorporationDate!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  @Index({ unique: false })
  pan!: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  gstin!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  chairmanName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ceoName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorisedPersonName!: string | null;

  // Step 2 — Address/Contact
  @Column({ type: 'text', nullable: true })
  registeredAddress!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  officialMobile!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  officialEmail!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website!: string | null;

  // Step 3 — Bank
  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 34, nullable: true })
  bankAccountNumber!: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true })
  bankIfsc!: string | null;

  // Step 5 — Review/Submit
  @Column({ type: 'boolean', default: false })
  termsAccepted!: boolean;

  // Lifecycle
  @Column({ type: 'enum', enum: FpoRegistrationStatus, default: FpoRegistrationStatus.DRAFT })
  @Index()
  status!: FpoRegistrationStatus;

  @Column({ type: 'boolean', default: false })
  emailOtpVerified!: boolean;

  /**
   * Platform-generated, unique, immutable tenant identifier (Owner Decision
   * #6). Null until the SA-01 approval hook (TenantActivationService) runs.
   * Never user-editable anywhere, including after activation.
   */
  @Column({ type: 'varchar', length: 32, nullable: true, unique: true })
  fpoCode!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  /** Set only once SYS-04's Go-Live Validation Gate has passed server-side. */
  @Column({ type: 'timestamptz', nullable: true })
  liveAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
