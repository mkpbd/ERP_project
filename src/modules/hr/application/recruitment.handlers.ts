import { randomUUID } from 'node:crypto';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { MAX_CV_FILES, validCvFile, type CvFile } from '../domain/recruitment.js';
import { JobApplicationFileRepository, type CvFileInfo } from '../domain/repositories.js';
import { safeFileName } from '../domain/staff-file.js';
import { JOB_APPLICATION, RECRUITMENT_MANAGE, RECRUITMENT_READ } from './hr.constants.js';
import {
  AddApplicationFileCommand,
  GetApplicationFileQuery,
  ListApplicationFilesQuery,
  RemoveApplicationFileCommand,
} from './recruitment.messages.js';

@CommandHandler(AddApplicationFileCommand)
export class AddApplicationFileHandler implements ICommandHandler<AddApplicationFileCommand> {
  constructor(
    private readonly files: JobApplicationFileRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, applicationId, fileName, contentType, data }: AddApplicationFileCommand): Promise<{
    id: string;
  }> {
    await this.access.authorize(actor.userId, { permissions: [RECRUITMENT_MANAGE] });
    const file = validCvFile(contentType, data);
    const name = safeFileName(fileName);
    const id = randomUUID();
    await this.tx.run(async () => {
      // The lock keeps two uploads at once from passing the file limit together.
      if (!(await this.files.lockApplication(applicationId))) throw new NotFoundError(JOB_APPLICATION);
      if ((await this.files.countFiles(applicationId)) >= MAX_CV_FILES) {
        throw new DomainError('too_many_files', `An application can hold up to ${MAX_CV_FILES} files`);
      }
      await this.files.addFile({
        id,
        applicationId,
        fileName: name,
        file,
        uploadedBy: actor.userId,
        now: this.clock.now(),
      });
      await this.audit.record({
        action: `${JOB_APPLICATION}.file_added`,
        actorUserId: actor.userId,
        resourceType: JOB_APPLICATION,
        resourceId: applicationId,
        metadata: { fileId: id, contentType: file.contentType, bytes: file.data.length },
      });
    });
    return { id };
  }
}

@CommandHandler(RemoveApplicationFileCommand)
export class RemoveApplicationFileHandler implements ICommandHandler<RemoveApplicationFileCommand> {
  constructor(
    private readonly files: JobApplicationFileRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, applicationId, fileId }: RemoveApplicationFileCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [RECRUITMENT_MANAGE] });
    await this.tx.run(async () => {
      if (!(await this.files.removeFile(applicationId, fileId))) throw new NotFoundError('job_application_file');
      await this.audit.record({
        action: `${JOB_APPLICATION}.file_removed`,
        actorUserId: actor.userId,
        resourceType: JOB_APPLICATION,
        resourceId: applicationId,
        metadata: { fileId },
      });
    });
  }
}

@QueryHandler(ListApplicationFilesQuery)
export class ListApplicationFilesHandler implements IQueryHandler<ListApplicationFilesQuery> {
  constructor(
    private readonly files: JobApplicationFileRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, applicationId }: ListApplicationFilesQuery): Promise<CvFileInfo[]> {
    await this.access.authorize(actor.userId, { permissions: [RECRUITMENT_READ] });
    const files = await this.files.listFiles(applicationId);
    if (!files) throw new NotFoundError(JOB_APPLICATION);
    return files;
  }
}

@QueryHandler(GetApplicationFileQuery)
export class GetApplicationFileHandler implements IQueryHandler<GetApplicationFileQuery> {
  constructor(
    private readonly files: JobApplicationFileRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, applicationId, fileId }: GetApplicationFileQuery): Promise<CvFile & { fileName: string }> {
    await this.access.authorize(actor.userId, { permissions: [RECRUITMENT_READ] });
    const file = await this.files.findFile(applicationId, fileId);
    if (!file) throw new NotFoundError('job_application_file');
    return file;
  }
}

export const RECRUITMENT_HANDLERS = [
  AddApplicationFileHandler,
  RemoveApplicationFileHandler,
  ListApplicationFilesHandler,
  GetApplicationFileHandler,
];
