import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { DiagnosticOrders } from '../../../shared/application/contracts/diagnostic-orders.js';
import { InpatientRegister } from '../../../shared/application/contracts/inpatient-register.js';
import { LedgerPosting } from '../../../shared/application/contracts/ledger-posting.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  addDays,
  assertMayDonate,
  BLOOD_GROUPS,
  BloodRequest,
  BloodUnit,
  compatible,
  Donation,
  DONATION_GAP_DAYS,
  text,
  type BloodGroup,
} from '../domain/blood.js';
import { BloodRepository, type ComponentType } from '../domain/repositories.js';
import {
  BB_COLLECT,
  BB_ISSUE,
  BB_MANAGE,
  BB_READ,
  BB_REQUEST,
  BB_SETTINGS,
  BLOOD_BANK_INCOME_ROLE,
  BloodReadRepository,
  CancelRequestCommand,
  CrossmatchCommand,
  DiscardUnitCommand,
  GetDonationQuery,
  GetRequestQuery,
  IPD_BLOOD_ROLE,
  IssueBloodCommand,
  ListDonorsQuery,
  ListRequestsQuery,
  ListUnitsQuery,
  PrepareComponentsCommand,
  RegisterDonorCommand,
  RequestBloodCommand,
  ScreenDonationCommand,
  TakeDonationCommand,
  type BloodBankSettings,
} from './blood.messages.js';

/** A donor after a reactive screen gives no more. */
const NEVER = '9999-12-31';

@Injectable()
export class BloodDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly posting: LedgerPosting,
    readonly blood: BloodRepository,
    readonly read: BloodReadRepository,
    readonly patients: PatientDirectory,
    readonly inpatients: InpatientRegister,
    readonly orders: DiagnosticOrders,
    @Inject(BB_SETTINGS) readonly settings: BloodBankSettings,
  ) {}

  today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
  }

  async number(kind: 'DN' | 'BB' | 'BR' | 'BI', on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return `${kind}-${year}-${String(await this.blood.nextSerial(kind, year)).padStart(5, '0')}`;
  }

  record(
    type: string,
    action: string,
    actor: Actor,
    id: string,
    metadata: Record<string, string | number | null> = {},
  ) {
    return this.audit.record({
      action: `blood_bank.${type}_${action}`,
      actorUserId: actor.userId,
      resourceType: type,
      resourceId: id,
      metadata,
    });
  }

  async componentType(id: string): Promise<ComponentType> {
    const type = (await this.blood.componentTypes([id])).get(id);
    if (!type) throw new NotFoundError('component_type');
    return type;
  }
}

/** Old Blood Donors page: who gives blood, with their group. */
@CommandHandler(RegisterDonorCommand)
export class RegisterDonorHandler implements ICommandHandler<RegisterDonorCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, input }: RegisterDonorCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_COLLECT] });
    const fullName = text(input.fullName, 150, 'name');
    if (!fullName) throw new DomainError('invalid_name', "Give the donor's name");
    if (!BLOOD_GROUPS.includes(input.bloodGroup)) throw new DomainError('invalid_group', 'Give a blood group');
    const today = desk.today();
    if (input.dateOfBirth > today) throw new DomainError('invalid_date', 'The donor is not born yet');
    return desk.tx.run(async () => {
      const id = randomUUID();
      const number = await desk.number('DN', today);
      await desk.blood.insertDonor({
        id,
        number,
        fullName,
        sex: input.sex,
        dateOfBirth: input.dateOfBirth,
        bloodGroup: input.bloodGroup,
        mobileNo: text(input.mobileNo, 20, 'mobile number'),
        address: text(input.address, 300, 'address'),
        lastDonatedOn: null,
        deferredUntil: null,
        deferReason: null,
        isActive: true,
        version: 1,
      });
      await desk.record('donor', 'registered', actor, id, { number });
      return { id, number };
    });
  }
}

/**
 * Old Donor Contribution: a bag taken from a donor of 18 to 65 who is not deferred; they may give again after
 * 90 days.
 */
