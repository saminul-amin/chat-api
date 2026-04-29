import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/response.types';

@Controller('api/v1/rooms/:id/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  async getMessages(@Param('id') roomId: string, @Query() query: GetMessagesDto) {
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const { messages, hasMore, nextCursor } = await this.messagesService.getMessages(
      roomId,
      limit,
      query.before,
    );

    return successResponse({
      messages: messages.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        username: m.username,
        content: m.content,
        createdAt: m.createdAt,
      })),
      hasMore,
      nextCursor,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMessage(
    @Param('id') roomId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const message = await this.messagesService.createMessage(
      roomId,
      user.username,
      dto.content,
    );

    return successResponse({
      id: message.id,
      roomId: message.roomId,
      username: message.username,
      content: message.content,
      createdAt: message.createdAt,
    });
  }
}
