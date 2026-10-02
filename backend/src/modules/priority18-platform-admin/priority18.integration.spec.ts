import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { DeliveryModule } from '../../common/delivery/delivery.module.js';
import { StorageModule } from '../../common/storage/storage.module.js';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard.js';
import { TenantContextModule } from '../../common/tenant-context/tenant-context.module.js';
import { TenantContextInterceptor } from '../../common/tenant-context/tenant-context.interceptor.js';
import { SESSION_STORE_PORT } from '../../common/session/session-store.port.js';
import type { SessionStorePort } from '../../common/session/session-store.port.js';
import { SessionModule } from '../../common/session/session.module.js';
import { KnownTenantTransactionRunner } from '../../common/tenant-context/known-tenant-transaction-runner.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../priority1-auth-registration/entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../priority1-auth-registration/entities/user-account.entity.js';
import { PlatformAdminAccountEntity, PlatformAdminRole, PlatformAdminStatus } from '../priority1-auth-registration/entities/platform-admin-account.entity.js';
import { Priority18PlatformAdminModule } from './priority18-platform-admin.module.js';

process.env.DATABASE_URL ??= 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-also-32-chars-long';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.PLATFORM_SUPPORT_ACCESS_MAX_MINUTES ??= '60';
process.env.NODE_ENV = 'test';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    SessionModule,
    DeliveryModule,
    StorageModule,
    AuthModule,
    AuditModule,
    TenantContextModule,
    DatabaseModule,
    Priority18PlatformAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class TestAppModule {}

describe('Priority #18 — Platform Super Admin control-plane integration', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let sessions: SessionStorePort;
  let dataSource: DataSource;

  const ADMIN = 'eeeeeeee-1111-1111-1111-111111111111';
  const TENANT = 'dddddddd-1111-1111-1111-111111111111';
  const TENANT_USER = 'cccccccc-1111-1111-1111-111111111111';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    jwt = app.get(JwtService);
    sessions = app.get(SESSION_STORE_PORT);
    dataSource = app.get(DataSource);

    await dataSource.getRepository(PlatformAdminAccountEntity).delete({ id: ADMIN });
    await dataSource.getRepository(FpoRegistrationEntity).delete({ id: TENANT });
    await dataSource.getRepository(FpoRegistrationEntity).insert({
      id: TENANT,
      status: FpoRegistrationStatus.ACTIVE,
      fpoCode: 'P18TEST',
      fpoName: 'Priority 18 Test FPO',
      officialEmail: 'p18-test@example.invalid',
    });
    const knownTenant = new KnownTenantTransactionRunner(dataSource);
    await knownTenant.run(TENANT, (manager) => manager.getRepository(UserAccountEntity).insert({
      id: TENANT_USER,
      tenantId: TENANT,
      username: 'p18tenant',
      email: 'p18tenant@example.invalid',
      status: UserAccountStatus.ACTIVE,
    }));

    await dataSource.getRepository(PlatformAdminAccountEntity).insert({
      id: ADMIN,
      username: 'p18-super-admin',
      email: 'p18-admin@example.invalid',
      passwordHash: 'not-used-by-this-integration-test',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpEnabled: true,
      role: PlatformAdminRole.SUPER_ADMIN,
      status: PlatformAdminStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function platformToken() {
    const session = await sessions.createSession({
      subjectType: 'PLATFORM_ADMIN',
      userId: ADMIN,
      tenantId: null,
      mfaCompleted: true,
      ttlSeconds: 900,
      ipAddress: null,
      userAgent: null,
    });
    return jwt.sign({ sub: ADMIN, tenantId: null, isPlatformSuperAdmin: true, platformRole: PlatformAdminRole.SUPER_ADMIN, sid: session.sessionId });
  }

  async function tenantToken() {
    const session = await sessions.createSession({
      subjectType: 'TENANT_USER',
      userId: TENANT_USER,
      tenantId: TENANT,
      mfaCompleted: true,
      ttlSeconds: 900,
      ipAddress: null,
      userAgent: null,
    });
    return jwt.sign({ sub: TENANT_USER, tenantId: TENANT, isPlatformSuperAdmin: false, platformRole: null, sid: session.sessionId });
  }

  it('SA-09 remains disabled/coming-soon and exposes no live mutation model', async () => {
    const token = await platformToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/super-admin/cbbo-agency-hierarchy')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISABLED_COMING_SOON');
    expect(res.body.liveDataModel).toBe(false);
    expect(res.body.mutationApi).toBe(false);
  });

  it('SA-08 does not expose the local audit outbox as a second authoritative audit truth', async () => {
    const token = await platformToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/super-admin/audit')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.owningPriority).toBe('Priority #15');
  });

  it('tenant users cannot access platform super-admin routes', async () => {
    const token = await tenantToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/super-admin/usage')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('creates a subscription plan and returns it through SA-03', async () => {
    const token = await platformToken();
    const planCode = `P18-${Date.now()}`;
    const create = await request(app.getHttpServer())
      .post('/api/v1/super-admin/subscription-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        planCode,
        planName: 'Integration Standard',
        limits: { users: 25, branches: 5 },
        features: { reports: true },
        effectiveDate: '2026-10-03',
        reason: 'Integration verification',
      });
    expect(create.status).toBe(201);
    expect(create.body.planCode).toBe(planCode);

    const list = await request(app.getHttpServer())
      .get('/api/v1/super-admin/subscription-plans')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((p: { planCode: string }) => p.planCode === planCode)).toBe(true);
  });

  it('SA-07 creates an idempotent consent-gated support-access request', async () => {
    const token = await platformToken();
    const key = `p18-support-${Date.now()}`;
    const body = {
      tenantId: TENANT,
      reason: 'Support investigation',
      ticketContext: 'INT-001',
      requestedDurationMinutes: 30,
      idempotencyKey: key,
    };
    const first = await request(app.getHttpServer()).post('/api/v1/super-admin/support-access').set('Authorization', `Bearer ${token}`).send(body);
    const second = await request(app.getHttpServer()).post('/api/v1/super-admin/support-access').set('Authorization', `Bearer ${token}`).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).toBe(second.body.id);
    expect(first.body.status).toBe('PENDING_TENANT_CONSENT');
  });

  it('SA-05/SA-06 return platform-safe aggregate/health output without generic tenant raw-table bypass', async () => {
    const token = await platformToken();
    const usage = await request(app.getHttpServer()).get('/api/v1/super-admin/usage').set('Authorization', `Bearer ${token}`);
    const health = await request(app.getHttpServer()).get('/api/v1/super-admin/health').set('Authorization', `Bearer ${token}`);
    expect(usage.status).toBe(200);
    expect(usage.body.metrics.activeTenants.available).toBe(true);
    expect(health.status).toBe(200);
    expect(['up', 'degraded']).toContain(health.body.status);
  });
});
