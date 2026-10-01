import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * SYS-04 — 16-step Onboarding Wizard, STATUS TRACKING ONLY. The wizard
 * reuses Priority #13's Settings screens for each step's actual field data
 * (frozen "Settings Cross-Reference" approach) — Priority #13 is not the
 * business-implementation target of this task, so Priority #1 does not
 * duplicate that settings truth here. This entity only tracks per-tenant
 * step completion state, which genuinely belongs to Priority #1 (it drives
 * SYS-04's own stepper UI and the Go-Live gate).
 *
 * Tenant-scoped (RLS). stepNumber is exactly 1-16, matching the frozen,
 * unreordered, unmerged step list — no step invented, none renamed.
 */
export enum OnboardingStepStatus {
  PENDING = 'PENDING',
  CURRENT = 'CURRENT',
  COMPLETE = 'COMPLETE',
  SKIPPED = 'SKIPPED',
}

/**
 * Correction-pass item 17: the frozen Priority #1 v1.2 text's "पाँच Explicit
 * Properties (Owner Decision #7)" §1-2 ONLY classifies steps {1,3,4,6,7,8,9,
 * 10,12} as non-skippable-mandatory and {13,14,15} as skippable-optional. It
 * does NOT conclusively classify steps 2 (Logo & Branding), 5 (Bank
 * Accounts), 11 (Staff Users), 16 (Authorised Signatures) either way in that
 * enumeration. The previous pass silently invented "non-skippable" for all
 * four — exactly the unauthorised invention the Owner's correction flags.
 *
 * Per the Owner's own instruction ("if the frozen text does not conclusively
 * classify 2/5/11/16, record: OWNER DECISION/SPECIFICATION CLARIFICATION
 * REQUIRED rather than deciding on behalf of the Owner"), this is NOT
 * resolved here. `skippable: false` below for steps 2/5/11/16 is kept ONLY
 * as the safer interim runtime default (so Go-Live cannot be bypassed by a
 * missing classification) — it is explicitly NOT a claim that the frozen
 * spec requires this, and must not be read as such. See
 * FPO_SaaS_PHASE_2.2_PHASE1_IMPLEMENTATION_PROGRESS_v1.0.md §"Open Owner
 * Decisions" for the formally recorded open item.
 */
export const ONBOARDING_STEPS: ReadonlyArray<{ stepNumber: number; name: string; skippable: boolean }> = [
  { stepNumber: 1, name: 'Organisation Profile', skippable: false }, // frozen: mandatory
  { stepNumber: 2, name: 'Logo & Branding', skippable: false }, // UNCLASSIFIED in frozen text — interim default only, OWNER DECISION REQUIRED
  { stepNumber: 3, name: 'Registered Office', skippable: false }, // frozen: mandatory
  { stepNumber: 4, name: 'Branches / Head Office', skippable: false }, // frozen: mandatory
  { stepNumber: 5, name: 'Bank Accounts', skippable: false }, // UNCLASSIFIED in frozen text — interim default only, OWNER DECISION REQUIRED
  { stepNumber: 6, name: 'Financial Year', skippable: false }, // frozen: mandatory
  { stepNumber: 7, name: 'Credit Policy', skippable: false }, // frozen: mandatory
  { stepNumber: 8, name: 'Interest Policy', skippable: false }, // frozen: mandatory
  { stepNumber: 9, name: 'Loan Products', skippable: false }, // frozen: mandatory
  { stepNumber: 10, name: 'Approval Hierarchy', skippable: false }, // frozen: mandatory
  { stepNumber: 11, name: 'Staff Users (+ Branch assignment)', skippable: false }, // UNCLASSIFIED in frozen text — interim default only, OWNER DECISION REQUIRED
  { stepNumber: 12, name: 'Accounting Settings', skippable: false }, // frozen: mandatory
  { stepNumber: 13, name: 'Email Settings', skippable: true }, // frozen: optional-integration
  { stepNumber: 14, name: 'WhatsApp Settings', skippable: true }, // frozen: optional-integration
  { stepNumber: 15, name: 'Document Templates', skippable: true }, // frozen: optional-integration
  { stepNumber: 16, name: 'Authorised Signatures', skippable: false }, // UNCLASSIFIED in frozen text — interim default only, OWNER DECISION REQUIRED
];

/** Steps the frozen text leaves unclassified — surfaced here (not only in a
 *  comment) so the progress record / report can render this mechanically,
 *  not by re-reading source comments. */
export const ONBOARDING_STEPS_PENDING_OWNER_CLASSIFICATION: ReadonlyArray<number> = [2, 5, 11, 16];

@Entity('onboarding_step_progress')
@Index(['tenantId', 'stepNumber'], { unique: true })
export class OnboardingStepProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // See UserAccountEntity's identical comment: explicit snake_case column
  // name is required for enableTenantRls()'s hardcoded `tenant_id` policy SQL.
  @Column({ type: 'uuid', name: 'tenant_id' })
  @Index()
  tenantId!: string;

  @Column({ type: 'int' })
  stepNumber!: number;

  @Column({ type: 'enum', enum: OnboardingStepStatus, default: OnboardingStepStatus.PENDING })
  status!: OnboardingStepStatus;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
