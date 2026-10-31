/** A test a patient may book: its rate and department; a lab test can also be collected at home. */
export interface BookableTestOffer {
  readonly id: string;
  readonly name: string;
  readonly rate: number;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly departmentKind: 'lab' | 'imaging';
}

/** A window of a day and how full it is. */
export interface WindowAvailability {
  readonly id: string;
  readonly label: string;
  readonly startTime: string;
  readonly endTime: string | null;
  /** Null: any department. */
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly capacity: number;
  readonly booked: number;
  readonly left: number;
  /** Today, and its time has gone by. */
  readonly over: boolean;
}

export interface HomeCollectionOffer {
  readonly areas: readonly {
    readonly id: string;
    readonly name: string;
    readonly charge: number;
    readonly minimumOrder: number;
    /** Weekdays served (sunday … saturday); none: every day. */
    readonly days: readonly string[];
  }[];
  readonly windows: readonly { readonly id: string; readonly label: string }[];
}

export interface BookedTest {
  readonly testId: string;
  readonly testName: string;
  readonly departmentName: string;
  readonly rate: number;
}

export interface PatientTestAppointment {
  readonly id: string;
  readonly number: string;
  readonly appointmentDate: string;
  readonly windowLabel: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly serial: number;
  readonly tests: readonly BookedTest[];
  readonly amount: number;
  readonly status: 'booked' | 'billed' | 'no_show' | 'cancelled';
  readonly statusReason: string | null;
}

export interface PatientHomeCollection {
  readonly id: string;
  readonly number: string;
  readonly collectionDate: string;
  readonly windowLabel: string;
  readonly areaName: string;
  readonly address: string;
  readonly landmark: string | null;
  readonly tests: readonly BookedTest[];
  readonly amount: number;
  readonly charge: number;
  readonly status: 'booked' | 'assigned' | 'collected' | 'cancelled';
  readonly statusReason: string | null;
}

export interface TestAppointmentRequest {
  readonly appointmentDate: string;
  readonly windowId: string;
  readonly testIds: readonly string[];
  readonly remarks: string | null;
}

export interface HomeCollectionRequest {
  readonly collectionDate: string;
  readonly windowId: string;
  readonly areaId: string;
  readonly address: string;
  readonly landmark: string | null;
  readonly testIds: readonly string[];
  readonly note: string | null;
}

/**
 * Test appointments and home collections as the patient portal offers them (old: the patients' mobile app), published
 * by the hospital so that the portal never reads its tables. A booking of another patient is not found.
 */
export abstract class DiagnosticBookings {
  /** Active lab and imaging tests, by name, short name or code when a text is given. */
  abstract catalogue(text: string | null): Promise<BookableTestOffer[]>;
  /** The active windows of a day (for a department: its own and those of any department). */
  abstract appointmentDay(date: string, departmentId: string | null): Promise<WindowAvailability[]>;
  /** The areas served and the windows offered. */
  abstract homeCollectionOffer(): Promise<HomeCollectionOffer>;
  abstract bookAppointment(
    patientId: string,
    request: TestAppointmentRequest,
  ): Promise<{ id: string; number: string; serial: number }>;
  abstract bookHomeCollection(
    patientId: string,
    request: HomeCollectionRequest,
  ): Promise<{ id: string; number: string }>;
  /** The patient's own, newest day first. */
  abstract appointments(patientId: string): Promise<PatientTestAppointment[]>;
  abstract homeCollections(patientId: string): Promise<PatientHomeCollection[]>;
  abstract cancelAppointment(patientId: string, id: string): Promise<void>;
  abstract cancelHomeCollection(patientId: string, id: string): Promise<void>;
}
