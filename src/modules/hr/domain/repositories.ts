import type { EducationEntry, EmergencyContactEntry, StaffMember } from './staff-member.js';
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
