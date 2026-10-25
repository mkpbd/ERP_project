import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { amountInWords, formatDate, formatDateTime, formatInteger, formatMoney } from './formatting.js';

const LAYOUT = fileURLToPath(new URL('./templates/layout.hbs', import.meta.url));

/**
 * Handlebars, isolated from the global instance. Output is HTML-escaped
 * unless a template deliberately uses triple braces; prototype access is
 * blocked by Handlebars itself. Templates are read once and cached.
 */
export class TemplateEngine {
  private readonly handlebars = Handlebars.create();
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();

  constructor(timeZone: string) {
    const h = this.handlebars;
    h.registerHelper('date', (value: unknown) => formatDate(value, timeZone));
    h.registerHelper('datetime', (value: unknown) => formatDateTime(value, timeZone));
    h.registerHelper('money', (value: unknown) => formatMoney(value));
    h.registerHelper('integer', (value: unknown) => formatInteger(value));
    h.registerHelper('amountInWords', (value: unknown) => (typeof value === 'number' ? amountInWords(value) : ''));
    h.registerHelper('inc', (value: unknown) => (typeof value === 'number' ? value + 1 : value));
    h.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }

  render(templatePath: string, model: object): string {
    return this.compiled(templatePath)(model);
  }

  /** Wraps a rendered body in the shared letterhead layout. */
  renderPage(model: Record<string, unknown> & { body: string }): string {
    return this.compiled(LAYOUT)({ ...model, body: new Handlebars.SafeString(model.body) });
  }

  private compiled(templatePath: string): Handlebars.TemplateDelegate {
    let template = this.cache.get(templatePath);
    if (!template) {
      template = this.handlebars.compile(readFileSync(templatePath, 'utf8'));
      this.cache.set(templatePath, template);
    }
    return template;
  }
}
