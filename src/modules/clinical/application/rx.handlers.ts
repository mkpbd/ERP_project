import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { DiagnosticOrders } from '../../../shared/application/contracts/diagnostic-orders.js';
import { MedicineCatalogue } from '../../../shared/application/contracts/medicine-catalogue.js';
import { OutpatientClinic, type ClinicDoctor } from '../../../shared/application/contracts/outpatient-clinic.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  bmi,
  checkedTemplate,
  Prescription,
  text,
  type DrugLine,
  type TemplateProps,
  type TestLine,
} from '../domain/prescription.js';
import { ClinicalRepository, type Phrase } from '../domain/repositories.js';
import {
  CancelPrescriptionCommand,
  ClinicalReadRepository,
  CLINICAL_SETTINGS,
  CreatePhraseCommand,
  CreateTemplateCommand,
  DeletePhraseCommand,
  DeleteTemplateCommand,
  GetPrescriptionQuery,
  GetTemplateQuery,
  ListPhrasesQuery,
  ListPrescriptionsQuery,
  ListTemplatesQuery,
  OpenPrescriptionCommand,
  RecordVitalsCommand,
  ReopenPrescriptionCommand,
  RX_MANAGE,
  RX_READ,
  RX_VITALS,
  RX_WRITE,
  SearchMedicinesQuery,
  SearchTestsQuery,
  SignPrescriptionCommand,
  UpdatePhraseCommand,
  UpdateTemplateCommand,
  WritePrescriptionCommand,
  type ClinicalSettings,
  type DrugInput,
  type TestInput,
} from './rx.messages.js';

const SEARCH_LIMIT = 30;

@Injectable()
export class ClinicDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly clinical: ClinicalRepository,
    readonly read: ClinicalReadRepository,
    readonly clinic: OutpatientClinic,
    readonly patients: PatientDirectory,
    readonly medicines: MedicineCatalogue,
    readonly orders: DiagnosticOrders,
    @Inject(CLINICAL_SETTINGS) readonly settings: ClinicalSettings,
  ) {}

  today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
  }

  async number(on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return `RX-${year}-${String(await this.clinical.nextSerial('RX', year)).padStart(5, '0')}`;
  }

  /** The active doctor the actor signs in as, or null. */
  async doctorOf(actor: Actor): Promise<ClinicDoctor | null> {
    const doctor = await this.clinic.doctorOfUser(actor.userId);
    return doctor?.isActive ? doctor : null;
  }

  /** The doctor the actor signs in as; rx:write is theirs only. */
  async actingDoctor(actor: Actor): Promise<ClinicDoctor> {
    await this.access.authorize(actor.userId, { permissions: [RX_WRITE] });
    const doctor = await this.doctorOf(actor);
    if (!doctor) throw new ForbiddenError('not_a_doctor', 'Your user account is not an active doctor’s');
    return doctor;
  }

  /** The assistant (rx:vitals) for any doctor, or the doctor of the prescription themself. */
  async assertAssists(actor: Actor, doctorId: string): Promise<void> {
    if (await this.access.isAllowed(actor.userId, { permissions: [RX_VITALS] })) return;
    const doctor = await this.actingDoctor(actor);
    if (doctor.id !== doctorId) throw new ForbiddenError('not_your_patient', 'This is another doctor’s patient');
  }

  async own(actor: Actor, id: string, version: number): Promise<Prescription> {
    const doctor = await this.actingDoctor(actor);
    const rx = await this.clinical.forUpdate(id);
    if (!rx) throw new NotFoundError('prescription');
    if (rx.doctorId !== doctor.id) throw new ForbiddenError('not_your_patient', 'This is another doctor’s patient');
    rx.assertVersion(version);
    return rx;
  }

  /** Medicines named from the catalogue (or as written), tests from the diagnostic catalogue. */
  async lines(
    drugs: readonly DrugInput[],
    tests: readonly TestInput[],
  ): Promise<{ drugs: DrugLine[]; tests: TestLine[] }> {
    const products = await this.medicines.find(drugs.flatMap((drug) => (drug.productId ? [drug.productId] : [])));
    const catalogue = await this.orders.tests(tests.flatMap((test) => (test.testId ? [test.testId] : [])));
    return {
      drugs: drugs.map((drug) => {
        if (!drug.productId) return { ...drug, name: drug.name ?? '' };
        const product = products.get(drug.productId);
        if (!product) throw new NotFoundError('medicine');
        return { ...drug, name: product.name };
      }),
      tests: tests.map((test) => {
        if (!test.testId) return { ...test, name: test.name ?? '' };
        const found = catalogue.get(test.testId);
        if (!found) throw new NotFoundError('diagnostic_test');
        return { ...test, name: found.name };
      }),
    };
  }

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.audit.record({
      action: `clinical.prescription_${action}`,
      actorUserId: actor.userId,
      resourceType: 'prescription',
      resourceId: id,
      metadata,
    });
  }
}

