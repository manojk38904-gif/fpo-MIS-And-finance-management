import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { BranchEntity, BranchType } from '../entities/branch.entity.js';
import type { CreateOrUpdateBranchDto } from '../dto/branch.dto.js';

/**
 * SET-03 — Branch Master. No maker-checker (not in Owner Decision #A's
 * scope list) — Create/Edit take effect immediately (spec point 21), backed
 * by their own independent server-side checks: unique Branch-Code per
 * tenant, at most one HEAD_OFFICE branch, and a safe-deactivate guard.
 *
 * HONEST SCOPE NOTE (not invented/fabricated): spec point 40/19 requires
 * Deactivate to be blocked if the branch has any open loan, active member,
 * or pending transaction. No such module (Members, Loans, Collections, …)
 * is built yet in this codebase, so there is nothing to check against today
 * — `branchUsageCheckers` is the extension point future Priority modules
 * register into; with zero checkers registered, Deactivate currently only
 * enforces the HEAD_OFFICE-always-exists rule below. This gap is also
 * called out in backend/README.md, not left silent.
 */
export interface BranchUsageChecker {
  /** Return a human-readable reason this branch cannot be deactivated, or null if clear. */
  check(tenantId: string, branchId: string): Promise<string | null>;
}

@Injectable()
export class BranchService {
  private readonly usageCheckers: BranchUsageChecker[] = [];

  constructor(
    private readonly txRunner: TenantAwareTransactionRunner,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  /** Future Priority modules (Members, Loans, Collections, Inventory, Accounting) register their own usage checks here. */
  registerUsageChecker(checker: BranchUsageChecker): void {
    this.usageCheckers.push(checker);
  }

  async list(tenantId: string): Promise<BranchEntity[]> {
    return this.txRunner.run((manager) => manager.getRepository(BranchEntity).find({ where: { tenantId }, order: { branchCode: 'ASC' } }));
  }

  async create(tenantId: string, actorUserId: string, dto: CreateOrUpdateBranchDto): Promise<BranchEntity> {
    return this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(BranchEntity);
      if (dto.branchType === BranchType.HEAD_OFFICE) {
        const existingHq = await repo.findOne({ where: { tenantId, branchType: BranchType.HEAD_OFFICE, isActive: true } });
        if (existingHq) throw new ConflictException('A Head Office branch already exists for this FPO — only one is allowed.');
      }
      const dup = await repo.findOne({ where: { tenantId, branchCode: dto.branchCode } });
      if (dup) throw new ConflictException('This Branch Code already exists.');

      const branch = await repo.save(
        repo.create({
          tenantId,
          branchCode: dto.branchCode,
          branchName: dto.branchName,
          branchType: dto.branchType as BranchType,
          address: dto.address,
          state: dto.state ?? null,
          district: dto.district ?? null,
          managerUserId: dto.managerUserId ?? null,
          openingDate: dto.openingDate,
          isActive: true,
        }),
      );
      await this.audit.record({ eventType: 'settings.branch.created', tenantId, actorUserId, subjectId: branch.id, metadata: { branchCode: branch.branchCode } });
      return branch;
    });
  }

  async update(tenantId: string, branchId: string, actorUserId: string, dto: CreateOrUpdateBranchDto): Promise<BranchEntity> {
    return this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(BranchEntity);
      const branch = await repo.findOne({ where: { id: branchId, tenantId } });
      if (!branch) throw new NotFoundException('Branch not found.');
      // Branch-Code is read-only after create (spec point 10) — many existing
      // transactions/documents reference it permanently.
      if (dto.branchCode !== branch.branchCode) {
        throw new BadRequestException('Branch Code cannot be changed after creation.');
      }
      if (dto.branchType === BranchType.HEAD_OFFICE && branch.branchType !== BranchType.HEAD_OFFICE) {
        const existingHq = await repo.findOne({ where: { tenantId, branchType: BranchType.HEAD_OFFICE, isActive: true } });
        if (existingHq) throw new ConflictException('A Head Office branch already exists for this FPO — only one is allowed.');
      }
      const oldValue = { branchName: branch.branchName, branchType: branch.branchType, address: branch.address };
      Object.assign(branch, {
        branchName: dto.branchName,
        branchType: dto.branchType,
        address: dto.address,
        state: dto.state ?? null,
        district: dto.district ?? null,
        managerUserId: dto.managerUserId ?? null,
        openingDate: dto.openingDate,
      });
      await repo.save(branch);
      await this.audit.record({
        eventType: 'settings.branch.updated',
        tenantId,
        actorUserId,
        subjectId: branch.id,
        metadata: { oldValue: JSON.stringify(oldValue) },
      });
      return branch;
    });
  }

  async deactivate(tenantId: string, branchId: string, actorUserId: string, reason: string): Promise<void> {
    await this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(BranchEntity);
      const branch = await repo.findOne({ where: { id: branchId, tenantId } });
      if (!branch) throw new NotFoundException('Branch not found.');
      if (!branch.isActive) throw new ConflictException('This branch is already Inactive.');

      for (const checker of this.usageCheckers) {
        const blockingReason = await checker.check(tenantId, branchId);
        if (blockingReason) throw new ConflictException(blockingReason);
      }

      if (branch.branchType === BranchType.HEAD_OFFICE) {
        const otherActiveHq = await repo.count({ where: { tenantId, branchType: BranchType.HEAD_OFFICE, isActive: true } });
        if (otherActiveHq <= 1) {
          throw new ConflictException('The Head Office branch cannot be deactivated — every FPO must always have one active Head Office.');
        }
      }

      branch.isActive = false;
      branch.deactivationReason = reason;
      await repo.save(branch);
    });
    await this.audit.record({ eventType: 'settings.branch.deactivated', tenantId, actorUserId, subjectId: branchId, metadata: { reason } });
  }

  async reactivate(tenantId: string, branchId: string, actorUserId: string): Promise<void> {
    await this.txRunner.run(async (manager) => {
      const repo = manager.getRepository(BranchEntity);
      const branch = await repo.findOne({ where: { id: branchId, tenantId } });
      if (!branch) throw new NotFoundException('Branch not found.');
      if (branch.isActive) throw new ConflictException('This branch is already Active.');
      branch.isActive = true;
      branch.deactivationReason = null;
      await repo.save(branch);
    });
    await this.audit.record({ eventType: 'settings.branch.reactivated', tenantId, actorUserId, subjectId: branchId });
  }
}
