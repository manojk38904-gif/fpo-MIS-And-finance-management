import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis-client.provider.js';
import type { CreateSessionInput, SessionRecord, SessionStorePort } from './session-store.port.js';

function sessionKey(sessionId: string): string {
  return `fpo:session:${sessionId}`;
}

function subjectIndexKey(subjectType: 'TENANT_USER' | 'PLATFORM_ADMIN', userId: string): string {
  return `fpo:session:index:${subjectType}:${userId}`;
}

/**
 * Redis is the authoritative active-session/revocation truth (correction-pass
 * item 1). Each session is a single Redis key with a TTL matching its
 * absolute expiry (so an expired session simply disappears — no separate
 * sweep job needed), plus a per-subject SET of live session ids so
 * revoke-all (lockout, suspension, password reset) is O(1) per session
 * without a table scan.
 */
@Injectable()
export class RedisSessionStoreAdapter implements SessionStorePort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const now = new Date();
    const record: SessionRecord = {
      sessionId,
      subjectType: input.subjectType,
      userId: input.userId,
      tenantId: input.tenantId,
      mfaCompleted: input.mfaCompleted,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      revoked: false,
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(sessionKey(sessionId), JSON.stringify(record), 'EX', input.ttlSeconds);
    pipeline.sadd(subjectIndexKey(input.subjectType, input.userId), sessionId);
    pipeline.expire(subjectIndexKey(input.subjectType, input.userId), input.ttlSeconds);
    await pipeline.exec();

    return record;
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(sessionKey(sessionId));
    if (!raw) return null;
    const record = JSON.parse(raw) as SessionRecord;
    if (record.revoked) return null;
    return record;
  }

  async revokeSession(sessionId: string): Promise<void> {
    // Delete outright rather than merely flagging: a deleted key can never be
    // replayed even if a caller bypassed getSession()'s revoked-flag check.
    await this.redis.del(sessionKey(sessionId));
  }

  async revokeAllSessionsForSubject(subjectType: 'TENANT_USER' | 'PLATFORM_ADMIN', userId: string): Promise<void> {
    const indexKey = subjectIndexKey(subjectType, userId);
    const sessionIds = await this.redis.smembers(indexKey);
    if (sessionIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) {
      pipeline.del(sessionKey(id));
    }
    pipeline.del(indexKey);
    await pipeline.exec();
  }

  async markMfaCompleted(sessionId: string): Promise<void> {
    const raw = await this.redis.get(sessionKey(sessionId));
    if (!raw) return;
    const record = JSON.parse(raw) as SessionRecord;
    record.mfaCompleted = true;
    const ttl = await this.redis.ttl(sessionKey(sessionId));
    await this.redis.set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttl > 0 ? ttl : 1);
  }
}
