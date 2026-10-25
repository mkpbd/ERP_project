import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import {
  foreignKeyViolationConstraint,
  uniqueViolationConstraint,
} from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { OrgStructureRepository, StaffFileRepository, StaffRepository } from '../../domain/repositories.js';
import type { DocumentCategory, StoredFile } from '../../domain/staff-file.js';
import { StaffMember, type EducationEntry, type EmergencyContactEntry } from '../../domain/staff-member.js';
import type { DocumentType } from '../../../../shared/domain/file-types.js';
import {
  hrSubDepartments,
  staffDocuments,
  staffEducation,
  staffEmergencyContacts,
  staffFestivals,
  staffPhotos,
  staffRecords,
} from './hr.schema.js';

const UNIQUE: Record<string, [string, string]> = {
  staff_records_employee_no_uq: ['employee_no_taken', 'Another staff record has this employee number'],
  staff_records_biometric_uq: ['biometric_no_taken', 'Another staff record has this biometric enrollment number'],
  staff_records_user_uq: ['user_already_linked', 'This user account is already linked to another staff record'],
};

const REFERENCES: Record<string, string> = {
  staff_records_department_id_hr_departments_id_fk: 'hr_department',
  staff_records_sub_department_id_hr_sub_departments_id_fk: 'hr_sub_department',
  staff_records_designation_id_designations_id_fk: 'designation',
  staff_records_joining_designation_id_designations_id_fk: 'designation',
  staff_records_division_id_hr_divisions_id_fk: 'hr_division',
  staff_records_nationality_country_id_countries_id_fk: 'country',
  staff_records_user_id_users_id_fk: 'user',
  staff_festivals_festival_id_festivals_id_fk: 'festival',
};

function translate(error: unknown): never {
  const unique = uniqueViolationConstraint(error);
  const conflict = unique !== null ? UNIQUE[unique] : undefined;
  if (conflict) throw new ConflictError(conflict[0], conflict[1]);
  const reference = foreignKeyViolationConstraint(error);
  if (reference !== null) throw new NotFoundError(REFERENCES[reference] ?? 'referenced_record');
  throw error;
}

@Injectable()
export class DrizzleStaffRepository extends StaffRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findByIdForUpdate(id: string): Promise<StaffMember | null> {
    const [row] = await this.context.db.select().from(staffRecords).where(eq(staffRecords.id, id)).for('update');
    return row ? StaffMember.restore(row) : null;
  }

  async insert(staff: StaffMember): Promise<void> {
    try {
      await this.context.db.insert(staffRecords).values(staff.toSnapshot());
    } catch (error) {
      translate(error);
    }
  }

  async update(staff: StaffMember): Promise<void> {
    const { id, createdAt: _createdAt, ...changes } = staff.toSnapshot();
    try {
      await this.context.db.update(staffRecords).set(changes).where(eq(staffRecords.id, id));
    } catch (error) {
      translate(error);
    }
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: staffRecords.id })
      .from(staffRecords)
      .where(eq(staffRecords.id, id));
    return row !== undefined;
  }

  async replaceEducation(staffId: string, entries: readonly EducationEntry[]): Promise<void> {
    await this.context.db.delete(staffEducation).where(eq(staffEducation.staffId, staffId));
    if (entries.length === 0) return;
    await this.context.db
      .insert(staffEducation)
      .values(entries.map((entry, position) => ({ id: randomUUID(), staffId, position, ...entry })));
  }

  async replaceEmergencyContacts(staffId: string, entries: readonly EmergencyContactEntry[]): Promise<void> {
    await this.context.db.delete(staffEmergencyContacts).where(eq(staffEmergencyContacts.staffId, staffId));
    if (entries.length === 0) return;
    await this.context.db
      .insert(staffEmergencyContacts)
      .values(entries.map((entry, position) => ({ id: randomUUID(), staffId, position, ...entry })));
  }

  async replaceFestivals(staffId: string, festivalIds: readonly string[]): Promise<void> {
    await this.context.db.delete(staffFestivals).where(eq(staffFestivals.staffId, staffId));
    if (festivalIds.length === 0) return;
    try {
      await this.context.db.insert(staffFestivals).values(festivalIds.map((festivalId) => ({ staffId, festivalId })));
    } catch (error) {
      translate(error);
    }
  }
}

@Injectable()
export class DrizzleOrgStructureRepository extends OrgStructureRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async subDepartment(id: string): Promise<{ departmentId: string; name: string } | null> {
    const [row] = await this.context.db
      .select({ departmentId: hrSubDepartments.departmentId, name: hrSubDepartments.name })
      .from(hrSubDepartments)
      .where(eq(hrSubDepartments.id, id));
    return row ?? null;
  }
}

@Injectable()
export class DrizzleStaffFileRepository extends StaffFileRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async savePhoto(staffId: string, photo: StoredFile, updatedBy: string, now: Date): Promise<void> {
    const row = { contentType: photo.contentType, data: Buffer.from(photo.data), updatedAt: now, updatedBy };
    await this.context.db
      .insert(staffPhotos)
      .values({ staffId, ...row })
      .onConflictDoUpdate({ target: staffPhotos.staffId, set: row });
  }

  async findPhoto(staffId: string): Promise<StoredFile | null> {
    const [row] = await this.context.db
      .select({ contentType: staffPhotos.contentType, data: staffPhotos.data })
      .from(staffPhotos)
      .where(eq(staffPhotos.staffId, staffId));
    // staff_photos_type_ck guarantees the content type.
    return row ? { contentType: row.contentType as DocumentType, data: row.data } : null;
  }

  async removePhoto(staffId: string): Promise<boolean> {
    const rows = await this.context.db
      .delete(staffPhotos)
      .where(eq(staffPhotos.staffId, staffId))
      .returning({ staffId: staffPhotos.staffId });
    return rows.length > 0;
  }

  async addDocument(document: {
    id: string;
    staffId: string;
    category: DocumentCategory;
    fileName: string;
    file: StoredFile;
    uploadedBy: string;
    now: Date;
  }): Promise<void> {
    await this.context.db.insert(staffDocuments).values({
      id: document.id,
      staffId: document.staffId,
      category: document.category,
      fileName: document.fileName,
      contentType: document.file.contentType,
      sizeBytes: document.file.data.length,
      data: Buffer.from(document.file.data),
      uploadedAt: document.now,
      uploadedBy: document.uploadedBy,
    });
  }

  async findDocument(staffId: string, documentId: string): Promise<(StoredFile & { fileName: string }) | null> {
    const [row] = await this.context.db
      .select({ contentType: staffDocuments.contentType, data: staffDocuments.data, fileName: staffDocuments.fileName })
      .from(staffDocuments)
      .where(and(eq(staffDocuments.staffId, staffId), eq(staffDocuments.id, documentId)));
    // staff_documents_type_ck guarantees the content type.
    return row ? { ...row, contentType: row.contentType as DocumentType } : null;
  }

  async removeDocument(staffId: string, documentId: string): Promise<boolean> {
    const rows = await this.context.db
      .delete(staffDocuments)
      .where(and(eq(staffDocuments.staffId, staffId), eq(staffDocuments.id, documentId)))
      .returning({ id: staffDocuments.id });
    return rows.length > 0;
  }
}
