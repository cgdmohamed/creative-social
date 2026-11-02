import {
  InboxKind,
  InboxReplyDto,
  InboxMessageDto,
  InboxModerationDto,
  InboxReadDto,
} from './inbox.dto';
import {
  ServiceUnavailableException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  ParseEnumPipe,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@ApiTags('Inbox')
@Controller('/inbox')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
export class InboxController {
  constructor(private _integrationService: IntegrationService) {}

  private requireLiveAccess() {
    if (process.env.INBOX_COLLECTION_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Inbox platform access is disabled on this server. Contact an administrator.'
      );
  }

  // Panel czyta stad: gotowe dane z bazy, zero wywolan do platform.
  @Get('/db/:kind')
  async fromDb(
    @GetOrgFromRequest() org: Organization,
    @Param('kind', new ParseEnumPipe(InboxKind)) kind: InboxKind
  ) {
    return this._integrationService.getInboxFromDb(org, kind);
  }

  // Reczne odswiezenie (przycisk Refresh). Cron robi to samo co godzine.
  @Post('/sync/:kind')
  async sync(
    @GetOrgFromRequest() org: Organization,
    @Param('kind', new ParseEnumPipe(InboxKind)) kind: InboxKind
  ) {
    this.requireLiveAccess();
    await this._integrationService.syncOrganization(org.id, kind);
    return this._integrationService.getInboxFromDb(org, kind);
  }

  @Get('/channels')
  async channels(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.getInboxChannels(org);
  }

  @Get('/channels/:id/posts/:postId/comments')
  async postComments(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('postId') postId: string
  ) {
    return this._integrationService.getPostComments(org, id, postId);
  }

  @Get('/channels/:id/comments')
  async channelComments(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('refresh') refresh?: string
  ) {
    this.requireLiveAccess();
    return this._integrationService.getChannelComments(
      org,
      id,
      refresh === 'true'
    );
  }

  @Get('/channels/:id/chats')
  async channelChats(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('refresh') refresh?: string
  ) {
    this.requireLiveAccess();
    return this._integrationService.getChannelConversations(
      org,
      id,
      refresh === 'true'
    );
  }

  @Get('/read')
  async readItems(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.getReadItems(org);
  }

  @Post('/read')
  async markRead(
    @GetOrgFromRequest() org: Organization,
    @Body() body: InboxReadDto
  ) {
    return this._integrationService.markRead(
      org,
      body.ids,
      body.read !== false
    );
  }

  @Get('/comments')
  async comments(@GetOrgFromRequest() org: Organization) {
    this.requireLiveAccess();
    return this._integrationService.getInboxComments(org);
  }

  @Post('/comments/:id/reply')
  async replyToComment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxReplyDto
  ) {
    this.requireLiveAccess();
    return this._integrationService.replyToComment(
      org,
      id,
      body.commentId,
      body.message
    );
  }

  @Post('/comments/:id/moderate')
  async moderateComment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxModerationDto
  ) {
    this.requireLiveAccess();
    return this._integrationService.moderateComment(
      org,
      id,
      body.commentId,
      body.action
    );
  }

  @Get('/chats')
  async chats(@GetOrgFromRequest() org: Organization) {
    this.requireLiveAccess();
    return this._integrationService.getInboxConversations(org);
  }

  @Post('/chats/:id/send')
  async sendMessage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxMessageDto
  ) {
    this.requireLiveAccess();
    return this._integrationService.sendInboxMessage(
      org,
      id,
      body.recipientId,
      body.message
    );
  }
}
