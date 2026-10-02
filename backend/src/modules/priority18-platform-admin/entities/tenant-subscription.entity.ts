import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TenantSubscriptionState {
  ACTIVE = 'ACTIVE',
  NEARING_EXPIRY = 'NEARING_EXPIRY',
  GRACE = 'GRACE',
  EXPIRED_READ_ONLY = 'EXPIRED_READ_ONLY',
  SUSPENDED = 'SUSPENDED',
  REACTIVATED = 'REACTIVATED',
}

@Entity('tenant_subscription')
@Index(['tenantId', 'createdAt'])
export class TenantSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  tenantId!: string;

  @Column({ type: 'uuid' })
  planVersionId!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  expiryDate!: string;

  @Column({ type: 'enum', enum: TenantSubscriptionState })
  @Index()
  state!: TenantSubscriptionState;

  @Column({ type: 'int' })
  gracePeriodDays!: number;

  @Column({ type: 'jsonb', nullable: true })
  usageSnapshot!: Record<string, number> | null;

  @Column({ type: 'uuid' })
  changedBy!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid', nullable: true })
  supersedesId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reactivatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
