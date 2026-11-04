import { Body, Controller, ForbiddenException, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { assertWorkspaceOrigin } from '@gitroom/nestjs-libraries/database/prisma/organizations/workspace.policy';
import { AdvertisingService } from '../../advertising/advertising.service';

export class AdvertisingCallbackDto {
  @IsString() @MaxLength(100) state: string;
  @IsOptional() @IsString() @MaxLength(4096) code?: string;
  @IsOptional() @IsString() @MaxLength(200) error?: string;
}
export class AdvertisingSelectionDto {
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) accountIds: string[];
}
export class AdvertisingDisconnectDto {
  @IsOptional() @IsBoolean() revoke?: boolean;
}
export class AdvertisingAuthorizeDto { @IsOptional() @IsBoolean() management?: boolean; }

@Controller('/advertising')
export class AdvertisingController {
  constructor(private service: AdvertisingService) {}
  @Get('/')
  list(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.list(org.id, user.id);
  }
  private write(request: Request, response: Response) {
    assertWorkspaceOrigin(request.headers);
    if (request.cookies?.impersonate || request.headers.impersonate) throw new ForbiddenException('Advertising changes are not permitted while impersonating');
    response.setHeader('Cache-Control', 'no-store');
  }
  @Post('/:provider/authorize')
  start(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Param('provider') provider: string, @Body() body: AdvertisingAuthorizeDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.write(request, response);
    return this.service.start(org.id, user.id, provider, body?.management === true);
  }
  @Post('/:provider/callback')
  callback(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Param('provider') provider: string, @Body() body: AdvertisingCallbackDto,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.write(request, response);
    return this.service.callback(org.id, user.id, provider, body);
  }
  @Post('/:provider/discover')
  discover(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Param('provider') provider: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.write(request, response);
    return this.service.discover(org.id, user.id, provider);
  }
  @Post('/:provider/accounts')
  select(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Param('provider') provider: string, @Body() body: AdvertisingSelectionDto,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.write(request, response);
    return this.service.select(org.id, user.id, provider, body.accountIds);
  }
  @Post('/:provider/disconnect')
  disconnect(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User,
    @Param('provider') provider: string, @Body() body: AdvertisingDisconnectDto,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.write(request, response);
    return this.service.disconnect(org.id, user.id, provider, body.revoke === true);
  }
}
