import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * SYS-01-B — Platform Super Admin / Support Admin identity. Deliberately a
 * SEPARATE table from UserAccountEntity (never mixed into Priority #13's
 * tenant-user truth, per kickoff instruction #10) and carries NO tenant_id
 * and NO RLS — it is genuinely platform-level, not a tenant-scoped table
 * given a null tenant_id (kickoff instruction #14: platform-owned tables
 * must not be incorrectly forced into tenant ownership).
 *
 * Provisioning of the first platform-admin account is out-of-band / ops-side
 * — Priority #1 v1.2 does not specify a self-service platform-admin sign-up
 * flow (there isn't one; this is a highest-privilege account), so none is
 * invented here.
 *
 * MFA/TOTP is mandatory for this role (frozen, SYS-01-B Prerequisites).
 */
export enum PlatformAdminStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED',
}

export enum PlatformAdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPPORT_ADMIN = 'SUPPORT_ADMIN',
}

@Entity('platform_admin_account')
export class PlatformAdminAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** Base32 TOTP secret (RFC 6238). Mandatory before login is permitted. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  totpSecret!: string | null;

  @Column({ type: 'boolean', default: false })
  totpEnabled!: boolean;

  @Column({ type: 'enum', enum: PlatformAdminRole, default: PlatformAdminRole.SUPER_ADMIN })
  role!: PlatformAdminRole;

  @Column({ type: 'enum', enum: PlatformAdminStatus, default: PlatformAdminStatus.ACTIVE })
  status!: PlatformAdminStatus;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
