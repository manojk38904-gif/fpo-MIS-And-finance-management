/**
 * SYS-04 Go-Live Validation Gate — exactly 5 substantive checks, frozen in
 * Priority #1 v1.2. Priority #1 "may READ/VALIDATE authoritative
 * prerequisites. It must not recreate them" (kickoff instruction #12).
 *
 * Priority #4/#5/#10/#13 (Loan Products, Input-Credit Policy, Approval
 * Matrix, Chart of Accounts, Branch Master, Compliance/regulatory-flag
 * truth, Rounding-Rule) are NOT the business-implementation target of this
 * task and do not exist yet. Each check below is expressed as an injectable
 * port with NO real backing table yet — the NotImplemented adapters bound in
 * OnboardingModule correctly and honestly report "not yet configured",
 * which correctly BLOCKS Go-Live (kickoff instruction #13: "SYS-04 must
 * BLOCK correctly when a required authoritative downstream prerequisite
 * does not yet exist... No demo/testing bypass"). When Priority #4/#5/#10/
 * #13 are built, only these adapters get swapped for real queries — no
 * caller of GoLiveGateService changes.
 */
export interface PrerequisiteCheckResult {
  satisfied: boolean;
  /** Actionable, specific message — never a generic "Go-Live failed" (frozen Explicit Property #4). */
  actionableMessage: string;
}

/** Check 1 — at least one active Loan Product / Input-Credit Policy, with a complete Approval Matrix. */
export const LOAN_OR_INPUT_CREDIT_PRODUCT_PORT = Symbol('LOAN_OR_INPUT_CREDIT_PRODUCT_PORT');
export interface LoanOrInputCreditProductPort {
  check(tenantId: string): Promise<PrerequisiteCheckResult>;
}

/** Check 2 — Chart of Accounts + Numbering-mode configured. */
export const CHART_OF_ACCOUNTS_PORT = Symbol('CHART_OF_ACCOUNTS_PORT');
export interface ChartOfAccountsPort {
  check(tenantId: string): Promise<PrerequisiteCheckResult>;
}

/** Check 3 — at least one Branch (or Head Office) exists (Priority #13 SET-03). */
export const BRANCH_EXISTENCE_PORT = Symbol('BRANCH_EXISTENCE_PORT');
export interface BranchExistencePort {
  check(tenantId: string): Promise<PrerequisiteCheckResult>;
}

/**
 * Check 4 (CA-3) — for whichever features the tenant has actually enabled,
 * every applicable PENDING_REGULATORY_VERIFICATION flag must be VERIFIED.
 * Feature-level gating: an unused/not-enabled feature's own unresolved flag
 * must NOT block Go-Live. Since no feature-enablement mechanism exists yet
 * (Priority #13), the honest default is a VACUOUS PASS (no enabled features
 * known → nothing applicable to verify) — this is not a fake bypass, it is
 * the frozen "unused feature does not block" rule applied to the current,
 * genuinely-empty set of enabled features. This is the one check that
 * legitimately differs from the other four, and is documented as such.
 */
export const REGULATORY_VERIFICATION_PORT = Symbol('REGULATORY_VERIFICATION_PORT');
export interface RegulatoryVerificationPort {
  check(tenantId: string): Promise<PrerequisiteCheckResult>;
}

/**
 * Check 5 (CA-4) — Rounding-Rule must be explicitly configured in Priority
 * #13 (never a pre-populated default) for financially-applicable modules.
 * Unlike check 4, this is unconditionally Go-Live-mandatory (Credit Policy /
 * Interest Policy / Loan Products are themselves non-skippable onboarding
 * steps), so the honest default here is a genuine BLOCK, not a vacuous pass.
 */
export const ROUNDING_RULE_PORT = Symbol('ROUNDING_RULE_PORT');
export interface RoundingRulePort {
  check(tenantId: string): Promise<PrerequisiteCheckResult>;
}
