import type { ApprovalLevel, LeaveApplication, LeavePolicyTerms } from './leave.js';
import type { EducationEntry, EmergencyContactEntry, StaffMember, StaffStatus } from './staff-member.js';
import type { DocumentCategory, StoredFile } from './staff-file.js';

export abstract class StaffRepository {
  /** Locks the row until the surrounding transaction ends. */
  abstract findByIdForUpdate(id: string): Promise<StaffMember | null>;
  /** Throws ConflictError for a duplicate employee number, biometric number or user link; NotFoundError for a missing reference. */
  abstract insert(staff: StaffMember): Promise<void>;
  abstract update(staff: StaffMember): Promise<void>;
  abstract exists(id: string): Promise<boolean>;
  abstract replaceEducation(staffId: string, entries: readonly EducationEntry[]): Promise<void>;
  abstract replaceEmergencyContacts(staffId: string, entries: readonly EmergencyContactEntry[]): Promise<void>;
  /** Throws NotFoundError (festival) for an unknown festival. */
  abstract replaceFestivals(staffId: string, festivalIds: readonly string[]): Promise<void>;
}

export abstract class LeaveRepository {
  abstract insert(application: LeaveApplication): Promise<void>;
  /** Locks the row until the surrounding transaction ends. */
  abstract findForUpdate(id: string): Promise<LeaveApplication | null>;
  /** Saves the application and the approval steps it recorded. */
  abstract update(application: LeaveApplication): Promise<void>;
  /** Pending or approved applications, or recorded leave, overlapping the period. */
  abstract overlaps(staffId: string, startDate: string, endDate: string): Promise<boolean>;
  /** Days of one leave type in a year: taken (approved + recorded) and pending. */
  abstract usage(staffId: string, year: number, leaveTypeId: string): Promise<{ taken: number; pending: number }>;
  abstract approvalLevels(departmentId: string): Promise<ApprovalLevel[]>;
  abstract leaveTypeExists(id: string): Promise<boolean>;
}

/** The year's policy for a staff member: their own if HR set one, else the organization's. */
export abstract class LeavePolicyRepository {
  abstract effectiveTerms(staffId: string, year: number): Promise<LeavePolicyTerms | null>;
  abstract saveYearly(year: number, terms: LeavePolicyTerms, updatedBy: string, now: Date): Promise<void>;
  abstract deleteYearly(year: number): Promise<boolean>;
  abstract saveForStaff(
    staffId: string,
    year: number,
    terms: LeavePolicyTerms,
    updatedBy: string,
    now: Date,
  ): Promise<void>;
  abstract deleteForStaff(staffId: string, year: number): Promise<boolean>;
}

/** Facts about staff that leave rules need. */
export abstract class StaffFacts {
  abstract placement(staffId: string): Promise<{ departmentId: string; status: StaffStatus } | null>;
  abstract staffIdForUser(userId: string): Promise<string | null>;
  abstract isDelegate(delegateStaffId: string, onBehalfOfStaffId: string): Promise<boolean>;
}

export abstract class OrgStructureRepository {
  abstract subDepartment(id: string): Promise<{ departmentId: string; name: string } | null>;
}

export abstract class StaffFileRepository {
  abstract savePhoto(staffId: string, photo: StoredFile, updatedBy: string, now: Date): Promise<void>;
  abstract findPhoto(staffId: string): Promise<StoredFile | null>;
  abstract removePhoto(staffId: string): Promise<boolean>;
  abstract addDocument(document: {
    id: string;
    staffId: string;
    category: DocumentCategory;
    fileName: string;
    file: StoredFile;
    uploadedBy: string;
    now: Date;
  }): Promise<void>;
  abstract findDocument(staffId: string, documentId: string): Promise<(StoredFile & { fileName: string }) | null>;
  abstract removeDocument(staffId: string, documentId: string): Promise<boolean>;
}
