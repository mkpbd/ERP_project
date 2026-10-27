/**
 * The reporting doctor's fee on a diagnostic test (a radiologist's on an imaging report), published by the hospital
 * that keeps the doctors' ledger, so that the lab never writes it directly. Both run inside the caller's transaction.
 */
export abstract class ReportingFees {
  /** Credits the doctor their fee on the bill's line (the test's percentage of the rate, or its amount); returns it. */
  abstract credit(params: {
    billId: string;
    line: number;
    doctorId: string;
    documentNumber: string;
    on: string;
    by: string;
  }): Promise<number>;
  /** Takes a fee credited before back. */
  abstract reverse(params: {
    billId: string;
    doctorId: string;
    documentNumber: string;
    amount: number;
    on: string;
    by: string;
  }): Promise<void>;
}
