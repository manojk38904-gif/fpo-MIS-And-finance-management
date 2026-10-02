import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

export enum GovernedSettingStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  REJECTED = 'REJECTED',
  SENT_BACK = 'SENT_BACK',
  SUPERSEDED = 'SUPERSEDED',
}

export enum GovernedSettingAction {
  UPSERT = 'UPSERT',
  DEACTIVATE = 'DEACTIVATE',
  REACTIVATE = 'REACTIVATE',
}

@Entity('settings_governed_config')
@Index(['tenantId', 'screenId', 'configKey', 'version'], { unique: true })
export class GovernedSettingEntity extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 16 })
  @Index()
  screenId!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  configKey!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'enum', enum: GovernedSettingAction, default: GovernedSettingAction.UPSERT })
  action!: GovernedSettingAction;

  @Column({ type: 'enum', enum: GovernedSettingStatus, default: GovernedSettingStatus.DRAFT })
  @Index()
  status!: GovernedSettingStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'uuid' })
  makerId!: string;

  @Column({ type: 'uuid', nullable: true })
  checkerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  supersedesId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;
}
