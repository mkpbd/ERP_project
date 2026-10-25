import { createRequire } from 'node:module';
import path from 'node:path';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import type { PdfmakeDocument, ReportHeader } from '../../../../shared/application/reports.js';
import type { PdfmakeReportDocument } from '../../../../shared/infrastructure/reports/pdfmake-document.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');

let configured = false;

/** pdfmake keeps fonts and policies in module state; set them once. */
function configure(): void {
  if (configured) return;
  const dir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  const roboto = {
    normal: path.join(dir, 'Roboto-Regular.ttf'),
    bold: path.join(dir, 'Roboto-Medium.ttf'),
    italics: path.join(dir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
  };
  pdfmake.setFonts({ Roboto: roboto });
  // Only the bundled fonts may be read from disk and nothing may be fetched; images must be data: URIs.
  const fontFiles = new Set(Object.values(roboto));
  pdfmake.setLocalAccessPolicy((file) => fontFiles.has(file));
  pdfmake.setUrlAccessPolicy(() => false);
  configured = true;
}

function letterhead(header: ReportHeader): Content {
  // pdfmake embeds PNG and JPEG only.
  const logo = header.logoDataUri && /^data:image\/(png|jpeg);/.test(header.logoDataUri) ? header.logoDataUri : null;
  const lines: Content[] = [
    { text: header.organizationName, style: 'organization' },
    ...(header.organizationNameAlt ? [{ text: header.organizationNameAlt, alignment: 'center' as const }] : []),
    ...(header.address ? [{ text: header.address, style: 'contact' }] : []),
    ...(header.hotline ? [{ text: `Hotline: ${header.hotline}`, style: 'contact' }] : []),
  ];
  return {
    columns: logo
      ? [{ image: logo, fit: [56, 56], width: 64 }, { stack: lines }, { text: '', width: 64 }]
      : [{ stack: lines }],
    margin: [0, 0, 0, 6],
  };
}

/** Small documents (receipts, labels, short lists) without a browser. Latin script only. */
export class PdfmakeRenderer {
  constructor() {
    configure();
  }

  async render(
    document: PdfmakeDocument,
    page: { header: ReportHeader; title: string; filters: string; footerText: string },
  ): Promise<Uint8Array> {
    const report = document as PdfmakeReportDocument;
    const definition: TDocumentDefinitions = {
      pageSize: report.pageSize ?? 'A4',
      pageOrientation: report.pageOrientation ?? 'portrait',
      pageMargins: [28, 28, 28, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      styles: {
        organization: { fontSize: 15, bold: true, alignment: 'center' },
        contact: { fontSize: 8, alignment: 'center', color: '#333333' },
        title: { fontSize: 12, bold: true, alignment: 'center', margin: [0, 8, 0, 2] },
        filters: { fontSize: 8, alignment: 'center', color: '#333333', margin: [0, 0, 0, 8] },
        tableHeader: { bold: true, fillColor: '#eeeeee' },
        ...report.styles,
      },
      footer: (currentPage: number, pageCount: number): Content => ({
        columns: [{ text: page.footerText }, { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right' }],
        fontSize: 7,
        color: '#444444',
        margin: [28, 12, 28, 0],
      }),
      content: [
        letterhead(page.header),
        { text: page.title.toUpperCase(), style: 'title' },
        ...(page.filters ? [{ text: page.filters, style: 'filters' }] : []),
        report.content,
      ],
    };
    return new Uint8Array(await pdfmake.createPdf(definition).getBuffer());
  }
}
