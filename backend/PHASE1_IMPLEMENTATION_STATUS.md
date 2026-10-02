# Phase-1 Implementation Status

**Scope:** Priority #1 v1.2, Priority #13 v1.3, Priority #18 v1.2  
**Implementation state:** CODED / CI-VERIFIED FOR CURRENT AUTHORISED SCOPE, with the explicit unresolved dependencies below.  
**Production Ready:** NO.  
**Professional Verification:** 0/5 VERIFIED.

## Completed in code

### Priority #1
- FPO registration draft/resume/document upload/submit.
- Email OTP lifecycle with atomic consumption and no raw-secret logging.
- Tenant login, Redis-backed live-session verification, refresh rotation/reuse detection, lockout/suspension handling.
- Platform-admin password + mandatory TOTP login.
- Initial FPO Admin secure setup-token flow and password reset.
- 16-step onboarding progress and server-side Go-Live gate.
- Go-Live now consumes real Priority #13 Branch existence and ACTIVE SET-14 Rounding Rule.
- Production activation continues to fail closed when the authoritative FPO-Code generator is unavailable.

### Priority #13
Active screens: SET-01, SET-02, SET-03, SET-05, SET-06, SET-07, SET-08, SET-09, SET-11, SET-12, SET-13, SET-14, SET-15, SET-16, SET-17, SET-20, SET-21, SET-22.

Implemented controls include:
- tenant-scoped RLS-backed persistence;
- direct-effective version history where the frozen screen is immediate-effective;
- mandatory Maker-Checker versioning for governed settings;
- Maker != Checker enforcement;
- immutable/superseded version history;
- Branch/RBAC effective projection;
- Financial Year overlap validation;
- Bank Account duplicate/IFSC/applicability validation;
- Approval Matrix range validation;
- all 9 fixed Numbering Rule document types;
- Credit Settings 8-weight total=100 validation;
- SET-14 Rounding Rule with no pre-populated default;
- Purchase/Inventory setting validation;
- SET-15 explicit Priority #10 ownership boundary;
- SET-21 professional-evidence status register without inventing legal conclusions;
- SET-22 export-request ledger and explicit Public-QR log-retention configuration with no invented default;
- approved SET-07 deactivation revokes live Redis sessions.

Retired/externally owned:
- SET-04 Warehouse Master — retired.
- SET-10 Warehouse Access — retired.
- SET-18 Notification Settings / SET-19 Document Templates — Priority #12-owned, not duplicated.

### Priority #18
- SA-01 application list/detail/review/approve/reject; approval ownership resides here.
- SA-02 tenant list and named Platform roles: SUPER_ADMIN / SUPPORT_ADMIN.
- Platform-admin create/deactivate and mandatory MFA-aware sessions.
- Owner-approved recovery pattern: requester cannot self-approve; at least two other active platform admins; request expiry; target identity + existing TOTP; password policy; live-session revocation; MFA remains mandatory.
- SA-03 immutable/versioned Subscription Plans.
- SA-04 subscription assignment and audited lifecycle history, configurable grace period, EXPIRED_READ_ONLY server-side mutation block, SUSPENDED login/session block.
- SA-05 aggregate usage returns only authoritative currently available metrics and explicit unavailable reasons for unimplemented owners.
- SA-06 DB/Redis/API health with explicit unavailable queue/storage metrics where no authoritative adapter exists.
- SA-07 consent-based, time-boxed support-access request; tenant consent/revoke; no business mutation endpoint is exposed through the support session.
- SA-08 explicitly defers to Priority #15 authoritative audit truth.
- SA-09 is strictly Disabled / Coming Soon / Future Phase; no live CBBO/Agency model or mutation API.
- SA-10 refuses to create a second security-event truth.
- Platform timezone is not duplicated in P18 storage.

## CI verification

GitHub Actions verifies:
- Node build.
- Lint.
- PostgreSQL migrations against a least-privilege `NOBYPASSRLS` application role.
- Real PostgreSQL + Redis integration tests, serialized because suites share the integration database/cache.
- Frontend TypeScript/Vite build and lint.

## Remaining authoritative blockers

1. **FPO-Code production Numbering Engine:** exact format/algorithm is not defined by the frozen material available to this implementation. The production adapter therefore blocks activation instead of fabricating a code.
2. **Staff credential lifecycle after SET-07 approval:** Initial FPO Admin setup-link rules cannot be silently extended to all staff without an authoritative rule. Staff account creation is real and Maker-Checker governed, but credential issuance remains unresolved.
3. **Go-Live downstream owners:** Loan/Input-Credit Product/Approval Matrix consumer truth and Chart of Accounts are owned by later Priorities and are not available yet; Go-Live correctly blocks.
4. **Priority #15 audit store:** not implemented in the authorised Phase-1 scope; local audit transport is not exposed as the authoritative store.
5. **CA-18 automatic subscription calendar transitions:** no second/hard-coded timezone source is invented. Manual audited lifecycle state changes are implemented.
6. **Professional Verification:** all five carried-forward professional items remain PENDING / NOT VERIFIED.
7. **Remaining product Priorities:** Priority #2–#12 and #14–#17 are not made complete by this Phase-1 work.

## Deployment meaning

The Phase-1 code is intended to be merged to the repository's `main` branch after CI passes. This is **GitHub source deployment**, not a claim that a production cloud environment, DNS, secrets, managed PostgreSQL/Redis, SMTP, object storage, malware scanner, monitoring or backup infrastructure has been provisioned.
