import ExcelJS from 'exceljs';
import type { ReportCellFormat, ReportContext, ReportTable } from '../../../../shared/application/reports.js';
import { formatDateTime, toNumber, wallClock } from './formatting.js';

const NUMBER_FORMATS: Partial<Record<ReportCellFormat, string>> = {
  integer: '#,##0',
  decimal: '#,##0.00##',
  money: '#,##0.00',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm AM/PM',
};

function cellValue(value: unknown, format: ReportCellFormat | undefined, timeZone: string): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  switch (format) {
    case 'integer':
    case 'decimal':
    case 'money':
      return toNumber(value);
    case 'date':
    case 'datetime':
      return wallClock(value, timeZone);
    default:
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
      return value instanceof Date ? value.toISOString() : JSON.stringify(value);
  }
}

/** Excel sheet names: ≤ 31 characters, none of : \ / ? * [ ]. */
const sheetName = (title: string) => title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Report';

/** One worksheet: a short banner (organization, title, filters, who/when), then the table. */
export class XlsxRenderer {
  async render(
    table: ReportTable,
    page: { context: ReportContext; title: string; filters: string },
  ): Promise<Uint8Array> {
    const { context } = page;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = context.printedBy;
    workbook.created = context.generatedAt;
    const sheet = workbook.addWorksheet(sheetName(page.title));
    const width = Math.max(table.columns.length, 1);

    const banner = [
      context.header.organizationName,
      page.title,
      page.filters,
      `Generated ${formatDateTime(context.generatedAt, context.timeZone)} by ${context.printedBy}`,
    ].filter((line) => line !== '');
    banner.forEach((line, index) => {
      const row = sheet.addRow([line]);
      sheet.mergeCells(row.number, 1, row.number, width);
      row.font = { bold: index < 2, size: index === 0 ? 14 : index === 1 ? 12 : 10 };
    });
    sheet.addRow([]);

    const headerRow = sheet.addRow(table.columns.map((column) => column.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    for (const row of table.rows) {
      sheet.addRow(table.columns.map((column) => cellValue(row[column.key], column.format, context.timeZone)));
    }

    table.columns.forEach((column, index) => {
      const sheetColumn = sheet.getColumn(index + 1);
      sheetColumn.width = column.width ?? Math.max(column.header.length + 2, 12);
      const numFmt = column.format ? NUMBER_FORMATS[column.format] : undefined;
      if (numFmt) {
        sheetColumn.eachCell((cell, rowNumber) => {
          if (rowNumber > headerRow.number) cell.numFmt = numFmt;
        });
      }
    });
    sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
    if (table.columns.length > 0) {
      sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: width } };
    }

    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }
}
