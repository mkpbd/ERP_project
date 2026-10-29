import { ConflictError, DomainError } from '../../../shared/domain/errors.js';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type Compatibility = 'red_cells' | 'plasma' | 'any';
export const SCREENS = ['hiv', 'hbsag', 'hcv', 'syphilis', 'malaria'] as const;
export type Screen = (typeof SCREENS)[number];
export type ScreenResult = 'negative' | 'positive';
/** Days a donor waits between donations. */
export const DONATION_GAP_DAYS = 90;

export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

const abo = (group: BloodGroup) => group.slice(0, -1) as 'A' | 'B' | 'AB' | 'O';
const negative = (group: BloodGroup) => group.endsWith('-');

/**
 * Whether a unit of the donor's group may go to the patient: red cells by the patient's antibodies (O to all, AB from
 * all; Rh-negative patients only Rh-negative cells), plasma the other way round (AB plasma to all), others any.
 */
export function compatible(donor: BloodGroup, patient: BloodGroup, kind: Compatibility): boolean {
  if (kind === 'any') return true;
  if (kind === 'red_cells') {
    const fits = abo(donor) === 'O' || abo(patient) === 'AB' || abo(donor) === abo(patient);
    return fits && (!negative(patient) || negative(donor));
  }
  return abo(donor) === 'AB' || abo(patient) === 'O' || abo(donor) === abo(patient);
}

/** A donor may give when active and not deferred to a later day. */
export function assertMayDonate(
  donor: { isActive: boolean; deferredUntil: string | null; deferReason: string | null },
  on: string,
) {
  if (!donor.isActive) throw new DomainError('donor_inactive', 'The donor is not active');
  if (donor.deferredUntil && donor.deferredUntil > on) {
    throw new DomainError(
      'donor_deferred',
      `The donor may give again from ${donor.deferredUntil}${donor.deferReason ? ` (${donor.deferReason})` : ''}`,
    );
  }
}

export interface DonationProps {
  id: string;
  bagNumber: string;
  donorId: string;
  donatedOn: string;
  donatedAt: Date;
  bloodGroup: BloodGroup;
  volumeMl: number;
  status: 'collected' | 'screened' | 'discarded';
  hiv: ScreenResult | null;
  hbsag: ScreenResult | null;
  hcv: ScreenResult | null;
  syphilis: ScreenResult | null;
  malaria: ScreenResult | null;
  screenedBy: string | null;
  screenedAt: Date | null;
  discardReason: string | null;
  collectedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old DonorContributionRecords (bag, group, expiry) with the screening of old SerologyRecords: a bag given by a
 * donor, screened for HIV, HBsAg, HCV, syphilis and malaria. Any positive screen throws the whole donation away.
 */
export class Donation {
  private constructor(private readonly props: DonationProps) {}

