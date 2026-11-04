import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors, BadRequestException, Injectable, CanActivate, ExecutionContext, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Organization, User } from '@prisma/client';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { assertWorkspaceOrigin } from '@gitroom/nestjs-libraries/database/prisma/organizations/workspace.policy';
import { CampaignManagerService } from '../../advertising/campaign-manager.service';
import { CampaignAssetsService } from '../../advertising/campaign-assets.service';
import { advertisingWritesEnabled } from '../../advertising/campaign-execution.service';
@Injectable()
export class CampaignUploadGuard implements CanActivate {
  constructor(private campaigns: CampaignManagerService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    assertWorkspaceOrigin(req.headers);
    if (req.cookies?.impersonate || req.headers.impersonate || !req.org?.id || !req.user?.id) throw new ForbiddenException('Advertising upload authorization required');
    await this.campaigns.member(req.org.id, req.user.id, 'approve');
    if (!advertisingWritesEnabled()) throw new ForbiddenException('Operator must enable advertising writes before uploading a provider asset');
    return true;
  }
}
export class CampaignSaveDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(80) key: string;
  @IsDefined() @IsObject() spec: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) revision?: number;
}
export class CampaignKeyDto { @IsString() @MaxLength(80) key: string; }
export class CampaignRejectDto { @IsString() @MaxLength(100) reason: string; }
export class CampaignAbandonDto { @IsString() @MaxLength(100) confirmation: string; }
export class CampaignReconcileDto { @IsOptional() @IsObject() evidence?: Record<string, string>; }
export class CampaignRevisionDto { @IsInt() @Min(0) revision: number; }
export class CampaignApprovalDto {
  @IsString() @MaxLength(64) digest: string;
  @IsString() @MaxLength(500) confirmation: string;
}
export class CampaignListDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsIn(['CAMPAIGN', 'AD_GROUP', 'AD']) level: string;
}
export class CampaignAssetDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsString() @MaxLength(80) key: string;
  @IsString() @MaxLength(100) name: string;
}
export class CampaignMediaAssetDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsString() @MaxLength(100) mediaId: string;
  @IsString() @MaxLength(80) key: string;
}
export class CampaignAssetImportDto {
  @IsString() @MaxLength(100) accountId: string;
  @IsString() @MaxLength(150) providerId: string;
  @IsIn(['IMAGE', 'VIDEO']) kind: string;
  @IsString() @MaxLength(80) key: string;
}
@Controller('/campaign-manager')
export class CampaignManagerController {
  constructor(private campaigns: CampaignManagerService, private assets: CampaignAssetsService) {}
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
  submit(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignApprovalDto, @Req() req: Request) {
    this.write(req); return this.campaigns.submit(org.id, user.id, id, body);
  }
  @Post('/executions/:id/reconcile')
  reconcile(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignReconcileDto, @Req() req: Request) {
    this.write(req); return this.campaigns.reconcile(org.id, user.id, id, body?.evidence);
  }
  @Post('/reviews/:id/validate')
  validateReview(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Req() req: Request) {
    this.write(req); return this.campaigns.validate(org.id, user.id, id);
  }
  @Post('/executions/:id/abandon')
  abandon(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignAbandonDto, @Req() req: Request) {
    this.write(req); return this.campaigns.abandon(org.id, user.id, id, body.confirmation);
  }
  @Post('/reviews/:id/reject')
  reject(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: CampaignRejectDto, @Req() req: Request) {
    this.write(req); return this.campaigns.reject(org.id, user.id, id, body.reason);
  }
  @Post('/assets/upload')
  @UseGuards(CampaignUploadGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 3 } }))
  upload(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CampaignAssetDto, @UploadedFile() file: { buffer: Buffer }, @Req() req: Request) {
    this.write(req); if (!file?.buffer) throw new BadRequestException('Advertising file required');
    return this.assets.upload(org.id, user.id, body.accountId, body.key, body.name, file.buffer);
  }
  @Get('/assets/:accountId')
  library(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('accountId') accountId: string, @Query('discover') discover: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.assets.library(org.id, user.id, accountId, discover === 'true');
  }
  @Post('/assets/from-media')
  fromMedia(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CampaignMediaAssetDto, @Req() req: Request) {
    this.write(req); return this.assets.fromMedia(org.id, user.id, body.accountId, body.mediaId, body.key);
  }
  @Post('/assets/import')
  importAsset(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: CampaignAssetImportDto, @Req() req: Request) {
    this.write(req); return this.assets.importAsset(org.id, user.id, body.accountId, body.providerId, body.kind, body.key);
  }
  @Post('/assets/:id/refresh')
  refreshAsset(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Req() req: Request) {
    this.write(req); return this.assets.refresh(org.id, user.id, id);
  }
}
