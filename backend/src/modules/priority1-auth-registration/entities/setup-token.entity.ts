import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserAccountEntity } from './user-account.entity.js';

/**
 * CA-1 — time-limited, single-use secure setup-link (Initial FPO-Admin
 * ONLY, per the v1.2 scope correction — never extended to all staff users).
 *
 * Deliberately NOT RLS-protected: this table's access pattern is "look up
 * the one row matching an unguessable, globally-unique secret hash" — which
 * is incompatible with tenant-context-gated row access (the whole point is
 * to resolve the row, and therefore its tenant, FROM the secret, before any
 * tenant context can exist). The row is already unforgeable/unenumerable
 * because tokenHash is a 256-bit random value's deterministic HMAC — RLS
 * would add no real protection here and would break the lookup entirely.
 * tenantId is a plain filter/denormalization column, same category as
 * otp_verification.tenantId. tokenHash is a deterministic HMAC
 * (SecretTokenHasher) of the raw token embedded in the emailed link URL —
 * the raw value is never stored, logged, or audited; only this hash and
 * lifecycle timestamps are.
 */
@Entity('setup_token')
export class SetupTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  tenantId!: string;

  @ManyToOne(() => UserAccountEntity, { onDelete: 'CASCADE' })
  user!: UserAccountEntity;

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
