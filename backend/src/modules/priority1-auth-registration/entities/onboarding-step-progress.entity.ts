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
 * Owner completion decision (2026-10-03) resolves the four previously
 * unclassified SYS-04 onboarding steps without changing the frozen
 * mandatory list:
 *
 * 2  Logo & Branding       = OPTIONAL
 * 5  Bank Accounts         = CONDITIONAL-MANDATORY (not a basic Go-Live
 *                            blocker; required by bank-dependent operations)
 * 11 Staff Users           = OPTIONAL AT INITIAL GO-LIVE
 * 16 Authorised Signatures = CONDITIONAL-MANDATORY (not a basic Go-Live
 *                            blocker; required by signature-dependent flows)
 *
 * In SYS-04 this means all four may be skipped during basic onboarding.
 * Their conditional downstream enforcement belongs to the owning operation
 * that actually needs the bank/signature configuration and must never be
 * satisfied by fake placeholder data.
 */
export const ONBOARDING_STEPS: ReadonlyArray<{ stepNumber: number; name: string; skippable: boolean }> = [
  { stepNumber: 1, name: 'Organisation Profile', skippable: false },
  { stepNumber: 2, name: 'Logo & Branding', skippable: true },
  { stepNumber: 3, name: 'Registered Office', skippable: false },
  { stepNumber: 4, name: 'Branches / Head Office', skippable: false },
  { stepNumber: 5, name: 'Bank Accounts', skippable: true },
  { stepNumber: 6, name: 'Financial Year', skippable: false },
  { stepNumber: 7, name: 'Credit Policy', skippable: false },
  { stepNumber: 8, name: 'Interest Policy', skippable: false },
  { stepNumber: 9, name: 'Loan Products', skippable: false },
  { stepNumber: 10, name: 'Approval Hierarchy', skippable: false },
  { stepNumber: 11, name: 'Staff Users (+ Branch assignment)', skippable: true },
  { stepNumber: 12, name: 'Accounting Settings', skippable: false },
  { stepNumber: 13, name: 'Email Settings', skippable: true },
  { stepNumber: 14, name: 'WhatsApp Settings', skippable: true },
  { stepNumber: 15, name: 'Document Templates', skippable: true },
  { stepNumber: 16, name: 'Authorised Signatures', skippable: true },
];

export const ONBOARDING_STEPS_PENDING_OWNER_CLASSIFICATION: ReadonlyArray<number> = [];

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
