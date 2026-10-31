import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { LAB_MANAGE, LAB_READ, LAB_RECORDS as R } from '../../application/lab.messages.js';
import {
  labAntibiotics,
  labCultureMessages,
  labGrowthTypes,
  labOrganisms,
  labReportTemplates,
} from './laboratory.schema.js';

const taken = (code: string, message: string) => ({ code, message });

/** The culture masters and the written reports' templates: seen with lab:read, changed with lab:manage. */
export function laboratoryRecordTypes(context: DbContext): RecordType[] {
  const record = (name: string, table: RecordTable, options: Omit<RecordStoreOptions, 'name'>): RecordType => ({
    name,
    readPermission: LAB_READ,
    managePermission: LAB_MANAGE,
    store: new DrizzleRecordStore(context, table, { name, ...options }),
  });

  return [
    record(R.antibiotic, labAntibiotics, {
      orderBy: [labAntibiotics.groupName, labAntibiotics.name],
      filters: { isActive: labAntibiotics.isActive },
      search: [labAntibiotics.name, labAntibiotics.groupName],
      unique: { lab_antibiotics_name_uq: taken('antibiotic_name_taken', 'This antibiotic exists') },
    }),
    record(R.organism, labOrganisms, {
      orderBy: [labOrganisms.name],
      filters: { isActive: labOrganisms.isActive },
      search: [labOrganisms.name],
      unique: { lab_organisms_name_uq: taken('organism_name_taken', 'This organism exists') },
    }),
    record(R.growthType, labGrowthTypes, {
      orderBy: [labGrowthTypes.name],
      search: [labGrowthTypes.name],
      unique: { lab_growth_types_name_uq: taken('growth_type_name_taken', 'This growth type exists') },
    }),
    record(R.cultureMessage, labCultureMessages, {
      orderBy: [labCultureMessages.text],
      search: [labCultureMessages.text],
      unique: { lab_culture_messages_text_uq: taken('culture_message_taken', 'This message exists') },
    }),
    record(R.reportTemplate, labReportTemplates, {
      orderBy: [labReportTemplates.name],
      search: [labReportTemplates.name, labReportTemplates.description],
      unique: { lab_report_templates_name_uq: taken('report_template_name_taken', 'This template exists') },
    }),
  ];
}