/**
 * Old appointment → VisitHistory (RxNo, VisitNo): a visit opened for the doctor, from a chamber appointment of today
 * (one prescription per appointment) or for a registered patient seen without one (old RxType 2).
 */
@CommandHandler(OpenPrescriptionCommand)
export class OpenPrescriptionHandler implements ICommandHandler<OpenPrescriptionCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, input }: OpenPrescriptionCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [RX_VITALS, RX_WRITE], mode: 'any' });
    const today = desk.today();
    let { patientId, doctorId } = input;
    if (input.appointmentId) {
      if (patientId || doctorId) {
        throw new DomainError('invalid_visit', 'A visit is opened from an appointment or for a patient and doctor');
      }
      const appointment = await desk.clinic.appointment(input.appointmentId);
      if (!appointment) throw new NotFoundError('appointment');
      if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
        throw new DomainError('appointment_state', `The appointment is ${appointment.status.replace('_', '-')}`);
      }
      if (appointment.appointmentDate !== today) {
        throw new DomainError('appointment_day', `The appointment is for ${appointment.appointmentDate}`);
      }
      if (!appointment.patientId) {
        throw new DomainError('patient_unregistered', 'Register the patient and attach them to the appointment first');
      }
      patientId = appointment.patientId;
      doctorId = appointment.doctorId;
    } else if (!patientId || !doctorId) {
      throw new DomainError('invalid_visit', 'A visit is opened from an appointment or for a patient and doctor');
    }
    await desk.assertAssists(actor, doctorId);
    const doctor = (await desk.clinic.doctors([doctorId])).get(doctorId);
    if (!doctor) throw new NotFoundError('doctor');
    if (!doctor.isActive) throw new DomainError('doctor_inactive', `${doctor.name} is not active`);
    const patient = (await desk.patients.find([patientId])).get(patientId);
    if (!patient) throw new NotFoundError('patient');
    if (!patient.isActive) throw new DomainError('patient_state', 'The patient record is not in use');
    return desk.tx.run(async () => {
      if (input.appointmentId) {
        await desk.tx.lock(`clinical:appointment:${input.appointmentId}`);
        const existing = await desk.clinical.ofAppointment(input.appointmentId);
        if (existing) {
          throw new ConflictError('visit_open', `Prescription ${existing.number} is open for this appointment`);
        }
      }
      await desk.tx.lock(`clinical:visits:${patient.id}:${doctor.id}`);
      const rx = Prescription.open({
        id: randomUUID(),
        number: await desk.number(today),
        patientId: patient.id,
        doctorId: doctor.id,
        appointmentId: input.appointmentId,
        visitNo: (await desk.clinical.visitCount(patient.id, doctor.id)) + 1,
        visitOn: today,
        by: actor.userId,
        at: desk.clock.now(),
      });
      await desk.clinical.insert(rx);
      await desk.record('opened', actor, rx.id, { number: rx.number });
      return { id: rx.id, number: rx.number };
    });
  }
}

