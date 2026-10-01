import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PlatformAdminAccountEntity } from './platform-admin-account.entity.js';

/** No RLS, no tenant_id — see PlatformAdminAccountEntity. */
@Entity('platform_admin_refresh_token')
export class PlatformAdminRefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PlatformAdminAccountEntity, { onDelete: 'CASCADE' })
  admin!: PlatformAdminAccountEntity;

  @Column({ type: 'uuid' })
  @Index()
  adminId!: string;

  /** See UserRefreshTokenEntity.sessionId's identical doc-comment. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  sessionId!: string | null;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  rotatedToTokenId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
