import { Injectable, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async setSession(token: string, userId: string, username: string): Promise<void> {
    const key = `session:${token}`;
    await this.redis.hset(key, { userId, username });
    await this.redis.expire(key, SESSION_TTL_SECONDS);
  }

  async getSession(token: string): Promise<{ userId: string; username: string } | null> {
    const key = `session:${token}`;
    const data = await this.redis.hgetall(key);
    if (!data || !data.userId) return null;
    return { userId: data.userId, username: data.username };
  }

  async deleteSession(token: string): Promise<void> {
    await this.redis.del(`session:${token}`);
  }
}
