import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  StaffReadRepository,
  type StaffDetailView,
  type StaffListFilter,
  type StaffSummaryView,
} from '../../application/read-models.js';
import {
  designations,
  hrDepartments,
  hrSubDepartments,
  staffDocuments,
  staffEducation,
  staffEmergencyContacts,
  staffFestivals,
  staffPhotos,
  staffRecords,
} from './hr.schema.js';

@Injectable()
export class DrizzleStaffReadRepository extends StaffReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async list(filter: StaffListFilter): Promise<Page<StaffSummaryView>> {
    const conditions: Array<SQL | undefined> = [
      filter.status ? eq(staffRecords.status, filter.status) : undefined,
      filter.departmentId ? eq(staffRecords.departmentId, filter.departmentId) : undefined,
      filter.designationId ? eq(staffRecords.designationId, filter.designationId) : undefined,
      filter.joinedFrom ? gte(staffRecords.joiningDate, filter.joinedFrom) : undefined,
      filter.joinedTo ? lte(staffRecords.joiningDate, filter.joinedTo) : undefined,
    ];
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        or(
          ilike(staffRecords.fullName, pattern),
          ilike(staffRecords.employeeNo, pattern),
          ilike(staffRecords.mobileNo, pattern),
        ),
      );
    }
    const where = and(...conditions);
    const [totals] = await this.context.db.select({ total: count() }).from(staffRecords).where(where);
    const items = await this.context.db
      .select({
        id: staffRecords.id,
        employeeNo: staffRecords.employeeNo,
        fullName: staffRecords.fullName,
        departmentId: staffRecords.departmentId,
        departmentName: hrDepartments.name,
        subDepartmentName: hrSubDepartments.name,
        designationId: staffRecords.designationId,
        designationName: designations.name,
        mobileNo: staffRecords.mobileNo,
        joiningDate: staffRecords.joiningDate,
        status: staffRecords.status,
      })
      .from(staffRecords)
      .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
      .innerJoin(hrSubDepartments, eq(hrSubDepartments.id, staffRecords.subDepartmentId))
      .innerJoin(designations, eq(designations.id, staffRecords.designationId))
      .where(where)
      .orderBy(asc(staffRecords.employeeNo))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    return toPage(items, totals?.total ?? 0, filter);
  }

  async get(id: string): Promise<StaffDetailView | null> {
    const [row] = await this.context.db
      .select({
        staff: staffRecords,
        departmentName: hrDepartments.name,
        subDepartmentName: hrSubDepartments.name,
        designationName: designations.name,
        photoType: staffPhotos.contentType,
      })
      .from(staffRecords)
      .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
      .innerJoin(hrSubDepartments, eq(hrSubDepartments.id, staffRecords.subDepartmentId))
      .innerJoin(designations, eq(designations.id, staffRecords.designationId))
      .leftJoin(staffPhotos, eq(staffPhotos.staffId, staffRecords.id))
      .where(eq(staffRecords.id, id));
    if (!row) return null;

    const [education, emergencyContacts, festivals, documents] = await Promise.all([
      this.context.db
        .select({
          examName: staffEducation.examName,
          passingYear: staffEducation.passingYear,
          subject: staffEducation.subject,
          result: staffEducation.result,
          board: staffEducation.board,
        })
        .from(staffEducation)
        .where(eq(staffEducation.staffId, id))
        .orderBy(asc(staffEducation.position)),
      this.context.db
        .select({
          name: staffEmergencyContacts.name,
          contact: staffEmergencyContacts.contact,
          relation: staffEmergencyContacts.relation,
        })
        .from(staffEmergencyContacts)
        .where(eq(staffEmergencyContacts.staffId, id))
        .orderBy(asc(staffEmergencyContacts.position)),
      this.context.db
        .select({ festivalId: staffFestivals.festivalId })
        .from(staffFestivals)
        .where(eq(staffFestivals.staffId, id)),
      this.context.db
        .select({
          id: staffDocuments.id,
          category: staffDocuments.category,
          fileName: staffDocuments.fileName,
          contentType: staffDocuments.contentType,
          sizeBytes: staffDocuments.sizeBytes,
          uploadedAt: staffDocuments.uploadedAt,
        })
        .from(staffDocuments)
        .where(eq(staffDocuments.staffId, id))
        .orderBy(asc(staffDocuments.uploadedAt)),
    ]);

    const { version: _version, ...staff } = row.staff;
    return {
      ...staff,
      departmentName: row.departmentName,
      subDepartmentName: row.subDepartmentName,
      designationName: row.designationName,
      hasPhoto: row.photoType !== null,
      education,
      emergencyContacts,
      festivalIds: festivals.map((festival) => festival.festivalId).sort(),
      documents,
    };
  }

  async idForUser(userId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: staffRecords.id })
      .from(staffRecords)
      .where(eq(staffRecords.userId, userId));
    return row?.id ?? null;
  }

  async ownerOf(staffId: string): Promise<string | null | undefined> {
    const [row] = await this.context.db
      .select({ userId: staffRecords.userId })
      .from(staffRecords)
      .where(eq(staffRecords.id, staffId));
    return row ? row.userId : undefined;
  }
}
