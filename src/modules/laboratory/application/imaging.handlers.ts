import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ReportingFees } from '../../../shared/application/contracts/reporting-fees.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { accessionNumber, checkedTemplates, ImagingStudy } from '../domain/imaging.js';
import { ImagingRepository } from '../domain/repositories.js';
import {
  ChangeStudyCommand,
  GetImagingTemplatesQuery,
  GetStudyQuery,
  ImagingReadRepository,
  ListStudiesQuery,
  MarkStudyDoneCommand,
  SetImagingTemplatesCommand,
  type StudySummary,
} from './imaging.messages.js';
import { LabDesk } from './lab.handlers.js';
import { ReagentUser } from './reagent-use.js';
import { LAB_MANAGE, LAB_READ, LAB_RESULT, LAB_VERIFY } from './lab.messages.js';

/** What the imaging handlers share on top of the lab desk. */
@Injectable()
export class ImagingDesk {
  constructor(
    readonly lab: LabDesk,
    readonly imaging: ImagingRepository,
    readonly read: ImagingReadRepository,
    readonly fees: ReportingFees,
    readonly reagents: ReagentUser,
  ) {}

  /** The bill, patient and test of each study, and its radiologist's name. */
  async describe<T extends StudySummary>(rows: readonly T[]) {
    const described = await this.lab.withOrders(rows);
    const radiologists = await this.lab.orders.doctors(
      rows.flatMap((row) => (row.radiologistId ? [row.radiologistId] : [])),
    );
    return described.map((row) => ({
      ...row,
      radiologistName: row.radiologistId ? (radiologists.get(row.radiologistId)?.name ?? null) : null,
    }));
  }
}

/** Old Radiology Templates page: an imaging test's usual wordings, the whole list. */
@CommandHandler(SetImagingTemplatesCommand)
export class SetImagingTemplatesHandler implements ICommandHandler<SetImagingTemplatesCommand> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, testId, templates }: SetImagingTemplatesCommand): Promise<void> {
    const { lab, imaging } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_MANAGE] });
    const checked = checkedTemplates(templates);
    const test = (await lab.orders.tests([testId])).get(testId);
    if (!test) throw new NotFoundError('diagnostic_test');
    if (test.departmentKind !== 'imaging') {
      throw new DomainError('not_imaging_test', `${test.name} is not an imaging test`);
    }
    await lab.tx.run(async () => {
      await imaging.setTemplates(testId, checked);
      await lab.record('imaging_templates', 'set', actor, testId, { templates: checked.length });
    });
  }
}

@QueryHandler(GetImagingTemplatesQuery)
export class GetImagingTemplatesHandler implements IQueryHandler<GetImagingTemplatesQuery> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, testId }: GetImagingTemplatesQuery) {
    await this.desk.lab.access.authorize(actor.userId, { permissions: [LAB_READ] });
    return this.desk.imaging.templates(testId);
  }
}

/**
 * Old radiology worklist (the detail's AccessionNumber, SOPInstanceUID and ProcedureStep for the modality worklist): an
 * imaging test of a bill marked done, with an accession number of the day, its report to be written.
 */
@CommandHandler(MarkStudyDoneCommand)
export class MarkStudyDoneHandler implements ICommandHandler<MarkStudyDoneCommand> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, billId, line }: MarkStudyDoneCommand) {
    const { lab, imaging } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_RESULT] });
    return lab.tx.run(async () => {
      await lab.tx.lock(`lab:bill:${billId}`);
      const order = await lab.order(billId);
      const test = order.tests.find((item) => item.line === line);
      if (!test) throw new NotFoundError('test');
      if (test.departmentKind !== 'imaging')
        throw new DomainError('not_imaging_test', `${test.testName} is not imaging`);
      if (test.status !== 'billed') throw new DomainError('test_cancelled', `${test.testName} was cancelled`);
      if (await imaging.studyOfLine(billId, line)) {
        throw new ConflictError('already_done', `${test.testName} of ${order.billNumber} is done already`);
      }
      const today = lab.today();
      const study = ImagingStudy.done({
        id: randomUUID(),
        accessionNumber: accessionNumber(today, await imaging.nextAccession(today)),
        billId,
        line,
        testId: test.testId,
        patientId: order.patient.id,
        doneOn: today,
        by: actor.userId,
        at: lab.clock.now(),
      });
      await imaging.insertStudy(study);
      await lab.record('imaging_study', 'done', actor, study.id, {
        accession: study.accessionNumber,
        bill: order.billNumber,
      });
      return { id: study.id, accessionNumber: study.accessionNumber };
    });
  }
}

