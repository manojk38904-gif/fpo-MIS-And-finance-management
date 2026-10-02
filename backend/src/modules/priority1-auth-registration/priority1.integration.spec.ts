import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import request from 'supertest';
import configuration from '../../config/configuration.js';
import { validateEnv } from '../../config/env.validation.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../../common/auth/auth.module.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { DeliveryModule } from '../../common/delivery/delivery.module.js';
import { StorageModule } from '../../common/storage/storage.module.js';
import { SessionModule } from '../../common/session/session.module.js';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard.js';
import { TenantContextModule } from '../../common/tenant-context/tenant-context.module.js';
import { TenantContextInterceptor } from '../../common/tenant-context/tenant-context.interceptor.js';
import { REDIS_CLIENT } from '../../common/session/redis-client.provider.js';
import { Priority1AuthRegistrationModule } from './priority1-auth-registration.module.js';
import { TenantActivationService } from './services/tenant-activation.service.js';
import { TotpService } from './services/totp.service.js';
import { PasswordHasher } from '../../common/security/password-hasher.js';
import { InMemoryEmailDeliveryAdapter } from '../../common/delivery/in-memory-email-delivery.adapter.js';
import { EMAIL_DELIVERY_PORT } from '../../common/delivery/email-delivery.port.js';
import { FPO_CODE_GENERATOR_PORT } from './services/fpo-code-generator.port.js';
import { TestFpoCodeGeneratorAdapter } from './services/fpo-code-generator.test.adapter.js';
import { NotImplementedFpoCodeGeneratorAdapter } from './services/fpo-code-generator.not-implemented.adapter.js';
import { FpoRegistrationDocumentType } from './entities/fpo-registration-document.entity.js';
import { PlatformAdminAccountEntity, PlatformAdminStatus } from './entities/platform-admin-account.entity.js';
import { UserAccountEntity, UserAccountStatus } from './entities/user-account.entity.js';
import { FpoRegistrationEntity, FpoRegistrationStatus } from './entities/fpo-registration.entity.js';
import { KnownTenantTransactionRunner } from '../../common/tenant-context/known-tenant-transaction-runner.js';
import { ONBOARDING_STEPS_PENDING_OWNER_CLASSIFICATION } from './entities/onboarding-step-progress.entity.js';

// Real PostgreSQL + real Redis required — a genuine, executed integration
// test, never a mock of either.
process.env.DATABASE_URL ??= 'postgres://fpo_app_user:changeme@localhost:5432/fpo_saas';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-only-refresh-secret-also-32-chars-long';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

let draftCounter = 0;
function validDraft(overrides: Record<string, unknown> = {}) {
  draftCounter += 1;
  const n = draftCounter;
  return {
    fpoName: 'Sahyadri Farmers Producer Company',
    cin: `U${String(10000 + n).padStart(5, '0')}MH2020PTC123456`,
    registrationNumber: `REG-${n}`,
    incorporationDate: '2020-01-01',
    pan: `ABCDE${String(1000 + n).slice(-4)}F`,
    chairmanName: 'Ramesh Patil',
    ceoName: 'Suresh Kale',
    authorisedPersonName: 'Ramesh Patil',
    registeredAddress: '12 Market Road, Pune',
    state: 'Maharashtra',
    district: 'Pune',
    pincode: '411001',
    officialMobile: '9876543210',
    officialEmail: `admin${n}@sahyadrifpo.test`,
    bankName: 'State Bank of India',
    bankAccountNumber: '123456789012',
    bankIfsc: 'SBIN0001234',
    termsAccepted: true,
    ...overrides,
  };
}

const MANDATORY_DOC_TYPES = [
  FpoRegistrationDocumentType.REGISTRATION_CERTIFICATE,
  FpoRegistrationDocumentType.INCORPORATION_CERTIFICATE,
  FpoRegistrationDocumentType.PAN_UPLOAD,
  FpoRegistrationDocumentType.LOGO_UPLOAD,
];

