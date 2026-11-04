import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Organization, User } from '@prisma/client';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { assertWorkspaceOrigin } from '@gitroom/nestjs-libraries/database/prisma/organizations/workspace.policy';
import { CampaignManagerService } from '../../advertising/campaign-manager.service';
export class CampaignSaveDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(80) key: string;
  @IsDefined() @IsObject() spec: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) revision?: number;
}
export class CampaignKeyDto { @IsString() @MaxLength(80) key: string; }
export class CampaignRejectDto { @IsString() @MaxLength(100) reason: string; }
export class CampaignRevisionDto { @IsInt() @Min(0) revision: number; }
export class CampaignApprovalDto {
  @IsString() @MaxLength(64) digest: string;
  @IsString() @MaxLength(500) confirmation: string;
}
export class CampaignListDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsIn(['CAMPAIGN', 'AD_GROUP', 'AD']) level: string;
}
@Controller('/campaign-manager')
export class CampaignManagerController {
  constructor(private campaigns: CampaignManagerService) {}
  private write(req: Request) {
    assertWorkspaceOrigin(req.headers);
    if (req.cookies?.impersonate || req.headers.impersonate) throw new ForbiddenException('Advertising changes are unavailable while impersonating');
  }
  @Get('/catalog')
  catalog(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.campaigns.catalog(org.id, user.id);
  }
  @Get('/resources')
  list(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Query() query: CampaignListDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.campaigns.list(org.id, user.id, query.accountId, query.level);
  }
  @Post('/drafts')
  create(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CampaignSaveDto, @Req() req: Request) {
    this.write(req); return this.campaigns.save(org.id, user.id, body);
  }
  @Post('/drafts/:id')
  edit(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignSaveDto, @Req() req: Request) {
    this.write(req); return this.campaigns.save(org.id, user.id, body, id);
  }
  @Post('/drafts/:id/duplicate')
  duplicate(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignKeyDto, @Req() req: Request) {
    this.write(req); return this.campaigns.duplicate(org.id, user.id, id, body.key);
  }
  @Post('/drafts/:id/review')
  review(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignRevisionDto, @Req() req: Request) {
    this.write(req); return this.campaigns.review(org.id, user.id, id, body.revision);
  }
  @Post('/reviews/:id/approve')
  approve(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignApprovalDto, @Req() req: Request) {
    this.write(req); return this.campaigns.approve(org.id, user.id, id, body.digest, body.confirmation);
  }
  @Post('/reviews/:id/submit')
  submit(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Req() req: Request) {
    this.write(req); return this.campaigns.submit(org.id, user.id, id);
  }
  @Post('/reviews/:id/reject')
  reject(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignRejectDto, @Req() req: Request) {
    this.write(req); return this.campaigns.reject(org.id, user.id, id, body.reason);
  }
}
