import { DomainError } from '../../../shared/domain/errors.js';

export const PERSON_KINDS = ['manager', 'officer', 'agent'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/** Whom each kind works under: officers under a manager, agents under an officer; managers under nobody. */
export const PARENT_KIND: Record<PersonKind, PersonKind | null> = {
  manager: null,
  officer: 'manager',
  agent: 'officer',
};

export interface Person {
  readonly id: string;
  readonly kind: PersonKind;
  readonly name: string;
  readonly code: string | null;
  readonly phone: string | null;
  readonly parentId: string | null;
  readonly zoneId: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

/** A referring doctor's billing over the period. */
export interface Referred {
  readonly doctorId: string;
  readonly opd: number;
  readonly diagnostic: number;
  readonly indoor: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** "an officer", "a manager". */
const article = (kind: string) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

/** A member of the team as given: under someone of the right kind; a zone for an officer only. */
export function checkedPerson(
  input: { kind: PersonKind; name: string; code: string | null; phone: string | null; zoneId: string | null },
  parent: Pick<Person, 'kind' | 'isActive' | 'name'> | null,
) {
  const name = text(input.name, 150, 'name');
  if (!name) throw new DomainError('invalid_text', 'Give the name');
  const wanted = PARENT_KIND[input.kind];
  if (wanted === null && parent) throw new DomainError('invalid_parent', 'A manager works under nobody here');
  if (wanted !== null && (!parent || parent.kind !== wanted)) {
    throw new DomainError('invalid_parent', `${capital(article(input.kind))} works under ${article(wanted)}`);
  }
  if (parent) {
    if (!parent.isActive) throw new DomainError('invalid_parent', `${parent.name} is not active`);
  }
  if (input.zoneId && input.kind !== 'officer') throw new DomainError('invalid_zone', 'Only an officer works a zone');
  return { name, code: text(input.code, 20, 'code'), phone: text(input.phone, 20, 'phone'), zoneId: input.zoneId };
}

export function monthBounds(year: number, month: number): [string, string] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, '0')}`];
}

export interface OfficerPerformance {
  readonly officerId: string;
  readonly officerName: string;
  readonly managerName: string | null;
  readonly zoneName: string | null;
  readonly doctors: number;
  readonly opd: number;
  readonly diagnostic: number;
  readonly indoor: number;
  readonly achieved: number;
  readonly target: number | null;
  /** Achieved as a percentage of the target, one decimal; null without a target. */
  readonly percent: number | null;
}

/**
 * Old MPO target vs achievement: each officer's doctors' referred billing in the month against the officer's target;
 * the whole hospital's referred billing (assigned or not) against the gross target.
 */
export function performance(params: {
  officers: readonly { id: string; name: string; managerName: string | null; zoneName: string | null }[];
  links: ReadonlyMap<string, string>;
  referred: readonly Referred[];
  targets: ReadonlyMap<string | null, number>;
}) {
  const percent = (achieved: number, target: number | null) =>
    target && target > 0 ? Math.round((achieved / target) * 1000) / 10 : null;
  const rows: OfficerPerformance[] = params.officers.map((officer) => {
    const mine = params.referred.filter((entry) => params.links.get(entry.doctorId) === officer.id);
    const sum = (key: 'opd' | 'diagnostic' | 'indoor') => cents(mine.reduce((total, entry) => total + entry[key], 0));
    const [opd, diagnostic, indoor] = [sum('opd'), sum('diagnostic'), sum('indoor')];
    const achieved = cents(opd + diagnostic + indoor);
    const target = params.targets.get(officer.id) ?? null;
    return {
      officerId: officer.id,
      officerName: officer.name,
      managerName: officer.managerName,
      zoneName: officer.zoneName,
      doctors: [...params.links.values()].filter((id) => id === officer.id).length,
      opd,
      diagnostic,
      indoor,
      achieved,
      target,
      percent: percent(achieved, target),
    };
  });
  const total = cents(params.referred.reduce((sum, entry) => sum + entry.opd + entry.diagnostic + entry.indoor, 0));
  const unassigned = cents(
    params.referred
      .filter((entry) => !params.links.has(entry.doctorId))
      .reduce((sum, entry) => sum + entry.opd + entry.diagnostic + entry.indoor, 0),
  );
  const gross = params.targets.get(null) ?? null;
  return { rows, total, unassigned, grossTarget: gross, grossPercent: percent(total, gross) };
}
