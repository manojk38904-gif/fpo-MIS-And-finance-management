import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { SecretTokenHasher } from '../security/secret-token-hasher.js';
import { PASSWORD_POLICY_PORT } from '../security/password-policy.port.js';
import { ConfigDrivenPasswordPolicyAdapter } from '../security/config-driven-password-policy.adapter.js';
import { SessionModule } from '../session/session.module.js';
import { TenantContextModule } from '../tenant-context/tenant-context.module.js';

/**
 * Shared authentication infrastructure: token verification (JwtStrategy,
 * guards) plus the password/secret-hashing primitives. Priority #1's own
 * login/registration services (src/modules/priority1-auth-registration/)
 * are the only code that calls JwtService to ISSUE tokens — this module
 * just provides the building blocks and the verification guards.
 */
@Global()
@Module({
  imports: [
    SessionModule,
    TenantContextModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Non-null: env.validation.ts refuses to let the app finish
        // bootstrapping if JWT_ACCESS_SECRET is empty/missing/too short.
        secret: config.get<string>('jwt.accessSecret')!,
        signOptions: {
          // @nestjs/jwt's type wants `number | StringValue` (from the `ms`
          // package); a config-driven "15m"/"7d" string is a valid StringValue
          // at runtime, so this cast only narrows the TS type, not behavior.
          expiresIn: config.get<string>('jwt.accessExpiresIn') as unknown as number,
        },
      }),
    }),
  ],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    PasswordHasher,
    SecretTokenHasher,
    { provide: PASSWORD_POLICY_PORT, useClass: ConfigDrivenPasswordPolicyAdapter },
  ],
  exports: [JwtModule, JwtAuthGuard, OptionalJwtAuthGuard, PasswordHasher, SecretTokenHasher, PASSWORD_POLICY_PORT],
})
export class AuthModule {}
