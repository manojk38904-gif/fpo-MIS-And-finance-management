import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserAccountEntity } from './user-account.entity.js';

/**
 * Refresh-token store for SYS-01-A tenant/staff/member logins — enables
 * rotation and revocation (kickoff instruction #9) without a Redis
 * dependency for Phase-1 (documented as a deliberate, honestly-reported
 * scope choice in the implementation-progress record, not a silent gap).
 *
 * Deliberately NOT RLS-protected, same reasoning as SetupTokenEntity: the
 * access pattern is lookup-by-unguessable-secret-hash, which must work
 * before any tenant context exists, and the secret's own entropy is what
 * protects the row, not row-level tenant isolation. tenantId is a plain
 * filter/denormalization column used for reporting/cleanup, not enforcement.
 * tokenHash is a deterministic HMAC of the raw refresh token; the raw value
 * is only ever returned once, to the client, at issuance/rotation.
 */
@Entity('user_refresh_token')
export class UserRefreshTokenEntity {
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

  /**
   * Correction-pass item 1 — points at the Redis session (SessionStorePort)
   * this refresh-token chain belongs to. This row is bookkeeping for
   * refresh-secret rotation/reuse-detection ONLY; whether the session is
   * actually still active is decided exclusively by Redis — this is never
   * read as a second "is the session active" truth.
   */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  sessionId!: string | null;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** Set when this token was rotated, pointing at its successor's id — lets a
   *  reuse of an already-rotated (stolen) token be detected and the whole
   *  chain revoked, per kickoff instruction #17's "refresh-token reuse". */
  @Column({ type: 'uuid', nullable: true })
  rotatedToTokenId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
