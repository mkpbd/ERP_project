import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { DiagnosticOrders, type DiagnosticOrder } from '../../../shared/application/contracts/diagnostic-orders.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { ageInDays, checkedTemplate, labNumber, LabResult, LabSample, rangeFor, resultValues } from '../domain/lab.js';
import { LabRepository } from '../domain/repositories.js';
import {
  ChangeResultCommand,
  ChangeSampleCommand,
  CollectSampleCommand,
  GetResultQuery,
  GetSampleQuery,
  GetTestParametersQuery,
  LAB_COLLECT,
  LAB_MANAGE,
  LAB_READ,
  LAB_RESULT,
  LAB_VERIFY,
  LabReadRepository,
  ListResultsQuery,
  LAB_SETTINGS,
  ListSamplesQuery,
  SetTestParametersCommand,
  type LabSettings,
  type OrderRef,
} from './lab.messages.js';
import { ReagentUser } from './reagent-use.js';

@Injectable()
export class LabDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly labs: LabRepository,
    readonly read: LabReadRepository,
    readonly orders: DiagnosticOrders,
    @Inject(LAB_SETTINGS) readonly settings: LabSettings,
  ) {}

  today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
  }

  record(
    type: string,
    action: string,
    actor: Actor,
    id: string,
    metadata: Record<string, string | number | null> = {},
  ) {
    return this.audit.record({
      action: `laboratory.${type}_${action}`,
      actorUserId: actor.userId,
      resourceType: type,
      resourceId: id,
      metadata,
    });
  }

  async order(billId: string): Promise<DiagnosticOrder> {
    const [order] = await this.orders.find([billId]);
    if (!order) throw new NotFoundError('diagnostic_bill');
    return order;
  }

  /** The bill, patient and test each row is for, as the hospital tells it. */
  async withOrders<T extends { billId: string; line?: number; departmentId?: string }>(
    rows: readonly T[],
  ): Promise<(T & OrderRef)[]> {
    const orders = new Map(
      (await this.orders.find(rows.map((row) => row.billId))).map((order) => [order.billId, order]),
    );
    return rows.map((row) => {
      const order = orders.get(row.billId);
      const test = order?.tests.find((item) =>
        row.line !== undefined ? item.line === row.line : item.departmentId === row.departmentId,
      );
      return {
        ...row,
        billNumber: order?.billNumber ?? null,
        patientName: order?.patient.name ?? null,
        uhid: order?.patient.uhid ?? null,
        ...(row.line !== undefined ? { testName: test?.testName ?? null } : {}),
        departmentName: test?.departmentName ?? null,
      };
    });
  }
}

/** Old Report Parameters / Age Variant Normal Value pages: a test's parameters and ranges, the whole list. */
@CommandHandler(SetTestParametersCommand)
export class SetTestParametersHandler implements ICommandHandler<SetTestParametersCommand> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, testId, parameters }: SetTestParametersCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [LAB_MANAGE] });
    const template = checkedTemplate(parameters);
    const test = (await desk.orders.tests([testId])).get(testId);
    if (!test) throw new NotFoundError('diagnostic_test');
    if (test.departmentKind !== 'lab') throw new DomainError('not_lab_test', `${test.name} is not done in a lab`);
    await desk.tx.run(async () => {
      await desk.labs.setParameters(testId, template);
      await desk.record('test_parameters', 'set', actor, testId, { parameters: template.length });
    });
  }
}

@QueryHandler(GetTestParametersQuery)
export class GetTestParametersHandler implements IQueryHandler<GetTestParametersQuery> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, testId }: GetTestParametersQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [LAB_READ] });
    return this.desk.labs.parameters(testId);
  }
}

/**
 * Old sample collection (a lab number per tube from SPGetNextLabNo): the bill's tests of a lab department not yet in
 * work go on one sample with a lab number of the day, each test waiting for its result.
 */
