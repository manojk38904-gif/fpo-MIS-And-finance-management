import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUDIT_EVENT_PORT } from './audit-event.port.js';
import { AuditEventEntity } from './audit-event.entity.js';
import { LocalAuditEventAdapter } from './local-audit-event.adapter.js';

/**
 * BUG FIX (found while running this pass's own integration tests against a
 * real PostgreSQL instance — "No metadata for AuditEventEntity was found"):
 * DatabaseModule's `autoLoadEntities: true` only auto-registers an entity
 * that is passed to SOME module's `TypeOrmModule.forFeature([...])` — it does
 * NOT scan the filesystem for every `@Entity()` class. LocalAuditEventAdapter
 * calls `dataSource.getRepository(AuditEventEntity)` directly, so without
 * this forFeature() registration the entity's metadata was never loaded at
 * all, and every audit write (every login, OTP, setup-token and registration
 * event) would have thrown at runtime the first time it was actually
 * exercised end-to-end, despite building/linting/unit-testing cleanly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity])],
  providers: [{ provide: AUDIT_EVENT_PORT, useClass: LocalAuditEventAdapter }],
  exports: [AUDIT_EVENT_PORT],
})
export class AuditModule {}
