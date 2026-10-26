import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { LocationDirectory } from '../../../shared/application/contracts/location-directory.js';
import { OrganizationProfile } from '../../../shared/application/contracts/organization-profile.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { checkedUpload } from '../../../shared/domain/uploads.js';
import {
  ageOn,
  normalMobile,
  parseUhid,
  Patient,
  patientDetails,
  uhidLabel,
  uhidOf,
  type PatientDetails,
  type PatientInput,
} from '../domain/patient.js';
import { PatientRepository } from '../domain/repositories.js';
import {
  ChangePatientCommand,
  DeactivatePatientCommand,
  FindPatientMatchesQuery,
  GetPatientByUhidQuery,
  GetPatientPhotoQuery,
  GetPatientQuery,
  ListPatientsQuery,
  PATIENT_MANAGE,
  PATIENT_READ,
  PATIENT_REGISTER,
  PatientReadRepository,
  ReactivatePatientCommand,
  RegisterPatientCommand,
  RemovePatientPhotoCommand,
  SetPatientPhotoCommand,
} from './patient.messages.js';

export const HOSPITAL_SETTINGS = Symbol('HOSPITAL_SETTINGS');
export interface HospitalSettings {
  readonly timeZone: string;
}

const MAX_PHOTO_BYTES = 1024 * 1024;

/** The calendar day of an instant in a time zone. */
export const localToday = (now: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

@Injectable()
export class PatientDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly patients: PatientRepository,
    readonly read: PatientReadRepository,
    readonly locations: LocationDirectory,
    readonly organization: OrganizationProfile,
    @Inject(HOSPITAL_SETTINGS) readonly settings: HospitalSettings,
  ) {}

  today(): string {
    return localToday(this.clock.now(), this.settings.timeZone);
  }

  record(
    action: string,
    actor: Actor,
    id: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    return this.audit.record({
      action: `hospital.patient_${action}`,
      actorUserId: actor.userId,
      resourceType: 'patient',
      resourceId: id,
      metadata,
    });
  }

  async patient(id: string, version?: number): Promise<Patient> {
    const patient = await this.patients.findForUpdate(id);
    if (!patient) throw new NotFoundError('patient');
    if (version !== undefined) patient.assertVersion(version);
    return patient;
  }

  /** The details checked, with a district that exists and an ID document no other active patient holds. */
  async details(input: PatientInput, excludeId?: string): Promise<PatientDetails> {
    const details = patientDetails(input, this.today());
    if (details.corporateClientId && !(await this.patients.corporateClientActive(details.corporateClientId))) {
      throw new DomainError('inactive_client', 'The corporate client does not exist or is not active');
    }
    if (details.districtId && !(await this.locations.districtNames([details.districtId])).has(details.districtId)) {
      throw new NotFoundError('district');
    }
    await this.assertIdFree(details, excludeId);
    return details;
  }

  async assertIdFree(details: Pick<PatientDetails, 'idType' | 'idNo'>, excludeId?: string): Promise<void> {
    if (!details.idType || !details.idNo) return;
    const holder = await this.patients.holderOf(details.idType, details.idNo, excludeId);
    if (holder !== null) {
      throw new ConflictError('duplicate_id_document', `UHID ${holder} is registered with this ID document`);
    }
  }
}

/**
 * Old AddEditRegRecordCommand (new) with GetUniqueNumberQuery: the UHID is taken in the same transaction as the
 * record, so a failed registration uses no number. Unlike the old page, a patient on the same mobile with the same
 * name or date of birth is not registered again unless the counter confirms it is someone else.
 */
@CommandHandler(RegisterPatientCommand)
export class RegisterPatientHandler implements ICommandHandler<RegisterPatientCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, input, allowDuplicate }: RegisterPatientCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_REGISTER] });
    return desk.tx.run(async () => {
      const details = await desk.details(input);
      if (!allowDuplicate) {
        const phone = (details.mobileNo ?? details.contactMobileNo)!;
        const matches = await desk.patients.possibleDuplicates({ ...details, phone });
        if (matches.length > 0) {
          throw new ConflictError(
            'possible_duplicate',
            `Possibly registered already: ${matches.map((match) => `UHID ${match.uhid} ${match.fullName}`).join(', ')}`,
          );
        }
      }
      const today = desk.today();
      const year = Number(today.slice(0, 4));
      const patient = Patient.register({
        id: randomUUID(),
        uhid: uhidOf(year, await desk.patients.nextSerial(year)),
        details,
        registeredOn: today,
        by: actor.userId,
        now: desk.clock.now(),
      });
      await desk.patients.insert(patient);
      await desk.record('registered', actor, patient.id, { uhid: patient.uhid, duplicateConfirmed: allowDuplicate });
      return { id: patient.id, uhid: patient.uhid };
    });
  }
}

/** Old AddEditRegRecordCommand (edit): every detail replaced at once, so nothing is kept by accident. */
@CommandHandler(ChangePatientCommand)
export class ChangePatientHandler implements ICommandHandler<ChangePatientCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id, version, input }: ChangePatientCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_REGISTER] });
    await desk.tx.run(async () => {
      const patient = await desk.patient(id, version);
      patient.change(await desk.details(input, id), desk.clock.now());
      await desk.patients.update(patient);
      await desk.record('changed', actor, id, { uhid: patient.uhid });
    });
  }
}

