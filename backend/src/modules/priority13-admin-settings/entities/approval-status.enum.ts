/**
 * Shared maker-checker lifecycle status, used identically across every
 * Owner-Decision-#A/#C-governed Priority #13 screen (SET-05, 07, 08, 09, 11,
 * 12, 13, 14, 16, 17) — the frozen spec (v1.3 §4) defines ONE governance
 * pattern and re-states it per screen; this enum is that one pattern,
 * written once and reused, not re-invented per entity.
 *
 * Lifecycle: DRAFT -> PENDING_APPROVAL -> ACTIVE | REJECTED | SENT_BACK.
 * SENT_BACK returns to an editable draft state (a fresh DRAFT row keeps the
 * same supersedesId lineage). SUPERSEDED marks an old ACTIVE row once a
 * later version has been approved in its place — rows are NEVER deleted or
 * overwritten (spec point 40, "कभी-delete/overwrite नहीं, हमेशा-traceable").
 */
export enum ApprovalStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  SENT_BACK = 'SENT_BACK',
  SUPERSEDED = 'SUPERSEDED',
}
