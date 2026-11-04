import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Organization, User } from '@prisma/client';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { assertWorkspaceOrigin } from '@gitroom/nestjs-libraries/database/prisma/organizations/workspace.policy';
import { PaidAnalyticsService } from '../../advertising/paid-analytics.service';
import { PaidReportsService } from '../../advertising/paid-reports.service';
import { paidLevels, PaidLevel } from '@gitroom/nestjs-libraries/advertising/paid.types';
import { ForbiddenException } from '@nestjs/common';
export class PaidQueryDto {
  @IsString() @MaxLength(10) from: string;
  @IsString() @MaxLength(10) to: string;
  @IsIn(paidLevels) level: PaidLevel;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsOptional() @IsIn(['META_ADS', 'GOOGLE_ADS']) provider?: 'META_ADS' | 'GOOGLE_ADS';
  @IsOptional() @IsString() @MaxLength(100) accountId?: string;
  @IsOptional() @IsString() @MaxLength(100) campaignId?: string;
  @IsOptional() @IsIn(['CSV', 'PDF']) format?: 'CSV' | 'PDF';
}
export class PaidAccountDto {
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsBoolean() valueTrackingVerified: boolean;
}
export class PaidScheduleDto {
  @IsString() @MaxLength(100) name: string;
  @IsDefined() @ValidateNested() @Type(() => PaidQueryDto) query: PaidQueryDto;
  @IsInt() @Min(1) @Max(93) rollingDays: number;
  @IsIn([1, 7, 30]) cadenceDays: number;
  @IsIn(['CSV', 'PDF']) format: 'CSV' | 'PDF';
  @IsIn(['ARCHIVE', 'EMAIL']) delivery: 'ARCHIVE' | 'EMAIL';
  @IsOptional() @IsEmail() @MaxLength(254) recipient?: string;
  @IsBoolean() requireFresh: boolean;
  @IsDateString() nextRunAt: string;
}
export class PaidEnabledDto { @IsBoolean() enabled: boolean; }
@Controller('/paid-analytics')
export class PaidAnalyticsController {
  constructor(private analytics: PaidAnalyticsService, private reports: PaidReportsService) {}
  private write(req: Request) {
    assertWorkspaceOrigin(req.headers);
    if (req.cookies?.impersonate || req.headers.impersonate) throw new ForbiddenException('Paid reporting changes are unavailable while impersonating');
  }
  @Get('/catalog')
  catalog(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) { return this.analytics.catalog(org.id, user.id); }
  @Get('/report')
  report(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Query() query: PaidQueryDto,
    @Res({ passthrough: true }) response: Response) { response.setHeader('Cache-Control', 'no-store'); return this.analytics.report(org.id, user.id, query); }
  @Post('/sync')
  sync(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: PaidQueryDto, @Req() req: Request) {
    this.write(req); return this.analytics.requestSync(org.id, user.id, body);
  }
  @Post('/accounts/:id')
  configure(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: PaidAccountDto, @Req() req: Request) {
    this.write(req); return this.analytics.configure(org.id, user.id, id, body.customerId || null, body.valueTrackingVerified);
  }
  private send(response: Response, format: string, bytes: Buffer) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="paid-advertising-report.${format.toLowerCase()}"`); response.send(bytes);
  }
  @Get('/export')
  async export(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Query() query: PaidQueryDto, @Res() response: Response) {
    const report = await this.analytics.report(org.id, user.id, query), format = query.format || 'CSV';
    this.send(response, format, await this.reports.artifact(report, format));
  }
  @Get('/schedules')
  schedules(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User) { return this.reports.list(org.id, user.id); }
  @Post('/schedules')
  schedule(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body() body: PaidScheduleDto, @Req() req: Request) {
    this.write(req); return this.reports.save(org.id, user.id, body);
  }
  @Post('/schedules/:id')
  updateSchedule(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: PaidScheduleDto, @Req() req: Request) {
    this.write(req); return this.reports.save(org.id, user.id, body, id);
  }
  @Post('/schedules/:id/enabled')
  enabled(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Body() body: PaidEnabledDto, @Req() req: Request) {
    this.write(req); return this.reports.toggle(org.id, user.id, id, body.enabled);
  }
  @Get('/runs/:id/download')
  async download(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Param('id') id: string, @Res() response: Response) {
    const run = await this.reports.download(org.id, user.id, id); this.send(response, run.format, run.bytes);
  }
}
