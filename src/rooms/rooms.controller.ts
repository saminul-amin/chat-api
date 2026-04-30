import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/response.types';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';

@Controller('api/v1/rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async findAll() {
    const rooms = await this.roomsService.findAll();
    return successResponse({
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        createdBy: r.createdBy,
        activeUsers: r.activeUsers,
        createdAt: r.createdAt,
      })),
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateRoomDto, @CurrentUser() user: AuthenticatedUser) {
    const room = await this.roomsService.create(dto.name, user.username);
    return successResponse({
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const room = await this.roomsService.findOne(id);
    return successResponse({
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      activeUsers: room.activeUsers,
      createdAt: room.createdAt,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.roomsService.validateDeletePermission(id, user.username);
    await this.redis.publish('chat:room:deleted', JSON.stringify({ roomId: id }));
    await this.roomsService.executeDelete(id);

    return successResponse({ deleted: true });
  }
}
