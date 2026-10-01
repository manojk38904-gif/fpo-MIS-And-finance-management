import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuditEvent, AuditEventPort } from './audit-event.port.js';
import { AuditEventEntity } from './audit-event.entity.js';

@Injectable()
export class LocalAuditEventAdapter implements AuditEventPort {
  constructor(private readonly dataSource: DataSource) {}

  async record(event: AuditEvent): Promise<void> {
    const repo = this.dataSource.getRepository(AuditEventEntity);
    const toInsert: Partial<AuditEventEntity> = {
      eventType: event.eventType,
      tenantId: event.tenantId,
      actorUserId: event.actorUserId ?? null,
      subjectId: event.subjectId ?? null,
      // AuditEvent.metadata is deliberately narrower than the jsonb column's
      // storage type (Record<string, unknown>) — its own type already forbids
      // callers from passing anything but structured, non-secret, JSON-
      // serializable primitives (the actual security property that matters
      // here). TypeORM's QueryDeepPartialEntity recursively maps a jsonb
      // column's plain-object type into per-key partials, which an arbitrary
      // string-indexed Record can never structurally satisfy — so insert()'s
      // input type is cast once, here, at the one place a plain object meets
      // that generic constraint; the runtime value and its narrower source
      // type are unaffected.
      metadata: (event.metadata ?? null) as never,
    };
    await repo.insert(toInsert as never);
  }
}
