# FPO SaaS — Backend Phase-1

**Authorised implementation scope:** Priority #1 v1.2, Priority #13 v1.3, Priority #18 v1.2.  
**Production Ready:** NO.  
**Professional Verification:** 0/5 VERIFIED.

See [PHASE1_IMPLEMENTATION_STATUS.md](PHASE1_IMPLEMENTATION_STATUS.md) for the exact completed scope and remaining authoritative blockers.

## Stack and security foundation

- NestJS / TypeScript / ESM.
- PostgreSQL with explicit migrations; `synchronize: false`.
- Shared database + `tenant_id` + PostgreSQL Row-Level Security.
- Least-privilege application role; no generic Platform Super Admin RLS bypass.
- Redis-backed authoritative live-session/revocation state.
- Argon2id password hashing.
- HMAC-SHA256 lookup hashes for OTP/setup/refresh secrets.
- Short-lived JWT access tokens tied to Redis sessions.
- Generic SMTP delivery port; test capture adapter.
- File-storage and malware-scan ports.
- Audit-event port; the local adapter is transport/outbox only, **not** Priority #15's authoritative audit store.
- Global subscription lifecycle guard for SUSPENDED and EXPIRED_READ_ONLY tenant states.

## Priority #1

Implemented: Registration, OTP, tenant login, platform-admin MFA login, secure Initial FPO Admin setup, password reset, onboarding tracking, and Go-Live gate.

The production FPO-Code generator deliberately fails closed because the exact frozen Numbering Engine algorithm/format is not available. The test-only generator is never the production binding.

## Priority #13

All 18 active SET surfaces are wired as backend APIs or explicit ownership boundaries:

`SET-01,02,03,05,06,07,08,09,11,12,13,14,15,16,17,20,21,22`.

- SET-04/SET-10 Warehouse surfaces remain retired.
- SET-18/SET-19 remain Priority #12-owned.
- Governed settings use Maker-Checker, immutable version history and audit events.
- Direct-effective settings use explicit version history.
- SET-15 does not duplicate Priority #10 accounting truth.
- SET-21 records professional evidence/status; it does not manufacture legal conclusions.
- SET-22 does not invent a QR-access-log retention default.

SET-07 approved staff creation creates a real `PENDING_SETUP` account, but no staff credential/setup-link mechanism is invented because the frozen Initial Admin setup-link rule is not an authoritative rule for all staff.

## Priority #18

Implemented platform control-plane surfaces:

- SA-01 FPO Applications.
- SA-02 Tenant Management + Platform Administrators.
- SA-03 Subscription Plans.
- SA-04 Tenant Subscription lifecycle.
- SA-05 Platform Usage.
- SA-06 Platform Health.
- SA-07 consent-based, time-boxed support access.
- SA-08 Priority #15 audit ownership boundary.
- SA-09 Disabled / Coming Soon only.
- SA-10 security-event ownership boundary.

Platform administrator roles are `SUPER_ADMIN` and `SUPPORT_ADMIN`; MFA is mandatory. Recovery uses the frozen dual-independent-approval pattern plus target TOTP. Subscription grace and support/recovery durations are explicitly configured; no universal business duration is hard-coded.

## Running locally

```bash
cp .env.example .env
npm ci --legacy-peer-deps
npm run build
npm run migration:run
npm run test -- --no-file-parallelism
npm run start
```

Real integration tests require reachable PostgreSQL and Redis.

The following platform values must be explicitly configured before those workflows can operate:

```env
PLATFORM_RECOVERY_REQUEST_TTL_HOURS=
PLATFORM_SUPPORT_ACCESS_MAX_MINUTES=
```

Do not set these to guessed production values.

## Go-Live status

Go-Live consumes Priority #13 Branch and Rounding truth now. It still correctly blocks on downstream authoritative truths that are not implemented in Phase-1, including Chart of Accounts and Loan/Input-Credit product/approval dependencies.

No Warehouse master, warehouse selector, `warehouse_id`, or warehouse RBAC dimension is reintroduced.
