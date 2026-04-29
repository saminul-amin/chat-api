import { IsString, Matches, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(2, 24, { message: 'username must be between 2 and 24 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username must contain only alphanumeric characters and underscores',
  })
  username: string;
}
