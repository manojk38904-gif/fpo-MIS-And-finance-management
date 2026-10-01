# FPO Member Agricultural Input & Credit Management System

Multi-tenant SaaS platform for Farmer Producer Organisations (FPOs) in India — member management, KYC, credit scoring, agricultural input/member credit, approvals, disbursement, repayment, automated accounting, and reporting, with strict per-FPO data isolation.

**This repository currently contains Priority #1 only** (Auth / Registration / Onboarding). See [`backend/README.md`](backend/README.md) for exactly what is implemented, what is explicitly out of scope, and how to run it. Priority #2–#18 (members/KYC, credit products, accounting, collections, platform admin, etc.) have frozen specification documents but no code yet — see below.

## Repository layout

```
backend/   NestJS (TypeScript) API — Priority #1 (Auth/Registration/Onboarding) implemented and tested
frontend/  Not started yet
docs/      (empty here — specification documents are tracked in the project workspace, not this repo)
```

## Status (as of this commit)

| Area | Status |
|---|---|
| Priority #1 — Auth/Registration/Onboarding (backend) | Implemented, security/spec-conformance corrected, 71/71 tests passing (real PostgreSQL + Redis) |
| Priority #2–#18 (members, credit, loans, accounting, collections, reports, platform admin, etc.) | **Specifications frozen; code not started** |
| Frontend (any priority) | **Not started** |
| Production-ready / deployable as a complete product | **No** — only one of eighteen planned modules exists |

Full detail: `backend/README.md` and `backend/FPO_SaaS_PHASE_2.2_PHASE1_IMPLEMENTATION_PROGRESS_v1.0.md`-equivalent progress record (kept in the project workspace).

## Working method (unchanged going forward)

This project is built phase-by-phase with explicit approval at each gate — architecture/specification first, then module-by-module implementation, each stage tested before the next begins, with financial/legal rules never invented and always made configurable or referred back to the Owner. Nothing in Priority #2–#18 is coded in this repository yet; their frozen specifications exist separately and implementation proceeds module by module as authorized.
