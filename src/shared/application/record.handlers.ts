import { randomUUID } from 'node:crypto';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../domain/errors.js';
import { AccessControl } from './contracts/access-control.js';
import { AuditTrail } from './ports/audit-trail.js';
import { Clock } from './ports/clock.js';
import { TransactionManager } from './ports/transaction-manager.js';
import {
  CreateRecordCommand,
  DeleteRecordCommand,
  GetRecordQuery,
  ListRecordsQuery,
  RecordTypeRegistry,
  UpdateRecordCommand,
  type RecordType,
} from './records.js';

async function authorizeRead(access: AccessControl, userId: string, type: RecordType): Promise<void> {
  if (type.readPermission !== null) await access.authorize(userId, { permissions: [type.readPermission] });
}

@CommandHandler(CreateRecordCommand)
export class CreateRecordHandler implements ICommandHandler<CreateRecordCommand> {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ type: typeName, actor, input }: CreateRecordCommand): Promise<{ id: string }> {
    const type = this.registry.get(typeName);
    await this.access.authorize(actor.userId, { permissions: [type.managePermission] });
    const id = randomUUID();
    await this.tx.run(async () => {
      await type.store.insert(id, input, this.clock.now());
      await this.audit.record({
        action: `${type.name}.created`,
        actorUserId: actor.userId,
        resourceType: type.name,
        resourceId: id,
      });
    });
    return { id };
  }
}

@CommandHandler(UpdateRecordCommand)
export class UpdateRecordHandler implements ICommandHandler<UpdateRecordCommand> {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ type: typeName, actor, id, changes }: UpdateRecordCommand): Promise<void> {
    const type = this.registry.get(typeName);
    await this.access.authorize(actor.userId, { permissions: [type.managePermission] });
    await this.tx.run(async () => {
      if (!(await type.store.update(id, changes, this.clock.now()))) throw new NotFoundError(type.name);
      await this.audit.record({
        action: `${type.name}.updated`,
        actorUserId: actor.userId,
        resourceType: type.name,
        resourceId: id,
        metadata: { fields: Object.keys(changes).sort() },
      });
    });
  }
}

@CommandHandler(DeleteRecordCommand)
export class DeleteRecordHandler implements ICommandHandler<DeleteRecordCommand> {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ type: typeName, actor, id }: DeleteRecordCommand): Promise<void> {
    const type = this.registry.get(typeName);
    await this.access.authorize(actor.userId, { permissions: [type.managePermission] });
    await this.tx.run(async () => {
      if (!(await type.store.delete(id))) throw new NotFoundError(type.name);
      await this.audit.record({
        action: `${type.name}.deleted`,
        actorUserId: actor.userId,
        resourceType: type.name,
        resourceId: id,
      });
    });
  }
}

@QueryHandler(ListRecordsQuery)
export class ListRecordsHandler implements IQueryHandler<ListRecordsQuery> {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly access: AccessControl,
  ) {}

  async execute({ type: typeName, actor, filter }: ListRecordsQuery): Promise<unknown[]> {
    const type = this.registry.get(typeName);
    await authorizeRead(this.access, actor.userId, type);
    return type.store.list(filter);
  }
}

@QueryHandler(GetRecordQuery)
export class GetRecordHandler implements IQueryHandler<GetRecordQuery> {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly access: AccessControl,
  ) {}

  async execute({ type: typeName, actor, id }: GetRecordQuery): Promise<unknown> {
    const type = this.registry.get(typeName);
    await authorizeRead(this.access, actor.userId, type);
    const record = await type.store.get(id);
    if (!record) throw new NotFoundError(type.name);
    return record;
  }
}

export const RECORD_HANDLERS = [
  CreateRecordHandler,
  UpdateRecordHandler,
  DeleteRecordHandler,
  ListRecordsHandler,
  GetRecordHandler,
];
