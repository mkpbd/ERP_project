import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail, type AuditEntry } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { OrgStructureRepository, StaffFileRepository, StaffRepository } from '../domain/repositories.js';
import { safeFileName, validDocument, validPhoto, type StoredFile } from '../domain/staff-file.js';
import { assertSubDepartmentOf, StaffMember, validEducation, validEmergencyContacts } from '../domain/staff-member.js';
import { HR_MANAGE, HR_READ } from './hr.constants.js';
import { StaffReadRepository, type StaffDetailView, type StaffSummaryView } from './read-models.js';
import {
  ActivateStaffCommand,
  AddStaffDocumentCommand,
  DeactivateStaffCommand,
  GetMyStaffRecordQuery,
  GetStaffDocumentQuery,
  GetStaffPhotoQuery,
  GetStaffQuery,
  HireStaffCommand,
  ListStaffQuery,
  RemoveStaffDocumentCommand,
  RemoveStaffPhotoCommand,
  ReplaceStaffEducationCommand,
  ReplaceStaffEmergencyContactsCommand,
  ReplaceStaffFestivalsCommand,
  SeparateStaffCommand,
  SetStaffPhotoCommand,
  UpdateStaffCommand,
} from './staff.messages.js';

type AuditMetadata = AuditEntry['metadata'];

/** The shape every staff change shares: hr:manage, one transaction, the row locked, one audit entry. */
@Injectable()
export class StaffChanges {
  constructor(
    readonly staff: StaffRepository,
    readonly files: StaffFileRepository,
    private readonly org: OrgStructureRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    readonly clock: Clock,
  ) {}

  async run(
    actor: Actor,
    staffId: string,
    action: string,
    change: (now: Date) => Promise<AuditMetadata | void>,
  ): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [HR_MANAGE] });
    await this.tx.run(async () => {
      if (!(await this.staff.exists(staffId))) throw new NotFoundError('staff');
      const metadata = await change(this.clock.now());
      await this.audit.record({
        action: `staff.${action}`,
        actorUserId: actor.userId,
        resourceType: 'staff',
        resourceId: staffId,
        ...(metadata ? { metadata } : {}),
      });
    });
  }

  /** Loads the aggregate locked, applies `mutate` and saves it. */
  async mutate(
    actor: Actor,
    staffId: string,
    action: string,
    mutate: (staff: StaffMember, now: Date) => Promise<AuditMetadata | void> | AuditMetadata | void,
  ): Promise<void> {
    await this.run(actor, staffId, action, async (now) => {
      const staff = await this.staff.findByIdForUpdate(staffId);
      if (!staff) throw new NotFoundError('staff');
      const metadata = await mutate(staff, now);
      await this.staff.update(staff);
      return metadata;
    });
  }

  async assertPlacement(departmentId: string, subDepartmentId: string): Promise<void> {
    const subDepartment = await this.org.subDepartment(subDepartmentId);
    if (!subDepartment) throw new NotFoundError('hr_sub_department');
    assertSubDepartmentOf(subDepartment, departmentId);
  }
}

@CommandHandler(HireStaffCommand)
export class HireStaffHandler implements ICommandHandler<HireStaffCommand> {
  constructor(
    private readonly changes: StaffChanges,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, profile }: HireStaffCommand): Promise<{ id: string }> {
    await this.access.authorize(actor.userId, { permissions: [HR_MANAGE] });
    const staff = StaffMember.hire({ id: randomUUID(), profile, now: this.changes.clock.now() });
    await this.tx.run(async () => {
      await this.changes.assertPlacement(staff.departmentId, staff.subDepartmentId);
      await this.changes.staff.insert(staff);
      await this.audit.record({
        action: 'staff.hired',
        actorUserId: actor.userId,
        resourceType: 'staff',
        resourceId: staff.id,
        metadata: { employeeNo: staff.toSnapshot().employeeNo },
      });
    });
    return { id: staff.id };
  }
}

@CommandHandler(UpdateStaffCommand)
export class UpdateStaffHandler implements ICommandHandler<UpdateStaffCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, changes }: UpdateStaffCommand): Promise<void> {
    await this.changes.mutate(actor, staffId, 'updated', async (staff, now) => {
      staff.update(changes, now);
      if (changes.departmentId !== undefined || changes.subDepartmentId !== undefined) {
        await this.changes.assertPlacement(staff.departmentId, staff.subDepartmentId);
      }
      return { fields: Object.keys(changes).sort() };
    });
  }
}

