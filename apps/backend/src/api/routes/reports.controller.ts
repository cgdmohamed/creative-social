import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ReportingService } from '@gitroom/nestjs-libraries/reporting/reporting.service';
import { ReportingCollector } from '@gitroom/nestjs-libraries/reporting/reporting.collector';
import { ReportingPdf } from '@gitroom/nestjs-libraries/reporting/reporting.pdf';
import {
  ReportQueryDto,
  SyncReportDto,
  CreateReportCampaignDto,
  ReportSelectionDto,
} from '@gitroom/nestjs-libraries/reporting/reporting.dto';
import { reportCsv } from '@gitroom/nestjs-libraries/reporting/reporting.export';
@ApiTags('Reports')
@Controller('/reports')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
export class ReportsController {
  constructor(
    private reports: ReportingService,
    private collector: ReportingCollector,
    private pdf: ReportingPdf
  ) {}
  @Get('/options')
  @Header('Cache-Control', 'private, no-store')
  options(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReportSelectionDto
  ) {
    return this.reports.metadata(org.id, query.customerId);
  }
  @Get('/posts')
  @Header('Cache-Control', 'private, no-store')
  posts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReportSelectionDto
  ) {
    return this.reports.posts(org.id, query.customerId, query.integrationIds);
  }
  @Get('/organic')
  @Header('Cache-Control', 'private, no-store')
  report(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReportQueryDto
  ) {
    return this.reports.report(org.id, query);
  }
  @Post('/campaigns') campaign(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateReportCampaignDto
  ) {
    return this.reports.createCampaign(org.id, body);
  }
  @Post('/sync')
  @HttpCode(202)
  collect(@GetOrgFromRequest() org: Organization, @Body() body: SyncReportDto) {
    return this.collector.request(org.id, body.integrationIds, body.customerId);
  }
  @Get('/organic.csv') async csv(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReportQueryDto,
    @Res() res: Response
  ) {
    const report = await this.reports.report(org.id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="creative-social-report.csv"'
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(reportCsv(report));
  }
  @Get('/organic.pdf') async exportPdf(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReportQueryDto,
    @Res() res: Response
  ) {
    const report = await this.reports.report(org.id, query);
    const pdf = await this.pdf.render(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="creative-social-report.pdf"'
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }
}
