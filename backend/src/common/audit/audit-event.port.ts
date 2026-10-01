/**
 * Audit boundary (Phase-1 kickoff instruction #16): Priority #15 remains the
 * sole authoritative audit-event truth. Priority #15 is outside the current
 * coding scope, so this is a MINIMAL, NON-FABRICATED interface/adapter
 * boundary only — Priority #1 emits meaningful audit events THROUGH this
 * port, never into a second/competing audit store of its own invention.
 *
 * When Priority #15 is built, its real sink replaces/fronts
 * LocalAuditEventAdapter below without any caller of this port changing.
 *
 * IMPORTANT: this port and its current local adapter never log credential
 * values (passwords, OTP codes, setup-token raw values, refresh-token raw
 * values) — only structural event metadata, per the frozen security rule
 * that credential values must never appear in audit/logs.
 */
export interface AuditEvent {
  /** e.g. 'auth.login.success', 'auth.login.failure', 'otp.generated', 'setup_token.used' */
  eventType: string;
  /** Tenant UUID, or null for pre-tenant/platform-level events. */
  tenantId: string | null;
  /** Acting user UUID, if known. */
  actorUserId?: string | null;
  /** A non-tenant-table subject this event concerns (e.g. a registration id), if applicable. */
  subjectId?: string | null;
  /** Structured, non-secret metadata only — never a password/OTP/token raw value. */
  metadata?: Record<string, string | number | boolean | null>;
}

export const AUDIT_EVENT_PORT = Symbol('AUDIT_EVENT_PORT');

export interface AuditEventPort {
  record(event: AuditEvent): Promise<void>;
}
