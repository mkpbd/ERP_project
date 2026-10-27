import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { Admission } from '../domain/admission.js';
import { validMoney } from '../domain/opd-bill.js';
import { text } from '../domain/patient.js';
import { AdmissionRepository, IpdBillingRepository, type AdmissionBed } from '../domain/repositories.js';
import { IPD_ADVANCE_ROLE, type MoneyInput } from './ipd-billing.messages.js';
import {
  AdmissionReadRepository,
  AdmitPatientCommand,
  ChangeAdmissionCommand,
  GetAdmissionQuery,
  GetBedBoardQuery,
  IPD_ADMIT,
  IPD_MANAGE,
  IPD_READ,
  ListAdmissionsQuery,
  SetBedStatusCommand,
} from './ipd.messages.js';
import { OPD_RECEIPT_ROLES } from './opd.messages.js';
import { OpdDesk } from './opd.handlers.js';

@Injectable()
export class IpdDesk {
  constructor(
    readonly opd: OpdDesk,
    readonly admissions: AdmissionRepository,
    readonly read: AdmissionReadRepository,
    readonly billing: IpdBillingRepository,
  ) {}

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.opd.audit.record({
      action: `hospital.admission_${action}`,
      actorUserId: actor.userId,
      resourceType: 'admission',
      resourceId: id,
      metadata,
    });
  }

  /** A bed a patient can be put in now, locked: active and available. */
  async freeBed(id: string): Promise<AdmissionBed> {
    await this.opd.tx.lock(`hospital:bed:${id}`);
    const bed = await this.admissions.bedForUpdate(id);
    if (!bed) throw new NotFoundError('bed');
    if (!bed.isActive) throw new DomainError('bed_unavailable', `Bed ${bed.code} is not in use`);
    if (bed.status !== 'available') {
      throw new ConflictError('bed_unavailable', `Bed ${bed.code} is ${bed.status.replace('_', ' ')}`);
    }
    return bed;
  }

  /** A bed left goes to housekeeping until it is made ready. */
  async leave(bedId: string): Promise<void> {
    await this.admissions.setBedStatus(bedId, 'housekeeping');
  }

  /**
   * Old AdvancePayments (Payment and Refund rows, no receipt number, posted only for the advance): an advance taken on
   * the admission, or advance held given back, with its receipt and voucher. Only while no bill is in force.
   */
  async moveAdvance(
    admission: { id: string; number: string },
    kind: 'advance' | 'refund',
    money: MoneyInput,
    actor: Actor,
  ): Promise<{ number: string; held: number }> {
    const { opd } = this;
    validMoney(money.amount, 'amount');
    if (money.amount === 0) throw new DomainError('invalid_amount', 'More than nothing');
    const held = await this.billing.received(admission.id);
    if (kind === 'refund' && money.amount > held) {
      throw new DomainError('overpayment', `Only ${held.toFixed(2)} is held`);
    }
    const today = opd.today();
    const number = await opd.number(kind === 'advance' ? 'AR' : 'AF', today);
    const narration = `${kind === 'advance' ? 'Advance on' : 'Advance refunded on'} ${admission.number} (${number})`;
    const cash = { account: { role: OPD_RECEIPT_ROLES[money.method] }, narration };
    const advance = { account: { role: IPD_ADVANCE_ROLE }, narration };
    const voucher = await opd.post(
      narration,
      today,
      admission.id,
      kind === 'advance'
        ? [
            { ...cash, debit: money.amount, credit: 0 },
            { ...advance, debit: 0, credit: money.amount },
          ]
        : [
            { ...advance, debit: money.amount, credit: 0 },
            { ...cash, debit: 0, credit: money.amount },
          ],
      actor,
    );
    await this.billing.addPayment({
      admissionId: admission.id,
      billId: null,
      kind,
      number,
      method: money.method,
      reference: text(money.reference, 100, 'payment reference'),
      amount: money.amount,
      paidOn: today,
      receivedBy: actor.userId,
      voucherNumber: voucher?.number ?? null,
    });
    await this.record(kind === 'advance' ? 'advance_taken' : 'advance_refunded', actor, admission.id, {
      number,
      amount: money.amount,
      method: money.method,
    });
    const after = Math.round(held * 100) + (kind === 'advance' ? 1 : -1) * Math.round(money.amount * 100);
    return { number, held: after / 100 };
  }

  /** Active doctors, by id (any doctor may see an admitted patient; the consultant must see patients here). */
  async doctors(ids: readonly string[]): Promise<void> {
    const found = await this.opd.bills.doctors(ids);
    for (const id of ids) {
      const doctor = found.get(id);
      if (!doctor) throw new NotFoundError('doctor');
      if (!doctor.isActive) throw new DomainError('not_bookable', `${doctor.name} is not active`);
    }
  }
}