@CommandHandler(DeactivatePatientCommand)
export class DeactivatePatientHandler implements ICommandHandler<DeactivatePatientCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id, version, reason }: DeactivatePatientCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_MANAGE] });
    await desk.tx.run(async () => {
      const patient = await desk.patient(id, version);
      patient.deactivate(reason, desk.clock.now());
      await desk.patients.update(patient);
      await desk.record('deactivated', actor, id, { uhid: patient.uhid, reason });
    });
  }
}

@CommandHandler(ReactivatePatientCommand)
export class ReactivatePatientHandler implements ICommandHandler<ReactivatePatientCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id, version }: ReactivatePatientCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_MANAGE] });
    await desk.tx.run(async () => {
      const patient = await desk.patient(id, version);
      await desk.assertIdFree(patient.toSnapshot(), id);
      patient.reactivate(desk.clock.now());
      await desk.patients.update(patient);
      await desk.record('reactivated', actor, id, { uhid: patient.uhid });
    });
  }
}

/** Old AddEditMemberPictureCommand (jpg only, keyed by UHID): PNG, JPEG or WebP up to 1 MiB. */
@CommandHandler(SetPatientPhotoCommand)
export class SetPatientPhotoHandler implements ICommandHandler<SetPatientPhotoCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id, contentType, data }: SetPatientPhotoCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_REGISTER] });
    const photo = checkedUpload(
      contentType,
      data,
      MAX_PHOTO_BYTES,
      ['image/png', 'image/jpeg', 'image/webp'],
      'A photo',
    );
    await desk.tx.run(async () => {
      const patient = await desk.patient(id);
      if (!patient.isActive) throw new DomainError('patient_state', 'An inactive patient cannot be changed');
      await desk.patients.savePhoto(id, photo, actor.userId, desk.clock.now());
      await desk.record('photo_set', actor, id, { contentType: photo.contentType, bytes: photo.data.length });
    });
  }
}

@CommandHandler(RemovePatientPhotoCommand)
export class RemovePatientPhotoHandler implements ICommandHandler<RemovePatientPhotoCommand> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id }: RemovePatientPhotoCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_REGISTER] });
    await desk.tx.run(async () => {
      await desk.patient(id);
      if (!(await desk.patients.removePhoto(id))) throw new NotFoundError('patient_photo');
      await desk.record('photo_removed', actor, id);
    });
  }
}

/** Old patient list and search (by UHID, by mobile; the name search was on the page only). */
@QueryHandler(ListPatientsQuery)
export class ListPatientsHandler implements IQueryHandler<ListPatientsQuery> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, filter }: ListPatientsQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PATIENT_READ] });
    const page = await desk.read.list({ ...filter, uhid: filter.q ? parseUhid(filter.q) : null });
    const today = desk.today();
    const prefix = await desk.organization.patientIdPrefix();
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        age: ageOn(item.dateOfBirth, today),
        uhidLabel: uhidLabel(prefix, item.uhid),
      })),
    };
  }
}

async function shown(desk: PatientDesk, id: string | null) {
  const patient = id ? await desk.read.get(id) : null;
  if (!patient) throw new NotFoundError('patient');
  const districtName = patient.districtId
    ? ((await desk.locations.districtNames([patient.districtId])).get(patient.districtId) ?? null)
    : null;
  return {
    ...patient,
    districtName,
    age: ageOn(patient.dateOfBirth, desk.today()),
    uhidLabel: uhidLabel(await desk.organization.patientIdPrefix(), patient.uhid),
  };
}

@QueryHandler(GetPatientQuery)
export class GetPatientHandler implements IQueryHandler<GetPatientQuery> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id }: GetPatientQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [PATIENT_READ] });
    return shown(this.desk, id);
  }
}

/** Old GetRegRecordByRegNoIdQuery: the patient of a UHID, as typed or scanned from the card. */
@QueryHandler(GetPatientByUhidQuery)
export class GetPatientByUhidHandler implements IQueryHandler<GetPatientByUhidQuery> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, uhid }: GetPatientByUhidQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [PATIENT_READ] });
    const number = parseUhid(uhid);
    return shown(this.desk, number === null ? null : await this.desk.read.idOfUhid(number));
  }
}

@QueryHandler(FindPatientMatchesQuery)
export class FindPatientMatchesHandler implements IQueryHandler<FindPatientMatchesQuery> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, mobileNo, fullName, dateOfBirth }: FindPatientMatchesQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [PATIENT_READ] });
    return this.desk.patients.possibleDuplicates({ phone: normalMobile(mobileNo), fullName, dateOfBirth });
  }
}

@QueryHandler(GetPatientPhotoQuery)
export class GetPatientPhotoHandler implements IQueryHandler<GetPatientPhotoQuery> {
  constructor(private readonly desk: PatientDesk) {}

  async execute({ actor, id }: GetPatientPhotoQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [PATIENT_READ] });
    const photo = await this.desk.read.photo(id);
    if (!photo) throw new NotFoundError('patient_photo');
    return photo;
  }
}

export const PATIENT_HANDLERS = [
  PatientDesk,
  RegisterPatientHandler,
  ChangePatientHandler,
  DeactivatePatientHandler,
  ReactivatePatientHandler,
  SetPatientPhotoHandler,
  RemovePatientPhotoHandler,
  ListPatientsHandler,
  GetPatientHandler,
  GetPatientByUhidHandler,
  FindPatientMatchesHandler,
  GetPatientPhotoHandler,
];
