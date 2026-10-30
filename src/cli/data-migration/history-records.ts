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

export interface OldCulture {
  readonly growthType: string | null;
  readonly organisms: readonly (string | null)[];
  readonly message: string | null;
  readonly colonyCount: string | null;
  readonly incubation: string | null;
  readonly media: string | null;
}

export interface OldMicroscopy {
  readonly analyzer: string | null;
  readonly pusCells: string | null;
  readonly epithelialCells: string | null;
  readonly rbc: string | null;
  readonly note: string | null;
}

const clean = (value: string | null | undefined) => {
  const said = (value ?? '').replace(/\s+/g, ' ').trim();
  return said === '' ? null : said;
};

/** An old culture report's findings (Diag.CSNoGrowthResults, CSOthersValues) written out as the report read. */
export function cultureText(culture: OldCulture | null, microscopy: OldMicroscopy | null): string {
  const lines: string[] = [];
  if (culture) {
    const organisms = culture.organisms.map(clean).filter((name): name is string => name !== null);
    if (clean(culture.growthType)) lines.push(`Culture: ${clean(culture.growthType)}`);
    if (organisms.length) lines.push(`Organism${organisms.length > 1 ? 's' : ''} isolated: ${organisms.join(', ')}`);
    if (clean(culture.colonyCount)) lines.push(`Colony count: ${clean(culture.colonyCount)}`);
    if (clean(culture.incubation)) lines.push(`Incubation: ${clean(culture.incubation)}`);
    if (clean(culture.media)) lines.push(`Culture media: ${clean(culture.media)}`);
    if (clean(culture.message)) lines.push(clean(culture.message)!);
  }
  if (microscopy) {
    const cells = [
      ['Pus cells', microscopy.pusCells],
      ['Epithelial cells', microscopy.epithelialCells],
      ['RBC', microscopy.rbc],
    ].flatMap(([name, value]) => (clean(value) ? [`${name} ${clean(value)}`] : []));
    if (cells.length) lines.push(`Microscopy: ${cells.join(' · ')}`);
    if (clean(microscopy.note)) lines.push(clean(microscopy.note)!);
  }
  return lines.join('\n');
}

/**
 * One antibiotic of an old sensitivity grid (Diag.CSGrowths): its result against each organism isolated (old ValueA,
 * B and C, for the culture's organisms A, B and C), and the zone diameter.
 */
export function sensitivity(
  antibiotic: string | null,
  diameter: string | null,
  values: readonly (string | null)[],
  organisms: readonly (string | null)[],
): { test: string; result: string; unit: null; reference: string | null } | null {
  const name = clean(antibiotic);
  const results = values.flatMap((value, index) => {
    const result = clean(value);
    if (!result) return [];
    const organism = clean(organisms[index]);
    return [organism ? `${organism}: ${result}` : result];
  });
  if (!name || results.length === 0) return null;
  const zone = clean(diameter);
  return { test: name.slice(0, 200), result: results.join(' · '), unit: null, reference: zone ? `Zone ${zone}` : null };
}

/**
 * An old handover sheet's form data (EMR.HandOverSheets kept the form as JSON): one line per field filled in.
 * Anything that is not JSON is read as text.
 */
export function sheetText(value: unknown): string {
  if (typeof value !== 'string') return '';
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return plainText(value);
  }
  const lines: string[] = [];
  const walk = (node: unknown, label: string) => {
    if (node === null || node === undefined || node === '' || node === false) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${label} ${index + 1}`.trim()));
    } else if (typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) walk(item, label ? `${label} › ${words(key)}` : words(key));
    } else {
      lines.push(`${label}: ${node === true ? 'yes' : typeof node === 'string' ? node : JSON.stringify(node)}`);
    }
  };
  walk(data, '');
  return lines.join('\n').slice(0, 200_000);
}

/** "bloodPressure" or "blood_pressure" → "Blood pressure". */
function words(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