/**
 * Old AddEditPatientAdmissionPage OnSubmit (registered the patient before checking the bed, claimed the bed from the
 * page's cached list, never checked for an admission already open): one transaction for a registered patient with no
 * open admission, a free bed taken under a lock, the consultant, the doctors who also see the patient and who pays.
 * An advance may be taken with it.
 */
@CommandHandler(AdmitPatientCommand)
export class AdmitPatientHandler implements ICommandHandler<AdmitPatientCommand> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, input }: AdmitPatientCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [IPD_ADMIT] });
    return opd.tx.run(async () => {
      const patient = await opd.appointments.patientContact(input.patientId);
      if (!patient) throw new NotFoundError('patient');
      await opd.tx.lock(`hospital:admission:${patient.id}`);
      if (await desk.admissions.activeOf(patient.id)) {
        throw new ConflictError('already_admitted', `${patient.fullName} is admitted already`);
      }
      await opd.consultants([input.doctorId]);
      await desk.doctors(input.additionalDoctorIds);
      if (input.referredById && (await opd.bills.doctors([input.referredById])).size === 0) {
        throw new NotFoundError('referring_doctor');
      }
      const payer = await opd.payer(
        input.corporateClientId === undefined && !input.staffId
          ? patient.corporateClientId
          : (input.corporateClientId ?? null),
        input.staffId,
      );
      // A credit client at or over its limit takes no more admissions (the final bill is never refused, so a
      // discharge is never held up by it).
      if (payer.kind === 'corporate' && payer.client.payment === 'credit' && payer.client.creditLimit !== null) {
        const owed = await opd.bills.corporateDue(payer.client.id);
        if (owed >= payer.client.creditLimit) {
          throw new DomainError(
            'credit_limit',
            `${payer.client.name} owes ${owed.toFixed(2)}, at or over its limit of ${payer.client.creditLimit.toFixed(2)}`,
          );
        }
      }
      const bed = await desk.freeBed(input.bedId);
      const now = opd.clock.now();
      const admission = Admission.admit({
        id: randomUUID(),
        number: await opd.number('IP', opd.today()),
        patientId: patient.id,
        kind: input.kind,
        reason: input.reason,
        referredById: input.referredById,
        corporateClientId: payer.payer.kind === 'corporate' ? payer.payer.clientId : null,
        staffId: payer.payer.kind === 'staff' ? payer.payer.staffId : null,
        admissionFee: bed.admissionFee,
        bed,
        doctorId: input.doctorId,
        additionalDoctorIds: input.additionalDoctorIds,
        by: actor.userId,
        at: now,
      });
      await desk.admissions.insert(admission);
      await desk.admissions.setBedStatus(bed.id, 'occupied');
      await opd.bills.addUhidUse({
        patientId: patient.id,
        usedOn: opd.today(),
        service: 'ipd_admission',
        documentNumber: admission.number,
      });
      await desk.record('admitted', actor, admission.id, { number: admission.number, bed: bed.code });
      const advance =
        input.advance && input.advance.amount > 0
          ? await desk.moveAdvance(admission, 'advance', input.advance, actor)
          : null;
      return { id: admission.id, number: admission.number, receipt: advance?.number ?? null };
    });
  }
}

/**
 * Old Cabin Transfer, Assigned Doctor Transfer, admission cancel and the discharge (the final bill being saved): each
 * change on the admission's current version. Cancelling needs ipd:manage.
 *
 * A discharge needs the final bill, made that day; a patient leaving with something of their own still due needs
 * ipd:manage (the old page let it go with a remark). An admission with charges, a bill or advance held is not
 * cancelled (as before: cancel the charges and refund the advance first).
 */