  static collect(params: {
    id: string;
    bagNumber: string;
    donorId: string;
    donatedOn: string;
    bloodGroup: BloodGroup;
    volumeMl: number;
    by: string;
    at: Date;
  }): Donation {
    if (!Number.isInteger(params.volumeMl) || params.volumeMl < 50 || params.volumeMl > 600) {
      throw new DomainError('invalid_volume', 'A donation is 50 to 600 ml');
    }
    return new Donation({
      id: params.id,
      bagNumber: params.bagNumber,
      donorId: params.donorId,
      donatedOn: params.donatedOn,
      donatedAt: params.at,
      bloodGroup: params.bloodGroup,
      volumeMl: params.volumeMl,
      status: 'collected',
      hiv: null,
      hbsag: null,
      hcv: null,
      syphilis: null,
      malaria: null,
      screenedBy: null,
      screenedAt: null,
      discardReason: null,
      collectedBy: params.by,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: DonationProps): Donation {
    return new Donation({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get bagNumber(): string {
    return this.props.bagNumber;
  }
  get donorId(): string {
    return this.props.donorId;
  }
  get status(): DonationProps['status'] {
    return this.props.status;
  }
  get bloodGroup(): BloodGroup {
    return this.props.bloodGroup;
  }
  get donatedOn(): string {
    return this.props.donatedOn;
  }

  /** Every screen's result; returns the screens that were positive (the donation is then thrown away). */
  screen(results: Record<Screen, ScreenResult>, by: string, at: Date): Screen[] {
    if (this.props.status !== 'collected') {
      throw new DomainError('donation_state', `A ${this.props.status} donation is not screened again`);
    }
    for (const screen of SCREENS) this.props[screen] = results[screen];
    const positive = SCREENS.filter((screen) => results[screen] === 'positive');
    this.props.status = positive.length > 0 ? 'discarded' : 'screened';
    this.props.discardReason = positive.length > 0 ? `Reactive: ${positive.join(', ')}` : null;
    this.props.screenedBy = by;
    this.props.screenedAt = at;
    this.touch(at);
    return positive;
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_donation', 'The donation was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<DonationProps> {
    return { ...this.props };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export type UnitStatus = 'quarantine' | 'available' | 'reserved' | 'issued' | 'discarded';

export interface UnitProps {
  id: string;
  unitNumber: string;
  donationId: string;
  componentTypeId: string;
  bloodGroup: BloodGroup;
  preparedOn: string;
  expiresOn: string;
  status: UnitStatus;
  requestId: string | null;
  discardReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * New (the old system kept bags, not units): one unit of a component of a donation, kept in quarantine until the donation is screened
 * clear, then cross-matched and kept for a patient's request, and given. Out of date, it is never cross-matched or
 * given.
 */
export class BloodUnit {
  private constructor(private readonly props: UnitProps) {}

  static prepare(params: {
    id: string;
    unitNumber: string;
    donation: Donation;
    componentTypeId: string;
    shelfDays: number;
    on: string;
    at: Date;
  }): BloodUnit {
    if (params.donation.status === 'discarded') {
      throw new DomainError('donation_state', 'A discarded donation is not split');
    }
    return new BloodUnit({
      id: params.id,
      unitNumber: params.unitNumber,
      donationId: params.donation.id,
      componentTypeId: params.componentTypeId,
      bloodGroup: params.donation.bloodGroup,
      preparedOn: params.on,
      expiresOn: addDays(params.donation.donatedOn, params.shelfDays),
      status: params.donation.status === 'screened' ? 'available' : 'quarantine',
      requestId: null,
      discardReason: null,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: UnitProps): BloodUnit {
    return new BloodUnit({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get unitNumber(): string {
    return this.props.unitNumber;
  }
  get status(): UnitStatus {
    return this.props.status;
  }
  get bloodGroup(): BloodGroup {
    return this.props.bloodGroup;
  }
  get componentTypeId(): string {
    return this.props.componentTypeId;
  }
  get requestId(): string | null {
    return this.props.requestId;
  }

  /** The donation screened clear: the unit may be used. */
  release(at: Date): void {
    if (this.props.status === 'quarantine') {
      this.props.status = 'available';
      this.touch(at);
    }
  }

  discard(reason: string, at: Date): void {
    if (this.props.status === 'issued') throw new DomainError('unit_state', 'An issued unit is not discarded');
    if (this.props.status === 'discarded') return;
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.status = 'discarded';
    this.props.discardReason = why;
    this.props.requestId = null;
    this.touch(at);
  }

  /** Cross-matched compatible: kept for the request. */
  reserve(requestId: string, on: string, at: Date): void {
    this.assertUsable(on);
    if (this.props.status !== 'available') {
      throw new ConflictError('unit_unavailable', `Unit ${this.props.unitNumber} is ${this.props.status}`);
    }
    this.props.status = 'reserved';
    this.props.requestId = requestId;
    this.touch(at);
  }

  /** The request was cancelled: back to the stock. */
  unreserve(at: Date): void {
    if (this.props.status !== 'reserved') return;
    this.props.status = 'available';
    this.props.requestId = null;
    this.touch(at);
  }

  /** Given to the patient of the request it is kept for. */
  issue(requestId: string, on: string, at: Date): void {
    this.assertUsable(on);
    if (this.props.status !== 'reserved' || this.props.requestId !== requestId) {
      throw new DomainError('not_crossmatched', `Unit ${this.props.unitNumber} is not cross-matched for this request`);
    }
    this.props.status = 'issued';
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_unit', 'The unit was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<UnitProps> {
    return { ...this.props };
  }

  private assertUsable(on: string): void {
    if (this.props.expiresOn < on) {
      throw new DomainError('unit_expired', `Unit ${this.props.unitNumber} expired on ${this.props.expiresOn}`);
    }
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export interface RequestProps {
  id: string;
  number: string;
  patientId: string;
  admissionId: string | null;
  billId: string | null;
  componentTypeId: string;
  units: number;
  bloodGroup: BloodGroup;
  reason: string | null;
  requestedOn: string;
  status: 'open' | 'fulfilled' | 'cancelled';
  requestedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old cross-matching request: a patient's need of units of a component, for a stay (charged to it) or on a diagnostic
 * bill (paid there). It is fulfilled when every unit is given, or cancelled.
 */
export class BloodRequest {
  private constructor(private readonly props: RequestProps) {}

  static open(
    params: Omit<RequestProps, 'status' | 'version' | 'createdAt' | 'updatedAt' | 'reason'> & {
      reason: string | null;
      at: Date;
    },
  ): BloodRequest {
    if (!Number.isInteger(params.units) || params.units < 1 || params.units > 20) {
      throw new DomainError('invalid_units', 'A request is for 1 to 20 units');
    }
    if ((params.admissionId === null) === (params.billId === null)) {
      throw new DomainError('invalid_payer', 'A request is for a stay or on a diagnostic bill');
    }
    const { at, ...rest } = params;
    return new BloodRequest({
      ...rest,
      reason: text(params.reason, 300, 'reason'),
      status: 'open',
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
  }

  static restore(props: RequestProps): BloodRequest {
    return new BloodRequest({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get patientId(): string {
    return this.props.patientId;
  }
  get admissionId(): string | null {
    return this.props.admissionId;
  }
  get componentTypeId(): string {
    return this.props.componentTypeId;
  }
  get bloodGroup(): BloodGroup {
    return this.props.bloodGroup;
  }
  get units(): number {
    return this.props.units;
  }
  get status(): RequestProps['status'] {
    return this.props.status;
  }

  assertOpen(): void {
    if (this.props.status !== 'open') throw new DomainError('request_state', `The request is ${this.props.status}`);
  }

  /** A unit given: fulfilled once all are. */
  issued(count: number, at: Date): void {
    this.assertOpen();
    if (count >= this.props.units) this.props.status = 'fulfilled';
    this.touch(at);
  }

  cancel(at: Date): void {
    this.assertOpen();
    this.props.status = 'cancelled';
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_request', 'The request was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<RequestProps> {
    return { ...this.props };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}
