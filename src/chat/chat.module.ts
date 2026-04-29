import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  providers: [ChatGateway],
})
export class ChatModule {}
