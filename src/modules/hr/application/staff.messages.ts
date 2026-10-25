import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { DocumentCategory, StoredFile } from '../domain/staff-file.js';
import type { EducationEntry, EmergencyContactEntry, StaffProfile } from '../domain/staff-member.js';
import type { StaffDetailView, StaffListFilter, StaffSummaryView } from './read-models.js';

export class HireStaffCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly profile: StaffProfile,
  ) {
    super();
  }
}

export class UpdateStaffCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly changes: Partial<StaffProfile>,
  ) {
    super();
  }
}

export class DeactivateStaffCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class ActivateStaffCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
  ) {
    super();
  }
}

export class SeparateStaffCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly separationDate: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class ReplaceStaffEducationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly entries: readonly EducationEntry[],
  ) {
    super();
  }
}

export class ReplaceStaffEmergencyContactsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly entries: readonly EmergencyContactEntry[],
  ) {
    super();
  }
}

export class ReplaceStaffFestivalsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly festivalIds: readonly string[],
  ) {
    super();
  }
}

export class SetStaffPhotoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemoveStaffPhotoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
  ) {
    super();
  }
}

export class AddStaffDocumentCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly category: DocumentCategory,
    readonly fileName: string,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemoveStaffDocumentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly documentId: string,
  ) {
    super();
  }
}

export class ListStaffQuery extends Query<Page<StaffSummaryView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: StaffListFilter,
  ) {
    super();
  }
}

export class GetStaffQuery extends Query<StaffDetailView> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
  ) {
    super();
  }
}

export class GetMyStaffRecordQuery extends Query<StaffDetailView> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetStaffPhotoQuery extends Query<StoredFile> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
  ) {
    super();
  }
}

export class GetStaffDocumentQuery extends Query<StoredFile & { fileName: string }> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly documentId: string,
  ) {
    super();
  }
}
