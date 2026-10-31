import { DomainError } from '../../../shared/domain/errors.js';
import { text } from './lab.js';

/**
 * How a lab test is reported: values against its parameters (10c), a culture with its sensitivity (old C/S report), or
 * written text (old descriptive pathology report: histopathology, cytology, FNAC …).
 */
export const REPORT_FORMS = ['values', 'culture', 'descriptive'] as const;
export type ReportForm = (typeof REPORT_FORMS)[number];

/** Sensitive, intermediate, resistant: the old antibiogram's S, I and R. */
export const SENSITIVITIES = ['S', 'I', 'R'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** The old report had columns for organisms A, B and C. */
export const MAX_ORGANISMS = 3;
export const MAX_ANTIBIOTICS = 60;
export const MAX_NARRATIVE = 20_000;

export interface CultureOrganism {
  readonly organismId: string | null;
  readonly name: string;
}

export interface CultureSensitivity {
  readonly antibioticId: string | null;
  readonly antibiotic: string;
  /** The zone diameter, as read (mm). */
  readonly zone: string | null;
  /** The result against each organism, in the organisms' order (null: not tested against it). */
  readonly results: readonly (Sensitivity | null)[];
}

/**
 * Old Diag.CSOthersValues (microscopy), CSNoGrowthResults (the culture) and CSGrowths (the antibiogram) as one report.
 * Names are copied from the masters when entered, so a master renamed later does not change a report already made.
 */
export interface CultureReport {
  readonly analyzer: string | null;
  readonly pusCells: string | null;
  readonly epithelialCells: string | null;
  readonly rbc: string | null;
  readonly microscopyNote: string | null;
  /** Growth, or no growth (then no organisms and no antibiogram). */
  readonly growth: boolean;
  readonly growthTypeId: string | null;
  readonly growthType: string | null;
  readonly organisms: readonly CultureOrganism[];
  readonly colonyCount: string | null;
  readonly incubation: string | null;
  readonly media: string | null;
  readonly message: string | null;
  readonly sensitivity: readonly CultureSensitivity[];
}

/** A culture report as it may be kept: its organisms named once, one result per organism, untested antibiotics left out. */
export function checkedCulture(input: CultureReport): CultureReport {
  const organisms = input.organisms.map((organism, index) => {
    const name = text(organism.name, 150, 'organism');
    if (!name) throw new DomainError('invalid_culture', `Organism ${index + 1}: name it`);
    return { organismId: organism.organismId, name };
  });
  if (input.growth && (organisms.length === 0 || organisms.length > MAX_ORGANISMS)) {
    throw new DomainError('invalid_culture', `A growth names 1 to ${MAX_ORGANISMS} organisms`);
  }
  if (!input.growth && (organisms.length > 0 || input.sensitivity.length > 0)) {
    throw new DomainError('invalid_culture', 'No growth has no organisms and no antibiogram');
  }
  const names = new Set(organisms.map((organism) => organism.name.toLowerCase()));
  if (names.size !== organisms.length) throw new DomainError('invalid_culture', 'An organism is named twice');
  if (input.sensitivity.length > MAX_ANTIBIOTICS) {
    throw new DomainError('invalid_culture', `The antibiogram has at most ${MAX_ANTIBIOTICS} antibiotics`);
  }

  const seen = new Set<string>();
  const sensitivity = input.sensitivity.flatMap((row, index) => {
    const antibiotic = text(row.antibiotic, 100, 'antibiotic');
    if (!antibiotic) throw new DomainError('invalid_culture', `Antibiotic ${index + 1}: name it`);
    if (seen.has(antibiotic.toLowerCase())) throw new DomainError('invalid_culture', `${antibiotic} is there twice`);
    seen.add(antibiotic.toLowerCase());
    if (row.results.length !== organisms.length) {
      throw new DomainError('invalid_culture', `${antibiotic}: give one result per organism`);
    }
    if (row.results.some((result) => result !== null && !SENSITIVITIES.includes(result))) {
      throw new DomainError('invalid_culture', `${antibiotic}: a result is S, I or R`);
    }
    // An antibiotic tested against none of the organisms is not on the report.
    if (row.results.every((result) => result === null)) return [];
    return [
      { antibioticId: row.antibioticId, antibiotic, zone: text(row.zone, 20, 'zone'), results: [...row.results] },
    ];
  });

  return {
    analyzer: text(input.analyzer, 100, 'analyzer'),
    pusCells: text(input.pusCells, 50, 'pus cells'),
    epithelialCells: text(input.epithelialCells, 50, 'epithelial cells'),
    rbc: text(input.rbc, 50, 'RBC'),
    microscopyNote: text(input.microscopyNote, 500, 'microscopy note'),
    growth: input.growth,
    growthTypeId: input.growthTypeId,
    growthType: text(input.growthType, 100, 'growth type'),
    organisms,
    colonyCount: text(input.colonyCount, 100, 'colony count'),
    incubation: text(input.incubation, 100, 'incubation'),
    media: text(input.media, 200, 'culture media'),
    message: text(input.message, 1000, 'message'),
    sensitivity,
  };
}

/** A written report (histopathology …): its line breaks kept, trailing spaces dropped. */
export function checkedNarrative(value: string): string {
  const narrative = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  if (!narrative) throw new DomainError('invalid_text', 'Write the report');
  if (narrative.length > MAX_NARRATIVE) {
    throw new DomainError('invalid_text', `The report is at most ${MAX_NARRATIVE} characters`);
  }
  return narrative;
}
