import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { JOB_APPLICATION, JOB_CIRCULAR, RECRUITMENT_MANAGE, RECRUITMENT_READ } from '../../application/hr.constants.js';
import { jobApplications, jobCirculars } from './recruitment.schema.js';

export function recruitmentRecordTypes(context: DbContext): RecordType[] {
  const recruitment = { readPermission: RECRUITMENT_READ, managePermission: RECRUITMENT_MANAGE };
  return [
    {
      name: JOB_CIRCULAR,
      ...recruitment,
      store: new DrizzleRecordStore(context, jobCirculars, {
        name: JOB_CIRCULAR,
        orderBy: [jobCirculars.createdAt],
        filters: {
          departmentId: jobCirculars.departmentId,
          designationId: jobCirculars.designationId,
          from: { column: jobCirculars.publishedOn, op: 'gte' },
          to: { column: jobCirculars.publishedOn, op: 'lte' },
        },
        unique: {
          job_circulars_no_uq: { code: 'circular_no_taken', message: 'A circular with this number already exists' },
        },
        references: {
          job_circulars_department_id_hr_departments_id_fk: 'hr_department',
          job_circulars_designation_id_designations_id_fk: 'designation',
        },
      }),
    },
    {
      name: JOB_APPLICATION,
      ...recruitment,
      store: new DrizzleRecordStore(context, jobApplications, {
        name: JOB_APPLICATION,
        orderBy: [jobApplications.createdAt],
        filters: {
          circularId: jobApplications.circularId,
          status: jobApplications.status,
          mobileNo: jobApplications.mobileNo,
        },
        unique: {
          job_applications_circular_mobile_uq: {
            code: 'application_exists',
            message: 'This mobile number has already applied to this circular',
          },
        },
        references: { job_applications_circular_id_job_circulars_id_fk: 'job_circular' },
      }),
    },
  ];
}
