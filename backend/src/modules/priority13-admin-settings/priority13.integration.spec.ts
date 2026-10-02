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
});
