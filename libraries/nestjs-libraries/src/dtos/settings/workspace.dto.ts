import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class WorkspaceDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  @Matches(/^[^\u0000-\u001f\u007f<>]+$/u, {
    message: 'Workspace name cannot contain control characters or angle brackets',
  })
  name: string;
}
