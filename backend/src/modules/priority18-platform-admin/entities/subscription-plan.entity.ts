import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SubscriptionPlanStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUPERSEDED = 'SUPERSEDED',
}

@Entity('subscription_plan')
@Index(['planCode', 'version'], { unique: true })
export class SubscriptionPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  planCode!: string;

  @Column({ type: 'varchar', length: 128 })
  planName!: string;

  @Column({ type: 'jsonb' })
  limits!: Record<string, number | boolean | string>;

  @Column({ type: 'jsonb' })
  features!: Record<string, boolean | string | number>;

  @Column({ type: 'date' })
  effectiveDate!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'enum', enum: SubscriptionPlanStatus, default: SubscriptionPlanStatus.ACTIVE })
  @Index()
  status!: SubscriptionPlanStatus;

  @Column({ type: 'uuid' })
  changedBy!: string;

  @Column({ type: 'text' })
  reason!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
