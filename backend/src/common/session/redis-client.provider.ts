import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export type { Redis };

export const redisClientFactory = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>('redis.url')!;
    // lazyConnect: false (default) — fail fast at boot if Redis is
    // unreachable, rather than silently degrading session enforcement.
    return new Redis(url, { maxRetriesPerRequest: 3 });
  },
};
