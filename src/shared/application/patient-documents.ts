/** A document of a patient's own the patient may read (a report, a prescription, a receipt). */
export interface PatientDocument {
  /** Unique within the patient's documents: `<kind>:<id>`. */
  readonly ref: string;
  readonly kind: string;
  readonly title: string;
  readonly number: string;
  /** The day it is of (YYYY-MM-DD). */
  readonly on: string;
  /** The registered report that prints it, and its parameters. */
  readonly reportKey: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Null when it may be printed; otherwise why it is held (an unpaid bill). */
  readonly heldReason: string | null;
}

/** A module's documents of a patient. */
export interface PatientDocumentSource {
  readonly kind: string;
  list(patientId: string): Promise<PatientDocument[]>;
}

/**
 * Sources of patients' documents registered by the modules that own them (hospital bills, lab reports, prescriptions),
 * read by the patient portal. A document is printed only when it is among the patient's own.
 */
export class PatientDocumentRegistry {
  private readonly sources = new Map<string, PatientDocumentSource>();

  register(source: PatientDocumentSource): void {
    if (this.sources.has(source.kind)) throw new Error(`Patient documents of ${source.kind} are registered twice`);
    this.sources.set(source.kind, source);
  }

  /** The patient's documents of every source, newest first. Sources are read one after another. */
  async list(patientId: string): Promise<PatientDocument[]> {
    const documents: PatientDocument[] = [];
    for (const source of this.sources.values()) documents.push(...(await source.list(patientId)));
    return documents.sort((a, b) => b.on.localeCompare(a.on) || a.ref.localeCompare(b.ref));
  }
}
