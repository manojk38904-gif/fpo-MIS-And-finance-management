# FPO Member Agricultural Input & Credit Management System

Multi-tenant SaaS platform for Farmer Producer Organisations (FPOs) in India — member management, KYC, credit scoring, agricultural input/member credit, approvals, disbursement, repayment, automated accounting, and reporting, with strict per-FPO data isolation.

**This repository currently contains Priority #1 only** (Auth / Registration / Onboarding) — backend and a first frontend. See [`backend/README.md`](backend/README.md) for exactly what is implemented, what is explicitly out of scope, and how to run it. Priority #2–#18 (members/KYC, credit products, accounting, collections, platform admin, etc.) have frozen specification documents but no code yet — see below.

## Repository layout

```
backend/   NestJS (TypeScript) API — Priority #1 (Auth/Registration/Onboarding) implemented and tested
frontend/  React + TypeScript (Vite) — Priority #1 screens: FPO self-registration wizard, OTP,
           document upload, FPO login, Platform Super Admin login (password + TOTP), password
           setup, onboarding progress / Go-Live. Calls the backend's real, tested API routes
           directly (src/api/*.ts) — no mocked or placeholder business logic.
docs/      (empty here — specification documents are tracked in the project workspace, not this repo)
```

## Status (as of this commit)

| Area | Status |
|---|---|
| Priority #1 — Auth/Registration/Onboarding (backend) | Implemented, security/spec-conformance corrected, 71/71 tests passing (real PostgreSQL + Redis) |
| Priority #1 — Frontend | First working version: registration wizard, OTP, document upload, FPO login, Platform Admin login + TOTP, password setup, onboarding/Go-Live screens. Builds clean, 0 lint errors, draft-creation flow verified live against the real backend. **Not yet styled/reviewed for production UX, and SMTP must be configured for OTP email to actually send.** |
| Priority #13 — Admin/Settings/RBAC | **In progress.** Built so far: **SET-08** Roles & Permissions, **SET-03** Branch Master, **SET-07** Users (Create/Edit/Deactivate/Reactivate, all Maker-Checker-governed — approving a Create genuinely inserts a `user_account` row with role + branch access, never on Submit). **Known, disclosed gap in SET-07:** an approved user-Create does not yet email a working setup link — Priority #1's existing setup-token flow is explicitly scoped to the Initial FPO Admin only, so a separate staff setup-link mechanism is still to be built, not quietly skipped. 15 of 18 screens remain: SET-01,02,05,06,09,11,12,13,14,15,16,17,20,21,22. |
| Priority #2–#12, #14–#18 (members, credit, loans, accounting, collections, reports, platform admin, etc.) | **Specifications frozen; code not started** |
| Production-ready / deployable as a complete product | **No** — only one of eighteen planned modules exists |

### Running the frontend locally
```
cd frontend
npm install
cp .env.example .env   # points at the backend; edit VITE_API_BASE_URL if needed
npm run dev
```
Requires the backend (see `backend/README.md`) running and reachable at the configured API URL.

Full detail: `backend/README.md` and `backend/FPO_SaaS_PHASE_2.2_PHASE1_IMPLEMENTATION_PROGRESS_v1.0.md`-equivalent progress record (kept in the project workspace).

## Working method (unchanged going forward)

This project is built phase-by-phase with explicit approval at each gate — architecture/specification first, then module-by-module implementation, each stage tested before the next begins, with financial/legal rules never invented and always made configurable or referred back to the Owner. Nothing in Priority #2–#18 is coded in this repository yet; their frozen specifications exist separately and implementation proceeds module by module as authorized.
