# FPO SaaS — Backend (Phase-1)

**Authorization:** `FPO_SaaS_PHASE_2.2_IMPLEMENTATION_START_AUTHORIZATION_PHASE1_v1.0.md` (OWNER APPROVED / FROZEN / CURRENT AUTHORITATIVE — unmodified by this pass).
**Authorized scope:** Priority #1 v1.2, Priority #13 v1.3, Priority #18 v1.2 ONLY.
**Implementation progress record:** `FPO_SaaS_PHASE_2.2_PHASE1_IMPLEMENTATION_PROGRESS_v1.0.md` (separate from the frozen authorization document, per Owner instruction — updated by this pass).
**Current pass:** PHASE 2.2 — PRIORITY #1 v1.2 SECURITY / SPEC-CONFORMANCE CORRECTION PASS (23-item list). Priority #1 is **not yet closed** — this pass corrected the prior implementation's security/architecture gaps (Redis sessions, atomic concurrency handling, OTP subject-binding, document-upload wiring, password-policy configurability, and more); it did not start Priority #13/#18 business implementation. See the progress record's §8 for the full item-by-item status.

## What exists so far

### Shared Technical Foundation (prior pass, unchanged in architecture this pass)

- NestJS (TypeScript) app skeleton, ESM, built on the frozen tech stack (Master SRS §4.1: Node.js + NestJS, PostgreSQL 15+, React, Redis/BullMQ).
- PostgreSQL connection via TypeORM (`src/database/database.module.ts`), `synchronize: false` — schema changes only via explicit migrations.
- **Database-enforced multi-tenancy**: `tenant_id` + Row-Level Security, per the frozen shared-DB strategy.
  - **Generic RLS: STRICT TENANT-ONLY.** No generic Platform Super Admin bypass.
  - `src/database/tenant-rls.util.ts` — `enableTenantRls()` migration helper, deny-by-default.
  - **Tenant-context flow**: verified `OptionalJwtAuthGuard` → `TenantContextInterceptor` → `TenantContextService` (AsyncLocalStorage) → `TenantAwareTransactionRunner` (per-request path).
  - `src/common/auth/` — `JwtStrategy`/`JwtAuthGuard`/`OptionalJwtAuthGuard`.
  - `src/common/security/password-hasher.ts` — Argon2id wrapper, for passwords only (looked up by username, one candidate verified).
  - `src/common/security/secret-token-hasher.ts` — **new this pass** — deterministic HMAC-SHA256 for secrets that must be found BY their hash (OTP codes, setup-link tokens, refresh tokens), since Argon2id's random salting cannot support that lookup pattern.
  - `src/common/tenant-context/known-tenant-transaction-runner.ts` — **new this pass** — a sibling to `TenantAwareTransactionRunner` for pre-authentication system operations (login's own `user_account` lookup, tenant activation, password reset) that have already independently resolved a legitimate `tenantId` but have no guard-verified request context yet to read one from.
  - `src/common/audit/` — **new this pass** — `AuditEventPort`/`AUDIT_EVENT_PORT` + `LocalAuditEventAdapter`, the minimal, non-fabricated audit boundary Priority #1 writes meaningful events through (Priority #15 remains the sole authoritative audit truth; this is a stand-in local sink, not a competing one).
  - `src/common/session/` — **new, correction pass** — `SessionStorePort`/`RedisSessionStoreAdapter`, the sole authoritative truth for whether an issued access token's session is still active (Master SRS §26, frozen). `JwtStrategy` checks it, plus live tenant/user/admin status, on every request.
  - `src/common/delivery/` — **new, correction pass** — `EmailDeliveryPort` (`InMemoryEmailDeliveryAdapter` in tests, a generic SMTP adapter in production), the single boundary all OTP/activation/setup-link email goes through — never a raw `console.log`.
  - `src/common/storage/` — **new, correction pass** — `FileStoragePort`/`MalwareScanPort`, the document-upload boundary `RegistrationController` is wired to.
  - `src/common/security/password-policy.port.ts` — **new, correction pass** — `PasswordPolicyPort`, the single configurable source of password-shape rules (replacing a prior hard-coded DTO rule).

### Priority #1 v1.2 — AUTH / REGISTRATION / ONBOARDING (this pass — newly implemented)

All six frozen SYS screens, under `src/modules/priority1-auth-registration/`:

| Screen | What's implemented |
|---|---|
| SYS-02 (Registration) | Opaque resume-token-gated draft create/update, real document upload (type/size-enforced, malware-scan hook), Step-5 submit with mandatory-field + mandatory-document completeness check + DB-level race-safe duplicate PAN/CIN handling (CA-2) |
| SYS-03 (OTP) | Shared email-OTP component — TTL/attempt-limit/resend-cooldown all configurable, deterministic-HMAC storage, subject-bound (never cross-registration-replayable), atomic single-consumption, no raw OTP ever logged or persisted |
| SYS-01-A (Tenant/Staff/Member Login) | FPO-Code + identifier + password, generic non-enumerating error for unknown FPO-Code/user/password, specific locked/suspended messages, account lockout (immediately revokes live sessions), Redis-backed session issuance + atomic refresh-token rotation/reuse-detection |
| SYS-05 (Initial FPO-Admin Setup) | CA-1 single-use, expiring, secure setup link; no plaintext password ever emailed or logged; no second compulsory password-change loop |
| SYS-01-B (Platform Super Admin Login) | Separate identity/table hierarchy from tenant users; mandatory two-step password + TOTP; MFA-pending ticket signed with a distinct secret so it can never be replayed as a general bearer token |
| SYS-06 (Forgot/Reset Password) | Byte-identical Step-1 response whether or not the account exists; Step-2 fails with the same generic error for both "no such request" and "wrong OTP" |
| SYS-04 (16-Step Onboarding Wizard + Go-Live Gate) | All 16 frozen steps, unmerged/unreordered; per-tenant completion/skip tracking; a server-side Go-Live gate expressed as 5 injectable prerequisite ports |

**SYS-04 Go-Live Gate — current, honest state:** Priority #4/#5/#10/#13 (Loan/Input-Credit Products, Chart of Accounts, Branches, Rounding Rule, feature-enablement) are not this task's implementation target and do not exist yet. The gate's 5 checks are bound to `NotImplemented*Adapter`s that correctly report "not yet configured" for 4 of the 5 checks (so Go-Live correctly **blocks**, with no demo/testing bypass), and a deliberate, documented vacuous PASS for the 5th (CA-3 regulatory verification), since it is feature-conditional and no enabled-feature truth exists yet to apply it to. Swapping in the real Priority #4/#5/#10/#13-backed adapters later requires no change to any caller.

### Correction pass (this pass) — what changed and why

Redis is now the **sole authoritative** active-session/revocation truth (Master SRS §26, frozen — not an Owner-optional future choice). `SessionStorePort`/`RedisSessionStoreAdapter` backs every login; `JwtStrategy` re-checks the Redis session plus live tenant/user/admin DB state on **every** authenticated request — logout, lockout, suspension and password-reset all take effect immediately, on the token's very next use, not only once its own short JWT expiry elapses. The DB refresh-token tables (`user_refresh_token` / `platform_admin_refresh_token`) are demoted to pure rotation/reuse-detection bookkeeping (a `sessionId` column links each row to its Redis session) — they are explicitly not a second "is this session active" truth.

Other correction-pass fixes: OTP verification, setup-token consumption, and refresh-token rotation are all now atomic (conditional-UPDATE compare-and-set), each with a parallel-request test proving exactly one caller ever wins; duplicate PAN/CIN submission is additionally backstopped by a DB-level partial unique index (scoped to post-submission statuses only) with its own parallel-submission test; OTPs are bound to `subjectId + purpose + identifier` so one registration's OTP can never verify another's, even sharing an email; resume access to an in-progress registration now requires an opaque, expiring, re-issuable resume token — a bare registration id is never sufficient; raw OTP values are never logged anywhere, including in tests (delivery goes through `EmailDeliveryPort`, with an in-memory test adapter); password policy is enforced through one configurable `PasswordPolicyPort`, not a second hard-coded DTO rule; `TenantActivationService` now only ever activates an application already in status `APPROVED` (SA-01's own decision, not this hook's); document upload is now wired end-to-end (`RegistrationController` → `FileInterceptor` → `RegistrationService.attachDocumentByResumeToken`) with real type/size enforcement and a malware-scan hook.

**Explicit scope choices still made and disclosed, not silently skipped:**
- Actual OTP/email delivery (SMTP/SES/etc.) uses a generic `EmailDeliveryPort`; the production binding is a plain SMTP adapter (`nodemailer`) — a vendor-specific provider (SES, SendGrid, etc.) has not been selected and is not implemented.
- FPO-Code generation has no real algorithm yet. The production binding (`NotImplementedFpoCodeGeneratorAdapter`) deliberately **blocks** tenant activation with a clear error rather than fabricating a code — the Master SRS's actual Numbering-Engine algorithm is not specified in Priority #1 v1.2's own text and does not exist in this codebase. A test-only adapter (`TestFpoCodeGeneratorAdapter`) exists solely for integration tests to exercise the rest of the activation flow.
- Document storage is a configurable local directory (`LocalFileStorageAdapter`), not a cloud object store — an S3/Spaces-compatible provider has not been selected; swapping one in later only touches this one adapter, never any caller or API contract. The malware-scan hook (`StubMalwareScanAdapter`) always reports clean and is explicitly not a real scanner — a real scanning service has not been selected either.
- `TenantActivationService` (the SA-01 "right after approval" hook) is an internal service method only, not a public HTTP endpoint — exposing it as one would itself constitute Priority #18's SA-01 approval screen, out of this task's scope.
- Steps 2 (Logo & Branding), 5 (Bank Accounts), 11 (Staff Users), and 16 (Authorised Signatures) of the 16-step onboarding wizard are not conclusively classified mandatory-vs-skippable by the frozen v1.2 text's own enumeration — see `ONBOARDING_STEPS_PENDING_OWNER_CLASSIFICATION` and the progress record's Open Owner Decisions. The current runtime default (non-skippable) is an interim safety choice, not a claim about what the frozen text requires.

### What does NOT exist yet (explicitly out of this pass)

- Priority #13 (SET-*) and Priority #18 (SA-*) screens/entities/controllers — including the public SA-01 approval endpoint, full RBAC/staff-user provisioning beyond the one `isInitialFpoAdmin` distinction, and Loan/Input-Credit/Chart-of-Accounts/Branch/Rounding-Rule configuration.
- Priority #15's real audit system (only the minimal local adapter boundary exists).
- Real file/object storage and email/SMS delivery providers.
- Frontend.

## Running locally

```bash
cp .env.example .env   # then fill in real values (JWT secrets must be 32+ chars)
npm ci --legacy-peer-deps   # --legacy-peer-deps works around an npm/arborist bug with this Nest CLI's default vitest peer deps
npm run build
npm run migration:run   # requires a reachable PostgreSQL at DATABASE_URL — creates the Priority #1 schema
npm run test            # requires a reachable PostgreSQL at DATABASE_URL AND a reachable Redis at REDIS_URL (sessions)
npm run start
```

Migration CLI commands: `npm run migration:run`, `npm run migration:revert`, `npm run migration:show` (all via `typeorm-ts-node-esm`, configured in `src/database/data-source.ts` — used only by the CLI, never imported by the running app).

## No-second-truth boundaries encoded in this codebase

| Truth | Owner | Where enforced here |
|---|---|---|
| Tenant/FPO identity, credentials | Priority #1 | `src/modules/priority1-auth-registration/services/auth.service.ts` + `platform-admin-auth.service.ts` |
| Active-session / revocation truth | Redis (via `SessionStorePort`) | `src/common/session/redis-session-store.adapter.ts` — the DB refresh-token tables are rotation/reuse bookkeeping only, never a second truth |
| Branch / RBAC / Settings / Loan & Input-Credit Products / Chart of Accounts / Rounding Rule | Priority #13 | Not yet implemented — Go-Live gate ports in `go-live-prerequisite.ports.ts` are the integration boundary |
| SA-01 approval decision | Priority #18 | Not yet implemented — `TenantActivationService` is the narrow, already-approved-registration-only hook it will call |
| Audit-event truth | Priority #15 (outside Phase-1) | `AuditEventPort` — local adapter only, not a competing truth |
| Row-level tenant isolation | Database (RLS), strict tenant-only | `tenant-rls.util.ts`, applied to `user_account` and `onboarding_step_progress` (the two genuinely tenant-scoped, per-request-path tables in this pass) |

**Tables deliberately NOT RLS-protected, and why:** `fpo_registration` / `fpo_registration_document` (pre-tenant — the tenant does not exist yet), `otp_verification` / `setup_token` / `user_refresh_token` / `platform_admin_refresh_token` (looked up BY an unguessable secret's hash — a lookup that must work before any tenant context can exist, protected by the secret's own entropy instead), `platform_admin_account` (genuinely platform-level, a separate identity hierarchy from tenant users, never given a tenant_id at all). Each entity's own doc-comment explains its specific reasoning.

Warehouse active inventory dimension: **ZERO / RETIRED** — no `warehouse_id` or Warehouse construct exists anywhere in this codebase (verified: zero occurrences of the word "warehouse" anywhere in `src/`, outside of this pass's own regression test naming the concept it is checking for).
