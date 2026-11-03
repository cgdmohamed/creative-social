// Adapted from Postmill's CampaignReportService.toPdf (AGPL-3.0).
// Use an operator-managed local Chromium; never fetch templates/assets or run scripts.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { launch } from 'puppeteer-core';
import { reportHtml } from './reporting.export';
import { OrganicReport } from './reporting.types';
@Injectable()
export class ReportingPdf {
  private active = 0;
  async render(report: OrganicReport): Promise<Buffer> {
    return this.renderHtml(reportHtml(report));
  }
  async renderHtml(html: string): Promise<Buffer> {
    const executablePath = process.env.REPORT_CHROMIUM_EXECUTABLE_PATH;
    if (!executablePath)
      throw new ServiceUnavailableException(
        'PDF export is not enabled on this server. Contact an administrator.'
      );
    if (this.active >= 2)
      throw new ServiceUnavailableException(
        'PDF renderer is busy; retry shortly'
      );
    this.active++;
    let browser: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      browser = await launch({
        executablePath,
        headless: true,
        timeout: 20000,
        args: ['--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void request.abort().catch(() => {});
      });
      page.setDefaultTimeout(20000);
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          timeout: 20000,
          margin: { top: '15mm', bottom: '17mm', left: '15mm', right: '15mm' },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate:
            '<div style="font:9px Arial;color:#616a7c;width:100%;text-align:center">Creative Social - <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        })
      );
    } catch {
      throw new ServiceUnavailableException(
        'PDF rendering failed; check the configured local Chromium installation'
      );
    } finally {
      try {
        await browser?.close();
      } catch {}
      this.active--;
    }
  }
}
