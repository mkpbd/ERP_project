import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { CvFile } from '../domain/recruitment.js';
import type { CvFileInfo } from '../domain/repositories.js';

export class AddApplicationFileCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly fileName: string,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemoveApplicationFileCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly fileId: string,
  ) {
    super();
  }
}

export class ListApplicationFilesQuery extends Query<CvFileInfo[]> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
  ) {
    super();
  }
}

export class GetApplicationFileQuery extends Query<CvFile & { fileName: string }> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly fileId: string,
  ) {
    super();
  }
}
