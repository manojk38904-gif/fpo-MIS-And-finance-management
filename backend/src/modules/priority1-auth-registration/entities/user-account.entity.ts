import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tenant-scoped (RLS). This is intentionally MINIMAL: Priority #1 v1.2 only
 * creates one kind of account — the Initial FPO-Admin, via the SA-01
 * approval hook (TenantActivationService). Full staff-user provisioning,
 * roles and RBAC are Priority #13's authoritative truth and are explicitly
 * NOT invented here (CA-1 scope-correction, kickoff instruction #6) — no
 * role/permission enum beyond the one distinction Priority #1 itself needs
 * (isInitialFpoAdmin, for SYS-04's "only the first account sees the wizard"
 * rule) is added.
 */
export enum UserAccountStatus {
  /** Setup-link issued, password not yet created (CA-1). */
  PENDING_SETUP = 'PENDING_SETUP',
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  SUSPENDED = 'SUSPENDED',
}

@Entity('user_account')
@Index(['tenantId', 'username'], { unique: true })
@Index(['tenantId', 'email'], { unique: true })
export class UserAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Explicit `name: 'tenant_id'`: enableTenantRls()'s policy SQL hardcodes the
  // snake_case column name `tenant_id` (matching TenantScopedEntity's own
  // convention) — without this override TypeORM's default naming strategy
  // would create a column literally named "tenantId", and the RLS policy
  // (CREATE POLICY ... USING (tenant_id = ...)) would fail to find it.
  @Column({ type: 'uuid', name: 'tenant_id' })
  @Index()
  tenantId!: string;

  @Column({ type: 'varchar', length: 128 })
  username!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mobile!: string | null;

  /** Argon2id hash. Null while PENDING_SETUP (no password exists yet, per CA-1). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'boolean', default: false })
  isInitialFpoAdmin!: boolean;

  /**
   * Added by Priority #13 (SET-07 Users), additive/nullable only — exactly
   * the "full staff-user provisioning, roles and RBAC" extension this
   * entity's own original comment anticipated. Null for the Initial FPO
   * Admin (created directly by Priority #1's own SA-01 hook, before any
   * Role exists to assign) until an Admin assigns one via SET-07.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  fullName!: string | null;

  @Column({ type: 'uuid', nullable: true })
  roleId!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  branchAccessScope!: 'SELECTED_BRANCH' | 'ALL_BRANCHES' | null;

  @Column({ type: 'enum', enum: UserAccountStatus, default: UserAccountStatus.PENDING_SETUP })
  status!: UserAccountStatus;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