@CommandHandler(TakeDonationCommand)
export class TakeDonationHandler implements ICommandHandler<TakeDonationCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, donorId, volumeMl }: TakeDonationCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_COLLECT] });
    return desk.tx.run(async () => {
      const donor = await desk.blood.donorForUpdate(donorId);
      if (!donor) throw new NotFoundError('donor');
      const today = desk.today();
      assertMayDonate(donor, today);
      const age = Math.floor(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${donor.dateOfBirth}T00:00:00Z`)) / (365.25 * 86_400_000),
      );
      if (age < 18 || age > 65) throw new DomainError('donor_age', 'A donor is 18 to 65 years old');
      const donation = Donation.collect({
        id: randomUUID(),
        bagNumber: await desk.number('BB', today),
        donorId,
        donatedOn: today,
        bloodGroup: donor.bloodGroup,
        volumeMl,
        by: actor.userId,
        at: desk.clock.now(),
      });
      await desk.blood.insertDonation(donation);
      await desk.blood.updateDonor({
        ...donor,
        lastDonatedOn: today,
        deferredUntil: addDays(today, DONATION_GAP_DAYS),
        deferReason: 'Donated',
        version: donor.version + 1,
      });
      await desk.record('donation', 'taken', actor, donation.id, { bag: donation.bagNumber, donor: donor.number });
      return { id: donation.id, bagNumber: donation.bagNumber };
    });
  }
}

/**
 * Old Serology Records / Results: the donation screened. A reactive screen throws it and its units away and defers the
 * donor for good; a clear one releases its units from quarantine.
 */
@CommandHandler(ScreenDonationCommand)
export class ScreenDonationHandler implements ICommandHandler<ScreenDonationCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, id, version, results }: ScreenDonationCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_COLLECT] });
    return desk.tx.run(async () => {
      const donation = await desk.blood.donationForUpdate(id);
      if (!donation) throw new NotFoundError('donation');
      donation.assertVersion(version);
      const now = desk.clock.now();
      const positive = donation.screen(results, actor.userId, now);
      const units = await desk.blood.unitsOf(id);
      for (const unit of units) {
        if (positive.length > 0) unit.discard(`Reactive: ${positive.join(', ')}`, now);
        else unit.release(now);
        await desk.blood.updateUnit(unit);
      }
      if (positive.length > 0) {
        const donor = (await desk.blood.donorForUpdate(donation.donorId))!;
        await desk.blood.updateDonor({
          ...donor,
          deferredUntil: NEVER,
          deferReason: `Reactive: ${positive.join(', ')}`,
          version: donor.version + 1,
        });
      }
      await desk.blood.updateDonation(donation);
      await desk.record('donation', 'screened', actor, id, {
        status: donation.status,
        reactive: positive.join(',') || null,
      });
      return { status: donation.status, units: units.length };
    });
  }
}

/** Old Blood Component preparation: the donation split into units, each keeping from the day of donation. */
@CommandHandler(PrepareComponentsCommand)
export class PrepareComponentsHandler implements ICommandHandler<PrepareComponentsCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, donationId, componentTypeIds }: PrepareComponentsCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_COLLECT] });
    if (componentTypeIds.length === 0 || new Set(componentTypeIds).size !== componentTypeIds.length) {
      throw new DomainError('invalid_components', 'Name each component once');
    }
    return desk.tx.run(async () => {
      const donation = await desk.blood.donationForUpdate(donationId);
      if (!donation) throw new NotFoundError('donation');
      const types = await desk.blood.componentTypes(componentTypeIds);
      const existing = new Set((await desk.blood.unitsOf(donationId)).map((unit) => unit.componentTypeId));
      const today = desk.today();
      const now = desk.clock.now();
      const made: { id: string; unitNumber: string }[] = [];
      for (const typeId of componentTypeIds) {
        const type = types.get(typeId);
        if (!type) throw new NotFoundError('component_type');
        if (!type.isActive) throw new DomainError('inactive_component', `${type.name} is not prepared`);
        if (existing.has(typeId)) throw new ConflictError('already_prepared', `${type.name} is prepared already`);
        const unit = BloodUnit.prepare({
          id: randomUUID(),
          unitNumber: `${donation.bagNumber}/${type.code.toUpperCase()}`,
          donation,
          componentTypeId: typeId,
          shelfDays: type.shelfDays,
          on: today,
          at: now,
        });
        await desk.blood.insertUnit(unit);
        made.push({ id: unit.id, unitNumber: unit.unitNumber });
      }
      await desk.record('donation', 'split', actor, donationId, { units: made.length });
      return { units: made };
    });
  }
}

@CommandHandler(DiscardUnitCommand)
export class DiscardUnitHandler implements ICommandHandler<DiscardUnitCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, id, version, reason }: DiscardUnitCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_MANAGE] });
    await desk.tx.run(async () => {
      const unit = await desk.blood.unitForUpdate(id);
      if (!unit) throw new NotFoundError('blood_unit');
      unit.assertVersion(version);
      unit.discard(reason, desk.clock.now());
      await desk.blood.updateUnit(unit);
      await desk.record('blood_unit', 'discarded', actor, id, { unit: unit.unitNumber, reason });
    });
  }
}

/**
 * Old cross-matching request: units of a component for a registered patient whose group is known, for a stay (still
 * in) or on a diagnostic bill of theirs.
 */
@CommandHandler(RequestBloodCommand)
export class RequestBloodHandler implements ICommandHandler<RequestBloodCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, input }: RequestBloodCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_REQUEST] });
    if ((input.admissionId === null) === (input.billNumber === null)) {
      throw new DomainError('invalid_payer', 'A request is for a stay or on a diagnostic bill');
    }
    return desk.tx.run(async () => {
      const patient = (await desk.patients.find([input.patientId])).get(input.patientId);
      if (!patient) throw new NotFoundError('patient');
      if (!patient.isActive) throw new DomainError('patient_state', 'The patient record is not in use');
      if (!patient.bloodGroup) throw new DomainError('blood_group_unknown', "Record the patient's blood group first");
      let billId: string | null = null;
      if (input.admissionId) {
        const [admission] = await desk.inpatients.find([input.admissionId]);
        if (!admission) throw new NotFoundError('admission');
        if (admission.patientId !== patient.id)
          throw new DomainError('admission_mismatch', 'The admission is of another patient');
        if (admission.status !== 'admitted')
          throw new DomainError('admission_state', `Admission ${admission.number} is ${admission.status}`);
      } else if (input.billNumber) {
        const order = await desk.orders.byNumber(input.billNumber);
        if (!order) throw new NotFoundError('diagnostic_bill');
        if (order.patient.id !== patient.id) throw new DomainError('bill_mismatch', 'The bill is of another patient');
        if (!order.tests.some((test) => test.status === 'billed')) {
          throw new DomainError('bill_mismatch', `${order.billNumber} has no test still billed`);
        }
        billId = order.billId;
      }
      const type = await desk.componentType(input.componentTypeId);
      if (!type.isActive) throw new DomainError('inactive_component', `${type.name} is not given`);
      const today = desk.today();
      const request = BloodRequest.open({
        id: randomUUID(),
        number: await desk.number('BR', today),
        patientId: patient.id,
        admissionId: input.admissionId,
        billId,
        componentTypeId: type.id,
        units: input.units,
        bloodGroup: patient.bloodGroup as BloodGroup,
        reason: input.reason,
        requestedOn: today,
        requestedBy: actor.userId,
        at: desk.clock.now(),
      });
      await desk.blood.insertRequest(request);
      await desk.record('blood_request', 'raised', actor, request.id, { number: request.number, units: input.units });
      return { id: request.id, number: request.number };
    });
  }
}

/**
 * Old Cross Matching Records / Results: a unit of the requested component and a group the patient may receive tried
 * against the patient's sample; a compatible one is kept for the request (never more than it asks for).
 */
@CommandHandler(CrossmatchCommand)
export class CrossmatchHandler implements ICommandHandler<CrossmatchCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, requestId, unitId, result, method }: CrossmatchCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_ISSUE] });
    return desk.tx.run(async () => {
      const request = await desk.blood.requestForUpdate(requestId);
      if (!request) throw new NotFoundError('blood_request');
      request.assertOpen();
      const unit = await desk.blood.unitForUpdate(unitId);
      if (!unit) throw new NotFoundError('blood_unit');
      if (unit.componentTypeId !== request.componentTypeId) {
        throw new DomainError('wrong_component', `Unit ${unit.unitNumber} is not the component asked for`);
      }
      const type = await desk.componentType(unit.componentTypeId);
      if (!compatible(unit.bloodGroup, request.bloodGroup, type.compatibility)) {
        throw new DomainError(
          'incompatible_group',
          `${unit.bloodGroup} ${type.name} is not given to a ${request.bloodGroup} patient`,
        );
      }
      const now = desk.clock.now();
      if (result === 'compatible') {
        const kept = (await desk.blood.reservedFor(requestId)).length + (await desk.blood.issuedCount(requestId));
        if (kept >= request.units) throw new ConflictError('enough_units', 'The request has all its units already');
        unit.reserve(requestId, desk.today(), now);
        await desk.blood.updateUnit(unit);
      }
      await desk.blood.addCrossmatch({
        requestId,
        unitId,
        result,
        method: text(method, 100, 'method'),
        doneBy: actor.userId,
        doneAt: now,
      });
      await desk.record('blood_request', 'crossmatched', actor, requestId, { unit: unit.unitNumber, result });
      return { result };
    });
  }
}

/**
 * New (the old system recorded no issue): a unit cross-matched for the request given to the patient. For a stay (still in and not billed) it
 * is charged at the component's rate: Dr blood charged to stays / Cr blood bank income, until the final bill takes
 * it. On a diagnostic bill it was paid there.
 */
@CommandHandler(IssueBloodCommand)
export class IssueBloodHandler implements ICommandHandler<IssueBloodCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, requestId, unitId }: IssueBloodCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_ISSUE] });
    return desk.tx.run(async () => {
      const request = await desk.blood.requestForUpdate(requestId);
      if (!request) throw new NotFoundError('blood_request');
      request.assertOpen();
      const today = desk.today();
      if (request.admissionId) {
        const admission = await desk.inpatients.lockForCharge(request.admissionId);
        if (!admission || admission.status !== 'admitted') {
          throw new DomainError('admission_state', 'The patient is no longer in');
        }
        if (admission.billed) {
          throw new ConflictError(
            'bill_made',
            `The final bill of ${admission.number} is made; it must be cancelled first`,
          );
        }
      }
      const unit = await desk.blood.unitForUpdate(unitId);
      if (!unit) throw new NotFoundError('blood_unit');
      const now = desk.clock.now();
      unit.issue(requestId, today, now);
      const type = await desk.componentType(unit.componentTypeId);
      const amount = request.admissionId ? type.rate : 0;
      const id = randomUUID();
      const number = await desk.number('BI', today);
      const narration = `Blood ${unit.unitNumber} issued (${number})`;
      const voucher =
        amount > 0
          ? await desk.posting.post({
              journal: 'JV',
              voucherDate: today,
              narration,
              source: { module: 'blood-bank', reference: id },
              lines: [
                { account: { role: IPD_BLOOD_ROLE }, debit: amount, credit: 0, narration },
                { account: { role: BLOOD_BANK_INCOME_ROLE }, debit: 0, credit: amount, narration },
              ],
              postedBy: actor.userId,
            })
          : null;
      await desk.blood.updateUnit(unit);
      await desk.blood.addIssue({
        id,
        number,
        requestId,
        unitId,
        admissionId: request.admissionId,
        issuedOn: today,
        issuedAt: now,
        amount,
        voucherNumber: voucher?.number ?? null,
        issuedBy: actor.userId,
      });
      request.issued(await desk.blood.issuedCount(requestId), now);
      await desk.blood.updateRequest(request);
      await desk.record('blood_request', 'issued', actor, requestId, { unit: unit.unitNumber, number, amount });
      return { id, number, amount, status: request.status };
    });
  }
}

/** A request not needed any more: its units kept for it go back to the stock. */
@CommandHandler(CancelRequestCommand)
export class CancelRequestHandler implements ICommandHandler<CancelRequestCommand> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, id, version }: CancelRequestCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [BB_REQUEST] });
    return desk.tx.run(async () => {
      const request = await desk.blood.requestForUpdate(id);
      if (!request) throw new NotFoundError('blood_request');
      request.assertVersion(version);
      const now = desk.clock.now();
      request.cancel(now);
      const kept = await desk.blood.reservedFor(id);
      for (const unit of kept) {
        unit.unreserve(now);
        await desk.blood.updateUnit(unit);
      }
      await desk.blood.updateRequest(request);
      await desk.record('blood_request', 'cancelled', actor, id, { released: kept.length });
      return { released: kept.length };
    });
  }
}

@QueryHandler(ListDonorsQuery)
export class ListDonorsHandler implements IQueryHandler<ListDonorsQuery> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, filter }: ListDonorsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [BB_READ] });
    return this.desk.read.donors(filter);
  }
}

@QueryHandler(GetDonationQuery)
export class GetDonationHandler implements IQueryHandler<GetDonationQuery> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, id }: GetDonationQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [BB_READ] });
    const donation = await this.desk.read.donation(id);
    if (!donation) throw new NotFoundError('donation');
    return donation;
  }
}

@QueryHandler(ListUnitsQuery)
export class ListUnitsHandler implements IQueryHandler<ListUnitsQuery> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, filter }: ListUnitsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [BB_READ] });
    return this.desk.read.units(filter);
  }
}

@QueryHandler(ListRequestsQuery)
export class ListRequestsHandler implements IQueryHandler<ListRequestsQuery> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, filter }: ListRequestsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [BB_READ] });
    return this.desk.read.requests(filter);
  }
}

@QueryHandler(GetRequestQuery)
export class GetRequestHandler implements IQueryHandler<GetRequestQuery> {
  constructor(private readonly desk: BloodDesk) {}

  async execute({ actor, id }: GetRequestQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [BB_READ] });
    const request = await this.desk.read.request(id);
    if (!request) throw new NotFoundError('blood_request');
    return request;
  }
}

export const BLOOD_HANDLERS = [
  BloodDesk,
  RegisterDonorHandler,
  TakeDonationHandler,
  ScreenDonationHandler,
  PrepareComponentsHandler,
  DiscardUnitHandler,
  RequestBloodHandler,
  CrossmatchHandler,
  IssueBloodHandler,
  CancelRequestHandler,
  ListDonorsHandler,
  GetDonationHandler,
  ListUnitsHandler,
  ListRequestsHandler,
  GetRequestHandler,
];
