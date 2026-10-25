import { and, asc, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbContext } from '../../../database/drizzle-transaction-manager.js';
import { RecordStore, type RecordFilter } from '../../application/records.js';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import { foreignKeyViolationConstraint, uniqueViolationConstraint } from './pg-errors.js';

/** A record table: uuid `id`, `created_at`, `updated_at`, plus its own columns. */
export type RecordTable = PgTable & {
  readonly id: PgColumn;
  readonly createdAt: PgColumn;
  readonly updatedAt: PgColumn;
};

export interface RecordStoreOptions {
  /** snake_case record name, for `<name>_in_use` and default conflict codes. */
  readonly name: string;
  readonly orderBy: readonly PgColumn[];
  /** Allowed list filters: query key → column (equality). */
  readonly filters?: Readonly<Record<string, PgColumn>>;
  /** Unique constraint name → reported conflict. */
  readonly unique?: Readonly<Record<string, { readonly code: string; readonly message: string }>>;
  /** Foreign key constraint name → referenced record, reported as `<record>_not_found`. */
  readonly references?: Readonly<Record<string, string>>;
}

/**
 * RecordStore over one table. Database constraints are the integrity rules;
 * their violations become ConflictError / NotFoundError.
 */
export class DrizzleRecordStore<TView, TInput extends object> extends RecordStore<TView, TInput> {
  constructor(
    protected readonly context: DbContext,
    protected readonly table: RecordTable,
    protected readonly options: RecordStoreOptions,
  ) {
    super();
  }

  async list(filter: RecordFilter): Promise<TView[]> {
    const conditions = Object.entries(filter).flatMap(([key, value]) => {
      const column = this.options.filters?.[key];
      return column && value !== undefined ? [eq(column, value)] : [];
    });
    const rows: unknown[] = await this.context.db
      .select()
      .from(this.table)
      .where(and(...conditions))
      .orderBy(...this.options.orderBy.map((column) => asc(column)));
    return rows as TView[];
  }

  async get(id: string): Promise<TView | null> {
    const rows: unknown[] = await this.context.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return (rows[0] as TView | undefined) ?? null;
  }

  async insert(id: string, input: TInput, now: Date): Promise<void> {
    try {
      // The DTO for this record type defines `input`; the table checks it.
      await this.context.db.insert(this.table).values({ ...input, id, createdAt: now, updatedAt: now } as never);
    } catch (error) {
      this.translate(error, 'write');
    }
  }

  async update(id: string, changes: Partial<TInput>, now: Date): Promise<boolean> {
    try {
      const rows = await this.context.db
        .update(this.table)
        .set({ ...changes, updatedAt: now })
        .where(eq(this.table.id, id))
        .returning({ id: this.table.id });
      return rows.length > 0;
    } catch (error) {
      this.translate(error, 'write');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const rows = await this.context.db
        .delete(this.table)
        .where(eq(this.table.id, id))
        .returning({ id: this.table.id });
      return rows.length > 0;
    } catch (error) {
      this.translate(error, 'delete');
    }
  }

  private translate(error: unknown, operation: 'write' | 'delete'): never {
    const unique = uniqueViolationConstraint(error);
    if (unique !== null) {
      const conflict = this.options.unique?.[unique];
      throw new ConflictError(
        conflict?.code ?? `${this.options.name}_duplicate`,
        conflict?.message ?? 'A record with these values already exists',
      );
    }
    const foreignKey = foreignKeyViolationConstraint(error);
    if (foreignKey !== null) {
      if (operation === 'delete') {
        throw new ConflictError(`${this.options.name}_in_use`, 'Other records still refer to this one');
      }
      throw new NotFoundError(this.options.references?.[foreignKey] ?? 'referenced_record');
    }
    throw error;
  }
}
