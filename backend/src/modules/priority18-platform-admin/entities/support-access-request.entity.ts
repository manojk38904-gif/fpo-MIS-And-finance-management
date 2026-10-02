import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum SupportAccessStatus {
  PENDING_TENANT_CONSENT = 'PENDING_TENANT_CONSENT',
  DENIED = 'DENIED',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

@Entity('support_access_request')
export class SupportAccessRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  tenantId!: string;

  @Column({ type: 'uuid' })
  @Index()
  requestingAdminId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 128 })
  ticketContext!: string;

  @Column({ type: 'int' })
  requestedDurationMinutes!: number;

  @Column({ type: 'enum', enum: SupportAccessStatus, default: SupportAccessStatus.PENDING_TENANT_CONSENT })
  @Index()
  status!: SupportAccessStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'uuid', nullable: true })
  consentedByTenantUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  consentedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  viewedModuleSummary!: string[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
