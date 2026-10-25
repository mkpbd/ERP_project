import { fileURLToPath } from 'node:url';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import {
  JOB_APPLICATION_STATUSES,
  jobApplicationFiles,
  jobApplications,
  jobCirculars,
} from '../persistence/recruitment.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const STATUS_LABELS: Record<(typeof JOB_APPLICATION_STATUSES)[number], string> = {
  received: 'Received',
  shortlisted: 'Shortlisted',
  interviewed: 'Interviewed',
  selected: 'Selected',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Applicants to one circular (the old system only listed JobCvs on screen). */
export function jobApplicationsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hr.job-applications',
    title: 'Job applicants',
    group: 'HR',
    description: 'Applicants to a job circular with their status and number of CV files.',
    params: z.strictObject({ circularId: z.uuid(), status: z.enum(JOB_APPLICATION_STATUSES).optional() }),
    async load(params) {
      const [circular] = await context.db
        .select({ circularNo: jobCirculars.circularNo, title: jobCirculars.title })
        .from(jobCirculars)
        .where(eq(jobCirculars.id, params.circularId));
      if (!circular) throw new NotFoundError('job_circular');
      const files = context.db
        .select({ applicationId: jobApplicationFiles.applicationId, n: count().as('n') })
        .from(jobApplicationFiles)
        .groupBy(jobApplicationFiles.applicationId)
        .as('files');
      const rows = await context.db
        .select({
          applicantName: jobApplications.applicantName,
          mobileNo: jobApplications.mobileNo,
          email: jobApplications.email,
          appliedFor: jobApplications.appliedFor,
          createdAt: jobApplications.createdAt,
          status: jobApplications.status,
          remarks: jobApplications.remarks,
          files: files.n,
        })
        .from(jobApplications)
        .leftJoin(files, eq(files.applicationId, jobApplications.id))
        .where(
          and(
            eq(jobApplications.circularId, params.circularId),
            params.status ? eq(jobApplications.status, params.status) : undefined,
          ),
        )
        .orderBy(asc(jobApplications.createdAt), asc(jobApplications.applicantName));
      const report = rows.map(({ createdAt, ...row }) => ({
        ...row,
        receivedOn: createdAt,
        statusLabel: STATUS_LABELS[row.status],
        files: row.files ?? 0,
      }));
      const counts = JOB_APPLICATION_STATUSES.map((status) => ({
        label: STATUS_LABELS[status],
        count: report.filter((row) => row.status === status).length,
      })).filter((entry) => entry.count > 0);
      return { circular, rows: report, counts };
    },
    describe: (params, data) =>
      `${data.circular.circularNo} — ${data.circular.title}${params.status ? ` · ${STATUS_LABELS[params.status]}` : ''}`,
    pdf: { engine: 'html', template: template('job-applications'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'applicantName', header: 'Applicant', width: 26 },
        { key: 'mobileNo', header: 'Mobile', width: 16 },
        { key: 'email', header: 'Email', width: 26 },
        { key: 'appliedFor', header: 'Applied for', width: 22 },
        { key: 'receivedOn', header: 'Received', format: 'datetime' },
        { key: 'statusLabel', header: 'Status', width: 12 },
        { key: 'files', header: 'CV files', format: 'integer' },
        { key: 'remarks', header: 'Remarks', width: 30 },
      ],
      rows: data.rows,
    }),
  });
}
