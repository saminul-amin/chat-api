import { IsString, Length } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @Length(1, 1000, { message: 'Message content must not exceed 1000 characters' })
  content: string;
}
