import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@ApiTags('Inbox')
@Controller('/inbox')
export class InboxController {
  constructor(private _integrationService: IntegrationService) {}

  @Get('/channels')
  async channels(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.getInboxChannels(org);
  }

  @Get('/channels/:id/comments')
  async channelComments(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('refresh') refresh?: string
  ) {
    return this._integrationService.getChannelComments(org, id, refresh === 'true');
  }

  @Get('/channels/:id/chats')
  async channelChats(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('refresh') refresh?: string
  ) {
    return this._integrationService.getChannelConversations(
      org,
      id,
      refresh === 'true'
    );
  }

  @Get('/comments')
  async comments(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.getInboxComments(org);
  }

  @Post('/comments/:id/reply')
  async replyToComment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { commentId: string; message: string }
  ) {
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
    @Body() body: { commentId: string; action: 'hide' | 'unhide' | 'delete' }
  ) {
    return this._integrationService.moderateComment(
      org,
      id,
      body.commentId,
      body.action
    );
  }

  @Get('/chats')
  async chats(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.getInboxConversations(org);
  }

  @Post('/chats/:id/send')
  async sendMessage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { recipientId: string; message: string }
  ) {
    return this._integrationService.sendInboxMessage(
      org,
      id,
      body.recipientId,
      body.message
    );
  }
}