/** Old InitialData vitals, taken by the doctor's assistant (or the doctor) before the doctor writes. */
@CommandHandler(RecordVitalsCommand)
export class RecordVitalsHandler implements ICommandHandler<RecordVitalsCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version, vitals }: RecordVitalsCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [RX_VITALS, RX_WRITE], mode: 'any' });
    return desk.tx.run(async () => {
      const rx = await desk.clinical.forUpdate(id);
      if (!rx) throw new NotFoundError('prescription');
      await desk.assertAssists(actor, rx.doctorId);
      rx.assertVersion(version);
      rx.recordVitals(vitals, actor.userId, desk.clock.now());
      await desk.clinical.update(rx);
      return { version: rx.toSnapshot().version };
    });
  }
}

/** The doctor's prescription: complaints, history, examination, diagnosis, medicines, tests, advice, follow-up. */
@CommandHandler(WritePrescriptionCommand)
export class WritePrescriptionHandler implements ICommandHandler<WritePrescriptionCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version, content }: WritePrescriptionCommand) {
    const { desk } = this;
    const lines = await desk.lines(content.drugs, content.tests);
    return desk.tx.run(async () => {
      const rx = await desk.own(actor, id, version);
      rx.write({ ...content, ...lines }, desk.clock.now());
      await desk.clinical.update(rx);
      return { version: rx.toSnapshot().version };
    });
  }
}

@CommandHandler(SignPrescriptionCommand)
export class SignPrescriptionHandler implements ICommandHandler<SignPrescriptionCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version }: SignPrescriptionCommand) {
    const { desk } = this;
    return desk.tx.run(async () => {
      const rx = await desk.own(actor, id, version);
      rx.sign(actor.userId, desk.clock.now());
      await desk.clinical.update(rx);
      await desk.record('signed', actor, rx.id, { number: rx.number });
      return { version: rx.toSnapshot().version };
    });
  }
}

/** A correction of a signed prescription, by its doctor on the visit's day. */
@CommandHandler(ReopenPrescriptionCommand)
export class ReopenPrescriptionHandler implements ICommandHandler<ReopenPrescriptionCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version }: ReopenPrescriptionCommand) {
    const { desk } = this;
    return desk.tx.run(async () => {
      const rx = await desk.own(actor, id, version);
      rx.reopen(desk.today(), desk.clock.now());
      await desk.clinical.update(rx);
      await desk.record('reopened', actor, rx.id, { number: rx.number });
      return { version: rx.toSnapshot().version };
    });
  }
}

@CommandHandler(CancelPrescriptionCommand)
export class CancelPrescriptionHandler implements ICommandHandler<CancelPrescriptionCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version, reason }: CancelPrescriptionCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [RX_VITALS, RX_WRITE], mode: 'any' });
    await desk.tx.run(async () => {
      const rx = await desk.clinical.forUpdate(id);
      if (!rx) throw new NotFoundError('prescription');
      await desk.assertAssists(actor, rx.doctorId);
      rx.assertVersion(version);
      rx.cancel(reason, desk.clock.now());
      await desk.clinical.update(rx);
      await desk.record('cancelled', actor, rx.id, { number: rx.number, reason });
    });
  }
}

/** Old CPId lists: a phrase of the doctor's own (rx:write) or shared by all (rx:manage). */
async function editablePhrase(desk: ClinicDesk, actor: Actor, phrase: Phrase | null): Promise<Phrase> {
  if (!phrase) throw new NotFoundError('phrase');
  if (phrase.doctorId === null) {
    await desk.access.authorize(actor.userId, { permissions: [RX_MANAGE] });
    return phrase;
  }
  const doctor = await desk.actingDoctor(actor);
  if (doctor.id !== phrase.doctorId) throw new NotFoundError('phrase');
  return phrase;
}

function phraseText(value: string, shortKey: string | null) {
  const kept = text(value, 500, 'text');
  if (!kept) throw new DomainError('invalid_text', 'Give the text');
  return { text: kept, shortKey: text(shortKey, 20, 'short key') };
}

