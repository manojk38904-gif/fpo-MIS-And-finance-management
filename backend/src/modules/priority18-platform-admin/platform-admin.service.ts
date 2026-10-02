import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { AUDIT_EVENT_PORT, type AuditEventPort } from '../../common/audit/audit-event.port.js';
import { PASSWORD_POLICY_PORT, type PasswordPolicyPort } from '../../common/security/password-policy.port.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { SESSION_STORE_PORT, type SessionStorePort } from '../../common/session/session-store.port.js';
import { REDIS_CLIENT } from '../../common/session/redis-client.provider.js';
import { KnownTenantTransactionRunner } from '../../common/tenant-context/known-tenant-transaction-runner.js';
import {
  FpoRegistrationEntity,
  FpoRegistrationStatus,
} from '../priority1-auth-registration/entities/fpo-registration.entity.js';
import {
  PlatformAdminAccountEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from '../priority1-auth-registration/entities/platform-admin-account.entity.js';
import { TenantActivationService } from '../priority1-auth-registration/services/tenant-activation.service.js';
import { TotpService } from '../priority1-auth-registration/services/totp.service.js';
import { UserAccountEntity } from '../priority1-auth-registration/entities/user-account.entity.js';
import { SubscriptionPlanEntity, SubscriptionPlanStatus } from './entities/subscription-plan.entity.js';
import { TenantSubscriptionEntity, TenantSubscriptionState } from './entities/tenant-subscription.entity.js';
import { PlatformConfigurationEntity } from './entities/platform-configuration.entity.js';
import { SupportAccessRequestEntity, SupportAccessStatus } from './entities/support-access-request.entity.js';
import {
  PlatformAdminRecoveryApprovalEntity,
  PlatformAdminRecoveryRequestEntity,
  RecoveryRequestStatus,
} from './entities/platform-admin-recovery.entity.js';
import type {
  AssignSubscriptionDto,
  CreatePlanDto,
  CreatePlatformAdminDto,
  NewPlanVersionDto,
  RecoveryCompleteDto,
  SupportAccessRequestDto,
} from './dto/platform-admin.dto.js';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly knownTenantTx: KnownTenantTransactionRunner,
    private readonly activation: TenantActivationService,
    private readonly passwordHasher: PasswordHasher,
    @Inject(PASSWORD_POLICY_PORT) private readonly passwordPolicy: PasswordPolicyPort,
    private readonly totp: TotpService,
    @Inject(SESSION_STORE_PORT) private readonly sessions: SessionStorePort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(AUDIT_EVENT_PORT) private readonly audit: AuditEventPort,
  ) {}

  assertPlatformRole(role: PlatformAdminRole | string | null | undefined, superOnly = false) {
    if (!role || ![PlatformAdminRole.SUPER_ADMIN, PlatformAdminRole.SUPPORT_ADMIN].includes(role as PlatformAdminRole)) {
      throw new ForbiddenException('Platform administrator access is required.');
    }
    if (superOnly && role !== PlatformAdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('This action is restricted to Platform Super Admin.');
    }
  }

  async listApplications(input: { page?: number; pageSize?: number; status?: string; search?: string }) {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)));
    const qb = this.dataSource.getRepository(FpoRegistrationEntity).createQueryBuilder('r');
    if (input.status) {
      const allowed = Object.values(FpoRegistrationStatus);
      if (!allowed.includes(input.status as FpoRegistrationStatus)) throw new BadRequestException('Invalid application status.');
      qb.andWhere('r.status = :status', { status: input.status });
    } else {
      qb.andWhere('r.status IN (:...statuses)', {
        statuses: [FpoRegistrationStatus.SUBMITTED, FpoRegistrationStatus.UNDER_VERIFICATION],
      });
    }
    if (input.search?.trim()) {
      qb.andWhere("(LOWER(COALESCE(r.fpoName, '')) LIKE :q OR LOWER(COALESCE(r.cin, '')) LIKE :q OR LOWER(COALESCE(r.pan, '')) LIKE :q)", {
        q: '%' + input.search.trim().toLowerCase() + '%',
      });
    }
    const [rows, total] = await qb.orderBy('r.submittedAt', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        fpoName: r.fpoName,
        cin: mask(r.cin),
        pan: mask(r.pan),
        gstin: mask(r.gstin),
        state: r.state,
        district: r.district,
        submittedAt: r.submittedAt,
        status: r.status,
        fpoCode: r.fpoCode,
      })),
    };
  }

  async getApplication(id: string) {
    const r = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id } });
    if (!r) throw new NotFoundException('Application not found.');
    return {
      id: r.id,
      fpoName: r.fpoName,
      cin: mask(r.cin),
      pan: mask(r.pan),
      gstin: mask(r.gstin),
      registeredAddress: r.registeredAddress,
      state: r.state,
      district: r.district,
      chairmanName: r.chairmanName,
      ceoName: r.ceoName,
      authorisedPersonName: r.authorisedPersonName,
      bankName: r.bankName,
      bankAccountNumber: mask(r.bankAccountNumber),
      bankIfsc: r.bankIfsc,
      submittedAt: r.submittedAt,
      status: r.status,
      fpoCode: r.fpoCode,
    };
  }

  async beginApplicationReview(id: string, actorAdminId: string, reason: string) {
    const result = await this.dataSource.getRepository(FpoRegistrationEntity)
      .createQueryBuilder()
      .update(FpoRegistrationEntity)
      .set({ status: FpoRegistrationStatus.UNDER_VERIFICATION })
      .where('id = :id AND status = :status', { id, status: FpoRegistrationStatus.SUBMITTED })
      .execute();
    if (result.affected !== 1) throw new ConflictException('Application is not in Submitted state or was already processed.');
    await this.audit.record({ eventType: 'platform.application.review_started', tenantId: null, actorUserId: actorAdminId, subjectId: id, metadata: { reason } });
    return { underVerification: true };
  }

  async rejectApplication(id: string, actorAdminId: string, reason: string) {
    const result = await this.dataSource.getRepository(FpoRegistrationEntity)
      .createQueryBuilder()
      .update(FpoRegistrationEntity)
      .set({ status: FpoRegistrationStatus.REJECTED })
      .where('id = :id AND status IN (:...states)', {
        id,
        states: [FpoRegistrationStatus.SUBMITTED, FpoRegistrationStatus.UNDER_VERIFICATION],
      })
      .execute();
    if (result.affected !== 1) throw new ConflictException('Application was already processed or is not rejectable.');
    await this.audit.record({ eventType: 'platform.application.rejected', tenantId: null, actorUserId: actorAdminId, subjectId: id, metadata: { reason } });
    return { rejected: true };
  }

  async approveApplication(id: string, actorAdminId: string, reason: string) {
    const repo = this.dataSource.getRepository(FpoRegistrationEntity);
    const current = await repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Application not found.');

    if (![FpoRegistrationStatus.SUBMITTED, FpoRegistrationStatus.UNDER_VERIFICATION, FpoRegistrationStatus.APPROVED].includes(current.status)) {
      throw new ConflictException('Application was already processed or is not approvable.');
    }

    if (current.status !== FpoRegistrationStatus.APPROVED) {
      const result = await repo.createQueryBuilder()
        .update(FpoRegistrationEntity)
        .set({ status: FpoRegistrationStatus.APPROVED })
        .where('id = :id AND status IN (:...states)', {
          id,
          states: [FpoRegistrationStatus.SUBMITTED, FpoRegistrationStatus.UNDER_VERIFICATION],
        })
        .execute();
      if (result.affected !== 1) throw new ConflictException('Application was processed concurrently.');
      await this.audit.record({ eventType: 'platform.application.approved', tenantId: null, actorUserId: actorAdminId, subjectId: id, metadata: { reason } });
    }

    try {
      const activated = await this.activation.activateApprovedRegistration(id);
      return { approved: true, activated: true, fpoCode: activated.fpoCode };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        return {
          approved: true,
          activated: false,
          activationPending: true,
          message: 'Application is approved, but tenant activation is blocked until the authoritative FPO-Code Numbering Engine is configured.',
        };
      }
      throw err;
    }
  }

  async listTenants() {
    const tenants = await this.dataSource.getRepository(FpoRegistrationEntity).find({
      where: { status: FpoRegistrationStatus.ACTIVE },
      order: { activatedAt: 'DESC' },
    });
    const out = [];
    for (const tenant of tenants) {
      const subscription = await this.latestSubscription(tenant.id);
      const branchCount = await this.knownTenantTx.run(tenant.id, async (manager) => {
        const rows = await manager.query('SELECT COUNT(*)::int AS count FROM "settings_branch" WHERE "tenant_id" = $1 AND "isActive" = true', [tenant.id]);
        return Number((rows as Array<{ count: number | string }>)[0]?.count ?? 0);
      });
      out.push({
        tenantId: tenant.id,
        fpoName: tenant.fpoName,
        fpoCode: tenant.fpoCode,
        activatedAt: tenant.activatedAt,
        subscriptionState: subscription?.state ?? null,
        planVersionId: subscription?.planVersionId ?? null,
        aggregateCounts: {
          branches: branchCount,
          members: { available: false, reason: 'Priority #2 member source is not implemented in the current Phase-1 code.' },
          storage: { available: false, reason: 'Authoritative object-storage metering aggregate is not implemented in the current Phase-1 code.' },
        },
      });
    }
    return out;
  }

  async listPlatformAdmins() {
    return (await this.dataSource.getRepository(PlatformAdminAccountEntity).find({ order: { createdAt: 'DESC' } })).map((a) => ({
      id: a.id,
      username: a.username,
      email: a.email,
      role: a.role,
      status: a.status,
      lastLoginAt: a.lastLoginAt,
      mfaEnabled: a.totpEnabled,
    }));
  }

  async createPlatformAdmin(actorAdminId: string, dto: CreatePlatformAdminDto) {
    await this.passwordPolicy.assertValid(dto.password);
    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const duplicate = await repo.createQueryBuilder('a')
      .where('LOWER(a.username) = LOWER(:username) OR LOWER(a.email) = LOWER(:email)', { username: dto.username, email: dto.email })
      .getOne();
    if (duplicate) throw new ConflictException('Platform administrator username or email already exists.');

    const row = await repo.save(repo.create({
      username: dto.username,
      email: dto.email,
      role: dto.role as PlatformAdminRole,
      passwordHash: await this.passwordHasher.hash(dto.password),
      totpSecret: dto.totpSecret,
      totpEnabled: true,
      status: PlatformAdminStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
    }));
    await this.audit.record({
      eventType: 'platform_admin.account.created',
      tenantId: null,
      actorUserId: actorAdminId,
      subjectId: row.id,
      metadata: { role: row.role, reason: dto.reason },
    });
    return { id: row.id, username: row.username, email: row.email, role: row.role, status: row.status };
  }

  async deactivatePlatformAdmin(actorAdminId: string, targetAdminId: string, reason: string) {
    if (actorAdminId === targetAdminId) throw new ForbiddenException('A Platform Super Admin cannot deactivate their own account.');
    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const target = await repo.findOne({ where: { id: targetAdminId } });
    if (!target) throw new NotFoundException('Platform administrator not found.');
    target.status = PlatformAdminStatus.SUSPENDED;
    await repo.save(target);
    await this.sessions.revokeAllSessionsForSubject('PLATFORM_ADMIN', target.id);
    await this.audit.record({
      eventType: 'platform_admin.account.deactivated',
      tenantId: null,
      actorUserId: actorAdminId,
      subjectId: target.id,
      metadata: { reason },
    });
    return { deactivated: true };
  }

  async initiateRecovery(requesterAdminId: string, targetAdminId: string, reason: string) {
    if (requesterAdminId === targetAdminId) throw new ForbiddenException('Recovery requester cannot be the target account.');
    const ttlHours = this.config.get<number>('platform.recoveryRequestTtlHours') ?? 0;
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
      throw new ServiceUnavailableException('Platform recovery request TTL is not configured. Set PLATFORM_RECOVERY_REQUEST_TTL_HOURS before using recovery.');
    }
    const target = await this.dataSource.getRepository(PlatformAdminAccountEntity).findOne({ where: { id: targetAdminId } });
    if (!target) throw new NotFoundException('Target platform administrator not found.');

    const repo = this.dataSource.getRepository(PlatformAdminRecoveryRequestEntity);
    const row = await repo.save(repo.create({
      targetAdminId,
      requesterAdminId,
      reason,
      status: RecoveryRequestStatus.PENDING_APPROVALS,
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      approvedAt: null,
      completedAt: null,
    }));
    await this.audit.record({
      eventType: 'platform_admin.recovery.initiated',
      tenantId: null,
      actorUserId: requesterAdminId,
      subjectId: row.id,
      metadata: { targetAdminId, reason },
    });
    return row;
  }

  async decideRecovery(approverAdminId: string, requestId: string, approve: boolean, reason: string) {
    const requestRepo = this.dataSource.getRepository(PlatformAdminRecoveryRequestEntity);
    const approvalRepo = this.dataSource.getRepository(PlatformAdminRecoveryApprovalEntity);
    const req = await requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Recovery request not found.');
    await this.expireRecoveryIfNeeded(req);
    if (req.status !== RecoveryRequestStatus.PENDING_APPROVALS) throw new ConflictException('Recovery request is not pending.');
    if (req.requesterAdminId === approverAdminId) throw new ForbiddenException('Requester cannot approve their own recovery request.');
    if (req.targetAdminId === approverAdminId) throw new ForbiddenException('Target account cannot approve its own recovery request.');

    const approver = await this.dataSource.getRepository(PlatformAdminAccountEntity).findOne({ where: { id: approverAdminId } });
    if (!approver || approver.status !== PlatformAdminStatus.ACTIVE) throw new ForbiddenException('Only an active platform administrator can approve recovery.');

    try {
      await approvalRepo.save(approvalRepo.create({ requestId, approverAdminId, approved: approve, reason }));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('This administrator already decided this recovery request.');
      throw err;
    }

    if (!approve) {
      req.status = RecoveryRequestStatus.REJECTED;
      await requestRepo.save(req);
    } else {
      const approvals = await approvalRepo.count({ where: { requestId, approved: true } });
      if (approvals >= 2) {
        req.status = RecoveryRequestStatus.APPROVED;
        req.approvedAt = new Date();
        await requestRepo.save(req);
        await this.sessions.revokeAllSessionsForSubject('PLATFORM_ADMIN', req.targetAdminId);
      }
    }

    await this.audit.record({
      eventType: approve ? 'platform_admin.recovery.approved_step' : 'platform_admin.recovery.rejected',
      tenantId: null,
      actorUserId: approverAdminId,
      subjectId: requestId,
      metadata: { reason },
    });
    return { status: req.status };
  }

  async completeRecovery(dto: RecoveryCompleteDto) {
    if (dto.newPassword !== dto.confirmNewPassword) throw new BadRequestException('New password and confirmation do not match.');
    const reqRepo = this.dataSource.getRepository(PlatformAdminRecoveryRequestEntity);
    const req = await reqRepo.findOne({ where: { id: dto.requestId } });
    if (!req) throw new NotFoundException('Recovery request not found.');
    await this.expireRecoveryIfNeeded(req);
    if (req.status !== RecoveryRequestStatus.APPROVED) throw new ForbiddenException('Recovery request has not received the required independent approvals.');

    const adminRepo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    const admin = await adminRepo.createQueryBuilder('a')
      .where('a.id = :id AND (a.username = :identifier OR a.email = :identifier)', { id: req.targetAdminId, identifier: dto.usernameOrEmail })
      .getOne();
    if (!admin || !admin.totpSecret || !admin.totpEnabled) throw new ForbiddenException('Identity verification failed.');
    if (!(await this.totp.verify(dto.totpCode, admin.totpSecret))) throw new ForbiddenException('Identity verification failed.');

    await this.passwordPolicy.assertValid(dto.newPassword);
    admin.passwordHash = await this.passwordHasher.hash(dto.newPassword);
    admin.failedLoginAttempts = 0;
    admin.lockedUntil = null;
    admin.status = PlatformAdminStatus.ACTIVE;
    await adminRepo.save(admin);
    await this.sessions.revokeAllSessionsForSubject('PLATFORM_ADMIN', admin.id);

    req.status = RecoveryRequestStatus.COMPLETED;
    req.completedAt = new Date();
    await reqRepo.save(req);
    await this.audit.record({
      eventType: 'platform_admin.recovery.completed',
      tenantId: null,
      actorUserId: admin.id,
      subjectId: req.id,
      metadata: {},
    });
    return { completed: true };
  }

  async listPlans() {
    return this.dataSource.getRepository(SubscriptionPlanEntity).find({ order: { planCode: 'ASC', version: 'DESC' } });
  }

  async createPlan(actorAdminId: string, dto: CreatePlanDto) {
    validatePlan(dto);
    const repo = this.dataSource.getRepository(SubscriptionPlanEntity);
    const existing = await repo.findOne({ where: { planCode: dto.planCode, status: SubscriptionPlanStatus.ACTIVE } });
    if (existing) throw new ConflictException('An active plan with this code already exists.');
    const row = await repo.save(repo.create({
      ...dto,
      version: 1,
      status: SubscriptionPlanStatus.ACTIVE,
      changedBy: actorAdminId,
    }));
    await this.audit.record({ eventType: 'platform.subscription_plan.created', tenantId: null, actorUserId: actorAdminId, subjectId: row.id, metadata: { planCode: row.planCode, reason: dto.reason } });
    return row;
  }

  async createPlanVersion(actorAdminId: string, dto: NewPlanVersionDto) {
    validatePlan(dto);
    return this.dataSource.transaction(async (manager) => {
      const old = await manager.getRepository(SubscriptionPlanEntity).findOne({ where: { id: dto.supersedesId } });
      if (!old || old.status !== SubscriptionPlanStatus.ACTIVE) throw new ConflictException('Only the current active plan version can be superseded.');
      if (old.planCode !== dto.planCode) throw new BadRequestException('planCode cannot change across versions.');
      const latest = await manager.getRepository(SubscriptionPlanEntity).find({ where: { planCode: dto.planCode }, order: { version: 'DESC' }, take: 1 });
      const next = await manager.getRepository(SubscriptionPlanEntity).save(manager.getRepository(SubscriptionPlanEntity).create({
        planCode: dto.planCode,
        planName: dto.planName,
        limits: dto.limits,
        features: dto.features,
        effectiveDate: dto.effectiveDate,
        version: (latest[0]?.version ?? old.version) + 1,
        status: SubscriptionPlanStatus.ACTIVE,
        changedBy: actorAdminId,
        reason: dto.reason,
      }));
      old.status = SubscriptionPlanStatus.SUPERSEDED;
      await manager.getRepository(SubscriptionPlanEntity).save(old);
      await this.audit.record({ eventType: 'platform.subscription_plan.versioned', tenantId: null, actorUserId: actorAdminId, subjectId: next.id, metadata: { planCode: next.planCode, reason: dto.reason } });
      return next;
    });
  }

  async setPlanActive(actorAdminId: string, id: string, active: boolean, reason: string) {
    const repo = this.dataSource.getRepository(SubscriptionPlanEntity);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subscription plan version not found.');
    if (row.status === SubscriptionPlanStatus.SUPERSEDED) throw new ConflictException('Superseded plan versions cannot be reactivated.');
    row.status = active ? SubscriptionPlanStatus.ACTIVE : SubscriptionPlanStatus.INACTIVE;
    row.changedBy = actorAdminId;
    row.reason = reason;
    await repo.save(row);
    await this.audit.record({ eventType: active ? 'platform.subscription_plan.activated' : 'platform.subscription_plan.deactivated', tenantId: null, actorUserId: actorAdminId, subjectId: row.id, metadata: { reason } });
    return row;
  }

  async configureGrace(actorAdminId: string, gracePeriodDays: number, reason: string) {
    if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) throw new BadRequestException('gracePeriodDays must be a non-negative whole number.');
    const repo = this.dataSource.getRepository(PlatformConfigurationEntity);
    const row = await repo.save(repo.create({
      key: 'SUBSCRIPTION_GRACE_POLICY',
      value: { gracePeriodDays },
      updatedBy: actorAdminId,
      reason,
    }));
    await this.audit.record({ eventType: 'platform.subscription.grace_configured', tenantId: null, actorUserId: actorAdminId, subjectId: row.key, metadata: { gracePeriodDays, reason } });
    return row;
  }

  async assignSubscription(actorAdminId: string, dto: AssignSubscriptionDto) {
    if (new Date(dto.expiryDate) < new Date(dto.startDate)) throw new BadRequestException('expiryDate cannot be before startDate.');
    const tenant = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: dto.tenantId } });
    if (!tenant || tenant.status !== FpoRegistrationStatus.ACTIVE) throw new BadRequestException('Subscription can only be assigned to an active tenant.');
    const plan = await this.dataSource.getRepository(SubscriptionPlanEntity).findOne({ where: { id: dto.planVersionId } });
    if (!plan || plan.status !== SubscriptionPlanStatus.ACTIVE) throw new BadRequestException('Selected plan version is not active.');
    const grace = await this.getGraceDays();

    const previous = await this.latestSubscription(dto.tenantId);
    const row = await this.dataSource.getRepository(TenantSubscriptionEntity).save(
      this.dataSource.getRepository(TenantSubscriptionEntity).create({
        tenantId: dto.tenantId,
        planVersionId: dto.planVersionId,
        startDate: dto.startDate,
        expiryDate: dto.expiryDate,
        state: TenantSubscriptionState.ACTIVE,
        gracePeriodDays: grace,
        usageSnapshot: null,
        changedBy: actorAdminId,
        reason: dto.reason,
        supersedesId: previous?.id ?? null,
        suspendedAt: null,
        reactivatedAt: null,
      }),
    );
    await this.audit.record({ eventType: 'platform.tenant_subscription.assigned', tenantId: dto.tenantId, actorUserId: actorAdminId, subjectId: row.id, metadata: { reason: dto.reason, planVersionId: dto.planVersionId } });
    return row;
  }

  async listSubscriptions() {
    return this.dataSource.getRepository(TenantSubscriptionEntity).find({ order: { createdAt: 'DESC' } });
  }

  async changeSubscriptionState(actorAdminId: string, tenantId: string, state: TenantSubscriptionState, reason: string) {
    const previous = await this.latestSubscription(tenantId);
    if (!previous) throw new NotFoundException('Tenant has no subscription assignment.');
    const row = await this.dataSource.getRepository(TenantSubscriptionEntity).save(
      this.dataSource.getRepository(TenantSubscriptionEntity).create({
        tenantId,
        planVersionId: previous.planVersionId,
        startDate: previous.startDate,
        expiryDate: previous.expiryDate,
        state,
        gracePeriodDays: previous.gracePeriodDays,
        usageSnapshot: previous.usageSnapshot,
        changedBy: actorAdminId,
        reason,
        supersedesId: previous.id,
        suspendedAt: state === TenantSubscriptionState.SUSPENDED ? new Date() : previous.suspendedAt,
        reactivatedAt: state === TenantSubscriptionState.REACTIVATED ? new Date() : null,
      }),
    );
    if (state === TenantSubscriptionState.SUSPENDED) {
      const tenantUsers = await this.knownTenantTx.run(tenantId, (manager) => manager.getRepository(UserAccountEntity).find({ where: { tenantId } }));
      for (const user of tenantUsers) await this.sessions.revokeAllSessionsForSubject('TENANT_USER', user.id);
    }
    await this.audit.record({ eventType: 'platform.tenant_subscription.state_changed', tenantId, actorUserId: actorAdminId, subjectId: row.id, metadata: { state, reason } });
    return row;
  }

  async platformUsage() {
    const tenantCount = await this.dataSource.getRepository(FpoRegistrationEntity).count({ where: { status: FpoRegistrationStatus.ACTIVE } });
    const platformAdminCount = await this.dataSource.getRepository(PlatformAdminAccountEntity).count({ where: { status: PlatformAdminStatus.ACTIVE } });
    return {
      lastComputedAt: new Date().toISOString(),
      metrics: {
        activeTenants: { available: true, value: tenantCount },
        activePlatformAdministrators: { available: true, value: platformAdminCount },
        totalTenantUsers: { available: false, reason: 'Cross-tenant user-count aggregate cache is not implemented; RLS is not bypassed to fabricate this metric.' },
        totalMembers: { available: false, reason: 'Priority #2 member source is not implemented.' },
        storageUsed: { available: false, reason: 'Authoritative object-storage metering aggregate is not implemented.' },
        notificationVolume: { available: false, reason: 'Priority #12 notification aggregate source is not implemented.' },
      },
    };
  }

  async platformHealth() {
    let database = 'down';
    let cache = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    try {
      cache = (await this.redis.ping()) === 'PONG' ? 'up' : 'degraded';
    } catch {
      cache = 'down';
    }
    return {
      checkedAt: new Date().toISOString(),
      api: 'up',
      database,
      cache,
      queueDepth: { available: false, reason: 'No authorised BullMQ business worker is currently wired in Phase-1.' },
      failedJobs: { available: false, reason: 'No authoritative failed-job registry is currently wired in Phase-1.' },
      storage: { available: false, reason: 'Storage health adapter is not exposed by the current storage port.' },
      status: database === 'up' && cache === 'up' ? 'up' : 'degraded',
    };
  }

  async createSupportAccess(actorAdminId: string, dto: SupportAccessRequestDto) {
    const maxMinutes = this.config.get<number>('platform.supportAccessMaxMinutes') ?? 0;
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) {
      throw new ServiceUnavailableException('Support-access maximum duration is not configured. Set PLATFORM_SUPPORT_ACCESS_MAX_MINUTES.');
    }
    if (dto.requestedDurationMinutes > maxMinutes) throw new BadRequestException('Requested duration exceeds the configured platform maximum.');
    const tenant = await this.dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { id: dto.tenantId } });
    if (!tenant || tenant.status !== FpoRegistrationStatus.ACTIVE) throw new BadRequestException('Target tenant is not active.');

    const repo = this.dataSource.getRepository(SupportAccessRequestEntity);
    if (dto.idempotencyKey) {
      const existing = await repo.findOne({ where: { requestingAdminId: actorAdminId, idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
    }
    const row = await repo.save(repo.create({
      tenantId: dto.tenantId,
      requestingAdminId: actorAdminId,
      reason: dto.reason,
      ticketContext: dto.ticketContext,
      requestedDurationMinutes: dto.requestedDurationMinutes,
      status: SupportAccessStatus.PENDING_TENANT_CONSENT,
      idempotencyKey: dto.idempotencyKey ?? null,
      consentedByTenantUserId: null,
      consentedAt: null,
      startedAt: null,
      endsAt: null,
      revokedAt: null,
      viewedModuleSummary: null,
    }));
    await this.audit.record({ eventType: 'platform.support_access.requested', tenantId: dto.tenantId, actorUserId: actorAdminId, subjectId: row.id, metadata: { reason: dto.reason, ticketContext: dto.ticketContext, requestedDurationMinutes: dto.requestedDurationMinutes } });
    return row;
  }

  async listSupportAccess(actorAdminId: string) {
    const rows = await this.dataSource.getRepository(SupportAccessRequestEntity).find({ where: { requestingAdminId: actorAdminId }, order: { createdAt: 'DESC' } });
    for (const row of rows) await this.expireSupportIfNeeded(row);
    return rows;
  }

  async tenantConsentSupport(tenantId: string, tenantUserId: string, requestId: string, approve: boolean, reason: string) {
    const repo = this.dataSource.getRepository(SupportAccessRequestEntity);
    const row = await repo.findOne({ where: { id: requestId, tenantId } });
    if (!row) throw new NotFoundException('Support-access request not found for this tenant.');
    await this.expireSupportIfNeeded(row);
    if (row.status !== SupportAccessStatus.PENDING_TENANT_CONSENT) throw new ConflictException('Support-access request is no longer awaiting consent.');

    row.consentedByTenantUserId = tenantUserId;
    row.consentedAt = new Date();
    if (approve) {
      row.status = SupportAccessStatus.ACTIVE;
      row.startedAt = new Date();
      row.endsAt = new Date(Date.now() + row.requestedDurationMinutes * 60 * 1000);
    } else {
      row.status = SupportAccessStatus.DENIED;
    }
    await repo.save(row);
    await this.audit.record({
      eventType: approve ? 'platform.support_access.consent_granted' : 'platform.support_access.consent_denied',
      tenantId,
      actorUserId: tenantUserId,
      subjectId: row.id,
      metadata: { reason },
    });
    return { status: row.status, endsAt: row.endsAt };
  }

  async revokeSupportAccess(actorId: string, requestId: string, tenantId?: string) {
    const repo = this.dataSource.getRepository(SupportAccessRequestEntity);
    const row = await repo.findOne({ where: tenantId ? { id: requestId, tenantId } : { id: requestId } });
    if (!row) throw new NotFoundException('Support-access request not found.');
    if (row.status !== SupportAccessStatus.ACTIVE) throw new ConflictException('Only an active support-access session can be revoked.');
    row.status = SupportAccessStatus.REVOKED;
    row.revokedAt = new Date();
    await repo.save(row);
    await this.audit.record({ eventType: 'platform.support_access.revoked', tenantId: row.tenantId, actorUserId: actorId, subjectId: row.id });
    return { revoked: true };
  }

  async recordSupportModuleSummary(actorAdminId: string, requestId: string, modules: string[]) {
    const repo = this.dataSource.getRepository(SupportAccessRequestEntity);
    const row = await repo.findOne({ where: { id: requestId, requestingAdminId: actorAdminId } });
    if (!row) throw new NotFoundException('Support-access session not found.');
    await this.expireSupportIfNeeded(row);
    if (row.status !== SupportAccessStatus.ACTIVE || !row.endsAt || row.endsAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Support-access session is not active.');
    }
    row.viewedModuleSummary = Array.from(new Set([...(row.viewedModuleSummary ?? []), ...modules])).slice(0, 100);
    await repo.save(row);
    await this.audit.record({ eventType: 'platform.support_access.module_viewed', tenantId: row.tenantId, actorUserId: actorAdminId, subjectId: row.id, metadata: { modules: modules.join(',') } });
    return { readOnly: true, endsAt: row.endsAt, modules: row.viewedModuleSummary };
  }

  platformAuditBoundary() {
    return {
      available: false,
      owningPriority: 'Priority #15',
      message: 'SA-08 is presentation-only. Priority #15 authoritative audit-event truth is not implemented in this Phase-1 code, so the transient local audit outbox is intentionally not exposed as a substitute.',
    };
  }

  cbboDisabledState() {
    return {
      screenId: 'SA-09',
      status: 'DISABLED_COMING_SOON',
      current: 'CBBO/Implementing-Agency Hierarchy is disabled.',
      future: 'Activation requires a separate Owner-authorised Controlled Amendment.',
      liveDataModel: false,
      mutationApi: false,
    };
  }

  async securityEventsBoundary() {
    const repo = this.dataSource.getRepository(PlatformAdminAccountEntity);
    return {
      available: false,
      owningSource: 'Master-SRS §26 Security / Login-History architecture',
      message: 'The authoritative security-event feed is not implemented yet; local audit-outbox rows are not exposed as a substitute.',
      currentAccountMetadata: {
        lockedPlatformAdmins: await repo.count({ where: { status: PlatformAdminStatus.LOCKED } }),
        suspendedPlatformAdmins: await repo.count({ where: { status: PlatformAdminStatus.SUSPENDED } }),
      },
    };
  }

  private async getGraceDays(): Promise<number> {
    const row = await this.dataSource.getRepository(PlatformConfigurationEntity).findOne({ where: { key: 'SUBSCRIPTION_GRACE_POLICY' } });
    const n = Number(row?.value?.gracePeriodDays);
    if (!Number.isInteger(n) || n < 0) {
      throw new ServiceUnavailableException('Subscription grace duration is not configured. Configure it before assigning a subscription.');
    }
    return n;
  }

  private latestSubscription(tenantId: string) {
    return this.dataSource.getRepository(TenantSubscriptionEntity).findOne({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  private async expireRecoveryIfNeeded(req: PlatformAdminRecoveryRequestEntity) {
    if (req.status === RecoveryRequestStatus.PENDING_APPROVALS || req.status === RecoveryRequestStatus.APPROVED) {
      if (req.expiresAt.getTime() <= Date.now()) {
        req.status = RecoveryRequestStatus.EXPIRED;
        await this.dataSource.getRepository(PlatformAdminRecoveryRequestEntity).save(req);
        await this.audit.record({ eventType: 'platform_admin.recovery.expired', tenantId: null, subjectId: req.id });
      }
    }
  }

  private async expireSupportIfNeeded(row: SupportAccessRequestEntity) {
    if (row.status === SupportAccessStatus.ACTIVE && row.endsAt && row.endsAt.getTime() <= Date.now()) {
      row.status = SupportAccessStatus.EXPIRED;
      await this.dataSource.getRepository(SupportAccessRequestEntity).save(row);
      await this.audit.record({ eventType: 'platform.support_access.expired', tenantId: row.tenantId, actorUserId: row.requestingAdminId, subjectId: row.id });
    }
  }
}

function validatePlan(dto: CreatePlanDto | NewPlanVersionDto) {
  for (const [key, value] of Object.entries(dto.limits)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      throw new BadRequestException('Plan limit must be non-negative: ' + key);
    }
  }
}

function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '*'.repeat(value.length);
  return value.slice(0, 2) + '*'.repeat(Math.max(2, value.length - 4)) + value.slice(-2);
}