@CommandHandler(CollectSampleCommand)
export class CollectSampleHandler implements ICommandHandler<CollectSampleCommand> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, billId, departmentId }: CollectSampleCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [LAB_COLLECT] });
    return desk.tx.run(async () => {
      await desk.tx.lock(`lab:bill:${billId}`);
      const order = await desk.order(billId);
      const inWork = await desk.labs.linesInWork(billId);
      const tests = order.tests.filter(
        (test) =>
          test.departmentId === departmentId &&
          test.departmentKind === 'lab' &&
          test.status === 'billed' &&
          !inWork.has(test.line),
      );
      if (tests.length === 0) {
        throw new DomainError('nothing_to_collect', `${order.billNumber} has no test of this lab waiting for a sample`);
      }
      const today = desk.today();
      const now = desk.clock.now();
      const sample = LabSample.collect({
        id: randomUUID(),
        labNumber: labNumber(today, await desk.labs.nextSerial(today)),
        billId,
        departmentId,
        patientId: order.patient.id,
        collectedOn: today,
        collectedAt: now,
        collectedBy: actor.userId,
      });
      const results = tests.map((test) =>
        LabResult.pending({
          id: randomUUID(),
          sampleId: sample.id,
          billId,
          line: test.line,
          testId: test.testId,
          at: now,
        }),
      );
      await desk.labs.insertSample(sample, results);
      await desk.record('sample', 'collected', actor, sample.id, {
        labNumber: sample.labNumber,
        bill: order.billNumber,
        tests: tests.length,
      });
      return { id: sample.id, labNumber: sample.labNumber, tests: tests.length };
    });
  }
}

/**
 * Old lab acknowledgement, sample rejection and report delivery (`/diagnosis/report-delivery`): a sample taken in or
 * rejected (its tests to be collected again), and its verified reports handed over. A report of a patient who still
 * owes on the bill is held unless lab:manage lets it go.
 */
@CommandHandler(ChangeSampleCommand)
export class ChangeSampleHandler implements ICommandHandler<ChangeSampleCommand> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, id, version, change }: ChangeSampleCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [LAB_RESULT] });
    const mayRelease =
      change.kind === 'deliver' && (await desk.access.isAllowed(actor.userId, { permissions: [LAB_MANAGE] }));
    return desk.tx.run(async () => {
      const sample = await desk.labs.sampleForUpdate(id);
      if (!sample) throw new NotFoundError('sample');
      sample.assertVersion(version);
      const results = await desk.labs.resultsOf(id);
      const now = desk.clock.now();
      let touched = 0;
      switch (change.kind) {
        case 'receive':
          sample.receive(actor.userId, now);
          break;
        case 'reject':
          sample.reject(change.reason, now);
          for (const result of results) {
            if (result.status === 'rejected') continue;
            result.reject(now);
            touched += 1;
          }
          break;
        case 'deliver': {
          const ready = results.filter((result) => result.status === 'verified');
          if (ready.length === 0) throw new DomainError('not_verified', 'No verified report to hand over');
          const order = await desk.order(sample.billId);
          if (order.payer === 'patient' && order.due > 0 && !mayRelease) {
            throw new ForbiddenError(
              'due_outstanding',
              `${order.due.toFixed(2)} is still due on ${order.billNumber}; only a manager hands the report over`,
            );
          }
          for (const result of ready) result.deliver(change.to, actor.userId, now);
          touched = ready.length;
          break;
        }
      }
      if (change.kind !== 'deliver') await desk.labs.updateSample(sample);
      for (const result of results) await desk.labs.updateResult(result);
      await desk.record(
        'sample',
        { receive: 'received', reject: 'rejected', deliver: 'delivered' }[change.kind],
        actor,
        id,
        {
          labNumber: sample.labNumber,
          results: touched,
        },
      );
      return { results: touched };
    });
  }
}

/** Old pathology result entry and finalisation: values entered against the template, verified by someone else. */
@CommandHandler(ChangeResultCommand)
export class ChangeResultHandler implements ICommandHandler<ChangeResultCommand> {
  constructor(
    private readonly desk: LabDesk,
    private readonly reagents: ReagentUser,
  ) {}

