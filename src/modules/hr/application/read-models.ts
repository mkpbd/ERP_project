import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { DocumentCategory } from '../domain/staff-file.js';
import type { EducationEntry, EmergencyContactEntry, StaffProps, StaffStatus } from '../domain/staff-member.js';

export interface StaffSummaryView {
  readonly id: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly subDepartmentName: string;
  readonly designationId: string;
  readonly designationName: string;
  readonly mobileNo: string | null;
  readonly joiningDate: string;
  readonly status: StaffStatus;
}

export interface StaffDocumentView {
  readonly id: string;
  readonly category: DocumentCategory;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export type StaffDetailView = Omit<StaffProps, 'version'> & {
  readonly departmentName: string;
  readonly subDepartmentName: string;
  readonly designationName: string;
  readonly hasPhoto: boolean;
  readonly education: EducationEntry[];
  readonly emergencyContacts: EmergencyContactEntry[];
  readonly festivalIds: string[];
  readonly documents: StaffDocumentView[];
};

export interface StaffListFilter extends PageRequest {
  readonly search?: string;
  readonly status?: StaffStatus;
  readonly departmentId?: string;
  readonly designationId?: string;
  readonly joinedFrom?: string;
  readonly joinedTo?: string;
}

export abstract class StaffReadRepository {
  abstract list(filter: StaffListFilter): Promise<Page<StaffSummaryView>>;
  abstract get(id: string): Promise<StaffDetailView | null>;
  abstract idForUser(userId: string): Promise<string | null>;
  /** The linked user of a staff record (for "own record" access), or undefined when the record does not exist. */
  abstract ownerOf(staffId: string): Promise<string | null | undefined>;
}
