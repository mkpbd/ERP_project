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
