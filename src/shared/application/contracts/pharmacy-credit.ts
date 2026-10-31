/**
 * Published by the pharmacy: what companies owe it for medicine sold on credit, so that the hospital's credit limit
 * counts it without reading the pharmacy tables.
 */
export abstract class PharmacyCredit {
  /** The client's completed credit sales, less what was collected or taken off by returns. */
  abstract corporateDue(clientId: string): Promise<number>;
}
