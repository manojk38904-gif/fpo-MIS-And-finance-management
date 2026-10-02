import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

export enum BranchType {
  HEAD_OFFICE = 'HEAD_OFFICE',
  REGULAR = 'REGULAR',
}

/**
 * SET-03 — Branch Master (Multi-Branch Architecture master data, Master-SRS
 * §6). Deliberately NOT maker-checker-governed — Owner Decision #A's screen
 * list (v1.3 §4) does not include SET-03; Create/Edit take effect
 * immediately on Save (spec point 21), with their own independent
 * safety checks instead (unique code, single HEAD_OFFICE, safe-deactivate).
 */
@Entity('settings_branch')
@Index(['tenantId', 'branchCode'], { unique: true })
export class BranchEntity extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 32 })
  branchCode!: string;

  @Column({ type: 'varchar', length: 255 })
  branchName!: string;

  @Column({ type: 'enum', enum: BranchType, default: BranchType.REGULAR })
  branchType!: BranchType;

  @Column({ type: 'text' })
  address!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  district!: string | null;

  @Column({ type: 'uuid', nullable: true })
  managerUserId!: string | null;

  @Column({ type: 'date' })
  openingDate!: string;

  @Column({ type: 'boolean', default: true })
  @Index()
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  deactivationReason!: string | null;
}
