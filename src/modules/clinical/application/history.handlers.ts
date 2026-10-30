import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { EMR_READ } from './emr.messages.js';
import { GetHistoryRecordQuery, HistoryReadRepository, LabTrendQuery, ListHistoryQuery } from './history.messages.js';

/** The old system's clinical records of a patient (step 13f), read with the EMR's read permission. */
async function patientOf(access: AccessControl, patients: PatientDirectory, actorId: string, patientId: string) {
  await access.authorize(actorId, { permissions: [EMR_READ] });
  if (!(await patients.find([patientId])).has(patientId)) throw new NotFoundError('patient');
}

@QueryHandler(ListHistoryQuery)
export class ListHistoryHandler implements IQueryHandler<ListHistoryQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly patients: PatientDirectory,
    private readonly read: HistoryReadRepository,
  ) {}

  async execute({ actor, patientId, kind }: ListHistoryQuery) {
    await patientOf(this.access, this.patients, actor.userId, patientId);
    return this.read.list(patientId, kind);
  }
}

@QueryHandler(GetHistoryRecordQuery)
export class GetHistoryRecordHandler implements IQueryHandler<GetHistoryRecordQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly read: HistoryReadRepository,
  ) {}

  async execute({ actor, id }: GetHistoryRecordQuery) {
    await this.access.authorize(actor.userId, { permissions: [EMR_READ] });
    const record = await this.read.find(id);
    if (!record) throw new NotFoundError('history_record');
    return record;
  }
}

@QueryHandler(LabTrendQuery)
export class LabTrendHandler implements IQueryHandler<LabTrendQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly patients: PatientDirectory,
    private readonly read: HistoryReadRepository,
  ) {}

  async execute({ actor, patientId, test }: LabTrendQuery) {
    await patientOf(this.access, this.patients, actor.userId, patientId);
    return this.read.trend(patientId, test.trim());
  }
}

export const HISTORY_HANDLERS = [ListHistoryHandler, GetHistoryRecordHandler, LabTrendHandler];
