import { Injectable } from '@nestjs/common';
import { KnownTenantTransactionRunner } from '../../../common/tenant-context/known-tenant-transaction-runner.js';
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
      actionableMessage:
        'Chart of Accounts is not available from Priority #10 yet. Priority #13 numbering mode alone cannot satisfy this combined Go-Live prerequisite.',
    };
  }
}

/**
 * SET-03 is now implemented in Phase-1, so this adapter is no longer a
 * placeholder: it reads the authoritative Priority #13 branch table through
 * a known-tenant RLS transaction. The historical class name is kept to avoid
 * changing the frozen injection token/wiring in an unrelated module.
 */
@Injectable()
export class NotImplementedBranchExistenceAdapter implements BranchExistencePort {
  constructor(private readonly knownTenantTx: KnownTenantTransactionRunner) {}

  async check(tenantId: string): Promise<PrerequisiteCheckResult> {
    const rows = await this.knownTenantTx.run(tenantId, (manager) =>
      manager.query('SELECT COUNT(*)::int AS count FROM "settings_branch" WHERE "tenant_id" = $1 AND "isActive" = true', [tenantId]),
    );
    const count = Number((rows as Array<{ count: number | string }>)[0]?.count ?? 0);
    return count > 0
      ? { satisfied: true, actionableMessage: '' }
      : { satisfied: false, actionableMessage: 'No active Branch or Head Office is configured yet. Complete Step 4 (Branches / Head Office).' };
  }
}

@Injectable()
export class NotImplementedRegulatoryVerificationAdapter implements RegulatoryVerificationPort {
  async check(_tenantId: string): Promise<PrerequisiteCheckResult> {
    // CA-3 remains feature-level. Phase-1 still has no authoritative mapping
    // from enabled production features to the fixed regulatory points, so an
    // unused/unmapped feature cannot be guessed as "applicable". This
    // remains the documented vacuous pass until an owning feature module
    // supplies applicability; SET-21 by itself never unlocks a feature.
    return { satisfied: true, actionableMessage: '' };
  }
}

/**
 * CA-4 is now backed by Priority #13 SET-14. Only an APPROVED/ACTIVE row
 * counts. Draft/Pending rows and the absence of a row do not satisfy Go-Live.
 */
@Injectable()
export class NotImplementedRoundingRuleAdapter implements RoundingRulePort {
  constructor(private readonly knownTenantTx: KnownTenantTransactionRunner) {}

  async check(tenantId: string): Promise<PrerequisiteCheckResult> {
    const rows = await this.knownTenantTx.run(tenantId, (manager) =>
      manager.query(
        "SELECT \"payload\" FROM \"settings_governed_config\" WHERE \"tenant_id\" = $1 AND \"screenId\" = 'SET-14' AND \"status\" = 'ACTIVE' ORDER BY \"version\" DESC LIMIT 1",
        [tenantId],
      ),
    );
    const payload = (rows as Array<{ payload?: Record<string, unknown> }>)[0]?.payload;
    const method = payload?.roundingMethod;
    const places = payload?.decimalPlaces;
    const configured = ['NEAREST', 'UP', 'DOWN'].includes(String(method)) && Number.isInteger(Number(places)) && Number(places) >= 0 && Number(places) <= 2;
    return configured
      ? { satisfied: true, actionableMessage: '' }
      : {
          satisfied: false,
          actionableMessage:
            'Rounding Rule is not explicitly approved/configured yet. Complete SET-14 Interest Settings with an ACTIVE Maker-Checker-approved rounding method and decimal places.',
        };
  }
}
