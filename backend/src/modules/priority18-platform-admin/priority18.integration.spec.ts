import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { TotpService } from '../priority1-auth-registration/services/totp.service.js';
import {
  PlatformAdminAccountEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from '../priority1-auth-registration/entities/platform-admin-account.entity.js';
import {
  FpoRegistrationEntity,
  FpoRegistrationStatus,
} from '../priority1-auth-registration/entities/fpo-registration.entity.js';
import { TenantSubscriptionState } from './entities/tenant-subscription.entity.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-also-32-chars-long';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.PLATFORM_RECOVERY_REQUEST_TTL_HOURS = '1';
process.env.PLATFORM_SUPPORT_ACCESS_MAX_MINUTES = '120';

describe('Priority #18 — Platform Control Plane (real PostgreSQL + Redis)', () => {
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>['compile']>;
  let dataSource: DataSource;
  let service: PlatformAdminService;
  let passwordHasher: PasswordHasher;
  let totp: TotpService;

  const ids = {
    tenant: '18181818-1111-1111-1111-111111111111',
    requester: '18181818-2222-2222-2222-222222222222',
    approver1: '18181818-3333-3333-3333-333333333333',
    approver2: '18181818-4444-4444-4444-444444444444',
    target: '18181818-5555-5555-5555-555555555555',
    tenantUser: '18181818-6666-6666-6666-666666666666',
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(PlatformAdminService);
    passwordHasher = moduleRef.get(PasswordHasher);
    totp = moduleRef.get(TotpService);

    await dataSource.query('TRUNCATE TABLE "platform_admin_recovery_approval" CASCADE');
    await dataSource.query('TRUNCATE TABLE "platform_admin_recovery_request" CASCADE');
    await dataSource.query('TRUNCATE TABLE "support_access_request" CASCADE');
    await dataSource.query('TRUNCATE TABLE "tenant_subscription" CASCADE');
    await dataSource.query('TRUNCATE TABLE "subscription_plan" CASCADE');
    await dataSource.query('TRUNCATE TABLE "platform_configuration" CASCADE');
    await dataSource.query('TRUNCATE TABLE "platform_admin_account" CASCADE');
    await dataSource.query('TRUNCATE TABLE "fpo_registration" CASCADE');

    const secret = totp.generateSecret();
    const repo = dataSource.getRepository(PlatformAdminAccountEntity);
    await repo.save([
      repo.create({
        id: ids.requester,
        username: 'p18-requester',
        email: 'p18-requester@example.invalid',
        passwordHash: await passwordHasher.hash('AdminPass123'),
        totpSecret: totp.generateSecret(),
        totpEnabled: true,
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
      }),
      repo.create({
        id: ids.approver1,
        username: 'p18-approver1',
        email: 'p18-approver1@example.invalid',
        passwordHash: await passwordHasher.hash('AdminPass123'),
        totpSecret: totp.generateSecret(),
        totpEnabled: true,
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
      }),
      repo.create({
        id: ids.approver2,
        username: 'p18-approver2',
        email: 'p18-approver2@example.invalid',
        passwordHash: await passwordHasher.hash('AdminPass123'),
        totpSecret: totp.generateSecret(),
        totpEnabled: true,
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.ACTIVE,
      }),
      repo.create({
        id: ids.target,
        username: 'p18-target',
        email: 'p18-target@example.invalid',
        passwordHash: await passwordHasher.hash('OldPass123'),
        totpSecret: secret,
        totpEnabled: true,
        role: PlatformAdminRole.SUPER_ADMIN,
        status: PlatformAdminStatus.LOCKED,
        lockedUntil: new Date(Date.now() + 60_000),
      }),
    ]);

    await dataSource.getRepository(FpoRegistrationEntity).save(
      dataSource.getRepository(FpoRegistrationEntity).create({
        id: ids.tenant,
        fpoName: 'P18 Test FPO',
        officialEmail: 'tenant@example.invalid',
        officialMobile: '9123456789',
        status: FpoRegistrationStatus.ACTIVE,
        fpoCode: 'P18-TEST',
        activatedAt: new Date(),
      }),
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('SA-09 stays Disabled / Coming Soon with no live model or mutation API', () => {
    const result = service.cbboDisabledState();
    expect(result.status).toBe('DISABLED_COMING_SOON');
    expect(result.liveDataModel).toBe(false);
    expect(result.mutationApi).toBe(false);
  });

  it('SA-03 creates immutable plan versions and supersedes the old version', async () => {
    const v1 = await service.createPlan(ids.requester, {
      planCode: 'BASIC',
      planName: 'Basic',
      limits: { staffUsers: 5 },
      features: { lending: true },
      effectiveDate: '2026-10-01',
      reason: 'Initial plan',
    });
    expect(v1.version).toBe(1);

    const v2 = await service.createPlanVersion(ids.requester, {
      supersedesId: v1.id,
      planCode: 'BASIC',
      planName: 'Basic Revised',
      limits: { staffUsers: 10 },
      features: { lending: true },
      effectiveDate: '2026-11-01',
      reason: 'Increase staff limit',
    });
    expect(v2.version).toBe(2);

    const old = await dataSource.getRepository(v1.constructor as typeof PlatformAdminAccountEntity).findOne({ where: { id: v1.id } }).catch(() => null);
    void old;
    const plans = await service.listPlans();
    const historical = plans.find((p) => p.id === v1.id);
    expect(historical?.status).toBe('SUPERSEDED');
  });

  it('SA-04 requires explicit grace configuration, assigns a subscription and preserves lifecycle history', async () => {
    await service.configureGrace(ids.requester, 7, 'Owner-configured grace window');
    const plan = (await service.listPlans()).find((p) => p.planCode === 'BASIC' && p.status === 'ACTIVE');
    expect(plan).toBeTruthy();

    const active = await service.assignSubscription(ids.requester, {
      tenantId: ids.tenant,
      planVersionId: plan!.id,
      startDate: '2026-10-01',
      expiryDate: '2027-09-30',
      reason: 'Initial assignment',
    });
    expect(active.state).toBe(TenantSubscriptionState.ACTIVE);
    expect(active.gracePeriodDays).toBe(7);

    const readonly = await service.changeSubscriptionState(
      ids.requester,
      ids.tenant,
      TenantSubscriptionState.EXPIRED_READ_ONLY,
      'Manual lifecycle override for test',
    );
    expect(readonly.supersedesId).toBe(active.id);
    expect(readonly.state).toBe(TenantSubscriptionState.EXPIRED_READ_ONLY);
  });

  it('SA-07 requires tenant consent before a support session becomes active', async () => {
    const req = await service.createSupportAccess(ids.requester, {
      tenantId: ids.tenant,
      reason: 'Investigate a support ticket',
      ticketContext: 'TICKET-18',
      requestedDurationMinutes: 30,
      idempotencyKey: 'p18-support-1',
    });
    expect(req.status).toBe('PENDING_TENANT_CONSENT');

    const consent = await service.tenantConsentSupport(
      ids.tenant,
      ids.tenantUser,
      req.id,
      true,
      'Tenant explicitly approves read-only support',
    );
    expect(consent.status).toBe('ACTIVE');
    expect(consent.endsAt).toBeTruthy();

    const summary = await service.recordSupportModuleSummary(ids.requester, req.id, ['SETTINGS']);
    expect(summary.readOnly).toBe(true);
  });

  it('Owner Decision #1 recovery needs two independent admins and target TOTP before password replacement', async () => {
    const req = await service.initiateRecovery(ids.requester, ids.target, 'Locked admin requires controlled recovery');
    expect(req.status).toBe('PENDING_APPROVALS');

    const first = await service.decideRecovery(ids.approver1, req.id, true, 'Identity confirmed independently');
    expect(first.status).toBe('PENDING_APPROVALS');

    const second = await service.decideRecovery(ids.approver2, req.id, true, 'Second independent confirmation');
    expect(second.status).toBe('APPROVED');

    const target = await dataSource.getRepository(PlatformAdminAccountEntity).findOneOrFail({ where: { id: ids.target } });
    const token = await totp.generateToken(target.totpSecret!);
    const done = await service.completeRecovery({
      requestId: req.id,
      usernameOrEmail: target.username,
      totpCode: token,
      newPassword: 'NewAdminPass123',
      confirmNewPassword: 'NewAdminPass123',
    });
    expect(done.completed).toBe(true);

    const after = await dataSource.getRepository(PlatformAdminAccountEntity).findOneOrFail({ where: { id: ids.target } });
    expect(after.status).toBe(PlatformAdminStatus.ACTIVE);
    expect(await passwordHasher.verify(after.passwordHash, 'NewAdminPass123')).toBe(true);
    expect(after.totpEnabled).toBe(true);
  });

  it('SA-08 and SA-10 refuse to manufacture second audit/security-event truth', async () => {
    const audit = service.platformAuditBoundary();
    expect(audit.available).toBe(false);
    expect(audit.owningPriority).toBe('Priority #15');

    const security = await service.securityEventsBoundary();
    expect(security.available).toBe(false);
  });
});
