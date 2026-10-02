import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from '../../../common/entities/tenant-scoped.entity.js';
import { ApprovalStatus } from './approval-status.enum.js';

/**
 * SET-08 — Roles & Permissions. Master-SRS §7's exact action list (the
 * frozen spec names these verbatim, point 4): VIEW, CREATE, EDIT, VERIFY,
 * APPROVE, REJECT, DISBURSE, COLLECT, REVERSE, DOWNLOAD, EXPORT, PRINT,
 * CONFIGURE, ISSUE, RETURN, ADJUST, TRANSFER, RECONCILE.
 *
 * `permissions` is a Module -> Action[] matrix (e.g. {"SETTINGS": ["VIEW",
 * "CONFIGURE"]}) stored as jsonb — the frozen spec does not freeze a fixed
 * module list or a normalised join-table schema, only the checkbox-grid
 * concept and the action vocabulary above, so a flexible matrix is used
 * rather than inventing a rigid schema the spec never specified.
 *
 * Versioning: a role "row" is really one version in a lineage. Creating a
 * new role, or editing an existing one, both insert a NEW row. `supersedesId`
 * links a pending edit to the ACTIVE row it will replace once approved (null
 * for a brand-new role). On approval the old ACTIVE row flips to SUPERSEDED
 * and the new row flips to ACTIVE in the same atomic transaction — neither
 * row is ever deleted (spec point 40).
 */
@Entity('settings_role')
@Index(['tenantId', 'roleName'])
export class RoleEntity extends TenantScopedEntity {
  @Column({ type: 'varchar', length: 128 })
  roleName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb' })
  permissions!: Record<string, string[]>;

  @Column({ type: 'varchar', length: 16, default: 'SELECTED_BRANCH' })
  scopeDefault!: 'SELECTED_BRANCH' | 'ALL_BRANCHES';

  /** System-seeded base roles (Super Admin, FPO Super Admin, etc.) — read-only structure (spec point 10). */
  @Column({ type: 'boolean', default: false })
  isDefaultRole!: boolean;

  @Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.DRAFT })
  @Index()
  status!: ApprovalStatus;

  @Column({ type: 'uuid' })
  makerId!: string;

  @Column({ type: 'uuid', nullable: true })
  checkerId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;

  /** The ACTIVE row this (pending) version will replace once approved. Null for a brand-new role. */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  supersedesId!: string | null;
}
