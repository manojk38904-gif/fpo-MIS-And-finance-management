import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AUDIT_EVENT_PORT } from '../../../common/audit/audit-event.port.js';
import type { AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { FpoRegistrationEntity } from '../entities/fpo-registration.entity.js';
import { ONBOARDING_STEPS, OnboardingStepProgressEntity, OnboardingStepStatus } from '../entities/onboarding-step-progress.entity.js';
import { GoLiveGateService } from './go-live-gate.service.js';

/**
 * SYS-04 — step-progress tracking + Go-Live. Per-step FIELD DATA is owned by
 * the reused Priority #13 Settings screens (frozen "Settings Cross-
 * Reference" approach) — Priority #13 is not this task's business-
 * implementation target, so only step completion/skip state (genuinely
 * Priority #1's own) is tracked here; no duplicate Settings truth is
 * created.
 *
 * This service is only ever called from an AUTHENTICATED request (the
 * tenant's own FPO-Admin, post-login) — so, unlike AuthService/
 * TenantActivationService, it correctly uses TenantAwareTransactionRunner,
 * the per-request path driven by the guard-verified TenantContext, not
 * KnownTenantTransactionRunner (which is only for pre-authentication system
 * operations with no request context yet).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantTx: TenantAwareTransactionRunner,
    private readonly goLiveGate: GoLiveGateService,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async getProgress(tenantId: string): Promise<Array<{ stepNumber: number; name: string; skippable: boolean; status: OnboardingStepStatus }>> {
    const rows = await this.tenantTx.run((manager) => manager.getRepository(OnboardingStepProgressEntity).find({ where: { tenantId } }));
    const byStep = new Map(rows.map((r) => [r.stepNumber, r.status]));
    return ONBOARDING_STEPS.map((step) => ({
      ...step,
      status: byStep.get(step.stepNumber) ?? OnboardingStepStatus.PENDING,
    }));
  }

  async completeStep(tenantId: string, stepNumber: number, actorUserId: string): Promise<void> {
    this.assertValidStep(stepNumber);
    await this.tenantTx.run(async (manager) => {
      const repo = manager.getRepository(OnboardingStepProgressEntity);
      const existing = await repo.findOne({ where: { tenantId, stepNumber } });
      const now = new Date();
      if (existing) {
        existing.status = OnboardingStepStatus.COMPLETE;
        existing.completedAt = now;
        await repo.save(existing);
      } else {
        await repo.save(repo.create({ tenantId, stepNumber, status: OnboardingStepStatus.COMPLETE, completedAt: now }));
      }
    });
    await this.audit.record({
      eventType: 'onboarding.step.completed',
      tenantId,
      actorUserId,
      metadata: { stepNumber, stepName: ONBOARDING_STEPS[stepNumber - 1].name },
    });
  }

  async skipStep(tenantId: string, stepNumber: number, actorUserId: string): Promise<void> {
    this.assertValidStep(stepNumber);
    const step = ONBOARDING_STEPS[stepNumber - 1];
    if (!step.skippable) {
      // Frozen Explicit Property #1: mandatory steps have no Skip option at all.
      throw new BadRequestException(`Step ${stepNumber} (${step.name}) is mandatory and cannot be skipped.`);
    }
    await this.tenantTx.run(async (manager) => {
      const repo = manager.getRepository(OnboardingStepProgressEntity);
      const existing = await repo.findOne({ where: { tenantId, stepNumber } });
      if (existing) {
        existing.status = OnboardingStepStatus.SKIPPED;
        await repo.save(existing);
      } else {
        await repo.save(repo.create({ tenantId, stepNumber, status: OnboardingStepStatus.SKIPPED, completedAt: null }));
      }
    });
    await this.audit.record({ eventType: 'onboarding.step.skipped', tenantId, actorUserId, metadata: { stepNumber } });
  }

  /** Explicit Property #3: server-side, independent of whatever the UI showed. */
  async checkGoLive(tenantId: string): Promise<{ passed: boolean; failures: string[] }> {
    return this.goLiveGate.evaluate(tenantId);
  }

  async goLive(tenantId: string, actorUserId: string): Promise<{ passed: boolean; failures: string[] }> {
    const result = await this.goLiveGate.evaluate(tenantId);
    if (!result.passed) {
      await this.audit.record({ eventType: 'onboarding.go_live.blocked', tenantId, actorUserId, metadata: { failureCount: result.failures.length } });
      return result;
    }
    // fpo_registration is platform-level (no RLS) — safe to query directly.
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const reg = await repo.findOne({ where: { id: tenantId } });
    if (!reg) throw new BadRequestException('Tenant not found.');
    reg.liveAt = new Date();
    await repo.save(reg);
    await this.audit.record({ eventType: 'onboarding.go_live.success', tenantId, actorUserId });
    return result;
  }

  private assertValidStep(stepNumber: number): void {
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 16) {
      throw new BadRequestException('Step number must be between 1 and 16.');
    }
  }
}
