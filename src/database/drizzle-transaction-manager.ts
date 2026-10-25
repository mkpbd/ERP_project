import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TransactionManager } from '../shared/application/ports/transaction-manager.js';
import { DRIZZLE, type Database, type DbExecutor } from './database.provider.js';

/**
 * Resolves the executor for the current async context: the ambient
 * transaction when one is open, otherwise the root database.
 */
@Injectable()
export class DbContext {
  private readonly storage = new AsyncLocalStorage<DbExecutor>();

  constructor(@Inject(DRIZZLE) private readonly root: Database) {}

  get db(): DbExecutor {
    return this.storage.getStore() ?? this.root;
  }

  get inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.root.transaction((tx) => this.storage.run(tx, work));
  }
}

@Injectable()
export class DrizzleTransactionManager extends TransactionManager {
  constructor(private readonly context: DbContext) {
    super();
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.context.inTransaction ? work() : this.context.runInTransaction(work);
  }

  async lock(resource: string): Promise<void> {
    if (!this.context.inTransaction) {
      throw new Error('TransactionManager.lock() must be called inside a transaction');
    }
    await this.context.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${resource}, 0))`);
  }
}
