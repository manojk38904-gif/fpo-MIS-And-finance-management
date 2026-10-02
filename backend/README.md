# FPO SaaS Backend — Phase-1

## Governance

**Authorised coding scope only:**

- Priority #1 v1.2 — Auth / Registration / Tenant Onboarding
- Priority #13 v1.3 — Admin / Settings / RBAC
- Priority #18 v1.2 — Platform Super Admin / Subscription

Production deployment is not authorised. Professional Verification remains 0/5 VERIFIED.

## Shared foundation

Implemented:

- NestJS + TypeScript
- PostgreSQL with explicit migrations and `synchronize: false`
- strict tenant-scoped Row-Level Security
- non-superuser / `NOBYPASSRLS` application DB role in CI
- verified-authentication → tenant-context → AsyncLocalStorage → tenant-aware transaction flow
- Redis-backed authoritative session/revocation state
- Argon2id password hashing
- HMAC lookup hashes for OTP/setup/refresh secrets
- configurable password policy
- rate limiting / CORS / environment validation
- provider ports for email delivery, private file storage and malware scanning
- audit-event adapter boundary without redefining Priority #15 as a second truth

Generic Platform Admin identity does **not** bypass generic tenant RLS.

## Priority #1 v1.2

Implemented backend flows:

- SYS-01 tenant login and separate Platform Admin password + TOTP login
- SYS-02 registration, resume-token access, document upload
- SYS-03 OTP verification
- SYS-04 16-step onboarding + server-side Go-Live gate
- SYS-05 secure first-password setup
- SYS-06 password reset
- Redis sessions, refresh rotation/reuse handling and immediate revocation
- non-enumerating registration/login/reset behaviour
- atomic one-time-token/OTP operations
- race-safe duplicate PAN/CIN submission protection
- approved-only tenant activation hook

### SYS-04 step classification

Resolved by Owner completion instruction:

- mandatory basic onboarding: 1, 3, 4, 6, 7, 8, 9, 10, 12
- optional: 2, 11, 13, 14, 15
- conditional downstream requirement but not a basic Go-Live blocker: 5 (Bank Accounts), 16 (Authorised Signatures)

Conditional requirements must be enforced by the operation that actually needs them; no fake bank/signature data is generated.

### Go-Live dependency boundary

Five frozen prerequisite checks remain server-side.

Already backed by Phase-1 authoritative truth:

- Branch existence → Priority #13 SET-03
- approved rounding rule → Priority #13 SET-14

Still correctly blocking where the authoritative owning module is outside Phase-1:

- active Loan/Input-Credit Product / required approval configuration
- Chart of Accounts + combined accounting prerequisite

Regulatory applicability remains feature-scoped; SET-21 does not itself unlock a regulated feature.

### FPO-Code boundary

The frozen source requires a platform-generated, unique, immutable FPO-Code from the Master-SRS Numbering Engine / tenant-level sequence after SA-01 approval. The available frozen source does not define a concrete production format/algorithm. The production adapter therefore blocks rather than inventing one.

## Priority #13 v1.3

Exactly 18 active screens are represented:

- SET-01 FPO Profile
- SET-02 Logo / Branding
- SET-03 Branch Master
- SET-05 Bank Accounts
- SET-06 Financial Year
- SET-07 Users
- SET-08 Roles & Permissions
- SET-09 Branch Access
- SET-11 Approval Matrix
- SET-12 Numbering Rules
- SET-13 Credit Settings
- SET-14 Interest Settings
- SET-15 Accounting Settings ownership/navigation boundary
- SET-16 Purchase Workflow Settings
- SET-17 Inventory Settings
- SET-20 Authorised Signatures
- SET-21 Regulatory Verification Status
- SET-22 Backup / Data Export

SET-04 and SET-10 remain retired. SET-18/SET-19 are Priority #12-owned, not active Priority #13 screens.

Implemented governance includes:

- maker ≠ checker where frozen
- Draft / Pending / Active / Rejected / Sent-Back / Superseded lifecycle
- version/history preservation
- concurrency guards
- Branch as the active location dimension
- role and branch-access truth
- user create/edit/deactivate/reactivate
- immediate Redis-session invalidation on approved deactivation
- Financial Year overlap validation
- approved Rounding rule configuration
- Regulatory Verification tracking
- tenant data-export requests / retention configuration

SET-15 intentionally does not duplicate Priority #10 accounting truth.

## Priority #18 v1.2

Implemented Platform Control Plane boundaries:

- SA-01 FPO/Tenant Applications
- SA-02 Tenant Management
- SA-03 Subscription Plans
- SA-04 Tenant Subscription
- SA-05 Platform Usage
- SA-06 Platform Health
- SA-07 consent/time-bound Support Access
- SA-08 Platform Audit presentation boundary
- SA-09 CBBO/Agency Hierarchy disabled/Coming-Soon state
- SA-10 Security Events boundary

Important boundaries:

- SA-01 acts on Priority #1-owned registration/application workflow.
- SA-08 does not create or expose a competing audit truth; Priority #15 remains authoritative.
- SA-09 contains no hierarchy model, operational mutation API or Agency-to-FPO mapping.
- Platform views use explicit platform-safe aggregate/metadata paths rather than a generic tenant-table bypass.
- tenant subscription suspension revokes tenant sessions.

## Verification

Current Phase-1 CI gate uses PostgreSQL 16 + Redis 7 and runs:

```bash
npm ci --legacy-peer-deps
npm run build
npm run lint
npm run migration:run
npm run test -- --no-file-parallelism
```

Latest verified branch result before documentation update:

- 7 explicit migrations PASS
- 6 test files PASS
- **93/93 tests PASS**
- Priority #1 integration: 42 PASS
- Priority #13 integration: 16 PASS
- Priority #18 integration: 6 PASS
- tenant-context / RLS / environment tests: PASS

Frontend build and lint also PASS in the same workflow.

## External deployment dependencies

The code intentionally does not commit real secrets or invent vendor choices.

A real deployed environment still needs:

- PostgreSQL / Redis
- strong JWT secrets
- explicit CORS origins
- SMTP configuration
- private object storage adapter/provider
- production malware scanning provider
- explicit platform recovery/support duration configuration
- deployment host/domain/runtime configuration

The current local storage / stub scanning implementations are adapter-level development implementations, not a claim that a production cloud provider has been selected.

## Warehouse regression

Active Warehouse inventory dimension = **ZERO / RETIRED**.

Do not introduce `warehouse_id`, Warehouse Master, Warehouse RBAC, warehouse-wise stock or Warehouse-to-Warehouse transfer.
