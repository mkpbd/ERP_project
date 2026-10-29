import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { CLINICAL_RECORDS } from '../../application/emr.messages.js';
import { RX_MANAGE, RX_READ } from '../../application/rx.messages.js';
import { noteTemplates } from './clinical.schema.js';

export function clinicalRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      name: CLINICAL_RECORDS.noteTemplate,
      readPermission: RX_READ,
      managePermission: RX_MANAGE,
      store: new DrizzleRecordStore(context, noteTemplates, {
        name: CLINICAL_RECORDS.noteTemplate,
        orderBy: [noteTemplates.name],
        filters: { isActive: noteTemplates.isActive, kind: noteTemplates.kind },
        search: [noteTemplates.name],
        unique: {
          clinical_note_templates_name_uq: { code: 'template_name_taken', message: 'A note template has this name' },
        },
      }),
    },
  ];
}
