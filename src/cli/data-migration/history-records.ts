const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  ndash: '–',
  mdash: '—',
  deg: '°',
  micro: 'µ',
  plusmn: '±',
  times: '×',
  le: '≤',
  ge: '≥',
};

/**
 * The text of an old rich-text field (the report and certificate editors kept HTML): blocks and line breaks become
 * lines, table cells are set apart, tags and styles go, entities are read. Plain text comes through as it is.
 */
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith('#') && key !== '#39') return String.fromCodePoint(Number(key.slice(1)));
      return ENTITIES[key] ?? match;
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/[ \u00a0]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 200_000);
}

export interface OldPrescription {
  readonly complaints: readonly { complaint: string; duration: string | null }[];
  readonly impressions: readonly string[];
  readonly drugs: readonly { name: string; dosage: string | null; duration: string | null }[];
  readonly tests: readonly string[];
  readonly advice: readonly string[];
  readonly notes: string | null;
  readonly followUpOn: string | null;
}

/** An old Rx visit written out as the prescription read: complaints, impression, medicines, tests, advice, follow-up. */
export function prescriptionText(rx: OldPrescription): string {
  const section = (title: string, lines: readonly string[]) =>
    lines.length ? [`${title}:`, ...lines.map((line) => `  ${line}`), ''] : [];
  return [
    ...section(
      'Complaints',
      rx.complaints.map((entry) => (entry.duration ? `${entry.complaint} — ${entry.duration}` : entry.complaint)),
    ),
    ...section('Clinical impression', rx.impressions),
    ...section(
      'Rx',
      rx.drugs.map((drug, index) =>
        [`${index + 1}. ${drug.name}`, drug.dosage, drug.duration].filter(Boolean).join(' — '),
      ),
    ),
    ...section('Investigations', rx.tests),
    ...section('Advice', rx.advice),
    ...(rx.notes ? [`Notes: ${rx.notes}`, ''] : []),
    ...(rx.followUpOn ? [`Follow up on ${rx.followUpOn}`] : []),
  ]
    .join('\n')
    .trim();
}
