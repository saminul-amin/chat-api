import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { eq, lt, and, desc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v4 as uuidv4 } from 'uuid';
import { DRIZZLE } from '../database/database.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';
import * as schema from '../database/schema';
import { AppException } from '../common/exceptions/app.exception';

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getMessages(
    roomId: string,
    limit = 50,
    before?: string,
  ): Promise<{ messages: schema.Message[]; hasMore: boolean; nextCursor: string | null }> {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!room) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'ROOM_NOT_FOUND',
        `Room with id ${roomId} does not exist`,
      );
    }

    const clampedLimit = Math.min(Math.max(limit, 1), 100);
    const fetchLimit = clampedLimit + 1;

    let rows: schema.Message[];

    if (before) {
      const cursorMsg = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, before))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!cursorMsg) {
        rows = [];
      } else {
        rows = await this.db
          .select()
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.roomId, roomId),
              lt(schema.messages.createdAt, cursorMsg.createdAt),
            ),
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(fetchLimit);
      }
    } else {
      rows = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.roomId, roomId))
        .orderBy(desc(schema.messages.createdAt))
        .limit(fetchLimit);
    }

    const hasMore = rows.length > clampedLimit;
    const messages = rows.slice(0, clampedLimit).reverse();
    const nextCursor = hasMore ? messages[0]?.id ?? null : null;

    return { messages, hasMore, nextCursor };
  }

  async createMessage(
    roomId: string,
    username: string,
    content: string,
  ): Promise<schema.Message> {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!room) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'ROOM_NOT_FOUND',
        `Room with id ${roomId} does not exist`,
      );
    }

    const trimmed = content.trim();

    if (!trimmed) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MESSAGE_EMPTY',
        'Message content cannot be empty',
      );
    }

    if (trimmed.length > 1000) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MESSAGE_TOO_LONG',
        'Message content must not exceed 1000 characters',
      );
    }

    const id = `msg_${uuidv4().replace(/-/g, '').slice(0, 6)}`;
    const inserted = await this.db
      .insert(schema.messages)
      .values({ id, roomId, username, content: trimmed })
      .returning();

    const message = inserted[0];

    await this.redis.publish(
      `chat:room:${roomId}:message`,
      JSON.stringify({
        id: message.id,
        roomId: message.roomId,
        username: message.username,
        content: message.content,
        createdAt: message.createdAt,
      }),
    );

    return message;
  }
}
