import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { TenantAwareTransactionRunner } from './tenant-aware-transaction-runner.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';
import { KnownTenantTransactionRunner } from './known-tenant-transaction-runner.js';

@Global()
@Module({
  providers: [TenantContextService, TenantAwareTransactionRunner, TenantContextInterceptor, KnownTenantTransactionRunner],
  exports: [TenantContextService, TenantAwareTransactionRunner, TenantContextInterceptor, KnownTenantTransactionRunner],
})
export class TenantContextModule {}
