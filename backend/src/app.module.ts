import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { TenantContextModule } from './common/tenant-context/tenant-context.module.js';
import { TenantContextInterceptor } from './common/tenant-context/tenant-context.interceptor.js';
import { AuthModule } from './common/auth/auth.module.js';
import { SessionModule } from './common/session/session.module.js';
import { DeliveryModule } from './common/delivery/delivery.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { OptionalJwtAuthGuard } from './common/auth/optional-jwt-auth.guard.js';
import { HealthModule } from './health/health.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { Priority1AuthRegistrationModule } from './modules/priority1-auth-registration/priority1-auth-registration.module.js';
import { Priority13AdminSettingsModule } from './modules/priority13-admin-settings/priority13-admin-settings.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            // ConfigService gives seconds (THROTTLE_TTL_SECONDS); @nestjs/throttler
            // v5+ expects milliseconds — converted explicitly, in this one place only.
            ttl: config.get<number>('throttle.ttlSeconds')! * 1000,
            limit: config.get<number>('throttle.limit')!,
          },
        ],
      }),
    }),
    SessionModule,
    DeliveryModule,
    StorageModule,
    AuthModule,
    AuditModule,
    TenantContextModule,
    DatabaseModule,
    HealthModule,
    // Priority #1 (Auth/Registration/Onboarding) is implemented and wired as of
    // this pass. Priority #13 (Admin/Settings/RBAC) is being built incrementally
    // — SET-08 (Roles & Permissions) only so far. Priority #18 (Platform Super
    // Admin screens) is added here once its own task builds it.
    Priority1AuthRegistrationModule,
    Priority13AdminSettingsModule,
  ],
  providers: [
    // Execution order for a request: Guards (in provider order) -> Interceptors.
    // OptionalJwtAuthGuard verifies any presented token's signature FIRST, so
    // TenantContextInterceptor only ever reads a guard-verified req.user —
    // never a client-supplied header — when it establishes tenant context.
    { provide: APP_GUARD, useClass: OptionalJwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
