import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

@Entity('settings_direct_config')
@Index(['tenantId', 'screenId', 'configKey', 'version'], { unique: true })
export class DirectSettingEntity extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 16 })
  @Index()
  screenId!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  configKey!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'uuid' })
  updatedBy!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
