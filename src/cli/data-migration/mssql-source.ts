import { LegacySource } from './etl.js';

/** Tries of a read whose connection dropped. */
const MAX_ATTEMPTS = 4;

/**
 * The old SQL Server database, read with a read-only login. The connection string comes from the environment
 * (ETL_SOURCE_URL) and is never written anywhere.
 */
export class MssqlSource extends LegacySource {
  private constructor(private readonly pool: import('mssql').ConnectionPool) {
    super();
  }

  static async connect(connectionString: string): Promise<MssqlSource> {
    // mssql is CommonJS: imported from ES modules its exports sit under `default`.
    const { ConnectionPool } = (await import('mssql')).default;
    const pool = new ConnectionPool(connectionString);
    await pool.connect();
    return new MssqlSource(pool);
  }

  /**
   * Runs a read. A dropped connection (the old server is reached over the internet) is retried a few times: every
   * query here only reads, so running it again is safe.
   */
  async query<T extends Record<string, unknown>>(text: string, params: Record<string, unknown> = {}): Promise<T[]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const request = this.pool.request();
        for (const [name, value] of Object.entries(params)) request.input(name, value);
        const result = await request.query<T>(text);
        return result.recordset;
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        const dropped = ['ECONNRESET', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ETIMEDOUT'].includes(code);
        if (!dropped || attempt >= MAX_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
      }
    }
  }

  close(): Promise<void> {
    return this.pool.close();
  }
}
