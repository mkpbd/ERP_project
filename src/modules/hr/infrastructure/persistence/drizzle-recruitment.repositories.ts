import { Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { CvFile, CvType } from '../../domain/recruitment.js';
import { JobApplicationFileRepository, type CvFileInfo } from '../../domain/repositories.js';
import { jobApplicationFiles, jobApplications } from './recruitment.schema.js';

@Injectable()
export class DrizzleJobApplicationFileRepository extends JobApplicationFileRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async lockApplication(applicationId: string): Promise<boolean> {
    const rows = await this.context.db
      .select({ id: jobApplications.id })
      .from(jobApplications)
      .where(eq(jobApplications.id, applicationId))
      .for('update');
    return rows.length > 0;
  }

  async countFiles(applicationId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(jobApplicationFiles)
      .where(eq(jobApplicationFiles.applicationId, applicationId));
    return row?.n ?? 0;
  }

  async addFile(file: {
    id: string;
    applicationId: string;
    fileName: string;
    file: CvFile;
    uploadedBy: string;
    now: Date;
  }): Promise<void> {
    await this.context.db.insert(jobApplicationFiles).values({
      id: file.id,
      applicationId: file.applicationId,
      fileName: file.fileName,
      contentType: file.file.contentType,
      sizeBytes: file.file.data.length,
      data: Buffer.from(file.file.data),
      uploadedAt: file.now,
      uploadedBy: file.uploadedBy,
    });
  }

  async listFiles(applicationId: string): Promise<CvFileInfo[] | null> {
    const [application] = await this.context.db
      .select({ id: jobApplications.id })
      .from(jobApplications)
      .where(eq(jobApplications.id, applicationId));
    if (!application) return null;
    const rows = await this.context.db
      .select({
        id: jobApplicationFiles.id,
        fileName: jobApplicationFiles.fileName,
        contentType: jobApplicationFiles.contentType,
        sizeBytes: jobApplicationFiles.sizeBytes,
        uploadedAt: jobApplicationFiles.uploadedAt,
        uploadedBy: jobApplicationFiles.uploadedBy,
      })
      .from(jobApplicationFiles)
      .where(eq(jobApplicationFiles.applicationId, applicationId))
      .orderBy(asc(jobApplicationFiles.uploadedAt));
    // job_application_files_type_ck guarantees the content type.
    return rows.map((row) => ({ ...row, contentType: row.contentType as CvType }));
  }

  async findFile(applicationId: string, fileId: string): Promise<(CvFile & { fileName: string }) | null> {
    const [row] = await this.context.db
      .select({
        contentType: jobApplicationFiles.contentType,
        data: jobApplicationFiles.data,
        fileName: jobApplicationFiles.fileName,
      })
      .from(jobApplicationFiles)
      .where(and(eq(jobApplicationFiles.applicationId, applicationId), eq(jobApplicationFiles.id, fileId)));
    return row ? { ...row, contentType: row.contentType as CvType } : null;
  }

  async removeFile(applicationId: string, fileId: string): Promise<boolean> {
    const rows = await this.context.db
      .delete(jobApplicationFiles)
      .where(and(eq(jobApplicationFiles.applicationId, applicationId), eq(jobApplicationFiles.id, fileId)))
      .returning({ id: jobApplicationFiles.id });
    return rows.length > 0;
  }
}
