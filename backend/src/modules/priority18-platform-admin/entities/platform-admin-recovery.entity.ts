import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum RecoveryRequestStatus {
  PENDING_APPROVALS = 'PENDING_APPROVALS',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  COMPLETED = 'COMPLETED',
}

@Entity('platform_admin_recovery_request')
export class PlatformAdminRecoveryRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  targetAdminId!: string;

  @Column({ type: 'uuid' })
  requesterAdminId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'enum', enum: RecoveryRequestStatus, default: RecoveryRequestStatus.PENDING_APPROVALS })
  @Index()
  status!: RecoveryRequestStatus;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('platform_admin_recovery_approval')
@Unique(['requestId', 'approverAdminId'])
export class PlatformAdminRecoveryApprovalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  requestId!: string;

  @Column({ type: 'uuid' })
  approverAdminId!: string;

  @Column({ type: 'boolean' })
  approved!: boolean;

  @Column({ type: 'text' })
  reason!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
