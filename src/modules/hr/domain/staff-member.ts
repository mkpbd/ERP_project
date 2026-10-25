import { DomainError } from '../../../shared/domain/errors.js';

export type StaffStatus = 'active' | 'inactive' | 'separated';
export const SEXES = ['male', 'female', 'other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Everything HR edits on a staff record. Dates are calendar dates (`YYYY-MM-DD`). */
export interface StaffProfile {
  employeeNo: string;
  fullName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fatherName: string | null;
  motherName: string | null;
  dateOfBirth: string | null;
  sex: (typeof SEXES)[number] | null;
  maritalStatus: string | null;
  religion: string | null;
  bloodGroup: (typeof BLOOD_GROUPS)[number] | null;
  nationalityCountryId: string | null;
  nationalityOther: string | null;
  nationalIdOrPassport: string | null;
  tinNo: string | null;
  mobileNo: string | null;
  officialMobileNo: string | null;
  email: string | null;
  guardianContact: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  divisionId: string | null;
  departmentId: string;
  subDepartmentId: string;
  designationId: string;
  joiningDesignationId: string | null;
  joiningDate: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  employeeCategory: number | null;
  jobLocation: string | null;
  serviceNature: string;
  salaryStatus: string;
  paymentMode: string | null;
  bankAccountNo: string | null;
  biometricEnrollmentNo: number | null;
  isHeadOfDepartment: boolean;
  workingTime: string | null;
  intervalTime: string | null;
  weeklyHoliday: string | null;
  shiftAndRelay: string | null;
  changeGroupDescription: string | null;
  nursingCouncilNo: string | null;
  medicalCouncilNo: string | null;
  remarks: string | null;
  userId: string | null;
}

export interface StaffProps extends StaffProfile {
  id: string;
  status: StaffStatus;
  statusReason: string | null;
  separationDate: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const EMPLOYEE_NO = /^[A-Za-z0-9][A-Za-z0-9\-/_.]{0,29}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function assertDate(value: string | null, field: string): void {
  if (value !== null && !isCalendarDate(value)) {
    throw new DomainError('invalid_date', `${field} must be a date (YYYY-MM-DD)`);
  }
}

/** A staff record: profile, organization placement and employment status. */
export class StaffMember {
  private constructor(private readonly props: StaffProps) {}

  static hire(params: { id: string; profile: StaffProfile; now: Date }): StaffMember {
    const staff = new StaffMember({
      ...StaffMember.normalized(params.profile),
      id: params.id,
      status: 'active',
      statusReason: null,
      separationDate: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    staff.assertConsistent();
    return staff;
  }

  static restore(props: StaffProps): StaffMember {
    return new StaffMember({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): StaffStatus {
    return this.props.status;
  }
  get departmentId(): string {
    return this.props.departmentId;
  }
  get subDepartmentId(): string {
    return this.props.subDepartmentId;
  }
  get version(): number {
    return this.props.version;
  }

  /** Changes the given profile fields. Separated staff are read-only history. */
  update(changes: Partial<StaffProfile>, now: Date): void {
    this.assertNotSeparated();
    const next = StaffMember.normalized({ ...this.profile(), ...changes });
    Object.assign(this.props, next);
    this.assertConsistent();
    this.touch(now);
  }

  deactivate(reason: string, now: Date): void {
    this.assertNotSeparated();
    if (this.props.status === 'inactive') throw new DomainError('staff_already_inactive', 'Already inactive');
    this.props.status = 'inactive';
    this.props.statusReason = StaffMember.reason(reason);
    this.touch(now);
  }

  activate(now: Date): void {
    this.assertNotSeparated();
    if (this.props.status === 'active') throw new DomainError('staff_already_active', 'Already active');
    this.props.status = 'active';
    this.props.statusReason = null;
    this.touch(now);
  }

  /** Resignation, termination or retirement. Final: the record stays as history. */
  separate(separationDate: string, reason: string, now: Date): void {
    this.assertNotSeparated();
    assertDate(separationDate, 'Separation date');
    if (separationDate < this.props.joiningDate) {
      throw new DomainError('invalid_separation_date', 'Separation date cannot be before the joining date');
    }
    this.props.status = 'separated';
    this.props.separationDate = separationDate;
    this.props.statusReason = StaffMember.reason(reason);
    this.touch(now);
  }

  toSnapshot(): Readonly<StaffProps> {
    return { ...this.props };
  }

  private profile(): StaffProfile {
    const {
      id: _id,
      status: _s,
      statusReason: _r,
      separationDate: _d,
      version: _v,
      createdAt: _c,
      updatedAt: _u,
      ...profile
    } = this.props;
    return profile;
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version++;
  }

  private assertNotSeparated(): void {
    if (this.props.status === 'separated') {
      throw new DomainError('staff_separated', 'This staff member has been separated; the record can no longer change');
    }
  }

  private assertConsistent(): void {
    const p = this.props;
    if (!EMPLOYEE_NO.test(p.employeeNo)) {
      throw new DomainError('invalid_employee_no', 'Employee number: 1-30 letters, digits or - / _ .');
    }
    if (p.fullName.length < 1 || p.fullName.length > 150) {
      throw new DomainError('invalid_full_name', 'Full name must be 1-150 characters');
    }
    if (p.serviceNature === '' || p.salaryStatus === '') {
      throw new DomainError('missing_employment_terms', 'Service nature and salary status are required');
    }
    if (p.email !== null && !EMAIL.test(p.email)) throw new DomainError('invalid_email', 'Invalid email address');
    assertDate(p.joiningDate, 'Joining date');
    assertDate(p.dateOfBirth, 'Date of birth');
    assertDate(p.probationEndDate, 'Probation end date');
    assertDate(p.confirmationDate, 'Confirmation date');
    if (p.dateOfBirth !== null && p.dateOfBirth >= p.joiningDate) {
      throw new DomainError('invalid_date_of_birth', 'Date of birth must be before the joining date');
    }
    for (const [value, field] of [
      [p.probationEndDate, 'Probation end date'],
      [p.confirmationDate, 'Confirmation date'],
    ] as const) {
      if (value !== null && value < p.joiningDate) {
        throw new DomainError('invalid_employment_dates', `${field} cannot be before the joining date`);
      }
    }
    if (
      p.biometricEnrollmentNo !== null &&
      (!Number.isInteger(p.biometricEnrollmentNo) || p.biometricEnrollmentNo < 0)
    ) {
      throw new DomainError('invalid_biometric_no', 'Biometric enrollment number must be a non-negative integer');
    }
  }

  private static reason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 500)
      throw new DomainError('invalid_reason', 'Give a reason (1-500 characters)');
    return trimmed;
  }

  /** Trims text, turns blank optional text into null, lower-cases the email. */
  private static normalized(profile: StaffProfile): StaffProfile {
    const result = { ...profile };
    for (const [key, value] of Object.entries(result) as Array<[keyof StaffProfile, unknown]>) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        (result as Record<string, unknown>)[key] = trimmed === '' && !REQUIRED_TEXT.has(key) ? null : trimmed;
      }
    }
    if (result.email !== null) result.email = result.email.toLowerCase();
    return result;
  }
}

const REQUIRED_TEXT = new Set<keyof StaffProfile>([
  'employeeNo',
  'fullName',
  'departmentId',
  'subDepartmentId',
  'designationId',
  'joiningDate',
  'serviceNature',
  'salaryStatus',
]);

/** The sub-department must belong to the chosen department (old ValidateSubDepartmentAsync). */
export function assertSubDepartmentOf(
  subDepartment: { departmentId: string; name: string },
  departmentId: string,
): void {
  if (subDepartment.departmentId !== departmentId) {
    throw new DomainError(
      'sub_department_mismatch',
      `Sub-department '${subDepartment.name}' belongs to another department`,
    );
  }
}

export interface EducationEntry {
  examName: string;
  passingYear: number | null;
  subject: string | null;
  result: string | null;
  board: string | null;
}

export interface EmergencyContactEntry {
  name: string;
  contact: string;
  relation: string | null;
}

export function validEducation(entries: readonly EducationEntry[], thisYear: number): EducationEntry[] {
  if (entries.length > 30) throw new DomainError('too_many_entries', 'At most 30 education entries');
  return entries.map((entry) => {
    const examName = entry.examName.trim();
    if (examName === '') throw new DomainError('invalid_education', 'Exam name is required');
    if (entry.passingYear !== null && (entry.passingYear < 1900 || entry.passingYear > thisYear + 1)) {
      throw new DomainError('invalid_education', `Passing year must be between 1900 and ${thisYear + 1}`);
    }
    return { ...entry, examName };
  });
}

export function validEmergencyContacts(entries: readonly EmergencyContactEntry[]): EmergencyContactEntry[] {
  if (entries.length > 10) throw new DomainError('too_many_entries', 'At most 10 emergency contacts');
  return entries.map((entry) => {
    const name = entry.name.trim();
    const contact = entry.contact.trim();
    if (name === '' || contact === '')
      throw new DomainError('invalid_emergency_contact', 'Name and contact are required');
    return { ...entry, name, contact };
  });
}
