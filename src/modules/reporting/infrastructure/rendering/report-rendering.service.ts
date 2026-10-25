import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG } from '../../../../config/config.module.js';
import type { AppConfig } from '../../../../config/configuration.js';
import { ReportRenderer, type RenderedFile, type RenderRequest } from '../../application/ports.js';
import { ChromiumPdfRenderer } from './chromium-pdf.renderer.js';
import { formatDateTime } from './formatting.js';
import { PdfmakeRenderer } from './pdfmake.renderer.js';
import { TemplateEngine } from './template-engine.js';
import { XlsxRenderer } from './xlsx.renderer.js';

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Picks the engine for the requested format and the report's layout. */
@Injectable()
export class ReportRenderingService extends ReportRenderer implements OnModuleDestroy {
  private readonly templates: TemplateEngine;
  private readonly chromium: ChromiumPdfRenderer;
  private readonly pdfmake = new PdfmakeRenderer();
  private readonly xlsx = new XlsxRenderer();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.templates = new TemplateEngine(config.reports.timeZone);
    this.chromium = new ChromiumPdfRenderer({
      concurrency: config.reports.renderConcurrency,
      executablePath: config.reports.chromiumExecutablePath,
    });
  }

  async render({ definition, data, context, format, filters }: RenderRequest): Promise<RenderedFile> {
    const title = definition.title;
    if (format === 'xlsx') {
      if (!definition.xlsx) throw new Error(`Report ${definition.key} has no spreadsheet layout`);
      return { contentType: XLSX, data: await this.xlsx.render(definition.xlsx(data), { context, title, filters }) };
    }

    const layout = definition.pdf;
    if (!layout) throw new Error(`Report ${definition.key} has no PDF layout`);
    const footerText = `Printed by ${context.printedBy || 'unknown'} on ${formatDateTime(context.generatedAt, context.timeZone)}`;
    if (layout.engine === 'pdfmake') {
      const document = layout.document(data, context);
      return {
        contentType: PDF,
        data: await this.pdfmake.render(document, { header: context.header, title, filters, footerText }),
      };
    }
    const body = this.templates.render(layout.template, { data, context, title, filters });
    const bare = layout.bare ?? false;
    const html = this.templates.renderPage({ header: context.header, title, filters, body, bare });
    return {
      contentType: PDF,
      data: await this.chromium.render(html, {
        landscape: layout.landscape ?? false,
        pageSize: layout.pageSize ?? 'A4',
        paper: layout.paper ?? null,
        footerText: bare ? null : footerText,
      }),
    };
  }

  onModuleDestroy(): Promise<void> {
    return this.chromium.close();
  }
}
