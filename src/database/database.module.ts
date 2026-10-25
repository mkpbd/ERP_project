import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/configuration.js';
import { TransactionManager } from '../shared/application/ports/transaction-manager.js';
import { createDatabase, createPool, DRIZZLE, PG_POOL } from './database.provider.js';
import { DbContext, DrizzleTransactionManager } from './drizzle-transaction-manager.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.database.url, config.database.poolMax),
    },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: createDatabase },
    DbContext,
    { provide: TransactionManager, useClass: DrizzleTransactionManager },
  ],
  exports: [PG_POOL, DbContext, TransactionManager],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
