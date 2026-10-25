import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from './actor.js';

/**
 * Simple records (master data: departments, districts, payment modes, …):
 * flat rows with create/read/update/delete and no business rules beyond
 * validation and database constraints. A module describes each kind once as
 * a RecordType and registers it; the generic handlers below do the rest
 * (authorization, transaction, audit). Anything with real behaviour gets
 * its own aggregate and handlers instead.
 */

export type RecordFilter = Readonly<Record<string, string | undefined>>;

export abstract class RecordStore<TView = unknown, TInput = unknown> {
  abstract list(filter: RecordFilter): Promise<TView[]>;
  abstract get(id: string): Promise<TView | null>;
  /** Throws ConflictError on duplicates and NotFoundError for a missing referenced record. */
  abstract insert(id: string, input: TInput, now: Date): Promise<void>;
  /** Returns false when the record does not exist. */
  abstract update(id: string, changes: Partial<TInput>, now: Date): Promise<boolean>;
  /** Returns false when the record does not exist; throws ConflictError while others reference it. */
  abstract delete(id: string): Promise<boolean>;
}

export interface RecordType<TView = unknown, TInput = unknown> {
  /** snake_case; used as the audit resource type and in error codes (`<name>_not_found`). */
  readonly name: string;
  /** Needed to list and read; null means any signed-in user (dropdown data). */
  readonly readPermission: string | null;
  readonly managePermission: string;
  readonly store: RecordStore<TView, TInput>;
}

export class RecordTypeRegistry {
  private readonly types = new Map<string, RecordType>();

  register(type: RecordType): void {
    if (this.types.has(type.name)) throw new Error(`Record type ${type.name} is registered twice`);
    this.types.set(type.name, type);
  }

  get(name: string): RecordType {
    const type = this.types.get(name);
    if (!type) throw new Error(`Record type ${name} is not registered`);
    return type;
  }
}

export class CreateRecordCommand extends Command<{ id: string }> {
  constructor(
    readonly type: string,
    readonly actor: Actor,
    readonly input: object,
  ) {
    super();
  }
}

export class UpdateRecordCommand extends Command<void> {
  constructor(
    readonly type: string,
    readonly actor: Actor,
    readonly id: string,
    readonly changes: object,
  ) {
    super();
  }
}

export class DeleteRecordCommand extends Command<void> {
  constructor(
    readonly type: string,
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListRecordsQuery<TView = unknown> extends Query<TView[]> {
  constructor(
    readonly type: string,
    readonly actor: Actor,
    readonly filter: RecordFilter = {},
  ) {
    super();
  }
}

export class GetRecordQuery<TView = unknown> extends Query<TView> {
  constructor(
    readonly type: string,
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
