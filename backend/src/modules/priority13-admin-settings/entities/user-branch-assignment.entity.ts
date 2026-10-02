import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

/**
 * Effective (approved) SELECTED_BRANCH assignments for a user — written only
 * when a SET-07 user-provisioning request reaches ACTIVE. This is the actual
 * `user_branch_assignments` table the frozen spec names (SET-09 point 2).
 * Rows are replaced wholesale on each approved change (delete-then-insert in
 * the same transaction as the approval), never edited in place — history of
 * who had access when lives in the request lineage (settings_user_request),
 * not here.
 */
@Entity('settings_user_branch_assignment')
@Index(['tenantId', 'userId'])
export class UserBranchAssignmentEntity extends TenantScopedEntity {
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ type: 'uuid' })
  branchId!: string;
}
