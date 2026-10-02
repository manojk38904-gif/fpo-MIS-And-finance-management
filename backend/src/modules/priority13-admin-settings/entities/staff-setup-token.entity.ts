import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * SET-07 staff credential bootstrap. This is deliberately separate from
 * Priority #1 CA-1's Initial-Admin-only setup_token lifecycle.
 *
 * Lookup is by an unguessable secret hash before tenant context exists, so
 * this table is not tenant-RLS gated. The raw secret is never persisted.
 */
@Entity('settings_staff_setup_token')
export class StaffSetupTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  tenantId!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
