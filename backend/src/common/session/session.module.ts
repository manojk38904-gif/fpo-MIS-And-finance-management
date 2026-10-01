import { Global, Module } from '@nestjs/common';
import { redisClientFactory } from './redis-client.provider.js';
import { SESSION_STORE_PORT } from './session-store.port.js';
import { RedisSessionStoreAdapter } from './redis-session-store.adapter.js';

/**
 * Global session infrastructure (correction-pass item 1). Exactly one Redis
 * connection for the whole app; SESSION_STORE_PORT is the only way any
 * service may touch session state, so the Redis key scheme stays an
 * implementation detail of RedisSessionStoreAdapter alone.
 */
@Global()
@Module({
  providers: [redisClientFactory, { provide: SESSION_STORE_PORT, useClass: RedisSessionStoreAdapter }],
  exports: [SESSION_STORE_PORT, redisClientFactory],
})
export class SessionModule {}