@CommandHandler(ChangeAdmissionCommand)
export class ChangeAdmissionHandler implements ICommandHandler<ChangeAdmissionCommand> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, id, version, change }: ChangeAdmissionCommand): Promise<void> {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [change.kind === 'cancel' ? IPD_MANAGE : IPD_ADMIT] });
    const mayLeaveDue =
      change.kind === 'discharge' && (await opd.access.isAllowed(actor.userId, { permissions: [IPD_MANAGE] }));
    await opd.tx.run(async () => {
      const admission = await desk.admissions.findForUpdate(id);
      if (!admission) throw new NotFoundError('admission');
      admission.assertVersion(version);
      const now = opd.clock.now();
      let metadata: Record<string, string | number | null> = {};
      switch (change.kind) {
        case 'transfer': {
          const bed = await desk.freeBed(change.bedId);
          const left = admission.transfer(bed, change.reason, actor.userId, now);
          await desk.leave(left);
          await desk.admissions.setBedStatus(bed.id, 'occupied');
          metadata = { bed: bed.code, reason: change.reason };
          break;
        }
        case 'consultant':
          await opd.consultants([change.doctorId]);
          admission.changeConsultant(change.doctorId, now);
          metadata = { doctorId: change.doctorId };
          break;
        case 'additional':
          await desk.doctors(change.doctorIds);
          admission.setAdditional(change.doctorIds, now);
          metadata = { doctors: change.doctorIds.length };
          break;
        case 'discharge': {
          const bill = await desk.billing.liveBill(id);
          if (!bill) throw new DomainError('bill_needed', 'Make the final bill first');
          if (bill.billedOn !== opd.today()) {
            throw new ConflictError('stale_bill', `The bill was made on ${bill.billedOn}; cancel it and bill again`);
          }
          if (bill.due > 0 && bill.payer.kind === 'patient' && !mayLeaveDue) {
            throw new ForbiddenError(
              'due_on_discharge',
              `${bill.due.toFixed(2)} is still due; only a manager lets the patient go with it`,
            );
          }
          await desk.leave(admission.discharge({ type: change.type, note: change.note, by: actor.userId, at: now }));
          metadata = { type: change.type, bill: bill.number, due: bill.due };
          break;
        }
        case 'cancel': {
          if (await desk.billing.liveBill(id)) throw new ConflictError('bill_made', 'Cancel the final bill first');
          if ((await desk.billing.activeCharges(id)).length > 0) {
            throw new ConflictError('has_charges', 'Cancel the charges first');
          }
          const held = await desk.billing.received(id);
          if (held > 0) throw new ConflictError('has_advance', `Refund the advance held (${held.toFixed(2)}) first`);
          await desk.leave(admission.cancel(change.reason, actor.userId, now));
          metadata = { reason: change.reason };
          break;
        }
      }
      await desk.admissions.update(admission);
      await desk.record(change.kind === 'discharge' ? 'discharged' : change.kind, actor, id, metadata);
    });
  }
}

/** Old house-keeping dashboard (never reached: nothing set a bed to housekeeping): a bed ready again, or out of order. */
@CommandHandler(SetBedStatusCommand)
export class SetBedStatusHandler implements ICommandHandler<SetBedStatusCommand> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, bedId, status }: SetBedStatusCommand): Promise<void> {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [status === 'out_of_order' ? IPD_MANAGE : IPD_ADMIT] });
    await opd.tx.run(async () => {
      await opd.tx.lock(`hospital:bed:${bedId}`);
      const bed = await desk.admissions.bedForUpdate(bedId);
      if (!bed) throw new NotFoundError('bed');
      if (bed.status === 'occupied') throw new ConflictError('bed_occupied', `Bed ${bed.code} has a patient`);
      await desk.admissions.setBedStatus(bedId, status);
      await opd.audit.record({
        action: 'hospital.bed_status_set',
        actorUserId: actor.userId,
        resourceType: 'bed',
        resourceId: bedId,
        metadata: { from: bed.status, to: status },
      });
    });
  }
}

@QueryHandler(ListAdmissionsQuery)
export class ListAdmissionsHandler implements IQueryHandler<ListAdmissionsQuery> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, filter }: ListAdmissionsQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.desk.read.list(filter);
  }
}

@QueryHandler(GetAdmissionQuery)
export class GetAdmissionHandler implements IQueryHandler<GetAdmissionQuery> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, id }: GetAdmissionQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    const admission = await this.desk.read.get(id);
    if (!admission) throw new NotFoundError('admission');
    return admission;
  }
}

/** Old cabin dashboard and patient list: every bed by ward with who is in it. */
@QueryHandler(GetBedBoardQuery)
export class GetBedBoardHandler implements IQueryHandler<GetBedBoardQuery> {
  constructor(private readonly desk: IpdDesk) {}

  async execute({ actor, wardId }: GetBedBoardQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.desk.read.board(wardId);
  }
}

export const IPD_HANDLERS = [
  IpdDesk,
  AdmitPatientHandler,
  ChangeAdmissionHandler,
  SetBedStatusHandler,
  ListAdmissionsHandler,
  GetAdmissionHandler,
  GetBedBoardHandler,
];
