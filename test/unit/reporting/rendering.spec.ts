import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  formatDate,
  formatDateTime,
  formatMoney,
  integerInWords,
  wallClock,
} from '../../../src/modules/reporting/infrastructure/rendering/formatting.js';
import { PdfmakeRenderer } from '../../../src/modules/reporting/infrastructure/rendering/pdfmake.renderer.js';
import { TemplateEngine } from '../../../src/modules/reporting/infrastructure/rendering/template-engine.js';

describe('pdfmake renderer', () => {
  const page = {
    header: { organizationName: 'X', organizationNameAlt: null, address: '', hotline: null, logoDataUri: null },
    title: 'Receipt',
    filters: '',
    footerText: 'Printed by test',
  };

  it('renders a PDF with the bundled fonts', async () => {
    const pdf = await new PdfmakeRenderer().render({ content: { text: 'Paid 1,500.00' } }, page);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('never reads local files or fetches URLs named in a document', async () => {
    const renderer = new PdfmakeRenderer();
    await expect(renderer.render({ content: { image: path.resolve('package.json') } }, page)).rejects.toThrow(
      /denied by resource access policy/,
    );
    await expect(renderer.render({ content: { image: 'https://example.com/logo.png' } }, page)).rejects.toThrow(
      /denied by resource access policy/,
    );
  });
});

describe('amounts in words (old NumberToWords)', () => {
  it('uses the thousand / lakh / crore system', () => {
    expect(integerInWords(0)).toBe('Zero');
    expect(integerInWords(105)).toBe('One Hundred And Five');
    expect(integerInWords(1_250)).toBe('One Thousand Two Hundred And Fifty');
    expect(integerInWords(2_00_000)).toBe('Two Lakh');
    expect(integerInWords(12_34_56_789)).toBe(
      'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred And Eighty Nine',
    );
  });

  it('writes the fraction as "Point" and ends with "Only."', () => {
    expect(amountInWords(1500)).toBe('One Thousand Five Hundred Only.');
    expect(amountInWords(10.5)).toBe('Ten Point Fifty Only.');
    expect(amountInWords(0.1 + 0.2)).toBe('Zero Point Thirty Only.');
    expect(amountInWords(-7)).toBe('Minus Seven Only.');
  });
});

describe('formatting', () => {
  it('groups money in lakhs with two decimals', () => {
    expect(formatMoney(123456.5)).toBe('1,23,456.50');
    expect(formatMoney('42')).toBe('42.00');
    expect(formatMoney(null)).toBe('');
  });

  it('prints dates in the report time zone', () => {
    const lateEvening = new Date('2026-10-25T20:30:00Z'); // 02:30 next day in Dhaka (UTC+6)
    expect(formatDate(lateEvening, 'Asia/Dhaka')).toBe('26/10/2026');
    expect(formatDateTime(lateEvening, 'Asia/Dhaka')).toMatch(/^26\/10\/2026, 02:30 am$/i);
    expect(wallClock(lateEvening, 'Asia/Dhaka')?.toISOString()).toBe('2026-10-26T02:30:00.000Z');
    expect(formatDate('not a date', 'Asia/Dhaka')).toBe('');
  });
});

describe('template engine', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'erp-templates-'));
  const template = path.join(dir, 'rows.hbs');
  writeFileSync(template, '{{#each data}}<td>{{inc @index}}</td><td>{{name}}</td><td>{{money amount}}</td>{{/each}}');

  it('escapes data and applies helpers', () => {
    const engine = new TemplateEngine('Asia/Dhaka');
    const html = engine.render(template, { data: [{ name: '<img src=x onerror=alert(1)>', amount: 1500 }] });
    expect(html).toBe('<td>1</td><td>&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;</td><td>1,500.00</td>');
  });

  it('wraps the body in the letterhead layout without escaping the body twice', () => {
    const engine = new TemplateEngine('Asia/Dhaka');
    const page = engine.renderPage({
      header: {
        organizationName: 'Hospital & Co',
        organizationNameAlt: null,
        address: '',
        hotline: '123',
        logoDataUri: null,
      },
      title: 'Daily sales',
      filters: 'Today',
      body: '<table class="report"></table>',
    });
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('Hospital &amp; Co');
    expect(page).toContain('Hotline: 123');
    expect(page).toContain('<table class="report"></table>');
    expect(page).not.toContain('<img');
  });
});
