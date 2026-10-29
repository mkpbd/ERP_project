/** A test ordered on a diagnostic bill. */
export interface OrderedTest {
  /** The bill line (1-based). */
  readonly line: number;
  readonly testId: string;
  readonly testName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly departmentKind: 'lab' | 'imaging' | 'other';
  readonly specimen: string | null;
  readonly status: 'billed' | 'cancelled';
  readonly reportDueAt: Date | null;
}

/** A diagnostic bill as the lab works from it. */
export interface DiagnosticOrder {
  readonly billId: string;
  readonly billNumber: string;
  readonly billedAt: Date;
  readonly patient: {
    readonly id: string;
    readonly uhid: number;
    readonly name: string;
    readonly sex: string;
    readonly dateOfBirth: string;
    readonly mobileNo: string | null;
  };
  readonly referredByName: string | null;
  /** Set for an admitted patient's tests (paid with the final bill). */
  readonly admissionId: string | null;
  /** Who owes what is not paid: the patient, a company, a staff member, or the stay. */
  readonly payer: 'patient' | 'corporate' | 'staff' | 'indoor';
  /** Still owed on the bill. */
  readonly due: number;
  readonly tests: OrderedTest[];
}

/**
 * The diagnostic bills published by the hospital for the lab (samples, results, reports), so that the lab never reads
 * the hospital tables directly.
 */
export abstract class DiagnosticOrders {
  abstract find(billIds: readonly string[]): Promise<DiagnosticOrder[]>;
  /** The bill with this number (any case), or null. */
  abstract byNumber(number: string): Promise<DiagnosticOrder | null>;
  /** Diagnostic departments by id. */
  abstract departments(
    ids: readonly string[],
  ): Promise<Map<string, { id: string; name: string; kind: 'lab' | 'imaging' | 'other' }>>;
  /** Doctors by id (a radiologist signing a report). */
  abstract doctors(ids: readonly string[]): Promise<Map<string, { id: string; name: string; isActive: boolean }>>;
  /** Tests of the catalogue by id, for the lab's parameter templates. */
  abstract tests(
    testIds: readonly string[],
  ): Promise<Map<string, { id: string; name: string; departmentKind: 'lab' | 'imaging' | 'other' }>>;
  /** Active tests whose name, short name or code holds the text, for a doctor writing them on a prescription. */
  abstract searchTests(
    text: string,
    limit: number,
  ): Promise<{ id: string; name: string; departmentKind: 'lab' | 'imaging' | 'other' }[]>;
}
