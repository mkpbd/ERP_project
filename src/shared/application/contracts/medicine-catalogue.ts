/** A medicine of the pharmacy's catalogue as a prescription names it. */
export interface Medicine {
  readonly id: string;
  /** As printed: "Tab. Napa 500 mg". */
  readonly name: string;
  readonly genericId: string;
  readonly genericName: string;
  readonly isActive: boolean;
}

/**
 * The pharmacy's products for prescribing (the clinical module), so that it never reads the pharmacy tables directly.
 */
export abstract class MedicineCatalogue {
  abstract find(ids: readonly string[]): Promise<Map<string, Medicine>>;
  /** Active products whose brand or generic name starts with (or contains) the text, best matches first. */
  abstract search(text: string, limit: number): Promise<Medicine[]>;
}
