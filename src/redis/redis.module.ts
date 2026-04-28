import { Module, Global, Logger, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_SUB_CLIENT = Symbol('REDIS_SUB_CLIENT');

function createRedisClient(url: string, name: string): Redis {
  const client = new Redis(url, {
    // Stop reconnecting after 3 failures so the process exits cleanly
    // instead of flooding the console with ECONNREFUSED indefinitely.
    retryStrategy: (times: number) => {
      if (times >= 3) {
        return null;
      }
      return Math.min(times * 200, 1000);
    },
  });

  client.on('error', (err: Error) => {
    // Only log the first ECONNREFUSED occurrence to avoid log flooding
    if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      Logger.error(
        `Redis (${name}) cannot connect to ${url} — is Redis running?`,
        'RedisModule',
      );
    }
  });

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return createRedisClient(config.getOrThrow<string>('REDIS_URL'), 'REDIS_CLIENT');
      },
    },
    {
      provide: REDIS_SUB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return createRedisClient(config.getOrThrow<string>('REDIS_URL'), 'REDIS_SUB_CLIENT');
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Verify the Redis connection on startup and crash with a clear message
   * rather than silently running with a broken connection.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.redis.ping();
      this.logger.log('Redis connection verified');
    } catch {
      this.logger.error(
        'Could not reach Redis. Make sure Redis is running and REDIS_URL is correct.',
      );
      process.exit(1);
    }
  }
}
