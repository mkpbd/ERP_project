import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';

/**
 * What a report's pdfmake layout returns: its content plus optional page
 * settings. The renderer adds the letterhead, title, filters and footer.
 */
export type PdfmakeReportDocument = Pick<TDocumentDefinitions, 'pageSize' | 'pageOrientation' | 'styles'> & {
  content: Content;
};
