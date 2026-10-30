import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { OutpatientClinic } from '../../../shared/application/contracts/outpatient-clinic.js';
import { ReferredBilling } from '../../../shared/application/contracts/referred-billing.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { checkedPerson, monthBounds, performance, type Person } from '../domain/team.js';
import {
  CreatePersonCommand,
  ListPeopleQuery,
  MarketingReadRepository,
  MarketingRepository,
  MKT_MANAGE,
  MKT_READ,
  OfficerDoctorsQuery,
  PerformanceQuery,
  SetOfficerDoctorsCommand,
  SetTargetCommand,
  UpdatePersonCommand,
  type Performance,
} from './marketing.messages.js';

@Injectable()
export class MarketingDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly marketing: MarketingRepository,
    readonly read: MarketingReadRepository,
    readonly clinic: OutpatientClinic,
    readonly billing: ReferredBilling,
  ) {}

  async parentOf(parentId: string | null): Promise<Person | null> {
    if (!parentId) return null;
    const parent = await this.marketing.person(parentId);
    if (!parent) throw new NotFoundError('marketing_person');
    return parent;
  }

  async assertZone(zoneId: string | null): Promise<void> {
    if (zoneId && !(await this.marketing.zoneExists(zoneId))) throw new NotFoundError('marketing_zone');
  }

  async officer(id: string): Promise<Person> {
    const person = await this.marketing.person(id);
    if (!person || person.kind !== 'officer') throw new NotFoundError('marketing_officer');
    return person;
  }
}

/** Old MarketingManager / MarketingJOfficerOrMedia / MarketingAgent: someone joins the team under their lead. */
@CommandHandler(CreatePersonCommand)
export class CreatePersonHandler implements ICommandHandler<CreatePersonCommand> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, input }: CreatePersonCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [MKT_MANAGE] });
    const checked = checkedPerson(input, await desk.parentOf(input.parentId));
    await desk.assertZone(checked.zoneId);
    const id = randomUUID();
    await desk.marketing.insertPerson({
      id,
      kind: input.kind,
      ...checked,
      parentId: input.parentId,
      isActive: true,
      version: 1,
    });
    return { id };
  }
}

/** Renamed, moved under another lead or zone, or taken out of the team (not while anyone works under them). */
@CommandHandler(UpdatePersonCommand)
export class UpdatePersonHandler implements ICommandHandler<UpdatePersonCommand> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, id, version, input }: UpdatePersonCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [MKT_MANAGE] });
    return desk.tx.run(async () => {
      const person = await desk.marketing.person(id);
      if (!person) throw new NotFoundError('marketing_person');
      if (person.version !== version) throw new ConflictError('stale_person', 'Changed meanwhile; reload it');
      if (input.parentId === id) throw new DomainError('invalid_parent', 'Nobody works under themself');
      const checked = checkedPerson({ ...input, kind: person.kind }, await desk.parentOf(input.parentId));
      await desk.assertZone(checked.zoneId);
      if (!input.isActive && person.isActive && (await desk.marketing.hasReports(id))) {
        throw new DomainError('has_reports', `Move the people under ${person.name} first`);
      }
      const updated: Person = {
        ...person,
        ...checked,
        parentId: input.parentId,
        isActive: input.isActive,
        version: version + 1,
      };
      await desk.marketing.updatePerson(updated);
      return { version: updated.version };
    });
  }
}

/** The referring doctors an officer looks after (the whole list); a doctor moves from any other officer. */
@CommandHandler(SetOfficerDoctorsCommand)
export class SetOfficerDoctorsHandler implements ICommandHandler<SetOfficerDoctorsCommand> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, officerId, doctorIds }: SetOfficerDoctorsCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [MKT_MANAGE] });
    await desk.officer(officerId);
    const unique = [...new Set(doctorIds)];
    const found = await desk.clinic.doctors(unique);
    if (found.size !== unique.length) throw new NotFoundError('doctor');
    await desk.tx.run(() => desk.marketing.setDoctors(officerId, unique));
  }
}

/** Old MPOSalesTarget (an officer's) or GrossSalesTarget (none): a month's target, or none. */
@CommandHandler(SetTargetCommand)
export class SetTargetHandler implements ICommandHandler<SetTargetCommand> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, officerId, year, month, amount }: SetTargetCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [MKT_MANAGE] });
    if (officerId) await desk.officer(officerId);
    if (amount !== null && !(amount >= 0)) throw new DomainError('invalid_amount', 'A target is 0 or more');
    await desk.marketing.setTarget(officerId, year, month, amount);
  }
}

@QueryHandler(ListPeopleQuery)
export class ListPeopleHandler implements IQueryHandler<ListPeopleQuery> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, kind }: ListPeopleQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [MKT_READ] });
    return this.desk.read.people(kind);
  }
}

@QueryHandler(OfficerDoctorsQuery)
export class OfficerDoctorsHandler implements IQueryHandler<OfficerDoctorsQuery> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, officerId }: OfficerDoctorsQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [MKT_READ] });
    await desk.officer(officerId);
    const doctors = await desk.clinic.doctors(await desk.read.doctorsOf(officerId));
    return [...doctors.values()]
      .map((doctor) => ({ id: doctor.id, name: doctor.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

@QueryHandler(PerformanceQuery)
export class PerformanceHandler implements IQueryHandler<PerformanceQuery> {
  constructor(private readonly desk: MarketingDesk) {}

  async execute({ actor, year, month }: PerformanceQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [MKT_READ] });
    return monthlyPerformance(this.desk, year, month);
  }
}

export async function monthlyPerformance(desk: MarketingDesk, year: number, month: number): Promise<Performance> {
  const [from, to] = monthBounds(year, month);
  const officers = (await desk.read.people('officer')).map((officer) => ({
    id: officer.id,
    name: officer.name,
    managerName: officer.parentName,
    zoneName: officer.zoneName,
  }));
  const result = performance({
    officers,
    links: await desk.read.links(),
    referred: await desk.billing.referred(from, to),
    targets: await desk.read.targets(year, month),
  });
  return { year, month, ...result };
}

export const MARKETING_HANDLERS = [
  MarketingDesk,
  CreatePersonHandler,
  UpdatePersonHandler,
  SetOfficerDoctorsHandler,
  SetTargetHandler,
  ListPeopleHandler,
  OfficerDoctorsHandler,
  PerformanceHandler,
];
