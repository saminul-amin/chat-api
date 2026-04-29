import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v4 as uuidv4 } from 'uuid';
import { DRIZZLE } from '../database/database.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';
import * as schema from '../database/schema';
import { AppException } from '../common/exceptions/app.exception';

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private activeUsersKey(roomId: string): string {
    return `room:${roomId}:active_users`;
  }

  async findAll(): Promise<(schema.Room & { activeUsers: number })[]> {
    const rooms = await this.db.select().from(schema.rooms).orderBy(schema.rooms.createdAt);
    const results = await Promise.all(
      rooms.map(async (room) => ({
        ...room,
        activeUsers: await this.redis.scard(this.activeUsersKey(room.id)),
      })),
    );
    return results;
  }

  async findOne(id: string): Promise<schema.Room & { activeUsers: number }> {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!room) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'ROOM_NOT_FOUND',
        `Room with id ${id} does not exist`,
      );
    }

    const activeUsers = await this.redis.scard(this.activeUsersKey(id));
    return { ...room, activeUsers };
  }

  async create(name: string, username: string): Promise<schema.Room> {
    const existing = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.name, name))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ROOM_NAME_TAKEN',
        'A room with this name already exists',
      );
    }

    const id = `room_${uuidv4().replace(/-/g, '').slice(0, 6)}`;
    const inserted = await this.db
      .insert(schema.rooms)
      .values({ id, name, createdBy: username })
      .returning();

    return inserted[0];
  }

  async validateDeletePermission(id: string, username: string): Promise<void> {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!room) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'ROOM_NOT_FOUND',
        `Room with id ${id} does not exist`,
      );
    }

    if (room.createdBy !== username) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Only the room creator can delete this room',
      );
    }
  }

  async executeDelete(id: string): Promise<void> {
    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));
    await this.redis.del(this.activeUsersKey(id));
  }
}