  async execute({ actor, id, version, change }: ChangeResultCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [change.kind === 'enter' ? LAB_RESULT : LAB_VERIFY] });
    await desk.tx.run(async () => {
      const result = await desk.labs.resultForUpdate(id);
      if (!result) throw new NotFoundError('result');
      result.assertVersion(version);
      const snapshot = result.toSnapshot();
      const now = desk.clock.now();
      switch (change.kind) {
        case 'enter': {
          const sample = await desk.labs.sampleForUpdate(snapshot.sampleId);
          if (sample?.status !== 'received') {
            throw new DomainError('sample_state', 'The sample must be taken in by the lab first');
          }
          const parameters = await desk.labs.parameters(snapshot.testId);
          if (parameters.length === 0) throw new DomainError('no_template', 'The test has no parameters yet');
          const order = await desk.order(snapshot.billId);
          const values = resultValues(parameters, change.values, {
            sex: order.patient.sex,
            ageDays: ageInDays(order.patient.dateOfBirth, desk.today()),
          });
          result.enter(values, change.comment, actor.userId, now);
          break;
        }
        case 'verify': {
          result.verify(actor.userId, now);
          // The reagents are used up once: a result verified again after a correction uses none.
          if (result.reagents === null) {
            const order = await desk.order(snapshot.billId);
            const test = order.tests.find((item) => item.line === snapshot.line)!;
            result.reagentsApplied(
              await this.reagents.useUp({
                sourceKind: 'result',
                sourceId: id,
                testId: snapshot.testId,
                diagnosticDepartmentId: test.departmentId,
                reference: `${test.testName} of ${order.billNumber}`,
                by: actor.userId,
              }),
            );
          }
          break;
        }
        case 'unverify':
          result.unverify(now);
          break;
      }
      await desk.labs.updateResult(result);
      await desk.record(
        'result',
        { enter: 'entered', verify: 'verified', unverify: 'unverified' }[change.kind],
        actor,
        id,
        {
          status: result.status,
        },
      );
    });
  }
}

@QueryHandler(ListSamplesQuery)
export class ListSamplesHandler implements IQueryHandler<ListSamplesQuery> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, filter }: ListSamplesQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const page = await this.desk.read.samples(filter);
    return { ...page, items: await this.desk.withOrders(page.items) };
  }
}

@QueryHandler(GetSampleQuery)
export class GetSampleHandler implements IQueryHandler<GetSampleQuery> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, id }: GetSampleQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const sample = await desk.read.sample(id);
    if (!sample) throw new NotFoundError('sample');
    const [withOrder] = await desk.withOrders([sample]);
    return { ...withOrder!, results: await desk.withOrders(sample.results) };
  }
}

@QueryHandler(ListResultsQuery)
export class ListResultsHandler implements IQueryHandler<ListResultsQuery> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, filter }: ListResultsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const page = await this.desk.read.results(filter);
    return { ...page, items: await this.desk.withOrders(page.items) };
  }
}

@QueryHandler(GetResultQuery)
export class GetResultHandler implements IQueryHandler<GetResultQuery> {
  constructor(private readonly desk: LabDesk) {}

  async execute({ actor, id }: GetResultQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const result = await desk.read.result(id);
    if (!result) throw new NotFoundError('result');
    const [withOrder] = await desk.withOrders([result]);
    const order = await desk.order(result.billId);
    const ageDays = ageInDays(order.patient.dateOfBirth, desk.today());
    const template = (await desk.labs.parameters(result.testId)).map((parameter) => {
      const range = rangeFor(parameter, order.patient.sex, ageDays);
      return {
        parameterId: parameter.id,
        name: parameter.name,
        unit: parameter.unit,
        kind: parameter.kind,
        low: range?.low ?? null,
        high: range?.high ?? null,
        normalText: range?.normalText ?? null,
      };
    });
    return { ...withOrder!, template };
  }
}

export const LAB_HANDLERS = [
  LabDesk,
  SetTestParametersHandler,
  GetTestParametersHandler,
  CollectSampleHandler,
  ChangeSampleHandler,
  ChangeResultHandler,
  ListSamplesHandler,
  GetSampleHandler,
  ListResultsHandler,
  GetResultHandler,
];
