import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantAwareTransactionRunner } from '../../../common/tenant-context/tenant-aware-transaction-runner.js';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../../common/audit/audit-event.port.js';
import { RoleEntity } from '../entities/role.entity.js';
import { ApprovalStatus } from '../entities/approval-status.enum.js';
import type { CreateOrEditRoleDraftDto } from '../dto/role.dto.js';

/**
 * SET-08 — Roles & Permissions, Owner Decision #A (MANDATORY MAKER-CHECKER).
 *
 * Every state transition below follows the identical, non-negotiable rule
 * set the frozen spec states (verbatim) at every one of its 18 screens'
 * point-40: Maker≠Checker is enforced in the database statement itself (not
 * just application logic, so a second concurrent request can never slip
 * through), activation is atomic, old versions are superseded — never
 * deleted/overwritten — and every transition is audited.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly txRunner: TenantAwareTransactionRunner,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  async list(tenantId: string): Promise<RoleEntity[]> {
    return this.txRunner.run((manager) =>
      manager.getRepository(RoleEntity).find({ where: { tenantId }, order: { roleName: 'ASC', createdAt: 'DESC' } }),
    );
  }

  async createDraft(tenantId: string, makerId: string, dto: CreateOrEditRoleDraftDto): Promise<RoleEntity> {
    if (dto.supersedesId) {
      // Must be editing a currently-ACTIVE role in this tenant, not an arbitrary id.
      const existing = await this.txRunner.run((manager) =>
        manager.getRepository(RoleEntity).findOne({ where: { id: dto.supersedesId, tenantId, status: ApprovalStatus.ACTIVE } }),
      );
      if (!existing) throw new NotFoundException('The role you are trying to edit was not found or is not currently Active.');
      if (existing.isDefaultRole) {
        throw new ForbiddenException('Default (system-seeded) roles cannot be edited directly — create a new Custom Role instead.');
      }
    }

    const draft = await this.txRunner.run((manager) =>
      manager.getRepository(RoleEntity).save(
        manager.getRepository(RoleEntity).create({
          tenantId,
          roleName: dto.roleName,
          description: dto.description ?? null,
          permissions: dto.permissions,
          scopeDefault: dto.scopeDefault ?? 'SELECTED_BRANCH',
          isDefaultRole: false,
          status: ApprovalStatus.DRAFT,
          makerId,
          supersedesId: dto.supersedesId ?? null,
        }),
      ),
    );

    await this.audit.record({
      eventType: 'settings.role.draft_created',
      tenantId,
      actorUserId: makerId,
      subjectId: draft.id,
      metadata: { roleName: draft.roleName, isEdit: Boolean(dto.supersedesId) },
    });
    return draft;
  }

  async submit(tenantId: string, roleId: string, makerId: string): Promise<void> {
    // Idempotency/race-safety: the partial unique index (tenant_id, supersedes_id)
    // WHERE status='PENDING_APPROVAL' (migration) makes a second concurrent
    // submit of a sibling draft against the same lineage fail at the DB layer;
    // this CAS update makes a double-click/retry of THIS submit a no-op rather
    // than a duplicate transition.
    let result: { affected?: number | null };
    try {
      result = await this.txRunner.run((manager) =>
        manager
          .getRepository(RoleEntity)
          .createQueryBuilder()
          .update(RoleEntity)
          .set({ status: ApprovalStatus.PENDING_APPROVAL, submittedAt: () => 'now()' })
          .where('"id" = :roleId AND "tenant_id" = :tenantId AND "makerId" = :makerId AND "status" IN (:...from)', {
            roleId,
            tenantId,
            makerId,
            from: [ApprovalStatus.DRAFT, ApprovalStatus.SENT_BACK],
          })
          .execute(),
      );
    } catch (err) {
      // Postgres unique_violation (23505) — the partial unique index
      // (tenant_id, supersedesId) WHERE status='PENDING_APPROVAL' caught a
      // second, concurrent edit of the same lineage already pending. This is
      // the DB-level backstop behind the application-level CAS above, so it
      // surfaces as the same ConflictException an app-level race would give.
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Another change to this role is already pending approval. Please wait for it to be decided.');
      }
      throw err;
    }
    if (result.affected !== 1) {
      const row = await this.txRunner.run((manager) => manager.getRepository(RoleEntity).findOne({ where: { id: roleId, tenantId } }));
      if (!row) throw new NotFoundException('Role draft not found.');
      if (row.makerId !== makerId) throw new ForbiddenException('Only the original Maker can submit this draft.');
      throw new ConflictException('This draft is not in a submittable state.');
    }

    await this.audit.record({ eventType: 'settings.role.submitted', tenantId, actorUserId: makerId, subjectId: roleId });
  }

  private async decide(
    tenantId: string,
    roleId: string,
    checkerId: string,
    toStatus: ApprovalStatus.ACTIVE | ApprovalStatus.REJECTED | ApprovalStatus.SENT_BACK,
    reason: string | null,
  ): Promise<void> {
    await this.txRunner.run(async (manager) => {
      // Atomic, Maker≠Checker-enforced-in-SQL CAS: this is what makes two
      // concurrent Checkers racing on the same record safe (only the first
      // UPDATE statement can match status='PENDING_APPROVAL'), and what makes
      // "a Checker who is also the Maker" structurally impossible to slip
      // through, not merely checked-then-trusted in application code.
      const result = await manager
        .createQueryBuilder()
        .update(RoleEntity)
        .set({ status: toStatus, checkerId, decidedAt: () => 'now()', decisionReason: reason })
        .where('"id" = :roleId AND "tenant_id" = :tenantId AND "status" = :pending AND "makerId" <> :checkerId', {
          roleId,
          tenantId,
          pending: ApprovalStatus.PENDING_APPROVAL,
          checkerId,
        })
        .execute();

      if (result.affected !== 1) {
        const row = await manager.getRepository(RoleEntity).findOne({ where: { id: roleId, tenantId } });
        if (!row) throw new NotFoundException('Role not found.');
        if (row.status !== ApprovalStatus.PENDING_APPROVAL) {
          throw new ConflictException('This submission has already been processed by another Checker.');
        }
        if (row.makerId === checkerId) {
          throw new ForbiddenException('You are the Maker of this submission — you cannot also be its Checker.');
        }
        throw new ConflictException('Unable to process this decision.');
      }

      if (toStatus === ApprovalStatus.ACTIVE) {
        const row = await manager.getRepository(RoleEntity).findOneOrFail({ where: { id: roleId, tenantId } });
        if (row.supersedesId) {
          // Also CAS-guarded: only supersede the old row if it is still ACTIVE
          // (defends against a pathological double-approval race superseding twice).
          await manager
            .createQueryBuilder()
            .update(RoleEntity)
            .set({ status: ApprovalStatus.SUPERSEDED })
            .where('"id" = :id AND "tenant_id" = :tenantId AND "status" = :active', {
              id: row.supersedesId,
              tenantId,
              active: ApprovalStatus.ACTIVE,
            })
            .execute();
        }
      }
    });

    const eventType =
      toStatus === ApprovalStatus.ACTIVE ? 'settings.role.approved' : toStatus === ApprovalStatus.REJECTED ? 'settings.role.rejected' : 'settings.role.sent_back';
    await this.audit.record({ eventType, tenantId, actorUserId: checkerId, subjectId: roleId, metadata: reason ? { reason } : undefined });
  }

  async approve(tenantId: string, roleId: string, checkerId: string): Promise<void> {
    await this.decide(tenantId, roleId, checkerId, ApprovalStatus.ACTIVE, null);
  }

  async reject(tenantId: string, roleId: string, checkerId: string, reason: string): Promise<void> {
    await this.decide(tenantId, roleId, checkerId, ApprovalStatus.REJECTED, reason);
  }

  async sendBack(tenantId: string, roleId: string, checkerId: string, reason: string): Promise<void> {
    await this.decide(tenantId, roleId, checkerId, ApprovalStatus.SENT_BACK, reason);
  }
}
