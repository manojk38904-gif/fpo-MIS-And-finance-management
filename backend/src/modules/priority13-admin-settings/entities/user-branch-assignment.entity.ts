import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

@Entity('settings_user_branch_assignment')
@Index(['tenantId', 'userId'])
export class UserBranchAssignmentEntity extends TenantScopedEntity {
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  permissionLevel!: string | null;

  @Column({ type: 'date', nullable: true })
  effectiveFrom!: string | null;

  @Column({ type: 'date', nullable: true })
  effectiveTo!: string | null;
}
