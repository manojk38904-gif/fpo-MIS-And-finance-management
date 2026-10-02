# FPO Member Agricultural Input & Credit Management System

Multi-tenant SaaS platform for Farmer Producer Organisations (FPOs) in India, implemented against frozen Phase-2.2 specifications with strict tenant isolation, maker-checker controls, audit boundaries, and no invented financial/legal rules.

## Current implemented Phase-1 scope

This repository now contains the authorised Phase-1 implementation for:

- **Priority #1 v1.2 — Auth / Registration / Onboarding**
- **Priority #13 v1.3 — Admin / Settings / RBAC**
- **Priority #18 v1.2 — Platform Super Admin / Subscription**

The backend is NestJS + PostgreSQL + Redis and the frontend is React/Vite. GitHub Actions runs build, lint, migrations, real PostgreSQL/Redis integration tests, and frontend build/lint on every Phase-1 branch/main update.

## Repository layout

```
backend/   NestJS API, migrations, RLS, auth/session infrastructure, P1/P13/P18 implementation and integration tests
frontend/  React/Vite user flows for registration/login/onboarding plus Platform Administration dashboard
.github/   Phase-1 CI workflow
```

## Implementation status

| Area | Status |
|---|---|
| Priority #1 | Implemented for the frozen Phase-1 surface. Registration, OTP, tenant login, platform-admin MFA login, password setup/reset, onboarding tracking and server-side Go-Live gate are wired. |
| Priority #13 | All 18 active SET surfaces have backend implementation or an explicit ownership boundary. SET-04/SET-10 Warehouse are retired; SET-18/SET-19 remain Priority #12-owned. |
| Priority #18 | Platform control-plane implemented: FPO application review/approval decision, tenant/admin management, versioned subscription plans, subscription lifecycle, usage/health surfaces, consent-based support access, recovery controls, SA-08/SA-10 source boundaries, and SA-09 Disabled/Coming Soon state. |
| Tenant isolation | PostgreSQL RLS with a least-privilege non-BYPASSRLS application role; no generic platform-admin RLS bypass. |
| CI | Backend build/lint/migrations/tests and frontend build/lint are passing on the Phase-1 branch. |
| Complete product / Production Ready | **No.** Priorities outside the authorised Phase-1 scope are not implemented, professional-verification items remain pending, and the explicit external blockers below remain unresolved. |

## Explicit unresolved dependencies — not fabricated

The code deliberately blocks or reports unavailable where the frozen sources do not define enough to implement safely:

- **Production FPO-Code Numbering Engine:** the frozen sources require a platform-generated unique immutable FPO-Code, but do not define the exact production format/algorithm. Approval can be recorded; activation remains pending until that authoritative adapter is supplied.
- **SET-07 staff credential/setup-link flow:** frozen Priority #1 CA-1 defines the secure setup-link specifically for the Initial FPO Admin; no authoritative staff credential issuance mechanism was found. Staff creation therefore remains `PENDING_SETUP` without an invented credential flow.
- **Full Go-Live:** Branch and Rounding prerequisites now consume real Priority #13 truth; Loan/Input-Credit Product/Approval and Chart-of-Accounts prerequisites still block until their owning Priorities are implemented.
- **Priority #15 audit truth:** SA-08 does not expose the transient local audit outbox as a substitute.
- **SA-10 authoritative security-event feed:** not fabricated from local transport data.
- **CA-18 calendar automation:** subscription state can be changed with audited controls, but automatic date-driven lifecycle transitions are not invented without the authoritative platform-timezone source.
- **Five Professional Verification items:** remain pending / not verified.

## Local run

Backend instructions are in [backend/README.md](backend/README.md). Frontend:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

## Governance

Frozen business ownership is preserved. No Warehouse master/dimension is reintroduced. No hidden defaults are used to pass Go-Live. Financial, legal and regulatory rules that require an owner/professional source remain configurable, blocked, or explicitly unavailable rather than guessed.
