import { chromium, type Browser } from 'playwright';

export interface ChromiumOptions {
  readonly concurrency: number;
  readonly executablePath: string | undefined;
}

export interface PdfPageOptions {
  readonly landscape: boolean;
  readonly pageSize: 'A4' | 'A5' | 'Letter' | 'Legal';
  /** Plain text for the left side of the footer. */
  readonly footerText: string;
}

const RENDER_TIMEOUT_MS = 30_000;

/** Limits how many pages render at once; each Chromium page holds tens of MB. */
class Slots {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/**
 * HTML → PDF with one shared headless Chromium, launched on first use.
 * Pages run without JavaScript and with every network request refused, so
 * report data can never make the browser fetch anything (images are data: URIs).
 */
export class ChromiumPdfRenderer {
  private browser: Promise<Browser> | null = null;
  private readonly slots: Slots;

  constructor(private readonly options: ChromiumOptions) {
    this.slots = new Slots(options.concurrency);
  }

  render(html: string, page: PdfPageOptions): Promise<Uint8Array> {
    return this.slots.run(async () => {
      const browser = await this.launch();
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      try {
        await context.route('**/*', (route) => route.abort());
        const tab = await context.newPage();
        tab.setDefaultTimeout(RENDER_TIMEOUT_MS);
        await tab.setContent(html, { waitUntil: 'load' });
        return await tab.pdf({
          format: page.pageSize,
          landscape: page.landscape,
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate:
            '<div style="font-size:8px;width:100%;padding:0 10mm;display:flex;justify-content:space-between;' +
            'font-family:Arial,sans-serif;color:#444">' +
            `<span>${escapeHtml(page.footerText)}</span>` +
            '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
          margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' },
        });
      } finally {
        await context.close();
      }
    });
  }

  async close(): Promise<void> {
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close();
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium.launch({ executablePath: this.options.executablePath });
      this.browser = launching;
      launching.then(
        (browser) =>
          browser.on('disconnected', () => {
            if (this.browser === launching) this.browser = null;
          }),
        () => {
          if (this.browser === launching) this.browser = null;
        },
      );
    }
    return this.browser;
  }
}