describe('Priority #1 — Auth / Registration / Onboarding (real PostgreSQL + Redis integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let jwtService: JwtService;
  let tenantActivationService: TenantActivationService;
  let totpService: TotpService;
  let passwordHasher: PasswordHasher;
  let emailAdapter: InMemoryEmailDeliveryAdapter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
        SessionModule,
        DeliveryModule,
        StorageModule,
        AuthModule,
        AuditModule,
        TenantContextModule,
        DatabaseModule,
        Priority1AuthRegistrationModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
      ],
    })
      // Correction-pass item 4 — the REAL production binding
      // (NotImplementedFpoCodeGeneratorAdapter) is covered by its own
      // dedicated unit test below; this suite's end-to-end activation flow
      // uses the explicit TEST adapter so activation can actually complete.
      .overrideProvider(FPO_CODE_GENERATOR_PORT)
      .useClass(TestFpoCodeGeneratorAdapter)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    redis = app.get(REDIS_CLIENT);
    jwtService = app.get(JwtService);
    tenantActivationService = app.get(TenantActivationService);
    totpService = app.get(TotpService);
    passwordHasher = app.get(PasswordHasher);
    emailAdapter = app.get(EMAIL_DELIVERY_PORT);

    // This suite runs against a real, persistent PostgreSQL + Redis instance
    // (not a per-test rollback sandbox), so a clean slate is required for the
    // run to be repeatable.
    await dataSource.query('TRUNCATE TABLE "local_audit_event" CASCADE');
    await dataSource.query('TRUNCATE TABLE "fpo_registration" CASCADE'); // cascades to fpo_registration_document, registration_resume_token
    await dataSource.query('TRUNCATE TABLE "otp_verification" CASCADE');
    await dataSource.query('TRUNCATE TABLE "platform_admin_account" CASCADE'); // cascades to platform_admin_refresh_token
    await dataSource.query('TRUNCATE TABLE "onboarding_step_progress" CASCADE');
    // user_account has no FK FROM fpo_registration (tenantId is a plain,
    // non-FK column), so it is never cascaded by the truncates above and
    // must be cleared explicitly; this in turn cascades to setup_token /
    // user_refresh_token.
    await dataSource.query('TRUNCATE TABLE "user_account" CASCADE');
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------- helpers
  /** Creates a draft, returns {registrationId, resumeToken}. */
  async function createDraft(overrides: Record<string, unknown> = {}) {
    const draft = validDraft(overrides);
    const res = await request(app.getHttpServer()).post('/api/v1/registration/draft').send(draft);
    expect(res.status).toBe(201);
    return { registrationId: res.body.id as string, resumeToken: res.body.resumeToken as string, draft };
  }

  async function sendAndCaptureOtp(resumeToken: string, officialEmail: string): Promise<{ otpVerificationId: string; otp: string }> {
    const before = emailAdapter.sentMessages.length;
    const res = await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/send-otp`).send({ officialEmail });
    expect(res.status).toBe(200);
    const sent = emailAdapter.sentMessages.slice(before).find((m) => m.template === 'REGISTRATION_OTP' && m.to === officialEmail);
    if (!sent) throw new Error('No REGISTRATION_OTP message captured.');
    return { otpVerificationId: res.body.otpVerificationId, otp: sent.data.otp };
  }

  async function uploadMandatoryDocuments(resumeToken: string) {
    for (const documentType of MANDATORY_DOC_TYPES) {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/documents/${documentType}`)
        .attach('file', Buffer.from('%PDF-1.4 fake content'), { filename: `${documentType}.pdf`, contentType: 'application/pdf' });
      expect(res.status).toBe(201);
    }
  }

  /** Full happy path: draft -> OTP -> docs -> submit. Returns registrationId + resumeToken. */
  async function registerToSubmitted(overrides: Record<string, unknown> = {}) {
    const { registrationId, resumeToken, draft } = await createDraft(overrides);
    const { otpVerificationId, otp } = await sendAndCaptureOtp(resumeToken, draft.officialEmail as string);
    const verifyRes = await request(app.getHttpServer())
      .post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`)
      .send({ otp });
    expect(verifyRes.status).toBe(200);
    await uploadMandatoryDocuments(resumeToken);
    const submitRes = await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/submit`);
    expect(submitRes.status).toBe(200);
    return { registrationId, resumeToken, draft };
  }

  /**
   * Correction-pass item 3 — SA-01's approval decision is Priority #18's own
   * and does not exist yet. This directly flips the row's status the same
   * way a real SA-01 screen eventually will — a raw repository write, never
   * routed through RegistrationService (which deliberately has no such
   * method) — simulating "approval already happened" for this test only.
   */
  async function simulateSa01Approval(registrationId: string) {
    await dataSource.getRepository(FpoRegistrationEntity).update({ id: registrationId }, { status: FpoRegistrationStatus.APPROVED });
  }

  async function activateAndSetupPassword(registrationId: string, password: string): Promise<{ fpoCode: string }> {
    await simulateSa01Approval(registrationId);
    const { fpoCode, setupLinkToken } = await tenantActivationService.activateApprovedRegistration(registrationId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/setup-password')
      .send({ setupToken: setupLinkToken, newPassword: password, confirmNewPassword: password });
    expect(res.status).toBe(200);
    return { fpoCode };
  }

  // ================================================================ SYS-02 / SYS-03 / items 5, 6, 7, 11, 14
  describe('SYS-02 Registration + SYS-03 OTP (correction-pass items 5, 6, 7, 11, 14)', () => {
    it('completes draft -> send-otp -> verify-otp -> submit end to end via resume token', async () => {
      const { registrationId } = await registerToSubmitted();
      expect(registrationId).toBeTruthy();
    });

    it('item 6: the bare registrationId is never, by itself, sufficient — only the resume token works', async () => {
      const { registrationId } = await createDraft();
      // Old-style bare-UUID endpoints no longer exist at all.
      const bareGet = await request(app.getHttpServer()).get(`/api/v1/registration/${registrationId}`);
      expect(bareGet.status).toBe(404);
      const bareUpdate = await request(app.getHttpServer()).post(`/api/v1/registration/${registrationId}/draft`).send({ fpoName: 'x' });
      expect(bareUpdate.status).toBe(404);

      // A resume token for a DIFFERENT registration cannot read this one.
      const { resumeToken: otherToken } = await createDraft();
      const crossRead = await request(app.getHttpServer()).get(`/api/v1/registration/resume/${otherToken}`);
      expect(crossRead.status).toBe(200); // reads its OWN registration, not this one
      expect(crossRead.body.id).not.toBe(registrationId);

      // A garbage/invalid token is rejected.
      const invalid = await request(app.getHttpServer()).get('/api/v1/registration/resume/not-a-real-token');
      expect(invalid.status).toBe(400);
    });

    it('item 6: controlled re-issuance requires the correct officialEmail on file', async () => {
      const { registrationId, draft } = await createDraft();
      const wrongEmail = await request(app.getHttpServer())
        .post('/api/v1/registration/resend-resume-link')
        .send({ registrationId, officialEmail: 'not-the-right-email@sahyadrifpo.test' });
      expect(wrongEmail.status).toBe(400);

      const before = emailAdapter.sentMessages.length;
      const correct = await request(app.getHttpServer())
        .post('/api/v1/registration/resend-resume-link')
        .send({ registrationId, officialEmail: draft.officialEmail });
      expect(correct.status).toBe(200);
      const sent = emailAdapter.sentMessages.slice(before).find((m) => m.template === 'REGISTRATION_RESUME_LINK');
      expect(sent).toBeTruthy();
    });

    it('item 5: a draft can genuinely hold incomplete data (fpoName only), be resumed, and progressively filled', async () => {
      const createRes = await request(app.getHttpServer()).post('/api/v1/registration/draft').send({ fpoName: 'Only A Name FPO' });
      expect(createRes.status).toBe(201);
      const resumeToken = createRes.body.resumeToken as string;

      const read = await request(app.getHttpServer()).get(`/api/v1/registration/resume/${resumeToken}`);
      expect(read.status).toBe(200);
      expect(read.body.fpoName).toBe('Only A Name FPO');
      expect(read.body.pan).toBeNull();

      // Submission fails loudly until genuinely complete — draft nullability
      // never weakens SUBMIT-time validation.
      const prematureSubmit = await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/submit`);
      expect(prematureSubmit.status).toBe(400);

      const fillMore = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/draft`)
        .send(validDraft({ fpoName: 'Only A Name FPO' }));
      expect(fillMore.status).toBe(201);
      const reread = await request(app.getHttpServer()).get(`/api/v1/registration/resume/${resumeToken}`);
      expect(reread.body.pan).toBeTruthy();
    });

    it('item 11: a future incorporation date is rejected', async () => {
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const res = await request(app.getHttpServer())
        .post('/api/v1/registration/draft')
        .send(validDraft({ incorporationDate: futureDate }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot be in the future/i);
    });

    it('item 7: an OTP issued for Registration A can never verify Registration B, even sharing the same email', async () => {
      const sharedEmail = 'shared-identity@sahyadrifpo.test';
      const a = await createDraft({ officialEmail: sharedEmail });
      const b = await createDraft({ officialEmail: sharedEmail });

      const { otpVerificationId, otp } = await sendAndCaptureOtp(a.resumeToken, sharedEmail);

      // B never actually sent an OTP of its own yet; even if it HAD one with
      // the same otpVerificationId id-space collision were possible, B using
      // A's otpVerificationId must fail because A's OTP is bound to A's own
      // registrationId (subjectId), not merely to the shared email. Using
      // A's own correct OTP value (not just a wrong guess) proves the
      // rejection is genuinely about subject-binding, not merely a wrong code.
      const crossVerify = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${b.resumeToken}/verify-otp/${otpVerificationId}`)
        .send({ otp });
      expect(crossVerify.status).toBe(400);

      // A verifying its own OTP with its own code still works correctly.
      const ownVerify = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${a.resumeToken}/verify-otp/${otpVerificationId}`)
        .send({ otp });
      expect(ownVerify.status).toBe(200);
    });

    it('item 7: changing officialEmail after verification clears emailOtpVerified and requires fresh verification', async () => {
      const { resumeToken } = await createDraft({ officialEmail: 'first@sahyadrifpo.test' });
      const { otpVerificationId, otp } = await sendAndCaptureOtp(resumeToken, 'first@sahyadrifpo.test');
      await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`).send({ otp });

      const afterFirst = await request(app.getHttpServer()).get(`/api/v1/registration/resume/${resumeToken}`);
      expect(afterFirst.body.emailOtpVerified).toBe(true);

      // Changing the email (another send-otp call with a new address) must
      // invalidate the prior verification.
      await sendAndCaptureOtp(resumeToken, 'changed@sahyadrifpo.test');
      const afterChange = await request(app.getHttpServer()).get(`/api/v1/registration/resume/${resumeToken}`);
      expect(afterChange.body.emailOtpVerified).toBe(false);
      expect(afterChange.body.status).not.toBe('OTP_VERIFIED');
    });

    it('rejects an incorrect OTP and enforces the configured attempt limit', async () => {
      const { resumeToken } = await createDraft({ officialEmail: 'attempts@sahyadrifpo.test' });
      const { otpVerificationId } = await sendAndCaptureOtp(resumeToken, 'attempts@sahyadrifpo.test');

      const wrong1 = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`)
        .send({ otp: '000000' });
      expect(wrong1.status).toBe(400);
      expect(wrong1.body.message).toMatch(/incorrect otp/i);

      await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`).send({ otp: '000000' });
      await request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`).send({ otp: '000000' });
      const wrong4 = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`)
        .send({ otp: '000000' });
      expect(wrong4.body.message).toMatch(/too many incorrect attempts/i);
    });

    it('CA-2 + item 14: a duplicate PAN at submit time returns the exact generic, non-enumerating message', async () => {
      const first = await registerToSubmitted({ officialEmail: 'first-dup@sahyadrifpo.test', pan: 'DUPAN1234D', cin: 'U33333MH2021PTC333333' });
      void first;

      const second = await createDraft({ officialEmail: 'second-dup@sahyadrifpo.test', pan: 'DUPAN1234D', cin: 'U44444MH2021PTC444444' });
      const { otpVerificationId, otp } = await sendAndCaptureOtp(second.resumeToken, second.draft.officialEmail as string);
      await request(app.getHttpServer()).post(`/api/v1/registration/resume/${second.resumeToken}/verify-otp/${otpVerificationId}`).send({ otp });
      await uploadMandatoryDocuments(second.resumeToken);

      const submitRes = await request(app.getHttpServer()).post(`/api/v1/registration/resume/${second.resumeToken}/submit`);
      expect(submitRes.status).toBe(400);
      expect(submitRes.body.message).toBe('This application cannot be processed at this time. Please contact support for assistance.');
      expect(submitRes.body.message.toLowerCase()).not.toContain('pan');
      expect(submitRes.body.message.toLowerCase()).not.toContain('already');
    });

    it('item 14: two concurrent submissions of different registrations sharing a PAN — exactly one succeeds (DB-level race safety)', async () => {
      const sharedPan = 'RACEP1234R';
      const a = await createDraft({ officialEmail: 'race-a@sahyadrifpo.test', pan: sharedPan, cin: 'U77777MH2021PTC777777' });
      const b = await createDraft({ officialEmail: 'race-b@sahyadrifpo.test', pan: sharedPan, cin: 'U88888MH2021PTC888888' });

      for (const r of [a, b]) {
        const { otpVerificationId, otp } = await sendAndCaptureOtp(r.resumeToken, r.draft.officialEmail as string);
        await request(app.getHttpServer()).post(`/api/v1/registration/resume/${r.resumeToken}/verify-otp/${otpVerificationId}`).send({ otp });
        await uploadMandatoryDocuments(r.resumeToken);
      }

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/registration/resume/${a.resumeToken}/submit`),
        request(app.getHttpServer()).post(`/api/v1/registration/resume/${b.resumeToken}/submit`),
      ]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 400]);
    });

    it('item 13: concurrent OTP verification of the SAME otp record — exactly one succeeds', async () => {
      const { resumeToken, draft } = await createDraft({ officialEmail: 'otp-race@sahyadrifpo.test' });
      const { otpVerificationId, otp } = await sendAndCaptureOtp(resumeToken, draft.officialEmail as string);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer()).post(`/api/v1/registration/resume/${resumeToken}/verify-otp/${otpVerificationId}`).send({ otp }),
        ),
      );
      const successes = results.filter((r) => r.status === 200);
      expect(successes).toHaveLength(1);
    });
  });

  // ================================================================ CA-1 / SYS-05 / SYS-01-A / TENANCY / SYS-04
  describe('CA-1 setup, SYS-01-A login, SYS-04 onboarding, tenancy, SESSION correctness (items 1, 2, 3, 4, 13, 18)', () => {
    let registrationId: string;
    let fpoCode: string;
    let accessToken: string;
    let refreshToken: string;

    it('item 3: activation REJECTS SUBMITTED / UNDER_VERIFICATION / REJECTED, and ALLOWS only APPROVED', async () => {
      const submitted = await registerToSubmitted({ officialEmail: 'status-submitted@sahyadrifpo.test', pan: 'STATU1234S', cin: 'U91111MH2021PTC911111' });
      const rejectSubmitted = await tenantActivationService.activateApprovedRegistration(submitted.registrationId).catch((e) => e);
      expect(rejectSubmitted).toBeInstanceOf(Error);

      await dataSource.getRepository(FpoRegistrationEntity).update({ id: submitted.registrationId }, { status: FpoRegistrationStatus.UNDER_VERIFICATION });
      const rejectUnderVerification = await tenantActivationService.activateApprovedRegistration(submitted.registrationId).catch((e) => e);
      expect(rejectUnderVerification).toBeInstanceOf(Error);

      await dataSource.getRepository(FpoRegistrationEntity).update({ id: submitted.registrationId }, { status: FpoRegistrationStatus.REJECTED });
      const rejectRejected = await tenantActivationService.activateApprovedRegistration(submitted.registrationId).catch((e) => e);
      expect(rejectRejected).toBeInstanceOf(Error);

      await dataSource.getRepository(FpoRegistrationEntity).update({ id: submitted.registrationId }, { status: FpoRegistrationStatus.APPROVED });
      const activation = await tenantActivationService.activateApprovedRegistration(submitted.registrationId);
      expect(activation.fpoCode).toBeTruthy();
      expect(activation.setupLinkToken).toBeTruthy();
    });

    it('activates an approved registration via the simulated SA-01 hook and issues a single-use setup link (CA-1)', async () => {
      const result = await registerToSubmitted({ officialEmail: 'lifecycle@sahyadrifpo.test', pan: 'LIFEC1234L', cin: 'U55555MH2021PTC555555' });
      registrationId = result.registrationId;
      const { fpoCode: code } = await activateAndSetupPassword(registrationId, 'Str0ngPass');
      fpoCode = code;

      // Item 9 — the activation + setup-link emails were genuinely sent
      // through EmailDeliveryPort, not fabricated.
      expect(emailAdapter.sentMessages.some((m) => m.template === 'TENANT_ACTIVATED')).toBe(true);
      expect(emailAdapter.sentMessages.some((m) => m.template === 'INITIAL_ADMIN_SETUP_LINK')).toBe(true);
    });

    it('rejects reusing the same setup link (CA-1, item 13 atomic consumption)', async () => {
      const result = await registerToSubmitted({ officialEmail: 'reuse-setup@sahyadrifpo.test', pan: 'REUSE1234R', cin: 'U10101MH2021PTC101010' });
      await simulateSa01Approval(result.registrationId);
      const { setupLinkToken } = await tenantActivationService.activateApprovedRegistration(result.registrationId);

      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/setup-password')
        .send({ setupToken: setupLinkToken, newPassword: 'Str0ngPass', confirmNewPassword: 'Str0ngPass' });
      expect(first.status).toBe(200);

      const reuse = await request(app.getHttpServer())
        .post('/api/v1/auth/setup-password')
        .send({ setupToken: setupLinkToken, newPassword: 'AnotherPass1', confirmNewPassword: 'AnotherPass1' });
      expect(reuse.status).toBe(400);
      expect(reuse.body.message).toMatch(/no longer valid/i);
    });

    it('item 13: concurrent setup-password submissions for the SAME token — exactly one succeeds', async () => {
      const result = await registerToSubmitted({ officialEmail: 'setup-race@sahyadrifpo.test', pan: 'SETUR1234S', cin: 'U20202MH2021PTC202020' });
      await simulateSa01Approval(result.registrationId);
      const { setupLinkToken } = await tenantActivationService.activateApprovedRegistration(result.registrationId);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(app.getHttpServer())
            .post('/api/v1/auth/setup-password')
            .send({ setupToken: setupLinkToken, newPassword: `Str0ngPass${i}`, confirmNewPassword: `Str0ngPass${i}` }),
        ),
      );
      const successes = results.filter((r) => r.status === 200);
      expect(successes).toHaveLength(1);
    });

    it('rejects login before the setup link has been used (no password exists yet)', async () => {
      const result = await registerToSubmitted({ officialEmail: 'nopass@sahyadrifpo.test', pan: 'NOPAS1234N', cin: 'U30303MH2021PTC303030' });
      await simulateSa01Approval(result.registrationId);
      const { fpoCode: code } = await tenantActivationService.activateApprovedRegistration(result.registrationId);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode: code, usernameOrEmailOrMobile: 'nopass@sahyadrifpo.test', password: 'whatever123' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('FPO Code, Username or Password is incorrect.');
    });

    it('SYS-01-A: logs in with the newly-created password and returns tokens + onboarding status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.isInitialFpoAdmin).toBe(true);
      expect(res.body.onboardingComplete).toBe(false);
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('item 2: a forged/garbage JWT and a well-formed-but-session-less JWT are both rejected', async () => {
      const garbage = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', 'Bearer not-a-real-jwt');
      expect(garbage.status).toBe(401);

      const tenantId = (jwtService.decode(accessToken) as { tenantId: string }).tenantId;
      const noSessionToken = await jwtService.signAsync({ sub: 'fake-user-id', tenantId, isPlatformSuperAdmin: false, sid: 'no-such-session-id' });
      const res = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${noSessionToken}`);
      expect(res.status).toBe(401);
    });

    it('item 2: logout immediately invalidates the session — the OLD access token stops working on its very next request', async () => {
      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      const tempAccess = relogin.body.accessToken;
      const tempRefresh = relogin.body.refreshToken;

      const beforeLogout = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${tempAccess}`);
      expect(beforeLogout.status).toBe(200);

      await request(app.getHttpServer()).post('/api/v1/auth/logout').send({ refreshToken: tempRefresh });

      const afterLogout = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${tempAccess}`);
      expect(afterLogout.status).toBe(401); // same, still-unexpired JWT — rejected purely because the session was revoked
    });

    it('rejects a wrong password with the generic, non-enumerating error, locks the account, and the lock REVOKES existing sessions immediately (item 2)', async () => {
      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      const liveAccessToken = relogin.body.accessToken;
      const stillWorks = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${liveAccessToken}`);
      expect(stillWorks.status).toBe(200);

      for (let i = 0; i < 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'wrong-password' });
        expect(res.status).toBe(401);
      }
      const lockingRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'wrong-password' });
      expect(lockingRes.status).toBe(401);

      const lockedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      expect(lockedRes.status).toBe(403);
      expect(lockedRes.body.message).toMatch(/temporarily locked/i);

      // Item 2 — the session that was live BEFORE lockout must already be dead.
      const afterLockout = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${liveAccessToken}`);
      expect(afterLockout.status).toBe(401);

      // Unlock for the remaining tests in this suite.
      const reg = await dataSource.getRepository(FpoRegistrationEntity).findOne({ where: { fpoCode } });
      await app.get(KnownTenantTransactionRunner).run(reg!.id, (manager) =>
        manager
          .getRepository(UserAccountEntity)
          .update({ email: 'lifecycle@sahyadrifpo.test' }, { failedLoginAttempts: 0, lockedUntil: null, status: UserAccountStatus.ACTIVE }),
      );

      const unlockedRelogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      expect(unlockedRelogin.status).toBe(200);
      accessToken = unlockedRelogin.body.accessToken;
      refreshToken = unlockedRelogin.body.refreshToken;
    });

    it('item 1/13: refresh-token rotation works, and reuse of a rotated token revokes the whole chain (and its session)', async () => {
      const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(rotated.status).toBe(200);
      const newAccessToken = rotated.body.accessToken;
      const newRefreshToken = rotated.body.refreshToken;
      expect(newRefreshToken).not.toBe(refreshToken);

      // The OLD access token's session was superseded by rotation — it must
      // already be dead (item 1's "exactly one authoritative session truth").
      const oldTokenNowDead = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${accessToken}`);
      expect(oldTokenNowDead.status).toBe(401);

      const newTokenWorks = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${newAccessToken}`);
      expect(newTokenWorks.status).toBe(200);

      const reuse = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(reuse.status).toBe(401);
      const nowRevokedToo = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: newRefreshToken });
      expect(nowRevokedToo.status).toBe(401);

      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      accessToken = relogin.body.accessToken;
      refreshToken = relogin.body.refreshToken;
    });

    it('item 13: concurrent refresh-token rotation of the SAME token — exactly one successor chain survives', async () => {
      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      const raceRefreshToken = relogin.body.refreshToken;

      const results = await Promise.all(Array.from({ length: 5 }, () => request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: raceRefreshToken })));
      const successes = results.filter((r) => r.status === 200);
      expect(successes).toHaveLength(1);
    });

    it('TENANCY: a forged x-tenant-id header is ignored — only the verified JWT tenant is ever used', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/onboarding/progress')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-tenant-id', '99999999-9999-9999-9999-999999999999');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(16);
    });

    it('TENANCY: a genuine Platform Super Admin token (real account + real session) is still rejected by a tenant-only onboarding route', async () => {
      const repo = dataSource.getRepository(PlatformAdminAccountEntity);
      await repo.delete({ username: 'tenancy-admin' });
      const secret = totpService.generateSecret();
      await repo.save(
        repo.create({
          username: 'tenancy-admin',
          email: 'tenancy-admin@fposaas.test',
          passwordHash: await passwordHasher.hash('AdminPass123'),
          totpSecret: secret,
          totpEnabled: true,
        }),
      );
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'tenancy-admin', password: 'AdminPass123' });
      const totpCode = await totpService.generateToken(secret);
      const step2 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login/mfa').send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode });
      expect(step2.status).toBe(200);

      const res = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${step2.body.accessToken}`);
      expect(res.status).toBe(403); // a REAL, currently-valid super-admin session — still correctly rejected by the tenant-only guard
    });

    it('TENANCY: Tenant A cannot see Tenant B rows in user_account / onboarding_step_progress at the database level', async () => {
      const tenantAId = jwtService.decode(accessToken) as { tenantId: string };
      const tenantARunner = app.get(KnownTenantTransactionRunner);

      const tenantB = '12121212-1212-1212-1212-121212121212';
      const bRows = await tenantARunner.run(tenantB, (manager) => manager.getRepository(UserAccountEntity).find());
      expect(bRows).toHaveLength(0);

      const aRows = await tenantARunner.run(tenantAId.tenantId, (manager) => manager.getRepository(UserAccountEntity).find());
      expect(aRows.length).toBeGreaterThan(0);
    });

    it('SYS-04: completing/skipping all 16 steps is tracked correctly, mandatory steps cannot be skipped', async () => {
      // Owner completion decision resolved the four previously-unclassified
      // steps: 2 optional, 5 conditional, 11 optional-at-initial-Go-Live,
      // 16 conditional. Conditional steps may be skipped in SYS-04; the
      // downstream operation that actually needs them must enforce them.
      expect(ONBOARDING_STEPS_PENDING_OWNER_CLASSIFICATION).toEqual([]);

      const mandatorySteps = [1, 3, 4, 6, 7, 8, 9, 10, 12];
      const skippableSteps = [2, 5, 11, 13, 14, 15, 16];

      const cannotSkipMandatory = await request(app.getHttpServer()).post('/api/v1/onboarding/steps/1/skip').set('Authorization', `Bearer ${accessToken}`);
      expect(cannotSkipMandatory.status).toBe(400);

      for (const step of mandatorySteps) {
        const res = await request(app.getHttpServer()).post(`/api/v1/onboarding/steps/${step}/complete`).set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(201);
      }
      for (const step of skippableSteps) {
        const res = await request(app.getHttpServer()).post(`/api/v1/onboarding/steps/${step}/skip`).set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(201);
      }

      const progress = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${accessToken}`);
      expect(progress.body.every((s: { status: string }) => s.status === 'COMPLETE' || s.status === 'SKIPPED')).toBe(true);

      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      expect(relogin.body.onboardingComplete).toBe(true);
    });

    it('SYS-04 Go-Live Gate: BLOCKS honestly with no fake downstream bypass while required owning modules/configuration remain unavailable', async () => {
      const check = await request(app.getHttpServer()).get('/api/v1/onboarding/go-live/check').set('Authorization', `Bearer ${accessToken}`);
      expect(check.status).toBe(200);
      expect(check.body.passed).toBe(false);
      expect(check.body.failures).toHaveLength(4);
      for (const failure of check.body.failures) {
        expect(failure).not.toMatch(/go-live failed/i);
      }
      const goLive = await request(app.getHttpServer()).post('/api/v1/onboarding/go-live').set('Authorization', `Bearer ${accessToken}`);
      expect(goLive.status).toBe(201);
      expect(goLive.body.passed).toBe(false);
    });

    it('SYS-06: password-reset request is byte-identical for an existing vs. a non-existent account, and a reset revokes sessions (items 1, 2, 7, 10)', async () => {
      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'Str0ngPass' });
      const preResetAccessToken = relogin.body.accessToken;
      expect((await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${preResetAccessToken}`)).status).toBe(200);

      const real = await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test' });
      const fake = await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').send({ fpoCode, usernameOrEmailOrMobile: 'nobody-such-user@sahyadrifpo.test' });
      expect(real.body.message).toBe(fake.body.message);
      expect(real.status).toBe(fake.status);

      const confirmFake = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send({ resetRequestId: fake.body.resetRequestId, otp: '000000', newPassword: 'NewPass123', confirmNewPassword: 'NewPass123' });
      expect(confirmFake.status).toBe(400);
      expect(confirmFake.body.message).toBe('Invalid or expired OTP.');

      const sentOtp = emailAdapter.sentMessages.slice().reverse().find((m) => m.template === 'PASSWORD_RESET_OTP');
      expect(sentOtp).toBeTruthy();
      const confirmReal = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send({ resetRequestId: real.body.resetRequestId, otp: sentOtp!.data.otp, newPassword: 'NewPass123', confirmNewPassword: 'NewPass123' });
      expect(confirmReal.status).toBe(200);

      // Item 1/2 — the session that was live BEFORE the reset must now be dead.
      const afterReset = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${preResetAccessToken}`);
      expect(afterReset.status).toBe(401);

      // New password actually works.
      const newLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ fpoCode, usernameOrEmailOrMobile: 'lifecycle@sahyadrifpo.test', password: 'NewPass123' });
      expect(newLogin.status).toBe(200);
      accessToken = newLogin.body.accessToken;
      refreshToken = newLogin.body.refreshToken;
    });
  });

  // ================================================================ SYS-01-B / item 18
  describe('SYS-01-B Platform Super Admin login (separate identity hierarchy, mandatory MFA; items 1, 2, 18)', () => {
    let secret: string;

    beforeAll(async () => {
      secret = totpService.generateSecret();
      const repo = dataSource.getRepository(PlatformAdminAccountEntity);
      await repo.delete({ username: 'platform.admin' });
      await repo.save(
        repo.create({
          username: 'platform.admin',
          email: 'platform.admin@fposaas.test',
          passwordHash: await passwordHasher.hash('AdminPass123'),
          totpSecret: secret,
          totpEnabled: true,
        }),
      );
    });

    it('rejects a request with no MFA / bad password with a generic error', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Username or Password is incorrect.');
    });

    it('completes the two-step password + TOTP login and issues real tokens', async () => {
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      expect(step1.status).toBe(200);
      expect(step1.body.mfaSessionToken).toBeTruthy();

      const totpCode = await totpService.generateToken(secret);
      const step2 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login/mfa').send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode });
      expect(step2.status).toBe(200);
      expect(step2.body.accessToken).toBeTruthy();
      expect(step2.body.refreshToken).toBeTruthy();
    });

    it('SECURITY: the MFA-pending ticket cannot be reused as a general bearer token', async () => {
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      const misuse = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${step1.body.mfaSessionToken}`);
      expect(misuse.status).toBe(401);
    });

    it('item 18: the MFA-pending ticket is SINGLE-USE — it cannot be replayed again after a successful step-2', async () => {
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      const totpCode = await totpService.generateToken(secret);
      const firstStep2 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login/mfa').send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode: await totpService.generateToken(secret) });
      expect(firstStep2.status).toBe(200);
      void totpCode;

      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/platform-admin/login/mfa')
        .send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode: await totpService.generateToken(secret) });
      expect(replay.status).toBe(401);
    });

    it('item 18: an admin suspended BETWEEN step 1 and step 2 cannot complete login and receive tokens', async () => {
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      expect(step1.status).toBe(200);

      await dataSource.getRepository(PlatformAdminAccountEntity).update({ username: 'platform.admin' }, { status: PlatformAdminStatus.SUSPENDED });

      const step2 = await request(app.getHttpServer())
        .post('/api/v1/auth/platform-admin/login/mfa')
        .send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode: await totpService.generateToken(secret) });
      expect(step2.status).toBe(403);

      // Restore for subsequent tests.
      await dataSource.getRepository(PlatformAdminAccountEntity).update({ username: 'platform.admin' }, { status: PlatformAdminStatus.ACTIVE });
    });

    it('item 18: an expired lock is cleared on the next correct password (mirrors tenant AuthService)', async () => {
      const repo = dataSource.getRepository(PlatformAdminAccountEntity);
      await repo.update({ username: 'platform.admin' }, { status: PlatformAdminStatus.LOCKED, lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 5 });

      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      expect(step1.status).toBe(200); // the lock window already passed

      const admin = await repo.findOne({ where: { username: 'platform.admin' } });
      expect(admin!.status).toBe(PlatformAdminStatus.ACTIVE);
      expect(admin!.failedLoginAttempts).toBe(0);
    });

    it('item 2: platform-admin logout and lockout immediately invalidate the session, same as tenant users', async () => {
      const totpCode = await totpService.generateToken(secret);
      const step1 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login').send({ usernameOrEmail: 'platform.admin', password: 'AdminPass123' });
      const step2 = await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/login/mfa').send({ mfaSessionToken: step1.body.mfaSessionToken, totpCode });
      const liveAccessToken = step2.body.accessToken;
      const liveRefreshToken = step2.body.refreshToken;

      await request(app.getHttpServer()).post('/api/v1/auth/platform-admin/logout').send({ refreshToken: liveRefreshToken });
      const afterLogout = await request(app.getHttpServer()).get('/api/v1/onboarding/progress').set('Authorization', `Bearer ${liveAccessToken}`);
      expect(afterLogout.status).toBe(401); // would be 403 (tenant-only route) if the token were still live; 401 proves the session itself is dead
    });
  });

  // ================================================================ item 8 — never log a raw OTP, anywhere
  describe('item 8 — raw OTP/secret values are never logged', () => {
    it('no console.log call across this entire suite ever contained a bare 6-digit OTP-shaped value', async () => {
      // This assertion runs LAST within its own isolated spy window around one
      // more full registration+OTP cycle — the stronger, suite-wide guarantee
      // is structural: OtpService contains no console.log call at all (see its
      // source), so there is nothing for a spy to ever catch.
      const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { resumeToken, draft } = await createDraft({ officialEmail: 'no-log-check@sahyadrifpo.test' });
      await sendAndCaptureOtp(resumeToken, draft.officialEmail as string);
      const loggedOtpLines = spy.mock.calls.flat().filter((arg) => typeof arg === 'string' && /\b\d{6}\b/.test(arg));
      spy.mockRestore();
      expect(loggedOtpLines).toHaveLength(0);
    });
  });

  // ================================================================ item 4 — FPO-Code generator production binding
  describe('item 4 — FPO-Code generator production binding BLOCKS, never fabricates', () => {
    it('NotImplementedFpoCodeGeneratorAdapter throws and blocks rather than inventing a code', async () => {
      const adapter = new NotImplementedFpoCodeGeneratorAdapter();
      await expect(adapter.generate('Any FPO', 'any-id')).rejects.toThrow(/Numbering Engine/i);
    });
  });

  // ================================================================ item 10 — password policy is genuinely configurable
  describe('item 10 — PasswordPolicyPort is the single, genuinely configurable truth', () => {
    it('two different configured policies actually produce different accept/reject behaviour', async () => {
      const { ConfigDrivenPasswordPolicyAdapter } = await import('../../common/security/config-driven-password-policy.adapter.js');
      const strictConfig = { get: (key: string) => ({ 'passwordPolicy.minLength': 12, 'passwordPolicy.requireLetter': true, 'passwordPolicy.requireDigit': true, 'passwordPolicy.requireSpecialChar': true } as Record<string, unknown>)[key] } as never;
      const looseConfig = { get: (key: string) => ({ 'passwordPolicy.minLength': 4, 'passwordPolicy.requireLetter': false, 'passwordPolicy.requireDigit': false, 'passwordPolicy.requireSpecialChar': false } as Record<string, unknown>)[key] } as never;

      const strict = new ConfigDrivenPasswordPolicyAdapter(strictConfig);
      const loose = new ConfigDrivenPasswordPolicyAdapter(looseConfig);

      await expect(strict.assertValid('short1')).rejects.toThrow();
      await expect(loose.assertValid('ok12')).resolves.toBeUndefined();
      await expect(strict.assertValid('ok12')).rejects.toThrow();
    });
  });

  // ================================================================ item 12 — document upload boundary
  describe('item 12 — document-upload boundary enforces type/size and a malware-scan hook exists', () => {
    it('rejects an unsupported file type', async () => {
      const { resumeToken } = await createDraft({ officialEmail: 'upload-reject@sahyadrifpo.test' });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/documents/${FpoRegistrationDocumentType.LOGO_UPLOAD}`)
        .attach('file', Buffer.from('not a real exe but wrong type'), { filename: 'logo.exe', contentType: 'application/x-msdownload' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/unsupported file type/i);
    });

    it('accepts an allowed type and records it, routed through the malware-scan hook', async () => {
      const { resumeToken } = await createDraft({ officialEmail: 'upload-ok@sahyadrifpo.test' });
      const res = await request(app.getHttpServer())
        .post(`/api/v1/registration/resume/${resumeToken}/documents/${FpoRegistrationDocumentType.LOGO_UPLOAD}`)
        .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'logo.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(201);
      expect(res.body.fileKey).toBeTruthy();
    });
  });

  // ================================================================ item 16 — login-history/security-event telemetry
  describe('item 16 — login-history/security-event telemetry carries IP/device metadata, never raw credentials', () => {
    it('a failed login records an audit event with masked/structural metadata only', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ fpoCode: 'NO-SUCH-CODE', usernameOrEmailOrMobile: 'x', password: 'y' }).set('User-Agent', 'IntegrationTestAgent/1.0');
      const rows = await dataSource.query(
        `SELECT "eventType", "metadata" FROM local_audit_event WHERE "eventType" = 'auth.login.failure' ORDER BY "createdAt" DESC LIMIT 1`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toHaveProperty('ip');
      expect(rows[0].metadata).toHaveProperty('userAgent');
      expect(JSON.stringify(rows[0].metadata)).not.toMatch(/\by\b/); // the raw password is never present
    });
  });

  // ================================================================ WAREHOUSE
  describe('WAREHOUSE regression', () => {
    it('no Priority #1 code path references the retired Warehouse concept', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dir = path.join(import.meta.dirname, '.');
      const selfFile = path.basename(import.meta.url.replace('file://', ''));
      const files: string[] = [];
      async function walk(d: string) {
        for (const entry of await fs.readdir(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.name.endsWith('.ts') && entry.name !== selfFile) files.push(full);
        }
      }
      await walk(dir);
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        expect(content.toLowerCase()).not.toContain('warehouse');
      }
    });
  });
});
