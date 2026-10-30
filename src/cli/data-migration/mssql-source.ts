import { LegacySource } from './etl.js';

/**
 * The old SQL Server database, read with a read-only login. The connection string comes from the environment
 * (ETL_SOURCE_URL) and is never written anywhere.
 */
export class MssqlSource extends LegacySource {
  private constructor(private readonly pool: import('mssql').ConnectionPool) {
    super();
  }

  static async connect(connectionString: string): Promise<MssqlSource> {
    const mssql = await import('mssql');
    const pool = new mssql.ConnectionPool(connectionString);
    await pool.connect();
    return new MssqlSource(pool);
  }

  async query<T extends Record<string, unknown>>(text: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const request = this.pool.request();
    for (const [name, value] of Object.entries(params)) request.input(name, value);
    const result = await request.query<T>(text);
    return result.recordset;
  }

  close(): Promise<void> {
    return this.pool.close();
  }
}
