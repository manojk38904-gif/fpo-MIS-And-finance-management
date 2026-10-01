import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Correction-pass item 15 — EXPLICITLY NON-AUTHORITATIVE. Priority #15
 * remains the SOLE authoritative audit-event truth; this table is a
 * transient, best-effort local outbox/transport behind AuditEventPort ONLY,
 * never a second audit system in its own right:
 *   - WRITE-ONLY from the application's perspective: no controller, service,
 *     or report in this codebase reads from it (verified: `AuditEventEntity`
 *     / `local_audit_event` do not appear outside this file, the migration
 *     that creates the table, and LocalAuditEventAdapter's own insert).
 *   - NOT exposed through any HTTP endpoint, report, or export.
 *   - NOT relied upon for compliance/legal evidence, retention guarantees,
 *     or cross-tenant reporting — it carries no such guarantee and may be
 *     pruned/rotated by ops without that being an audit-integrity incident.
 *   - No RLS: it deliberately holds both pre-tenant (tenantId null) and
 *     tenant events in one undifferentiated write path, which is itself
 *     inappropriate for a genuine queryable audit store (another reason this
 *     can never become Priority #15's real one by accretion).
 * When Priority #15 is built, its real sink either replaces this adapter's
 * binding outright, or this table is demoted to a pure outbox Priority #15
 * drains and clears — either way, no caller of AUDIT_EVENT_PORT changes.
 */
@Entity('local_audit_event')
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  eventType!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  tenantId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  subjectId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
