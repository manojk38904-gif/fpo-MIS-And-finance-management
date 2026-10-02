import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';
import { ApprovalStatus } from './approval-status.enum.js';

export enum UserRequestActionType {
  CREATE = 'CREATE',
  EDIT = 'EDIT',
  DEACTIVATE = 'DEACTIVATE',
  REACTIVATE = 'REACTIVATE',
}

export type BranchAccessScope = 'SELECTED_BRANCH' | 'ALL_BRANCHES';

/**
 * SET-07 — Users, Owner Decision #A (MANDATORY MAKER-CHECKER): "User-Create/
 * Role-Assignment/Branch-Assignment/Deactivation" are all governed here, as
 * one unified request lineage per real `user_account` row — the frozen spec
 * explicitly lists these as the SAME governance pattern, not four separate
 * screens. SET-09 (Branch Access) is the one piece of SET-07's own scope
 * NOT yet folded in here (see priority13-admin-settings.module.ts) — that
 * remains a standalone screen for changing branch access independently of
 * the rest of a user's profile, still to be built.
 *
 * `actionType` disambiguates what the request does; `supersedesUserId` links
 * an EDIT/DEACTIVATE/REACTIVATE request to the real UserAccountEntity row it
 * targets (null only for a brand-new CREATE).
 */
@Entity('settings_user_request')
@Index(['tenantId', 'supersedesUserId'])
export class UserProvisioningRequestEntity extends TenantScopedEntity {
  @Column({ type: 'enum', enum: UserRequestActionType })
  actionType!: UserRequestActionType;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  supersedesUserId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fullName!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  /** Must reference an ACTIVE settings_role row in the same tenant (validated at submit, not a DB FK — mirrors RoleEntity's own tenant-scoped validation pattern). */
  @Column({ type: 'uuid', nullable: true })
  roleId!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  branchAccessScope!: BranchAccessScope | null;

  /** Branch ids, only meaningful when branchAccessScope = SELECTED_BRANCH. */
  @Column({ type: 'jsonb', nullable: true })
  selectedBranchIds!: string[] | null;

  @Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.DRAFT })
  @Index()
  status!: ApprovalStatus;

  @Column({ type: 'uuid' })
  makerId!: string;

  @Column({ type: 'uuid', nullable: true })
  checkerId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;
}