@CommandHandler(CreatePhraseCommand)
export class CreatePhraseHandler implements ICommandHandler<CreatePhraseCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, input }: CreatePhraseCommand) {
    const { desk } = this;
    let doctorId: string | null = null;
    if (input.shared) await desk.access.authorize(actor.userId, { permissions: [RX_MANAGE] });
    else doctorId = (await desk.actingDoctor(actor)).id;
    if (input.genericId && input.kind !== 'dose') {
      throw new DomainError('invalid_phrase', 'Only a dose is kept for a generic');
    }
    const phrase: Phrase = {
      id: randomUUID(),
      doctorId,
      kind: input.kind,
      ...phraseText(input.text, input.shortKey),
      genericId: input.genericId,
    };
    await desk.clinical.insertPhrase(phrase);
    return { id: phrase.id };
  }
}

@CommandHandler(UpdatePhraseCommand)
export class UpdatePhraseHandler implements ICommandHandler<UpdatePhraseCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, text: value, shortKey }: UpdatePhraseCommand): Promise<void> {
    const { desk } = this;
    const phrase = await editablePhrase(desk, actor, await desk.clinical.phrase(id));
    await desk.clinical.updatePhrase({ ...phrase, ...phraseText(value, shortKey) });
  }
}

@CommandHandler(DeletePhraseCommand)
export class DeletePhraseHandler implements ICommandHandler<DeletePhraseCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id }: DeletePhraseCommand): Promise<void> {
    const { desk } = this;
    await editablePhrase(desk, actor, await desk.clinical.phrase(id));
    await desk.clinical.deletePhrase(id);
  }
}

async function ownTemplate(desk: ClinicDesk, actor: Actor, id: string): Promise<TemplateProps> {
  const doctor = await desk.actingDoctor(actor);
  const template = await desk.clinical.template(id);
  if (!template || template.doctorId !== doctor.id) throw new NotFoundError('rx_template');
  return template;
}

/** Old DigitalRx presets: the doctor's own sets of medicines, tests and advice. */
@CommandHandler(CreateTemplateCommand)
export class CreateTemplateHandler implements ICommandHandler<CreateTemplateCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, input }: CreateTemplateCommand) {
    const { desk } = this;
    const doctor = await desk.actingDoctor(actor);
    const template: TemplateProps = {
      id: randomUUID(),
      doctorId: doctor.id,
      ...checkedTemplate({ ...input, ...(await desk.lines(input.drugs, input.tests)) }),
      version: 1,
    };
    await desk.clinical.insertTemplate(template);
    return { id: template.id };
  }
}

@CommandHandler(UpdateTemplateCommand)
export class UpdateTemplateHandler implements ICommandHandler<UpdateTemplateCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id, version, input }: UpdateTemplateCommand) {
    const { desk } = this;
    const template = await ownTemplate(desk, actor, id);
    if (template.version !== version) {
      throw new ConflictError('stale_template', 'The template was changed meanwhile; reload it');
    }
    const updated: TemplateProps = {
      ...template,
      ...checkedTemplate({ ...input, ...(await desk.lines(input.drugs, input.tests)) }),
      version: version + 1,
    };
    await desk.clinical.updateTemplate(updated);
    return { version: updated.version };
  }
}

@CommandHandler(DeleteTemplateCommand)
export class DeleteTemplateHandler implements ICommandHandler<DeleteTemplateCommand> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id }: DeleteTemplateCommand): Promise<void> {
    await ownTemplate(this.desk, actor, id);
    await this.desk.clinical.deleteTemplate(id);
  }
}