/**
 * Old radiology report entry, finalisation and publishing: the report written, signed by the radiologist (their
 * reporting fee credited through the hospital), reopened for a correction (the fee taken back), handed over (held
 * while the patient owes, unless lab:manage).
 */
@CommandHandler(ChangeStudyCommand)
export class ChangeStudyHandler implements ICommandHandler<ChangeStudyCommand> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, id, version, change }: ChangeStudyCommand) {
    const { lab, imaging, fees } = this.desk;
    const permission = change.kind === 'sign' || change.kind === 'unsign' ? LAB_VERIFY : LAB_RESULT;
    await lab.access.authorize(actor.userId, { permissions: [permission] });
    const mayRelease =
      change.kind === 'deliver' && (await lab.access.isAllowed(actor.userId, { permissions: [LAB_MANAGE] }));
    return lab.tx.run(async () => {
      const study = await imaging.studyForUpdate(id);
      if (!study) throw new NotFoundError('imaging_study');
      study.assertVersion(version);
      const now = lab.clock.now();
      const today = lab.today();
      switch (change.kind) {
        case 'write': {
          if (change.radiologistId) {
            const doctor = (await lab.orders.doctors([change.radiologistId])).get(change.radiologistId);
            if (!doctor) throw new NotFoundError('doctor');
            if (!doctor.isActive) throw new DomainError('not_bookable', `${doctor.name} is not active`);
          }
          study.write({ ...change, at: now });
          break;
        }
        case 'sign': {
          study.sign(actor.userId, now);
          const fee = await fees.credit({
            billId: study.billId,
            line: study.line,
            doctorId: study.radiologistId!,
            documentNumber: study.accessionNumber,
            on: today,
            by: actor.userId,
          });
          study.feeCredited(fee);
          // Films and reagents are used up once: a report signed again after a correction uses none.
          if (study.reagents === null) {
            const order = await lab.order(study.billId);
            const test = order.tests.find((item) => item.line === study.line)!;
            study.reagentsApplied(
              await this.desk.reagents.useUp({
                sourceKind: 'study',
                sourceId: study.id,
                testId: test.testId,
                diagnosticDepartmentId: test.departmentId,
                reference: `${test.testName} ${study.accessionNumber}`,
                by: actor.userId,
              }),
            );
          }
          break;
        }
        case 'unsign': {
          const doctorId = study.radiologistId!;
          const fee = study.unsign(now);
          await fees.reverse({
            billId: study.billId,
            doctorId,
            documentNumber: study.accessionNumber,
            amount: fee,
            on: today,
            by: actor.userId,
          });
          break;
        }
        case 'deliver': {
          const order = await lab.order(study.billId);
          if (study.status === 'signed' && order.payer === 'patient' && order.due > 0 && !mayRelease) {
            throw new ForbiddenError(
              'due_outstanding',
              `${order.due.toFixed(2)} is still due on ${order.billNumber}; only a manager hands the report over`,
            );
          }
          study.deliver(change.to, actor.userId, now);
          break;
        }
      }
      await imaging.updateStudy(study);
      const action = { write: 'written', sign: 'signed', unsign: 'unsigned', deliver: 'delivered' }[change.kind];
      await lab.record('imaging_study', action, actor, id, {
        accession: study.accessionNumber,
        fee: study.reportingFee,
      });
      return { reportingFee: study.reportingFee };
    });
  }
}

@QueryHandler(ListStudiesQuery)
export class ListStudiesHandler implements IQueryHandler<ListStudiesQuery> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, filter }: ListStudiesQuery) {
    await this.desk.lab.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const page = await this.desk.read.studies(filter);
    return { ...page, items: await this.desk.describe(page.items) };
  }
}

@QueryHandler(GetStudyQuery)
export class GetStudyHandler implements IQueryHandler<GetStudyQuery> {
  constructor(private readonly desk: ImagingDesk) {}

  async execute({ actor, id }: GetStudyQuery) {
    const { desk } = this;
    await desk.lab.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const study = await desk.read.study(id);
    if (!study) throw new NotFoundError('imaging_study');
    const [described] = await desk.describe([study]);
    return { ...described!, templates: await desk.imaging.templates(study.testId) };
  }
}

export const IMAGING_HANDLERS = [
  ImagingDesk,
  SetImagingTemplatesHandler,
  GetImagingTemplatesHandler,
  MarkStudyDoneHandler,
  ChangeStudyHandler,
  ListStudiesHandler,
  GetStudyHandler,
];
