import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { SessionService } from '../session/session.service';
import { REDIS_CLIENT, REDIS_SUB_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';
import { default as IORedis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly redisSub: Redis,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async afterInit(server: Server): Promise<void> {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    const adapterPub = new IORedis(redisUrl);
    const adapterSub = adapterPub.duplicate();
    const rootServer: Server = (server as unknown as { server: Server }).server;
    rootServer.adapter(createAdapter(adapterPub, adapterSub));
    this.logger.log('Socket.io Redis adapter configured');
  }

  async onModuleInit(): Promise<void> {
    await this.redisSub.psubscribe('chat:room:*:message', 'chat:room:deleted');

    this.redisSub.on('pmessage', (_pattern: string, channel: string, rawMessage: string) => {
      try {
        const payload = JSON.parse(rawMessage) as Record<string, unknown>;

        if (channel === 'chat:room:deleted') {
          const roomId = payload.roomId as string;
          this.server.to(`room:${roomId}`).emit('room:deleted', { roomId });
          return;
        }

        const parts = channel.split(':');
        const roomId = parts[2];
        this.server.to(`room:${roomId}`).emit('message:new', {
          id: payload.id,
          username: payload.username,
          content: payload.content,
          createdAt: payload.createdAt,
        });
      } catch (err) {
        this.logger.error('Failed to process pub/sub message', err);
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.query['token'] as string | undefined;
      const roomId = client.handshake.query['roomId'] as string | undefined;

      if (!token) {
        client.emit('error', { code: 401, message: 'Missing session token' });
        client.disconnect(true);
        return;
      }

      const session = await this.sessionService.getSession(token);
      if (!session) {
        client.emit('error', { code: 401, message: 'Invalid or expired session token' });
        client.disconnect(true);
        return;
      }

      if (!roomId) {
        client.emit('error', { code: 404, message: 'roomId is required' });
        client.disconnect(true);
        return;
      }

      const room = await this.db
        .select()
        .from(schema.rooms)
        .where(eq(schema.rooms.id, roomId))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!room) {
        client.emit('error', { code: 404, message: `Room ${roomId} does not exist` });
        client.disconnect(true);
        return;
      }

      await this.redis.hset(`socket:${client.id}`, {
        username: session.username,
        roomId,
      });

      await client.join(`room:${roomId}`);
      await this.redis.sadd(`room:${roomId}:active_users`, session.username);

      const activeUsersArr = await this.redis.smembers(`room:${roomId}:active_users`);

      client.emit('room:joined', { activeUsers: activeUsersArr });

      client.to(`room:${roomId}`).emit('room:user_joined', {
        username: session.username,
        activeUsers: activeUsersArr,
      });
    } catch (err) {
      this.logger.error(`handleConnection failed for socket ${client.id}`, err);
      client.emit('error', { code: 500, message: 'Internal server error during connection' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.cleanupClient(client);
  }

  @SubscribeMessage('room:leave')
  async handleRoomLeave(@ConnectedSocket() client: Socket, @MessageBody() _data: unknown): Promise<void> {
    await this.cleanupClient(client);
    client.disconnect(true);
  }

  private async cleanupClient(client: Socket): Promise<void> {
    const socketData = await this.redis.hgetall(`socket:${client.id}`);
    if (!socketData || !socketData.username) return;

    const { username, roomId } = socketData;

    await this.redis.srem(`room:${roomId}:active_users`, username);
    await this.redis.del(`socket:${client.id}`);

    const remaining = await this.redis.smembers(`room:${roomId}:active_users`);

    this.server.to(`room:${roomId}`).emit('room:user_left', {
      username,
      activeUsers: remaining,
    });
  }
}