/** Prescriptions by doctor, patient, day or number; `mine` for the doctor signed in. */
@QueryHandler(ListPrescriptionsQuery)
export class ListPrescriptionsHandler implements IQueryHandler<ListPrescriptionsQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, filter }: ListPrescriptionsQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [RX_READ] });
    const { mine, ...rest } = filter;
    let doctorId = rest.doctorId;
    if (mine) {
      const doctor = await desk.doctorOf(actor);
      if (!doctor) throw new ForbiddenError('not_a_doctor', 'Your user account is not an active doctor’s');
      doctorId = doctor.id;
    }
    const page = await desk.read.prescriptions({ ...rest, doctorId });
    const patients = await desk.patients.find(page.items.map((row) => row.patientId));
    const doctors = await desk.clinic.doctors(page.items.map((row) => row.doctorId));
    return {
      ...page,
      items: page.items.map((row) => ({
        ...row,
        patientName: patients.get(row.patientId)?.name ?? '',
        uhid: patients.get(row.patientId)?.uhid ?? null,
        doctorName: doctors.get(row.doctorId)?.name ?? '',
      })),
    };
  }
}

export async function prescriptionView(desk: ClinicDesk, id: string) {
  const rx = await desk.read.prescription(id);
  if (!rx) throw new NotFoundError('prescription');
  const patient = (await desk.patients.find([rx.patientId])).get(rx.patientId);
  const doctor = (await desk.clinic.doctors([rx.doctorId])).get(rx.doctorId);
  if (!patient || !doctor) throw new NotFoundError('prescription');
  return {
    ...rx,
    patient: {
      id: patient.id,
      uhid: patient.uhid,
      name: patient.name,
      sex: patient.sex,
      dateOfBirth: patient.dateOfBirth,
      bloodGroup: patient.bloodGroup,
    },
    doctor: { id: doctor.id, name: doctor.name, degrees: doctor.degrees, specialityName: doctor.specialityName },
    bmi: bmi(rx),
  };
}

@QueryHandler(GetPrescriptionQuery)
export class GetPrescriptionHandler implements IQueryHandler<GetPrescriptionQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, id }: GetPrescriptionQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [RX_READ] });
    return prescriptionView(this.desk, id);
  }
}

@QueryHandler(ListPhrasesQuery)
export class ListPhrasesHandler implements IQueryHandler<ListPhrasesQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, filter }: ListPhrasesQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [RX_READ] });
    const doctor = await desk.doctorOf(actor);
    return desk.read.phrases(doctor?.id ?? null, filter);
  }
}

@QueryHandler(ListTemplatesQuery)
export class ListTemplatesHandler implements IQueryHandler<ListTemplatesQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor }: ListTemplatesQuery) {
    const doctor = await this.desk.actingDoctor(actor);
    return this.desk.read.templates(doctor.id);
  }
}

@QueryHandler(GetTemplateQuery)
export class GetTemplateHandler implements IQueryHandler<GetTemplateQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  execute({ actor, id }: GetTemplateQuery) {
    return ownTemplate(this.desk, actor, id);
  }
}

@QueryHandler(SearchMedicinesQuery)
export class SearchMedicinesHandler implements IQueryHandler<SearchMedicinesQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, text: value }: SearchMedicinesQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [RX_READ] });
    return this.desk.medicines.search(value, SEARCH_LIMIT);
  }
}

@QueryHandler(SearchTestsQuery)
export class SearchTestsHandler implements IQueryHandler<SearchTestsQuery> {
  constructor(private readonly desk: ClinicDesk) {}

  async execute({ actor, text: value }: SearchTestsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [RX_READ] });
    return this.desk.orders.searchTests(value, SEARCH_LIMIT);
  }
}

export const RX_HANDLERS = [
  ClinicDesk,
  OpenPrescriptionHandler,
  RecordVitalsHandler,
  WritePrescriptionHandler,
  SignPrescriptionHandler,
  ReopenPrescriptionHandler,
  CancelPrescriptionHandler,
  CreatePhraseHandler,
  UpdatePhraseHandler,
  DeletePhraseHandler,
  CreateTemplateHandler,
  UpdateTemplateHandler,
  DeleteTemplateHandler,
  ListPrescriptionsHandler,
  GetPrescriptionHandler,
  ListPhrasesHandler,
  ListTemplatesHandler,
  GetTemplateHandler,
  SearchMedicinesHandler,
  SearchTestsHandler,
];
