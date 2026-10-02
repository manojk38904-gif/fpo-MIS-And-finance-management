import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';

export enum DataExportStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('settings_data_export_request')
export class DataExportRequestEntity extends TenantScopedEntity {
  @Column({ type: 'uuid' })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 32 })
  scope!: 'ALL_DATA' | 'SELECTED_MODULES';

  @Column({ type: 'jsonb', nullable: true })
  modules!: string[] | null;

  @Column({ type: 'date', nullable: true })
  fromDate!: string | null;

  @Column({ type: 'date', nullable: true })
  toDate!: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'enum', enum: DataExportStatus, default: DataExportStatus.QUEUED })
  @Index()
  status!: DataExportStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'text', nullable: true })
  secureDownloadReference!: string | null;
}
