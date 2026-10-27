export interface StockItem {
  readonly id: string;
  /** Item — variant. */
  readonly name: string;
  readonly unit: string;
  readonly isActive: boolean;
  readonly isAsset: boolean;
}

/**
 * The store departments' stock published by the supply chain, so that other modules (the lab using up reagents and
 * films) never read or write the store tables directly. Consuming runs inside the caller's transaction.
 */
export abstract class DepartmentStock {
  /** Store items (variants) by id. */
  abstract items(variantIds: readonly string[]): Promise<Map<string, StockItem>>;
  /** Store departments by id. */
  abstract departments(ids: readonly string[]): Promise<Map<string, { id: string; name: string }>>;
  /**
   * Uses up stock of a department (first expiring first, as a department consumption with its number). When the
   * department holds too little of something, nothing is taken and null comes back.
   */
  abstract consume(params: {
    departmentId: string;
    on: string;
    note: string;
    lines: readonly { variantId: string; qty: number }[];
    by: string;
  }): Promise<{ number: string } | null>;
}
