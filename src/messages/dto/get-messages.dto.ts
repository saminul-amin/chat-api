import { IsOptional, IsNumberString, IsString } from 'class-validator';

export class GetMessagesDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  before?: string;
}