@CommandHandler(DeactivateStaffCommand)
export class DeactivateStaffHandler implements ICommandHandler<DeactivateStaffCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, reason }: DeactivateStaffCommand): Promise<void> {
    await this.changes.mutate(actor, staffId, 'deactivated', (staff, now) => staff.deactivate(reason, now));
  }
}

@CommandHandler(ActivateStaffCommand)
export class ActivateStaffHandler implements ICommandHandler<ActivateStaffCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId }: ActivateStaffCommand): Promise<void> {
    await this.changes.mutate(actor, staffId, 'activated', (staff, now) => staff.activate(now));
  }
}

@CommandHandler(SeparateStaffCommand)
export class SeparateStaffHandler implements ICommandHandler<SeparateStaffCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, separationDate, reason }: SeparateStaffCommand): Promise<void> {
    await this.changes.mutate(actor, staffId, 'separated', (staff, now) => {
      staff.separate(separationDate, reason, now);
      return { separationDate };
    });
  }
}

@CommandHandler(ReplaceStaffEducationCommand)
export class ReplaceStaffEducationHandler implements ICommandHandler<ReplaceStaffEducationCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, entries }: ReplaceStaffEducationCommand): Promise<void> {
    await this.changes.run(actor, staffId, 'education_replaced', async (now) => {
      await this.changes.staff.replaceEducation(staffId, validEducation(entries, now.getUTCFullYear()));
      return { entries: entries.length };
    });
  }
}

@CommandHandler(ReplaceStaffEmergencyContactsCommand)
export class ReplaceStaffEmergencyContactsHandler implements ICommandHandler<ReplaceStaffEmergencyContactsCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, entries }: ReplaceStaffEmergencyContactsCommand): Promise<void> {
    await this.changes.run(actor, staffId, 'emergency_contacts_replaced', async () => {
      await this.changes.staff.replaceEmergencyContacts(staffId, validEmergencyContacts(entries));
      return { entries: entries.length };
    });
  }
}

@CommandHandler(ReplaceStaffFestivalsCommand)
export class ReplaceStaffFestivalsHandler implements ICommandHandler<ReplaceStaffFestivalsCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, festivalIds }: ReplaceStaffFestivalsCommand): Promise<void> {
    const unique = [...new Set(festivalIds)];
    await this.changes.run(actor, staffId, 'festivals_replaced', async () => {
      await this.changes.staff.replaceFestivals(staffId, unique);
      return { festivalIds: unique };
    });
  }
}

@CommandHandler(SetStaffPhotoCommand)
export class SetStaffPhotoHandler implements ICommandHandler<SetStaffPhotoCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, contentType, data }: SetStaffPhotoCommand): Promise<void> {
    const photo = validPhoto(contentType, data);
    await this.changes.run(actor, staffId, 'photo_set', async (now) => {
      await this.changes.files.savePhoto(staffId, photo, actor.userId, now);
      return { contentType: photo.contentType, bytes: photo.data.length };
    });
  }
}

@CommandHandler(RemoveStaffPhotoCommand)
export class RemoveStaffPhotoHandler implements ICommandHandler<RemoveStaffPhotoCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId }: RemoveStaffPhotoCommand): Promise<void> {
    await this.changes.run(actor, staffId, 'photo_removed', async () => {
      if (!(await this.changes.files.removePhoto(staffId))) throw new NotFoundError('staff_photo');
    });
  }
}

@CommandHandler(AddStaffDocumentCommand)
export class AddStaffDocumentHandler implements ICommandHandler<AddStaffDocumentCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, category, fileName, contentType, data }: AddStaffDocumentCommand): Promise<{
    id: string;
  }> {
    const file = validDocument(contentType, data);
    const name = safeFileName(fileName);
    const id = randomUUID();
    await this.changes.run(actor, staffId, 'document_added', async (now) => {
      await this.changes.files.addDocument({
        id,
        staffId,
        category,
        fileName: name,
        file,
        uploadedBy: actor.userId,
        now,
      });
      return { documentId: id, category, contentType: file.contentType, bytes: file.data.length };
    });
    return { id };
  }
}

