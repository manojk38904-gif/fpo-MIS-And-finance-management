# FPO Member Agricultural Input & Credit Management System

Multi-tenant SaaS foundation for Farmer Producer Organisations (FPOs) in India.

## Current authorised implementation scope

Phase-1 coding is authorised for exactly:

- **Priority #1 v1.2 — Auth / Registration / Tenant Onboarding**
- **Priority #13 v1.3 — Admin / Settings / RBAC**
- **Priority #18 v1.2 — Platform Super Admin / Subscription**

No other Priority is represented here as an implemented business module.

## Phase-1 status

| Area | Current status |
|---|---|
| Shared multi-tenant/security foundation | Implemented |
| Priority #1 backend | Implemented within the frozen Phase-1 boundary |
| Priority #1 frontend | Implemented working flows |
| Priority #13 backend | 18 active Settings/RBAC screens represented by their frozen ownership/governance boundaries |
| Priority #13 frontend | Operational tenant Settings console for all 18 active screen IDs |
| Priority #18 backend | Platform control-plane implementation for SA-01…SA-10 boundaries |
| Priority #18 frontend | Operational Platform Admin console for SA-01…SA-10 |
| SA-09 CBBO/Agency Hierarchy | **Disabled / Coming Soon / Future Phase / Not in MVP** |
| Warehouse active inventory dimension | **Zero / retired** |
| Professional Verification | **0/5 VERIFIED** |
| Production deployment | **Not authorised** |
| Production Ready | **No** |

## Verification

GitHub Actions verifies the current Phase-1 source against real PostgreSQL + Redis test services.

Latest verified branch gate before merge:

- Backend build: PASS
- Backend lint: PASS
- Database migrations: PASS
- Backend/integration tests: **93/93 PASS**
- Frontend build: PASS
- Frontend lint: PASS
- Generic tenant RLS runs under a non-superuser, non-BYPASSRLS application role.

## Repository layout

```text
backend/   NestJS + TypeScript + PostgreSQL + Redis
frontend/  React + TypeScript + Vite
.github/   CI workflow for build/lint/migration/test verification
```

### Backend modules in the authorised Phase-1

```text
backend/src/modules/priority1-auth-registration/
backend/src/modules/priority13-admin-settings/
backend/src/modules/priority18-platform-admin/
```

### Frontend Phase-1 surfaces

- FPO self-registration / OTP / document upload
- FPO login
- initial password setup
- 16-step onboarding + Go-Live validation
- Priority #13 tenant Settings console
- Platform Super Admin login + TOTP
- Priority #18 Platform Control Plane console

## Important ownership boundaries

- Tenant/FPO registration and application-status truth remains Priority #1-owned.
- Branch/RBAC/tenant settings truth remains Priority #13-owned.
- Platform control-plane truth remains Priority #18-owned.
- Priority #15 remains the sole authoritative audit-event truth; SA-08 is a presentation/control consumer boundary only.
- SA-09 contains no live CBBO/Agency hierarchy model or mutation API.
- Generic Platform Admin identity never bypasses tenant RLS to read arbitrary tenant business tables.
- Warehouse is not an active inventory/location dimension; Branch remains the active location dimension.

## Honest remaining dependencies

Phase-1 code must not fabricate business truth owned by modules that are outside the authorised Phase-1 implementation scope.

Accordingly, SYS-04 Go-Live may still correctly block when authoritative downstream prerequisites are unavailable, including Loan/Input-Credit Product truth and Chart-of-Accounts truth owned by later modules. Priority #13-backed Branch and approved Rounding configuration are already wired into the gate.

The exact production FPO-Code format/algorithm is also not invented here. The frozen source requires a platform-generated, unique, immutable code from the Master-SRS Numbering Engine, but the available frozen sources do not define a concrete format/algorithm. The production adapter therefore blocks rather than manufacturing a canonical format.

Production integrations also require environment/deployment configuration such as real SMTP credentials, private object storage/malware scanning provider, production secrets and infrastructure. These are not reasons to create fake business state.

## Local run

Backend:

```bash
cd backend
cp .env.example .env
npm ci --legacy-peer-deps
npm run migration:run
npm run start:dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

For implementation detail, see [backend/README.md](backend/README.md) and [PHASE1_IMPLEMENTATION_STATUS.md](PHASE1_IMPLEMENTATION_STATUS.md).
