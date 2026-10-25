const UNITS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** English words in the South Asian system (thousand, lakh, crore), as the old NumberToWords did. */
export function integerInWords(value: number): string {
  const n = Math.trunc(value);
  const join = (head: string, rest: number) => (rest > 0 ? `${head} ${integerInWords(rest)}` : head);
  if (n < 20) return UNITS[n]!;
  if (n < 100) return join(TENS[Math.floor(n / 10)]!, n % 10);
  if (n < 1000) {
    const head = `${UNITS[Math.floor(n / 100)]!} Hundred`;
    return n % 100 > 0 ? `${head} And ${integerInWords(n % 100)}` : head;
  }
  if (n < 100_000) return join(`${integerInWords(n / 1000)} Thousand`, n % 1000);
  if (n < 10_000_000) return join(`${integerInWords(n / 100_000)} Lakh`, n % 100_000);
  return join(`${integerInWords(n / 10_000_000)} Crore`, n % 10_000_000);
}

/** `1250.5` → `One Thousand Two Hundred And Fifty Point Fifty Only.` (old ConvertAmount wording). */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const words = fraction === 0 ? integerInWords(whole) : `${integerInWords(whole)} Point ${integerInWords(fraction)}`;
  return `${amount < 0 ? 'Minus ' : ''}${words} Only.`;
}

const moneyFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** `123456.5` → `1,23,456.50` (lakh grouping). */
export function formatMoney(value: unknown): string {
  const n = toNumber(value);
  return n === null ? '' : moneyFormat.format(n);
}

export function formatInteger(value: unknown): string {
  const n = toNumber(value);
  return n === null ? '' : integerFormat.format(n);
}

/** `25/10/2026` in the report time zone. */
export function formatDate(value: unknown, timeZone: string): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** `25/10/2026, 06:30 pm` in the report time zone. */
export function formatDateTime(value: unknown, timeZone: string): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** `06:30 pm` in the report time zone. */
export function formatTime(value: unknown, timeZone: string): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
}

/** `75` → `1h 15m`; `0` or missing → empty. */
export function formatDuration(minutes: unknown): string {
  const total = toNumber(minutes);
  if (total === null || total <= 0) return '';
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  return hours > 0 ? `${hours}h${rest > 0 ? ` ${rest}m` : ''}` : `${rest}m`;
}

/** The same instant as wall-clock time in `timeZone`, expressed as a UTC date (spreadsheets have no zones). */
export function wallClock(value: unknown, timeZone: string): Date | null {
  const date = toDate(value);
  if (!date) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day, parts.hour, parts.minute, parts.second));
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
