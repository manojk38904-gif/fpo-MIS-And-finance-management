import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { UserAccountEntity, UserAccountStatus } from '../../priority1-auth-registration/entities/user-account.entity.js';
import { UserProvisioningRequestEntity, UserRequestActionType } from '../entities/user-provisioning-request.entity.js';
import { UserBranchAssignmentEntity } from '../entities/user-branch-assignment.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { ApprovalStatus } from '../entities/approval-status.enum.js';
import type { CreateUserRequestDto, EditUserRequestDto } from '../dto/user-provisioning.dto.js';

/**
 * SET-07 — Users, Owner Decision #A (MANDATORY MAKER-CHECKER). See
 * UserProvisioningRequestEntity's header for the scope this covers.
 *
 * DISCLOSED GAP (not silently skipped): on an approved CREATE, this creates
 * the real `user_account` row in PENDING_SETUP status (mirroring Priority
 * #1's own CA-1 state), but does NOT yet email a working setup link —
 * Priority #1's `SetupTokenEntity`/email flow is explicitly scoped to the
 * Initial FPO Admin ONLY ("never extended to all staff users", per its own
 * frozen comment), so a parallel setup-link mechanism for general staff
 * users is a deliberate, separate next step, not bolted on hastily here
 * alongside everything else in this pass. Documented in backend/README.md.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly txRunner: TenantAwareTransactionRunner,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async list(tenantId: string): Promise<UserProvisioningRequestEntity[]> {
    return this.txRunner.run((manager) =>
      manager.getRepository(UserProvisioningRequestEntity).find({ where: { tenantId }, order: { createdAt: 'DESC' } }),
    );
  }

  private async assertActiveRole(manager: EntityManager, tenantId: string, roleId: string) {
    const role = await manager.getRepository(RoleEntity).findOne({ where: { id: roleId, tenantId, status: ApprovalStatus.ACTIVE } });
    if (!role) throw new BadRequestException('Selected Role is not a currently Active role.');
  }

  async createDraft(tenantId: string, makerId: string, dto: CreateUserRequestDto): Promise<UserProvisioningRequestEntity> {
    return this.txRunner.run(async (manager) => {
      await this.assertActiveRole(manager, tenantId, dto.roleId);
      const repo = manager.getRepository(UserProvisioningRequestEntity);
      const req = await repo.save(
        repo.create({
          tenantId,
          actionType: UserRequestActionType.CREATE,
          fullName: dto.fullName,
          mobile: dto.mobile,
          email: dto.email ?? null,
          roleId: dto.roleId,
          branchAccessScope: dto.branchAccessScope,
          selectedBranchIds: dto.branchAccessScope === 'SELECTED_BRANCH' ? (dto.selectedBranchIds ?? []) : null,
          status: ApprovalStatus.DRAFT,
          makerId,
        }),
      );
      await this.audit.record({ eventType: 'settings.user.create_draft', tenantId, actorUserId: makerId, subjectId: req.id });
      return req;
    });
  }

  async editDraft(tenantId: string, makerId: string, dto: EditUserRequestDto): Promise<UserProvisioningRequestEntity> {
    return this.txRunner.run(async (manager) => {
      const target = await manager.getRepository(UserAccountEntity).findOne({ where: { id: dto.targetUserId, tenantId } });
      if (!target) throw new NotFoundException('User not found.');
      if (dto.roleId) await this.assertActiveRole(manager, tenantId, dto.roleId);
      const repo = manager.getRepository(UserProvisioningRequestEntity);
      const req = await repo.save(
        repo.create({
          tenantId,
          actionType: UserRequestActionType.EDIT,
          supersedesUserId: dto.targetUserId,
          fullName: dto.fullName ?? null,
          mobile: dto.mobile ?? null,
          email: dto.email ?? null,
          roleId: dto.roleId ?? null,
          branchAccessScope: dto.branchAccessScope ?? null,
          selectedBranchIds: dto.branchAccessScope === 'SELECTED_BRANCH' ? (dto.selectedBranchIds ?? []) : null,
          status: ApprovalStatus.DRAFT,
          makerId,
        }),
      );
      await this.audit.record({ eventType: 'settings.user.edit_draft', tenantId, actorUserId: makerId, subjectId: req.id, metadata: { targetUserId: dto.targetUserId } });
      return req;
    });
  }

  private async createDeactivateOrReactivate(
    tenantId: string,
    makerId: string,
    targetUserId: string,
    actionType: UserRequestActionType.DEACTIVATE | UserRequestActionType.REACTIVATE,
  ): Promise<UserProvisioningRequestEntity> {
    return this.txRunner.run(async (manager) => {
      const target = await manager.getRepository(UserAccountEntity).findOne({ where: { id: targetUserId, tenantId } });
      if (!target) throw new NotFoundException('User not found.');
      const repo = manager.getRepository(UserProvisioningRequestEntity);
      const req = await repo.save(repo.create({ tenantId, actionType, supersedesUserId: targetUserId, status: ApprovalStatus.DRAFT, makerId }));
      await this.audit.record({ eventType: `settings.user.${actionType.toLowerCase()}_draft`, tenantId, actorUserId: makerId, subjectId: req.id, metadata: { targetUserId } });
      return req;
    });
  }

  requestDeactivation(tenantId: string, makerId: string, targetUserId: string) {
    return this.createDeactivateOrReactivate(tenantId, makerId, targetUserId, UserRequestActionType.DEACTIVATE);
  }

  requestReactivation(tenantId: string, makerId: string, targetUserId: string) {
    return this.createDeactivateOrReactivate(tenantId, makerId, targetUserId, UserRequestActionType.REACTIVATE);
  }

  async submit(tenantId: string, requestId: string, makerId: string): Promise<void> {
    let result: { affected?: number | null };
    try {
      result = await this.txRunner.run((manager) =>
        manager
          .getRepository(UserProvisioningRequestEntity)
          .createQueryBuilder()
          .update(UserProvisioningRequestEntity)
          .set({ status: ApprovalStatus.PENDING_APPROVAL, submittedAt: () => 'now()' })
          .where('"id" = :requestId AND "tenant_id" = :tenantId AND "makerId" = :makerId AND "status" IN (:...from)', {
            requestId,
            tenantId,
            makerId,
            from: [ApprovalStatus.DRAFT, ApprovalStatus.SENT_BACK],
          })
          .execute(),
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Another change to this user is already pending approval. Please wait for it to be decided.');
      }
      throw err;
    }
    if (result.affected !== 1) {
      const row = await this.txRunner.run((manager) => manager.getRepository(UserProvisioningRequestEntity).findOne({ where: { id: requestId, tenantId } }));
      if (!row) throw new NotFoundException('Request not found.');
      if (row.makerId !== makerId) throw new ForbiddenException('Only the original Maker can submit this draft.');
      throw new ConflictException('This draft is not in a submittable state.');
    }
    await this.audit.record({ eventType: 'settings.user.submitted', tenantId, actorUserId: makerId, subjectId: requestId });
  }

  private async decide(
    tenantId: string,
    requestId: string,
    checkerId: string,
    toStatus: ApprovalStatus.ACTIVE | ApprovalStatus.REJECTED | ApprovalStatus.SENT_BACK,
    reason: string | null,
  ): Promise<void> {
    await this.txRunner.run(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(UserProvisioningRequestEntity)
        .set({ status: toStatus, checkerId, decidedAt: () => 'now()', decisionReason: reason })
        .where('"id" = :requestId AND "tenant_id" = :tenantId AND "status" = :pending AND "makerId" <> :checkerId', {
          requestId,
          tenantId,
          pending: ApprovalStatus.PENDING_APPROVAL,
          checkerId,
        })
        .execute();

      if (result.affected !== 1) {
        const row = await manager.getRepository(UserProvisioningRequestEntity).findOne({ where: { id: requestId, tenantId } });
        if (!row) throw new NotFoundException('Request not found.');
        if (row.status !== ApprovalStatus.PENDING_APPROVAL) throw new ConflictException('This submission has already been processed by another Checker.');
        if (row.makerId === checkerId) throw new ForbiddenException('You are the Maker of this submission — you cannot also be its Checker.');
        throw new ConflictException('Unable to process this decision.');
      }

      if (toStatus === ApprovalStatus.ACTIVE) {
        const req = await manager.getRepository(UserProvisioningRequestEntity).findOneOrFail({ where: { id: requestId, tenantId } });
        await this.applyApprovedRequest(manager, tenantId, req);
      }
    });

    const eventType =
      toStatus === ApprovalStatus.ACTIVE ? 'settings.user.approved' : toStatus === ApprovalStatus.REJECTED ? 'settings.user.rejected' : 'settings.user.sent_back';
    await this.audit.record({ eventType, tenantId, actorUserId: checkerId, subjectId: requestId, metadata: reason ? { reason } : undefined });
  }

  private async applyApprovedRequest(
    manager: EntityManager,
    tenantId: string,
    req: UserProvisioningRequestEntity,
  ): Promise<void> {
    const userRepo = manager.getRepository(UserAccountEntity);
    const branchAssignRepo = manager.getRepository(UserBranchAssignmentEntity);

    if (req.actionType === UserRequestActionType.CREATE) {
      const username = (req.mobile ?? req.email ?? `user-${req.id.slice(0, 8)}`).toLowerCase();
      const user = await userRepo.save(
        userRepo.create({
          tenantId,
          username,
          email: req.email ?? `${username}@pending-setup.invalid`,
          mobile: req.mobile,
          fullName: req.fullName,
          roleId: req.roleId,
          branchAccessScope: req.branchAccessScope,
          status: UserAccountStatus.PENDING_SETUP,
        }),
      );
      if (req.branchAccessScope === 'SELECTED_BRANCH' && req.selectedBranchIds) {
        await branchAssignRepo.save(req.selectedBranchIds.map((branchId) => branchAssignRepo.create({ tenantId, userId: user.id, branchId })));
      }
      return;
    }

    if (!req.supersedesUserId) throw new BadRequestException('Request is missing its target user.');
    const target = await userRepo.findOne({ where: { id: req.supersedesUserId, tenantId } });
    if (!target) throw new NotFoundException('Target user no longer exists.');

    if (req.actionType === UserRequestActionType.DEACTIVATE) {
      target.status = UserAccountStatus.SUSPENDED;
      await userRepo.save(target);
      return;
    }
    if (req.actionType === UserRequestActionType.REACTIVATE) {
      target.status = UserAccountStatus.ACTIVE;
      await userRepo.save(target);
      return;
    }

    // EDIT
    if (req.fullName !== null) target.fullName = req.fullName;
    if (req.mobile !== null) target.mobile = req.mobile;
    if (req.email !== null) target.email = req.email;
    if (req.roleId !== null) target.roleId = req.roleId;
    if (req.branchAccessScope !== null) target.branchAccessScope = req.branchAccessScope;
    await userRepo.save(target);
    if (req.branchAccessScope === 'SELECTED_BRANCH' && req.selectedBranchIds) {
      await branchAssignRepo.delete({ tenantId, userId: target.id });
      await branchAssignRepo.save(req.selectedBranchIds.map((branchId) => branchAssignRepo.create({ tenantId, userId: target.id, branchId })));
    }
  }

  async approve(tenantId: string, requestId: string, checkerId: string): Promise<void> {
    await this.decide(tenantId, requestId, checkerId, ApprovalStatus.ACTIVE, null);
  }

  async reject(tenantId: string, requestId: string, checkerId: string, reason: string): Promise<void> {
    await this.decide(tenantId, requestId, checkerId, ApprovalStatus.REJECTED, reason);
  }

  async sendBack(tenantId: string, requestId: string, checkerId: string, reason: string): Promise<void> {
    await this.decide(tenantId, requestId, checkerId, ApprovalStatus.SENT_BACK, reason);
  }
}
