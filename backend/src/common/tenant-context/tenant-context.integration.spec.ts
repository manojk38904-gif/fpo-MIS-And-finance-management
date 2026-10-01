import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import configuration from '../../config/configuration.js';
import { validateEnv } from '../../config/env.validation.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard.js';
import { TenantContextModule } from './tenant-context.module.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';
import { TenantContextService } from './tenant-context.service.js';
import { DataSource } from 'typeorm';
import { SESSION_STORE_PORT } from '../session/session-store.port.js';
import type { SessionStorePort } from '../session/session-store.port.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from '../../modules/priority1-auth-registration/entities/fpo-registration.entity.js';
import { UserAccountEntity, UserAccountStatus } from '../../modules/priority1-auth-registration/entities/user-account.entity.js';
import { PlatformAdminAccountEntity, PlatformAdminStatus } from '../../modules/priority1-auth-registration/entities/platform-admin-account.entity.js';
import { KnownTenantTransactionRunner } from './known-tenant-transaction-runner.js';

// Must run BEFORE the @Module() decorator below is evaluated — its imports
// array (ConfigModule.forRoot(...)) executes at class-definition time, i.e.
// at module-load time, not inside beforeAll().
process.env.DATABASE_URL ??= 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-also-32-chars-long';

/**
 * Proves the Blocker 2 correction: tenant context is now established from a
 * GUARD-verified identity (OptionalJwtAuthGuard, which runs before
 * interceptors in Nest's request lifecycle), never from the removed
 * middleware that read req.user before any guard had populated it, and never
 * from a client-supplied header.
 */
@Controller('whoami')
class WhoAmIController {
  constructor(private readonly tenantContext: TenantContextService) {}

