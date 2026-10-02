import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import configuration from '../../config/configuration.js';
import { validateEnv } from '../../config/env.validation.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../../common/auth/auth.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard.js';
import { TenantContextModule } from '../../common/tenant-context/tenant-context.module.js';
import { TenantContextInterceptor } from '../../common/tenant-context/tenant-context.interceptor.js';
import { SESSION_STORE_PORT } from '../../common/session/session-store.port.js';
import type { SessionStorePort } from '../../common/session/session-store.port.js';
import { SessionModule } from '../../common/session/session.module.js';
import { KnownTenantTransactionRunner } from '../../common/tenant-context/known-tenant-transaction-runner.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../priority1-auth-registration/entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../priority1-auth-registration/entities/user-account.entity.js';
import { Priority13AdminSettingsModule } from './priority13-admin-settings.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';

// Real PostgreSQL + real Redis — a genuine, executed integration test.
process.env.DATABASE_URL ??= 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-also-32-chars-long';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    SessionModule,
    AuthModule,
    AuditModule,
    TenantContextModule,
    DatabaseModule,
    TypeOrmModule.forFeature([FpoRegistrationEntity, UserAccountEntity]),
    Priority13AdminSettingsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class TestAppModule {}

describe('Priority #13 — SET-08 Roles & Permissions (real PostgreSQL + Redis integration)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let sessionStore: SessionStorePort;
  let dataSource: DataSource;

  const TENANT_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const MAKER = 'bbbbbbbb-1111-1111-1111-111111111111';
  const CHECKER = 'bbbbbbbb-2222-2222-2222-222222222222';
  const OTHER_CHECKER = 'bbbbbbbb-3333-3333-3333-333333333333';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Matches main.ts's production bootstrap exactly (whitelist/forbid-unknown/
    // transform) — this is what actually enforces "reason is mandatory" etc.
    // at the HTTP boundary; it is not wired by default in a bare test module.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwtService = app.get(JwtService);
    sessionStore = app.get(SESSION_STORE_PORT);
    dataSource = app.get(DataSource);

    const regRepo = dataSource.getRepository(FpoRegistrationEntity);
    const knownTenantTx = new KnownTenantTransactionRunner(dataSource);
    await knownTenantTx.run(TENANT_A, (manager) => manager.getRepository(UserAccountEntity).delete({ tenantId: TENANT_A }));
    await regRepo.delete({ id: TENANT_A });
    await regRepo.insert({ id: TENANT_A, status: FpoRegistrationStatus.ACTIVE, fpoCode: `P13-${TENANT_A.slice(0, 8)}` });
    await knownTenantTx.run(TENANT_A, (manager) =>
      manager.getRepository(UserAccountEntity).insert([
        { id: MAKER, tenantId: TENANT_A, username: 'maker', email: 'maker@p13-test.invalid', status: UserAccountStatus.ACTIVE },
        { id: CHECKER, tenantId: TENANT_A, username: 'checker', email: 'checker@p13-test.invalid', status: UserAccountStatus.ACTIVE },
        { id: OTHER_CHECKER, tenantId: TENANT_A, username: 'checker2', email: 'checker2@p13-test.invalid', status: UserAccountStatus.ACTIVE },
      ]),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function tokenFor(userId: string): Promise<string> {
    const session = await sessionStore.createSession({
      subjectType: 'TENANT_USER',
      userId,
      tenantId: TENANT_A,
      mfaCompleted: true,
      ttlSeconds: 900,
      ipAddress: null,
      userAgent: null,
    });
    return jwtService.sign({ sub: userId, tenantId: TENANT_A, isPlatformSuperAdmin: false, sid: session.sessionId });
  }

  async function createAndSubmitRole(makerToken: string, roleName: string) {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/settings/roles')
      .set('Authorization', `Bearer ${makerToken}`)
      .send({ roleName, permissions: { SETTINGS: ['VIEW', 'CONFIGURE'] } });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.id;

    const submitRes = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/submit`)
      .set('Authorization', `Bearer ${makerToken}`)
      .send({});
    expect(submitRes.status).toBe(201);
    return roleId as string;
  }

  it('lets a Maker create and submit a role, and a different Checker approve it', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const roleId = await createAndSubmitRole(makerToken, `Branch Manager ${Date.now()}`);

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/approve`)
      .set('Authorization', `Bearer ${checkerToken}`)
      .send({});
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.approved).toBe(true);

    const list = await request(app.getHttpServer()).get('/api/v1/settings/roles').set('Authorization', `Bearer ${checkerToken}`);
    const approved = list.body.find((r: { id: string }) => r.id === roleId);
    expect(approved.status).toBe('ACTIVE');
    expect(approved.checkerId).toBe(CHECKER);
  });

  it('blocks a Maker from approving their own submission (Maker != Checker, server-enforced)', async () => {
    const makerToken = await tokenFor(MAKER);
    const roleId = await createAndSubmitRole(makerToken, `Self Approve Attempt ${Date.now()}`);

    const selfApprove = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/approve`)
      .set('Authorization', `Bearer ${makerToken}`)
      .send({});
    expect(selfApprove.status).toBe(403);
  });

  it('only lets the first of two concurrent Checkers succeed (CAS, no double-approval)', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const otherCheckerToken = await tokenFor(OTHER_CHECKER);
    const roleId = await createAndSubmitRole(makerToken, `Concurrent Approve ${Date.now()}`);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/settings/roles/${roleId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}),
      request(app.getHttpServer()).post(`/api/v1/settings/roles/${roleId}/approve`).set('Authorization', `Bearer ${otherCheckerToken}`).send({}),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('rejects with a mandatory reason, and Reject keeps the role out of Active', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const roleId = await createAndSubmitRole(makerToken, `To Be Rejected ${Date.now()}`);

    const missingReason = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/reject`)
      .set('Authorization', `Bearer ${checkerToken}`)
      .send({});
    expect(missingReason.status).toBe(400);

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/reject`)
      .set('Authorization', `Bearer ${checkerToken}`)
      .send({ reason: 'Permission set too broad for this role.' });
    expect(rejectRes.status).toBe(201);

    const list = await request(app.getHttpServer()).get('/api/v1/settings/roles').set('Authorization', `Bearer ${checkerToken}`);
    const rejected = list.body.find((r: { id: string }) => r.id === roleId);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decisionReason).toBe('Permission set too broad for this role.');
  });

  it('Send Back returns the role to the Maker for correction, distinct from Reject', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const roleId = await createAndSubmitRole(makerToken, `To Be Sent Back ${Date.now()}`);

    const sendBackRes = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/send-back`)
      .set('Authorization', `Bearer ${checkerToken}`)
      .send({ reason: 'Please also grant EXPORT.' });
    expect(sendBackRes.status).toBe(201);

    const list = await request(app.getHttpServer()).get('/api/v1/settings/roles').set('Authorization', `Bearer ${checkerToken}`);
    const sentBack = list.body.find((r: { id: string }) => r.id === roleId);
    expect(sentBack.status).toBe('SENT_BACK');

    // Maker can resubmit the same (now SENT_BACK) record.
    const resubmit = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${roleId}/submit`)
      .set('Authorization', `Bearer ${makerToken}`)
      .send({});
    expect(resubmit.status).toBe(201);
  });

  it('supersedes the old Active version (never deletes it) when an edit is approved', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const roleName = `Editable Role ${Date.now()}`;
    const originalId = await createAndSubmitRole(makerToken, roleName);
    await request(app.getHttpServer()).post(`/api/v1/settings/roles/${originalId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

    // Submit an edit (supersedesId = originalId).
    const editRes = await request(app.getHttpServer())
      .post('/api/v1/settings/roles')
      .set('Authorization', `Bearer ${makerToken}`)
      .send({ roleName, permissions: { SETTINGS: ['VIEW', 'CONFIGURE', 'EXPORT'] }, supersedesId: originalId });
    expect(editRes.status).toBe(201);
    const editId = editRes.body.id;
    await request(app.getHttpServer()).post(`/api/v1/settings/roles/${editId}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
    const approveEdit = await request(app.getHttpServer())
      .post(`/api/v1/settings/roles/${editId}/approve`)
      .set('Authorization', `Bearer ${checkerToken}`)
      .send({});
    expect(approveEdit.status).toBe(201);

    const list = await request(app.getHttpServer()).get('/api/v1/settings/roles').set('Authorization', `Bearer ${checkerToken}`);
    const original = list.body.find((r: { id: string }) => r.id === originalId);
    const edited = list.body.find((r: { id: string }) => r.id === editId);
    expect(original.status).toBe('SUPERSEDED');
    expect(edited.status).toBe('ACTIVE');
  });

  it('rejects a second concurrent edit-submission of the same Active role (DB-level race guard)', async () => {
    const makerToken = await tokenFor(MAKER);
    const checkerToken = await tokenFor(CHECKER);
    const roleName = `Race Guard Role ${Date.now()}`;
    const originalId = await createAndSubmitRole(makerToken, roleName);
    await request(app.getHttpServer()).post(`/api/v1/settings/roles/${originalId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

    const draft1 = await request(app.getHttpServer())
      .post('/api/v1/settings/roles')
      .set('Authorization', `Bearer ${makerToken}`)
      .send({ roleName, permissions: { SETTINGS: ['VIEW'] }, supersedesId: originalId });
    const draft2 = await request(app.getHttpServer())
      .post('/api/v1/settings/roles')
      .set('Authorization', `Bearer ${makerToken}`)
      .send({ roleName, permissions: { SETTINGS: ['CONFIGURE'] }, supersedesId: originalId });
    expect(draft1.status).toBe(201);
    expect(draft2.status).toBe(201);

    const submit1 = await request(app.getHttpServer()).post(`/api/v1/settings/roles/${draft1.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
    expect(submit1.status).toBe(201);
    const submit2 = await request(app.getHttpServer()).post(`/api/v1/settings/roles/${draft2.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
    expect(submit2.status).toBe(409);
  });

  function validBranch(overrides: Record<string, unknown> = {}) {
    return {
      branchCode: `BR-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      branchName: 'Pune Regular Branch',
      branchType: 'REGULAR',
      address: '45 Market Yard, Pune',
      state: 'Maharashtra',
      district: 'Pune',
      openingDate: '2024-01-01',
      ...overrides,
    };
  }

  describe('SET-03 — Branch Master (no maker-checker; immediate effect + own safety checks)', () => {
    it('creates a branch immediately on Save, no approval step', async () => {
      const token = await tokenFor(MAKER);
      const res = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`).send(validBranch());
      expect(res.status).toBe(201);
      expect(res.body.isActive).toBe(true);
    });

    it('rejects a duplicate Branch Code within the same tenant', async () => {
      const token = await tokenFor(MAKER);
      const branch = validBranch();
      const first = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`).send(branch);
      expect(first.status).toBe(201);
      const dup = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`).send(branch);
      expect(dup.status).toBe(409);
    });

    it('allows only one active HEAD_OFFICE branch per tenant', async () => {
      const token = await tokenFor(MAKER);
      const first = await request(app.getHttpServer())
        .post('/api/v1/settings/branches')
        .set('Authorization', `Bearer ${token}`)
        .send(validBranch({ branchType: 'HEAD_OFFICE' }));
      // A Head Office may already exist from a prior test run in this shared tenant — accept either a clean 201 or the expected conflict.
      expect([201, 409]).toContain(first.status);
      const second = await request(app.getHttpServer())
        .post('/api/v1/settings/branches')
        .set('Authorization', `Bearer ${token}`)
        .send(validBranch({ branchType: 'HEAD_OFFICE' }));
      expect(second.status).toBe(409);
    });

    it('blocks changing Branch Code after creation (read-only per spec point 10)', async () => {
      const token = await tokenFor(MAKER);
      const created = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`).send(validBranch());
      const attempt = await request(app.getHttpServer())
        .put(`/api/v1/settings/branches/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(validBranch({ branchCode: 'SOME-OTHER-CODE' }));
      expect(attempt.status).toBe(400);
    });

    it('deactivates and reactivates a REGULAR branch, preserving history (never deleted)', async () => {
      const token = await tokenFor(MAKER);
      const created = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`).send(validBranch());
      const branchId = created.body.id;

      const missingReason = await request(app.getHttpServer()).post(`/api/v1/settings/branches/${branchId}/deactivate`).set('Authorization', `Bearer ${token}`).send({});
      expect(missingReason.status).toBe(400);

      const deactivate = await request(app.getHttpServer())
        .post(`/api/v1/settings/branches/${branchId}/deactivate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Branch closed — merged into HQ.' });
      expect(deactivate.status).toBe(201);

      const listAfterDeactivate = await request(app.getHttpServer()).get('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`);
      const found = listAfterDeactivate.body.find((b: { id: string }) => b.id === branchId);
      expect(found.isActive).toBe(false);
      expect(found.deactivationReason).toBe('Branch closed — merged into HQ.');

      const reactivate = await request(app.getHttpServer()).post(`/api/v1/settings/branches/${branchId}/reactivate`).set('Authorization', `Bearer ${token}`).send({});
      expect(reactivate.status).toBe(201);
      const listAfterReactivate = await request(app.getHttpServer()).get('/api/v1/settings/branches').set('Authorization', `Bearer ${token}`);
      expect(listAfterReactivate.body.find((b: { id: string }) => b.id === branchId).isActive).toBe(true);
    });
  });

  describe('SET-07 — Users (Maker-Checker; real user_account rows created on approval)', () => {
    async function activeRole(makerToken: string, checkerToken: string): Promise<string> {
      const roleId = await createAndSubmitRole(makerToken, `Field Officer ${Date.now()}-${Math.random()}`);
      await request(app.getHttpServer()).post(`/api/v1/settings/roles/${roleId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});
      return roleId;
    }

    async function activeBranch(makerToken: string): Promise<string> {
      const res = await request(app.getHttpServer()).post('/api/v1/settings/branches').set('Authorization', `Bearer ${makerToken}`).send(validBranch());
      return res.body.id;
    }

    it('rejects a Create request naming a Role that is not currently Active', async () => {
      const token = await tokenFor(MAKER);
      const res = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Asha Patil', mobile: '9123456780', roleId: '00000000-0000-0000-0000-000000000000', branchAccessScope: 'ALL_BRANCHES' });
      expect(res.status).toBe(400);
    });

    it('creates a real, PENDING_SETUP user_account row only once the request is Approved (never on Submit)', async () => {
      const makerToken = await tokenFor(MAKER);
      const checkerToken = await tokenFor(CHECKER);
      const roleId = await activeRole(makerToken, checkerToken);
      const branchId = await activeBranch(makerToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ fullName: 'Asha Patil', mobile: '9123456781', roleId, branchAccessScope: 'SELECTED_BRANCH', selectedBranchIds: [branchId] });
      expect(createRes.status).toBe(201);
      const requestId = createRes.body.id;

      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${requestId}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});

      const beforeApprove = await request(app.getHttpServer()).get('/api/v1/settings/users/requests').set('Authorization', `Bearer ${makerToken}`);
      expect(beforeApprove.body.find((r: { id: string }) => r.id === requestId).status).toBe('PENDING_APPROVAL');

      const approveRes = await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${requestId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});
      expect(approveRes.status).toBe(201);

      const userRepo = dataSource.getRepository(UserAccountEntity);
      const createdUser = await new KnownTenantTransactionRunner(dataSource).run(TENANT_A, (manager) =>
        manager.getRepository(UserAccountEntity).findOne({ where: { tenantId: TENANT_A, mobile: '9123456781' } }),
      );
      expect(createdUser).not.toBeNull();
      expect(createdUser!.status).toBe('PENDING_SETUP');
      expect(createdUser!.roleId).toBe(roleId);
      expect(createdUser!.fullName).toBe('Asha Patil');
      void userRepo; // repo var kept for clarity of intent; actual read goes through the RLS-aware KnownTenantTransactionRunner above.
    });

    it('blocks the Maker from approving their own user-creation request', async () => {
      const makerToken = await tokenFor(MAKER);
      const checkerToken = await tokenFor(CHECKER);
      const roleId = await activeRole(makerToken, checkerToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ fullName: 'Self Approve User', mobile: '9123456782', roleId, branchAccessScope: 'ALL_BRANCHES' });
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${createRes.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});

      const selfApprove = await request(app.getHttpServer())
        .post(`/api/v1/settings/users/requests/${createRes.body.id}/approve`)
        .set('Authorization', `Bearer ${makerToken}`)
        .send({});
      expect(selfApprove.status).toBe(403);
    });

    it('Edit request changes an existing user\'s Role once approved; Deactivate/Reactivate toggle status', async () => {
      const makerToken = await tokenFor(MAKER);
      const checkerToken = await tokenFor(CHECKER);
      const roleId1 = await activeRole(makerToken, checkerToken);
      const roleId2 = await activeRole(makerToken, checkerToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ fullName: 'Edit Target User', mobile: '9123456783', roleId: roleId1, branchAccessScope: 'ALL_BRANCHES' });
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${createRes.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${createRes.body.id}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

      const createdUser = await new KnownTenantTransactionRunner(dataSource).run(TENANT_A, (manager) =>
        manager.getRepository(UserAccountEntity).findOneOrFail({ where: { tenantId: TENANT_A, mobile: '9123456783' } }),
      );

      const editRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests/edit')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ targetUserId: createdUser.id, roleId: roleId2 });
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${editRes.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${editRes.body.id}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

      const afterEdit = await new KnownTenantTransactionRunner(dataSource).run(TENANT_A, (manager) =>
        manager.getRepository(UserAccountEntity).findOneOrFail({ where: { id: createdUser.id } }),
      );
      expect(afterEdit.roleId).toBe(roleId2);

      const liveSessionBeforeDeactivation = await sessionStore.createSession({
        subjectType: 'TENANT_USER',
        userId: createdUser.id,
        tenantId: TENANT_A,
        mfaCompleted: true,
        ttlSeconds: 900,
        ipAddress: null,
        userAgent: 'priority13-deactivation-test',
      });
      expect(await sessionStore.getSession(liveSessionBeforeDeactivation.sessionId)).not.toBeNull();

      const deactivateRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests/deactivate')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ targetUserId: createdUser.id });
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${deactivateRes.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${deactivateRes.body.id}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

      const afterDeactivate = await new KnownTenantTransactionRunner(dataSource).run(TENANT_A, (manager) =>
        manager.getRepository(UserAccountEntity).findOneOrFail({ where: { id: createdUser.id } }),
      );
      expect(afterDeactivate.status).toBe('SUSPENDED');
      expect(await sessionStore.getSession(liveSessionBeforeDeactivation.sessionId)).toBeNull();

      const reactivateRes = await request(app.getHttpServer())
        .post('/api/v1/settings/users/requests/reactivate')
        .set('Authorization', `Bearer ${makerToken}`)
        .send({ targetUserId: createdUser.id });
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${reactivateRes.body.id}/submit`).set('Authorization', `Bearer ${makerToken}`).send({});
      await request(app.getHttpServer()).post(`/api/v1/settings/users/requests/${reactivateRes.body.id}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({});

      const afterReactivate = await new KnownTenantTransactionRunner(dataSource).run(TENANT_A, (manager) =>
        manager.getRepository(UserAccountEntity).findOneOrFail({ where: { id: createdUser.id } }),
      );
      expect(afterReactivate.status).toBe('ACTIVE');
    });
  });
});
