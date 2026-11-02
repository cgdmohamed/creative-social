import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class InboxReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  commentId: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
export class InboxMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  recipientId: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
export class InboxModerationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  commentId: string;
  @IsIn(['hide', 'unhide', 'delete'])
  action: 'hide' | 'unhide' | 'delete';
}
export class InboxReadDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  ids: string[];
  @IsBoolean()
  read: boolean;
}
export enum InboxKind {
  Comment = 'comment',
  Conversation = 'conversation',
}
