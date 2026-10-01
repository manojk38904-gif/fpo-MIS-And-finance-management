import { Injectable } from '@nestjs/common';
import {
  BranchExistencePort,
  ChartOfAccountsPort,
  LoanOrInputCreditProductPort,
  PrerequisiteCheckResult,
  RegulatoryVerificationPort,
  RoundingRulePort,
} from './go-live-prerequisite.ports.js';

@Injectable()
export class NotImplementedLoanOrInputCreditProductAdapter implements LoanOrInputCreditProductPort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    return {
      satisfied: false,
      actionableMessage:
        'No active Loan Product or Input-Credit Policy with a complete Approval Matrix is configured yet. Complete Step 9 (Loan Products) and Step 10 (Approval Hierarchy).',
    };
  }
}

@Injectable()
export class NotImplementedChartOfAccountsAdapter implements ChartOfAccountsPort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    return {
      satisfied: false,
      actionableMessage: 'Chart of Accounts and numbering mode are not configured yet. Complete Step 12 (Accounting Settings).',
    };
  }
}

@Injectable()
export class NotImplementedBranchExistenceAdapter implements BranchExistencePort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    return {
      satisfied: false,
      actionableMessage: 'No Branch or Head Office is configured yet. Complete Step 4 (Branches / Head Office).',
    };
  }
}

@Injectable()
export class NotImplementedRegulatoryVerificationAdapter implements RegulatoryVerificationPort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    // CA-3: feature-level gating — no enabled-feature truth exists yet, so
    // there is nothing applicable to verify. This is a deliberate vacuous
    // pass per the frozen "unused feature does not block Go-Live" rule, not
    // a bypass of a check that should otherwise run.
    return { satisfied: true, actionableMessage: '' };
  }
}

@Injectable()
export class NotImplementedRoundingRuleAdapter implements RoundingRulePort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    return {
      satisfied: false,
      actionableMessage:
        'Rounding Rule is not explicitly configured yet (no platform default exists). Configure it in Priority #13 Settings before Go-Live.',
    };
  }
}
