import { Inject, Injectable } from '@nestjs/common';
import {
  BRANCH_EXISTENCE_PORT,
  CHART_OF_ACCOUNTS_PORT,
  LOAN_OR_INPUT_CREDIT_PRODUCT_PORT,
  REGULATORY_VERIFICATION_PORT,
  ROUNDING_RULE_PORT,
} from './go-live-prerequisite.ports.js';
import type {
  BranchExistencePort,
  ChartOfAccountsPort,
  LoanOrInputCreditProductPort,
  PrerequisiteCheckResult,
  RegulatoryVerificationPort,
  RoundingRulePort,
} from './go-live-prerequisite.ports.js';

export interface GoLiveGateResult {
  passed: boolean;
  /** Frozen Explicit Property #4: never a generic "Go-Live failed" — always this exact actionable list. */
  failures: string[];
}

/**
 * SYS-04 Go-Live Validation Gate — EXACTLY 5 substantive checks (frozen,
 * v1.2 §"SYS-04 Final Checklist Count"). Explicit Property #3: this runs
 * server-side and is re-verified independently of whatever the UI shows,
 * so client-side tampering can never bypass it.
 */
@Injectable()
export class GoLiveGateService {
  constructor(
    @Inject(LOAN_OR_INPUT_CREDIT_PRODUCT_PORT) private readonly loanOrInputCredit: LoanOrInputCreditProductPort,
    @Inject(CHART_OF_ACCOUNTS_PORT) private readonly chartOfAccounts: ChartOfAccountsPort,
    @Inject(BRANCH_EXISTENCE_PORT) private readonly branchExistence: BranchExistencePort,
    @Inject(REGULATORY_VERIFICATION_PORT) private readonly regulatoryVerification: RegulatoryVerificationPort,
    @Inject(ROUNDING_RULE_PORT) private readonly roundingRule: RoundingRulePort,
  ) {}

  async evaluate(tenantId: string): Promise<GoLiveGateResult> {
    const checks: PrerequisiteCheckResult[] = await Promise.all([
      this.loanOrInputCredit.check(tenantId),
      this.chartOfAccounts.check(tenantId),
      this.branchExistence.check(tenantId),
      this.regulatoryVerification.check(tenantId),
      this.roundingRule.check(tenantId),
    ]);

    const failures = checks.filter((c) => !c.satisfied).map((c) => c.actionableMessage);
    return { passed: failures.length === 0, failures };
  }
}