  @Get()
  async get() {
    // Deliberately await something, to prove AsyncLocalStorage context
    // survives an async continuation, not just the synchronous call frame.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.tenantContext.getContext();
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    AuthModule,
    TenantContextModule,
    DatabaseModule,
    // Registered here (not via the full Priority1AuthRegistrationModule,
    // which this deliberately-minimal test app does not import) purely so
    // JwtStrategy's own live-tenant/live-user checks (correction-pass item 2)
    // have real rows to find — this suite seeds two ACTIVE tenants + users
    // below and is otherwise unrelated to Priority #1's business endpoints.
    TypeOrmModule.forFeature([FpoRegistrationEntity, UserAccountEntity, PlatformAdminAccountEntity]),
  ],
  controllers: [WhoAmIController],
  providers: [
    { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class TestAppModule {}

describe('Tenant context lifecycle (post-auth-guard, not pre-guard middleware)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let sessionStore: SessionStorePort;
  let dataSource: DataSource;
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_1 = '33333333-3333-3333-3333-333333333331';
  const USER_A = '33333333-3333-3333-3333-333333333332';
  const USER_B = '33333333-3333-3333-3333-333333333333';
  const PLATFORM_USER = '44444444-4444-4444-4444-444444444444';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    sessionStore = app.get(SESSION_STORE_PORT);
    dataSource = app.get(DataSource);

    // Correction-pass item 2 — JwtStrategy now re-checks the tenant and user
    // rows are genuinely ACTIVE on every request, so this suite needs two
    // real, ACTIVE tenants (with matching ACTIVE users) to authenticate
    // against, not just a signature-valid JWT naming an arbitrary tenantId.
    const regRepo = dataSource.getRepository(FpoRegistrationEntity);
    const adminRepo = dataSource.getRepository(PlatformAdminAccountEntity);
    const knownTenantTx = new KnownTenantTransactionRunner(dataSource);
    // user_account is RLS-protected (deny-by-default) — a plain repo.insert()
    // runs with no `app.current_tenant_id` session var set, which the RLS
    // policy rejects outright. KnownTenantTransactionRunner is the same
    // legitimate pre-request-context path TenantActivationService itself uses
    // (tenantId already independently, correctly known — this suite is
    // literally creating these tenants right above).
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await knownTenantTx.run(tenantId, (manager) => manager.getRepository(UserAccountEntity).delete({ tenantId }));
    }
    await regRepo.delete({ id: TENANT_A });
    await regRepo.delete({ id: TENANT_B });
    await adminRepo.delete({ id: PLATFORM_USER });
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await regRepo.insert({ id: tenantId, status: FpoRegistrationStatus.ACTIVE, fpoCode: `TC-${tenantId.slice(0, 8)}` });
    }
    await knownTenantTx.run(TENANT_A, (manager) =>
      manager.getRepository(UserAccountEntity).insert([
        { id: USER_1, tenantId: TENANT_A, username: 'user-1', email: 'user-1@tenant-context-test.invalid', status: UserAccountStatus.ACTIVE },
        { id: USER_A, tenantId: TENANT_A, username: 'user-a', email: 'user-a@tenant-context-test.invalid', status: UserAccountStatus.ACTIVE },
      ]),
    );
    await knownTenantTx.run(TENANT_B, (manager) =>
      manager
        .getRepository(UserAccountEntity)
        .insert([{ id: USER_B, tenantId: TENANT_B, username: 'user-b', email: 'user-b@tenant-context-test.invalid', status: UserAccountStatus.ACTIVE }]),
    );
    // isPlatformSuperAdmin=true payloads are checked against a real
    // platform_admin_account row too (JwtStrategy, item 2).
    await adminRepo.insert({
      id: PLATFORM_USER,
      username: 'tenant-context-platform-user',
      email: 'platform-user@tenant-context-test.invalid',
      passwordHash: 'not-used-by-this-suite',
      status: PlatformAdminStatus.ACTIVE,
    });

    const jwtModuleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.get<string>('jwt.accessSecret'),
            signOptions: { expiresIn: '15m' },
          }),
        }),
      ],
    }).compile();
    jwtService = jwtModuleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Correction-pass item 1/2 — a bare, signature-valid JWT is no longer
   * sufficient on its own (JwtStrategy now also requires a live Redis
   * session matching the token's `sid`, subject and tenant). This helper
   * creates a REAL session through the same SessionStorePort the real login
   * flows use, so this suite keeps testing what it always meant to test
   * (tenant-context propagation from a guard-verified identity) without
   * silently degrading into testing session validity instead.
   */
  async function signWithSession(input: { sub: string; tenantId: string | null; isPlatformSuperAdmin: boolean }): Promise<string> {
    const session = await sessionStore.createSession({
      subjectType: input.isPlatformSuperAdmin ? 'PLATFORM_ADMIN' : 'TENANT_USER',
      userId: input.sub,
      tenantId: input.tenantId,
      mfaCompleted: true,
      ttlSeconds: 900,
      ipAddress: null,
      userAgent: null,
    });
    return jwtService.sign({ ...input, sid: session.sessionId });
  }

  it('gives tenantId = null for an unauthenticated request (no token)', async () => {
    const res = await request(app.getHttpServer()).get('/whoami');
    expect(res.body.tenantId).toBeNull();
    expect(res.body.isPlatformSuperAdmin).toBe(false);
  });

  it('gives the JWT-verified tenantId for an authenticated request', async () => {
    const token = await signWithSession({ sub: USER_1, tenantId: TENANT_A, isPlatformSuperAdmin: false });
    const res = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.body.tenantId).toBe(TENANT_A);
    expect(res.body.userId).toBe(USER_1);
  });

  it('ignores a client-supplied x-tenant-id header entirely — only the verified JWT counts', async () => {
    const token = await signWithSession({ sub: USER_1, tenantId: TENANT_A, isPlatformSuperAdmin: false });
    const res = await request(app.getHttpServer())
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', TENANT_B); // forged/attempted override
    expect(res.body.tenantId).toBe(TENANT_A); // NOT TENANT_B
  });

  it('rejects a forged/invalid token rather than silently treating it as unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get('/whoami').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('carries the platform-admin flag from a verified token without any header involved', async () => {
    const token = await signWithSession({ sub: PLATFORM_USER, tenantId: null, isPlatformSuperAdmin: true });
    const res = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.body.isPlatformSuperAdmin).toBe(true);
    expect(res.body.tenantId).toBeNull();
  });

  it('does not leak tenant identity between concurrent requests from different tenants', async () => {
    const tokenA = await signWithSession({ sub: USER_A, tenantId: TENANT_A, isPlatformSuperAdmin: false });
    const tokenB = await signWithSession({ sub: USER_B, tenantId: TENANT_B, isPlatformSuperAdmin: false });

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenA}`),
      request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenB}`),
    ]);

    expect(resA.body.tenantId).toBe(TENANT_A);
    expect(resB.body.tenantId).toBe(TENANT_B);
  });

  it('does not leak tenant identity, the platform-admin flag, or stale AsyncLocalStorage context across a SEQUENTIAL chain of distinct requests', async () => {
    const tokenA = await signWithSession({ sub: USER_A, tenantId: TENANT_A, isPlatformSuperAdmin: false });
    const tokenPlatformAdmin = await signWithSession({ sub: PLATFORM_USER, tenantId: null, isPlatformSuperAdmin: true });
    const tokenB = await signWithSession({ sub: USER_B, tenantId: TENANT_B, isPlatformSuperAdmin: false });

    // 1. Authenticated Tenant A
    const res1 = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenA}`);
    expect(res1.body.tenantId).toBe(TENANT_A);
    expect(res1.body.isPlatformSuperAdmin).toBe(false);

    // 2. Unauthenticated — must not inherit Tenant A's context left over from request 1
    const res2 = await request(app.getHttpServer()).get('/whoami');
    expect(res2.body.tenantId).toBeNull();
    expect(res2.body.isPlatformSuperAdmin).toBe(false);
    expect(res2.body.userId).toBeUndefined();

    // 3. Authenticated platform-admin (tenantId null, flag true) — must not inherit
    //    anything from request 1 or 2, and the flag itself must not leak forward later
    const res3 = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenPlatformAdmin}`);
    expect(res3.body.tenantId).toBeNull();
    expect(res3.body.isPlatformSuperAdmin).toBe(true);

    // 4. Authenticated Tenant B — must not inherit the platform-admin flag from
    //    request 3, nor Tenant A's identity from request 1
    const res4 = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenB}`);
    expect(res4.body.tenantId).toBe(TENANT_B);
    expect(res4.body.isPlatformSuperAdmin).toBe(false);

    // 5. Authenticated Tenant A again — must be correct and independent of every
    //    intervening request (anonymous, platform-admin, Tenant B)
    const res5 = await request(app.getHttpServer()).get('/whoami').set('Authorization', `Bearer ${tokenA}`);
    expect(res5.body.tenantId).toBe(TENANT_A);
    expect(res5.body.isPlatformSuperAdmin).toBe(false);
  });
});
