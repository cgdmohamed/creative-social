import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@ApiTags('Inbox')
@Controller('/inbox')
export class InboxController {
  constructor(private _integrationService: IntegrationService) {}

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
