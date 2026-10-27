import type { ImagingStudy, ImagingTemplate } from './imaging.js';
import type { LabResult, LabSample, Parameter } from './lab.js';

export abstract class LabRepository {
  /** The test's parameters in order, with their ranges. */
  abstract parameters(testId: string): Promise<Parameter[]>;
  /** Replaces the test's parameters (values already entered keep their own copy). */
  abstract setParameters(testId: string, parameters: readonly Omit<Parameter, 'id'>[]): Promise<void>;
  /** The next lab number serial of the day, counted under a row lock. */
  abstract nextSerial(day: string): Promise<number>;
  /** The bill's lines being worked on (on a sample not rejected). */
  abstract linesInWork(billId: string): Promise<Set<number>>;
  abstract insertSample(sample: LabSample, results: readonly LabResult[]): Promise<void>;
  abstract sampleForUpdate(id: string): Promise<LabSample | null>;
  abstract updateSample(sample: LabSample): Promise<void>;
  /** The sample's results, locked. */
  abstract resultsOf(sampleId: string): Promise<LabResult[]>;
  abstract resultForUpdate(id: string): Promise<LabResult | null>;
  /** Saves the header and replaces the values. */
  abstract updateResult(result: LabResult): Promise<void>;
}

export abstract class ImagingRepository {
  abstract templates(testId: string): Promise<ImagingTemplate[]>;
  /** Replaces the test's report templates. */
  abstract setTemplates(testId: string, templates: readonly ImagingTemplate[]): Promise<void>;
  /** The next accession number serial of the day, counted under a row lock. */
  abstract nextAccession(day: string): Promise<number>;
  /** The study of a bill's line, if it was done. */
  abstract studyOfLine(billId: string, line: number): Promise<string | null>;
  abstract insertStudy(study: ImagingStudy): Promise<void>;
  abstract studyForUpdate(id: string): Promise<ImagingStudy | null>;
  abstract updateStudy(study: ImagingStudy): Promise<void>;
}

export interface ReagentUse {
  readonly sourceKind: 'result' | 'study';
  readonly sourceId: string;
  readonly testId: string;
  readonly storeDepartmentId: string;
  readonly variantId: string;
  readonly qty: number;
  readonly usedOn: string;
  readonly consumptionNumber: string | null;
}

export abstract class ReagentRepository {
  /** What one test uses up. */
  abstract recipe(testId: string): Promise<{ variantId: string; qty: number }[]>;
  abstract setRecipe(testId: string, lines: readonly { variantId: string; qty: number }[]): Promise<void>;
  abstract stockDepartments(): Promise<{ diagnosticDepartmentId: string; storeDepartmentId: string }[]>;
  abstract setStockDepartments(
    pairs: readonly { diagnosticDepartmentId: string; storeDepartmentId: string }[],
  ): Promise<void>;
  /** The store department a diagnostic department uses up stock from, if set. */
  abstract storeOf(diagnosticDepartmentId: string): Promise<string | null>;
  abstract addUses(uses: readonly ReagentUse[]): Promise<void>;
}
