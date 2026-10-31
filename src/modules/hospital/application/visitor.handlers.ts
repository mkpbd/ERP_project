import { randomUUID } from 'node:crypto';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { VisitorPassRepository } from '../domain/repositories.js';
import { VisitorPass } from '../domain/visitor-pass.js';
import { IpdDesk } from './ipd.handlers.js';
import { IPD_ADMIT, IPD_READ } from './ipd.messages.js';
import {
  IssueVisitorPassCommand,
  ListVisitorPassesQuery,
  ReturnVisitorPassCommand,
  VisitorPassReadRepository,
} from './visitor.messages.js';

/**
 * Old Visiting Card: a pass for an attendant of an admitted patient, numbered VP-<year>-…, up to the policy's limit in
 * force at once (2 unless set). Taken under a lock on the admission, so two counters cannot pass the limit together.
 * The old card fee is not kept here: when one is wanted it is charged to the stay as a service.
 */
@CommandHandler(IssueVisitorPassCommand)
export class IssueVisitorPassHandler implements ICommandHandler<IssueVisitorPassCommand> {
  constructor(
    private readonly desk: IpdDesk,
    private readonly passes: VisitorPassRepository,
  ) {}

  async execute({ actor, admissionId, visitor }: IssueVisitorPassCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [IPD_ADMIT] });
    return opd.tx.run(async () => {
      const admission = await desk.admissions.findForUpdate(admissionId);
      if (!admission) throw new NotFoundError('admission');
      if (admission.status !== 'admitted') {
        throw new DomainError('admission_state', `The admission is ${admission.status}`);
      }
      const { visitorPassLimit } = await desk.billing.policy();
      if ((await this.passes.activeCount(admissionId)) >= visitorPassLimit) {
        throw new ConflictError(
          'pass_limit',
          `${visitorPassLimit} passes are in force for this patient; take one back first`,
        );
      }
      const now = opd.clock.now();
      const pass = VisitorPass.issue({
        ...visitor,
        id: randomUUID(),
        number: await opd.number('VP', opd.today()),
        admissionId,
        by: actor.userId,
        at: now,
      });
      await this.passes.insert(pass);
      const snapshot = pass.toSnapshot();
      await opd.audit.record({
        action: 'hospital.visitor_pass_issued',
        actorUserId: actor.userId,
        resourceType: 'visitor_pass',
        resourceId: snapshot.id,
        metadata: { number: snapshot.number, admission: admission.number },
      });
      return { id: snapshot.id, number: snapshot.number };
    });
  }
}

/** A pass handed back (lost, or the attendant changed): another can then be issued. */
@CommandHandler(ReturnVisitorPassCommand)
export class ReturnVisitorPassHandler implements ICommandHandler<ReturnVisitorPassCommand> {
  constructor(
    private readonly desk: IpdDesk,
    private readonly passes: VisitorPassRepository,
  ) {}

  async execute({ actor, id }: ReturnVisitorPassCommand): Promise<void> {
    const { opd } = this.desk;
    await opd.access.authorize(actor.userId, { permissions: [IPD_ADMIT] });
    await opd.tx.run(async () => {
      const pass = await this.passes.findForUpdate(id);
      if (!pass) throw new NotFoundError('visitor_pass');
      pass.handBack(actor.userId, opd.clock.now());
      await this.passes.update(pass);
      await opd.audit.record({
        action: 'hospital.visitor_pass_returned',
        actorUserId: actor.userId,
        resourceType: 'visitor_pass',
        resourceId: id,
        metadata: { number: pass.toSnapshot().number },
      });
    });
  }
}

@QueryHandler(ListVisitorPassesQuery)
export class ListVisitorPassesHandler implements IQueryHandler<ListVisitorPassesQuery> {
  constructor(
    private readonly desk: IpdDesk,
    private readonly read: VisitorPassReadRepository,
  ) {}

  async execute({ actor, admissionId }: ListVisitorPassesQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.read.list(admissionId);
  }
}

export const VISITOR_HANDLERS = [IssueVisitorPassHandler, ReturnVisitorPassHandler, ListVisitorPassesHandler];
