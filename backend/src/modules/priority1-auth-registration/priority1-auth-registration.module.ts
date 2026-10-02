import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FpoRegistrationEntity } from './entities/fpo-registration.entity.js';
import { FpoRegistrationDocumentEntity } from './entities/fpo-registration-document.entity.js';
import { RegistrationResumeTokenEntity } from './entities/registration-resume-token.entity.js';
import { OtpVerificationEntity } from './entities/otp-verification.entity.js';
import { UserAccountEntity } from './entities/user-account.entity.js';
import { SetupTokenEntity } from './entities/setup-token.entity.js';
import { UserRefreshTokenEntity } from './entities/user-refresh-token.entity.js';
import { PlatformAdminAccountEntity } from './entities/platform-admin-account.entity.js';
import { PlatformAdminRefreshTokenEntity } from './entities/platform-admin-refresh-token.entity.js';
import { OnboardingStepProgressEntity } from './entities/onboarding-step-progress.entity.js';

import { OtpService } from './services/otp.service.js';
import { RegistrationService } from './services/registration.service.js';
import { TenantActivationService } from './services/tenant-activation.service.js';
import { TotpService } from './services/totp.service.js';
import { AuthService } from './services/auth.service.js';
import { PlatformAdminAuthService } from './services/platform-admin-auth.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { GoLiveGateService } from './services/go-live-gate.service.js';
import { OnboardingService } from './services/onboarding.service.js';

import { FPO_CODE_GENERATOR_PORT } from './services/fpo-code-generator.port.js';
import { NotImplementedFpoCodeGeneratorAdapter } from './services/fpo-code-generator.not-implemented.adapter.js';

import {
  BRANCH_EXISTENCE_PORT,
  CHART_OF_ACCOUNTS_PORT,
  LOAN_OR_INPUT_CREDIT_PRODUCT_PORT,
  REGULATORY_VERIFICATION_PORT,
  ROUNDING_RULE_PORT,
} from './services/go-live-prerequisite.ports.js';
import {
  NotImplementedBranchExistenceAdapter,
  NotImplementedChartOfAccountsAdapter,
  NotImplementedLoanOrInputCreditProductAdapter,
  NotImplementedRegulatoryVerificationAdapter,
  NotImplementedRoundingRuleAdapter,
} from './services/go-live-prerequisite.not-implemented-adapters.js';

import { RegistrationController } from './controllers/registration.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { PasswordResetController } from './controllers/password-reset.controller.js';
import { OnboardingController } from './controllers/onboarding.controller.js';

/**
 * Priority #1 v1.2 — AUTH / REGISTRATION / ONBOARDING (SYS-01-A, SYS-01-B,
 * SYS-02, SYS-03, SYS-04, SYS-05, SYS-06). Wires exactly the entities,
 * services and controllers built in this pass, PLUS the correction-pass
 * ports this module now owns: FPO_CODE_GENERATOR_PORT (bound to its
 * blocking NotImplemented adapter in production — swap only in test setups
 * that need activation to actually produce a code).
 *
 * AuthModule, AuditModule, SessionModule, DeliveryModule and StorageModule
 * are all @Global() and already imported in AppModule, so they are not
 * re-imported here; PASSWORD_POLICY_PORT / SESSION_STORE_PORT /
 * EMAIL_DELIVERY_PORT / FILE_STORAGE_PORT / MALWARE_SCAN_PORT / AUDIT_EVENT_PORT
 * are all available to this module's own providers through those globals.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FpoRegistrationEntity,
      FpoRegistrationDocumentEntity,
      RegistrationResumeTokenEntity,
      OtpVerificationEntity,
      UserAccountEntity,
      SetupTokenEntity,
      UserRefreshTokenEntity,
      PlatformAdminAccountEntity,
      PlatformAdminRefreshTokenEntity,
      OnboardingStepProgressEntity,
    ]),
  ],
  controllers: [RegistrationController, AuthController, PasswordResetController, OnboardingController],
  providers: [
    OtpService,
    RegistrationService,
    TenantActivationService,
    TotpService,
    AuthService,
    PlatformAdminAuthService,
    PasswordResetService,
    GoLiveGateService,
    OnboardingService,
    { provide: FPO_CODE_GENERATOR_PORT, useClass: NotImplementedFpoCodeGeneratorAdapter },
    { provide: LOAN_OR_INPUT_CREDIT_PRODUCT_PORT, useClass: NotImplementedLoanOrInputCreditProductAdapter },
    { provide: CHART_OF_ACCOUNTS_PORT, useClass: NotImplementedChartOfAccountsAdapter },
    { provide: BRANCH_EXISTENCE_PORT, useClass: NotImplementedBranchExistenceAdapter },
    { provide: REGULATORY_VERIFICATION_PORT, useClass: NotImplementedRegulatoryVerificationAdapter },
    { provide: ROUNDING_RULE_PORT, useClass: NotImplementedRoundingRuleAdapter },
  ],
  exports: [TenantActivationService, TotpService],
})
export class Priority1AuthRegistrationModule {}
