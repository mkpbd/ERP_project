/**
 * Explicit transaction boundary. Repositories called inside `run` join the
 * same database transaction; nested `run` calls reuse the outer transaction.
 */
export abstract class TransactionManager {
  abstract run<T>(work: () => Promise<T>): Promise<T>;

  /**
   * Serializes competing transactions on a named resource until commit.
   * Must be called inside `run`.
   */
  abstract lock(resource: string): Promise<void>;
}
