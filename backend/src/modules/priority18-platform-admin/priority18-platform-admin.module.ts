import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Priority1AuthRegistrationModule } from '../priority1-auth-registration/priority1-auth-registration.module.js';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity.js';
import { TenantSubscriptionEntity } from './entities/tenant-subscription.entity.js';
import { PlatformConfigurationEntity } from './entities/platform-configuration.entity.js';
import { SupportAccessRequestEntity } from './entities/support-access-request.entity.js';
import {
  PlatformAdminRecoveryApprovalEntity,
  PlatformAdminRecoveryRequestEntity,
} from './entities/platform-admin-recovery.entity.js';
import {
  PlatformAdminController,
  PlatformAdminRecoveryController,
  TenantSupportAccessController,
} from './platform-admin.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Module({
  imports: [
    Priority1AuthRegistrationModule,
    TypeOrmModule.forFeature([
      SubscriptionPlanEntity,
      TenantSubscriptionEntity,
      PlatformConfigurationEntity,
      SupportAccessRequestEntity,
      PlatformAdminRecoveryRequestEntity,
      PlatformAdminRecoveryApprovalEntity,
    ]),
  ],
  providers: [PlatformAdminService],
  controllers: [PlatformAdminController, TenantSupportAccessController, PlatformAdminRecoveryController],
  exports: [PlatformAdminService],
})
export class Priority18PlatformAdminModule {}
