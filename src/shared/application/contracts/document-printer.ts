export interface PrintedDocument {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

/**
 * Prints a registered report as PDF for a caller that has already decided the reader may see it (the patient portal,
 * for the patient's own documents). Published by the reporting module; it checks no staff report grants.
 */
export abstract class DocumentPrinter {
  abstract printPdf(key: string, params: unknown, printedBy: string): Promise<PrintedDocument>;
}