@CommandHandler(RemoveStaffDocumentCommand)
export class RemoveStaffDocumentHandler implements ICommandHandler<RemoveStaffDocumentCommand> {
  constructor(private readonly changes: StaffChanges) {}

  async execute({ actor, staffId, documentId }: RemoveStaffDocumentCommand): Promise<void> {
    await this.changes.run(actor, staffId, 'document_removed', async () => {
      if (!(await this.changes.files.removeDocument(staffId, documentId))) throw new NotFoundError('staff_document');
      return { documentId };
    });
  }
}

/** hr:read, or the staff member themselves (via the linked user account). */
async function authorizeRead(access: AccessControl, read: StaffReadRepository, actor: Actor, staffId: string) {
  const owner = await read.ownerOf(staffId);
  if (owner === undefined) {
    await access.authorize(actor.userId, { permissions: [HR_READ] });
    throw new NotFoundError('staff');
  }
  await access.authorize(actor.userId, { permissions: [HR_READ], ...(owner ? { ownerId: owner } : {}) });
}

@QueryHandler(ListStaffQuery)
export class ListStaffHandler implements IQueryHandler<ListStaffQuery> {
  constructor(
    private readonly read: StaffReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListStaffQuery): Promise<Page<StaffSummaryView>> {
    await this.access.authorize(actor.userId, { permissions: [HR_READ] });
    return this.read.list(filter);
  }
}

@QueryHandler(GetStaffQuery)
export class GetStaffHandler implements IQueryHandler<GetStaffQuery> {
  constructor(
    private readonly read: StaffReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, staffId }: GetStaffQuery): Promise<StaffDetailView> {
    await authorizeRead(this.access, this.read, actor, staffId);
    const staff = await this.read.get(staffId);
    if (!staff) throw new NotFoundError('staff');
    return staff;
  }
}

@QueryHandler(GetMyStaffRecordQuery)
export class GetMyStaffRecordHandler implements IQueryHandler<GetMyStaffRecordQuery> {
  constructor(private readonly read: StaffReadRepository) {}

  async execute({ actor }: GetMyStaffRecordQuery): Promise<StaffDetailView> {
    const staffId = await this.read.idForUser(actor.userId);
    const staff = staffId ? await this.read.get(staffId) : null;
    if (!staff) throw new NotFoundError('staff');
    return staff;
  }
}

@QueryHandler(GetStaffPhotoQuery)
export class GetStaffPhotoHandler implements IQueryHandler<GetStaffPhotoQuery> {
  constructor(
    private readonly read: StaffReadRepository,
    private readonly files: StaffFileRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, staffId }: GetStaffPhotoQuery): Promise<StoredFile> {
    await authorizeRead(this.access, this.read, actor, staffId);
    const photo = await this.files.findPhoto(staffId);
    if (!photo) throw new NotFoundError('staff_photo');
    return photo;
  }
}

@QueryHandler(GetStaffDocumentQuery)
export class GetStaffDocumentHandler implements IQueryHandler<GetStaffDocumentQuery> {
  constructor(
    private readonly read: StaffReadRepository,
    private readonly files: StaffFileRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, staffId, documentId }: GetStaffDocumentQuery): Promise<StoredFile & { fileName: string }> {
    await authorizeRead(this.access, this.read, actor, staffId);
    const document = await this.files.findDocument(staffId, documentId);
    if (!document) throw new NotFoundError('staff_document');
    return document;
  }
}

export const STAFF_HANDLERS = [
  HireStaffHandler,
  UpdateStaffHandler,
  DeactivateStaffHandler,
  ActivateStaffHandler,
  SeparateStaffHandler,
  ReplaceStaffEducationHandler,
  ReplaceStaffEmergencyContactsHandler,
  ReplaceStaffFestivalsHandler,
  SetStaffPhotoHandler,
  RemoveStaffPhotoHandler,
  AddStaffDocumentHandler,
  RemoveStaffDocumentHandler,
  ListStaffHandler,
  GetStaffHandler,
  GetMyStaffRecordHandler,
  GetStaffPhotoHandler,
  GetStaffDocumentHandler,
];
