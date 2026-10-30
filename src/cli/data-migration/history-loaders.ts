import { randomUUID } from 'node:crypto';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { historyRecords, historyValues } from '../../modules/clinical/infrastructure/persistence/clinical.schema.js';
import { patients } from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import { cultureText, plainText, prescriptionText, sensitivity, sheetText } from './history-records.js';
import { isNew, NIL, pages } from './loader-kit.js';

type Kind = (typeof historyRecords.$inferInsert)['kind'];

interface HistoryRow {
  readonly oldId: string;
  readonly uhid: number | null;
  readonly kind: Kind;
  readonly title: string;
  readonly number: string | null;
  readonly on: Date | null;
  readonly body: string;
  readonly shared: boolean;
  readonly values?: readonly { test: string; result: string; unit: string | null; reference: string | null }[];
}

const day = (value: Date | null) => (value && value.getUTCFullYear() > 1900 ? value.toISOString().slice(0, 10) : null);
const set = (value: string | null | undefined) => (value && value !== NIL ? value : null);

/** Every patient here by UHID (13a), read once per loader. */
async function patientsByUhid(db: DbContext): Promise<Map<number, string>> {
  const rows = await db.db.select({ id: patients.id, uhid: patients.uhid }).from(patients);
  return new Map(rows.map((row) => [row.uhid, row.id]));
}

/** Rows of an old child table for a page of parents: the query takes @ids, a JSON array read with OPENJSON. */
async function childrenOf<T extends Record<string, unknown> & { ParentId: string }>(
  context: EtlContext,
  query: string,
  ids: readonly string[],
): Promise<Map<string, T[]>> {
  const map = new Map<string, T[]>();
  if (ids.length === 0) return map;
  for (const row of await context.source.query<T>(query, { ids: JSON.stringify(ids) })) {
    const key = row.ParentId.toLowerCase();
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
}

/** Writes a page of records (each once: the id map and the unique source keep re-runs from doubling them). */
async function write(
  db: DbContext,
  context: EtlContext,
  report: LoaderReport,
  entity: string,
  uhids: Map<number, string>,
  rows: readonly HistoryRow[],
): Promise<void> {
  for (const row of rows) {
    if (!(await isNew(context, report, entity, row.oldId))) continue;
    const patientId = row.uhid ? uhids.get(Number(row.uhid)) : undefined;
    const recordedOn = day(row.on);
    if (!patientId || !recordedOn) {
      noteRejection(report, row.oldId, !row.uhid ? 'no_patient' : !patientId ? 'patient_not_brought' : 'no_date');
      continue;
    }
    const values = (row.values ?? []).filter((value) => value.test && value.result);
    if (!row.body && values.length === 0) {
      noteRejection(report, row.oldId, 'empty');
      continue;
    }
    const id = randomUUID();
    await db.db.insert(historyRecords).values({
      id,
      patientId,
      kind: row.kind,
      title: row.title.slice(0, 200),
      number: row.number,
      recordedOn,
      body: row.body,
      shared: row.shared,
      source: `${entity}:${row.oldId.toLowerCase()}`,
    });
    if (values.length) {
      await db.db
        .insert(historyValues)
        .values(values.slice(0, 1000).map((value, index) => ({ recordId: id, position: index + 1, ...value })));
    }
    await context.ids.set(entity, row.oldId, id);
    report.written += 1;
  }
}

/**
 * Old Diag.PathologyReports with their result rows (PathologyReportDetails) → lab reports with their values, so the
 * results can be followed over time. The patient is the one whose invoice the lab number was collected for.
 * Reports verified or delivered there are shown to the patient.
 */
export function labHistoryLoader(db: DbContext): Loader {
  return {
    name: 'lab-history',
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      const query = `SELECT TOP (@n) CAST(r.[Id] AS nvarchar(36)) AS [Id], r.[LabNo], r.[ReportDate], r.[PreparedDate],
        r.[CreatedOn], r.[AnyComments], r.[DeliveryOn], CAST(r.[ReportVerifierId] AS nvarchar(36)) AS [ReportVerifierId],
        x.[UHID], x.[InvoiceNo]
        FROM [Diag].[PathologyReports] r
        OUTER APPLY (SELECT TOP 1 i.[UHID], i.[InvoiceNo] FROM [Diag].[SampleCollectionRecords] s
          JOIN [Diag].[InvestigationInvoices] i ON i.[Id] = s.[InvoiceId] WHERE s.[LabNo] = r.[LabNo]) x
        WHERE r.[IsDeleted] = 0 AND r.[Id] > @after ORDER BY r.[Id]`;
      type Row = {
        Id: string;
        LabNo: number | null;
        ReportDate: Date | null;
        PreparedDate: Date | null;
        CreatedOn: Date | null;
        AnyComments: string | null;
        DeliveryOn: Date | null;
        ReportVerifierId: string | null;
        UHID: number | null;
        InvoiceNo: number | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        const details = await childrenOf<{
          ParentId: string;
          TestName: string | null;
          TestTitle: string | null;
          TestResult: string | null;
          ResultUnit: string | null;
          NormalResult: string | null;
        }>(
          context,
          `SELECT CAST(d.[PathologyReportId] AS nvarchar(36)) AS [ParentId], t.[Name] AS [TestName], d.[TestTitle],
            d.[TestResult], d.[ResultUnit], d.[NormalResult]
            FROM [Diag].[PathologyReportDetails] d LEFT JOIN [Diag].[TestItems] t ON t.[Id] = d.[TestItemId]
            WHERE d.[IsDeleted] = 0 AND d.[PathologyReportId] IN (SELECT [value] FROM OPENJSON(@ids))
            ORDER BY d.[PathologyReportId], d.[DisplayOrder]`,
          page.map((row) => row.Id),
        );
        // Culture reports: the organisms grown, the culture's findings, microscopy, and the sensitivity grid.
        const ids = page.map((row) => row.Id);
        const cultures = await childrenOf<{
          ParentId: string;
          GrowthType: string | null;
          OrganismA: string | null;
          OrganismB: string | null;
          OrganismC: string | null;
          Message: string | null;
          ColonyCount: string | null;
          Incubation: string | null;
          CultureMediaUsed: string | null;
        }>(
          context,
          `SELECT CAST(c.[PathologyReportId] AS nvarchar(36)) AS [ParentId], g.[Name] AS [GrowthType],
            a.[Name] AS [OrganismA], b.[Name] AS [OrganismB], o.[Name] AS [OrganismC],
            COALESCE(NULLIF(c.[CSMessage], ''), m.[Name]) AS [Message], c.[ColonyCount], c.[Incubation],
            c.[CultureMediaUsed]
            FROM [Diag].[CSNoGrowthResults] c
            LEFT JOIN [Diag].[CSGrowthTypes] g ON g.[Id] = c.[GrowthTypeId]
            LEFT JOIN [Diag].[MicroBioBacterias] a ON a.[Id] = c.[MicroBioBacteriaAId]
            LEFT JOIN [Diag].[MicroBioBacterias] b ON b.[Id] = c.[MicroBioBacteriaBId]
            LEFT JOIN [Diag].[MicroBioBacterias] o ON o.[Id] = c.[MicroBioBacteriaCId]
            LEFT JOIN [Diag].[CSMessases] m ON m.[Id] = c.[CSMessageId]
            WHERE c.[IsDeleted] = 0 AND c.[PathologyReportId] IN (SELECT [value] FROM OPENJSON(@ids))`,
          ids,
        );
        const microscopy = await childrenOf<{
          ParentId: string;
          Analyzer: string | null;
          PusCellValue: string | null;
          EpithelialCellValue: string | null;
          RBCValue: string | null;
          Note: string | null;
        }>(
          context,
          `SELECT CAST(x.[PathologyReportId] AS nvarchar(36)) AS [ParentId], x.[Analyzer], x.[PusCellValue],
            x.[EpithelialCellValue], x.[RBCValue], x.[Note] FROM [Diag].[CSOthersValues] x
            WHERE x.[IsDeleted] = 0 AND x.[PathologyReportId] IN (SELECT [value] FROM OPENJSON(@ids))`,
          ids,
        );
        const grid = await childrenOf<{
          ParentId: string;
          Antibiotic: string | null;
          Diameter: string | null;
          ValueA: string | null;
          ValueB: string | null;
          ValueC: string | null;
        }>(
          context,
          `SELECT CAST(s.[PathologyReportId] AS nvarchar(36)) AS [ParentId], a.[Name] AS [Antibiotic], s.[Diameter],
            s.[ValueA], s.[ValueB], s.[ValueC] FROM [Diag].[CSGrowths] s
            LEFT JOIN [Diag].[CSAntibiotics] a ON a.[Id] = s.[CSAntibioticId]
            WHERE s.[IsDeleted] = 0 AND s.[PathologyReportId] IN (SELECT [value] FROM OPENJSON(@ids))
            ORDER BY [ParentId], a.[Name]`,
          ids,
        );
        await write(
          db,
          context,
          report,
          'lab-history',
          uhids,
          page.map((row) => {
            const key = row.Id.toLowerCase();
            const lines = details.get(key) ?? [];
            const tests = [
              ...new Set(lines.flatMap((line) => (text(line.TestName, 100) ? [text(line.TestName, 100)!] : []))),
            ];
            const culture = cultures.get(key)?.[0];
            const seen = microscopy.get(key)?.[0];
            const organisms = culture ? [culture.OrganismA, culture.OrganismB, culture.OrganismC] : [];
            const findings = cultureText(
              culture
                ? {
                    growthType: culture.GrowthType,
                    organisms,
                    message: culture.Message,
                    colonyCount: culture.ColonyCount,
                    incubation: culture.Incubation,
                    media: culture.CultureMediaUsed,
                  }
                : null,
              seen
                ? {
                    analyzer: seen.Analyzer,
                    pusCells: seen.PusCellValue,
                    epithelialCells: seen.EpithelialCellValue,
                    rbc: seen.RBCValue,
                    note: seen.Note,
                  }
                : null,
            );
            return {
              oldId: row.Id,
              uhid: row.UHID,
              kind: 'lab-report' as const,
              title: tests.length ? `Laboratory report: ${tests.join(', ')}` : 'Laboratory report',
              number: row.LabNo ? `Lab ${row.LabNo}` : null,
              on: row.ReportDate ?? row.PreparedDate ?? row.CreatedOn,
              body: [findings, plainText(row.AnyComments)].filter(Boolean).join('\n\n'),
              shared: Boolean(row.DeliveryOn) || set(row.ReportVerifierId) !== null,
              values: [
                ...lines.map((line) => ({
                  test: text(line.TestTitle, 200) ?? '',
                  result: text(line.TestResult, 500) ?? '',
                  unit: text(line.ResultUnit, 50),
                  reference: plainText(line.NormalResult).slice(0, 500) || null,
                })),
                ...(grid.get(key) ?? []).flatMap((entry) => {
                  const line = sensitivity(
                    entry.Antibiotic,
                    entry.Diameter,
                    [entry.ValueA, entry.ValueB, entry.ValueC],
                    organisms,
                  );
                  return line ? [line] : [];
                }),
              ],
            };
          }),
        );
      }
    },
  };
}

/**
 * Old text reports of an invoice's test (Diag.RadiologyReports, Diag.PathologyDescriptiveReports): the report as it
 * was written. The patient is the invoice's; reports finalised by a doctor are shown to the patient.
 */
function textReportLoader(db: DbContext, spec: { name: string; table: string; kind: Kind; noun: string }): Loader {
  return {
    name: spec.name,
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      const query = `SELECT TOP (@n) CAST(r.[Id] AS nvarchar(36)) AS [Id], r.[InvoiceNo], r.[ReportDateTime], r.[CreatedOn],
        r.[ReportContent], CAST(r.[FinalizedByDoctorId] AS nvarchar(36)) AS [FinalizedByDoctorId], t.[Name] AS [TestName],
        x.[UHID]
        FROM ${spec.table} r LEFT JOIN [Diag].[TestItems] t ON t.[Id] = r.[TestItemId]
        OUTER APPLY (SELECT TOP 1 i.[UHID] FROM [Diag].[InvestigationInvoices] i WHERE i.[InvoiceNo] = r.[InvoiceNo]) x
        WHERE r.[IsDeleted] = 0 AND r.[Id] > @after ORDER BY r.[Id]`;
      type Row = {
        Id: string;
        InvoiceNo: number | null;
        ReportDateTime: Date | null;
        CreatedOn: Date | null;
        ReportContent: string | null;
        FinalizedByDoctorId: string | null;
        TestName: string | null;
        UHID: number | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        await write(
          db,
          context,
          report,
          spec.name,
          uhids,
          page.map((row) => ({
            oldId: row.Id,
            uhid: row.UHID,
            kind: spec.kind,
            title: text(row.TestName, 150) ? `${spec.noun}: ${text(row.TestName, 150)}` : spec.noun,
            number: row.InvoiceNo ? `Invoice ${row.InvoiceNo}` : null,
            on: row.ReportDateTime ?? row.CreatedOn,
            body: plainText(row.ReportContent),
            shared: set(row.FinalizedByDoctorId) !== null,
          })),
        );
      }
    },
  };
}

export const imagingHistoryLoader = (db: DbContext) =>
  textReportLoader(db, {
    name: 'imaging-history',
    table: '[Diag].[RadiologyReports]',
    kind: 'imaging-report',
    noun: 'Imaging report',
  });

export const pathologyTextHistoryLoader = (db: DbContext) =>
  textReportLoader(db, {
    name: 'pathology-text-history',
    table: '[Diag].[PathologyDescriptiveReports]',
    kind: 'lab-report',
    noun: 'Laboratory report',
  });

/**
 * Old Rx visits (Rx.VisitHistories of a patient's PatientMasterDatas) with their complaints, impressions, medicines,
 * tests and advice → prescriptions written out as they read, shown to the patient.
 */
export function prescriptionHistoryLoader(db: DbContext): Loader {
  return {
    name: 'prescription-history',
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      const query = `SELECT TOP (@n) CAST(v.[Id] AS nvarchar(36)) AS [Id], v.[RxNo], v.[VisitDate], v.[FollowUpDate], v.[Notes],
        m.[UHID] FROM [Rx].[VisitHistories] v JOIN [Rx].[PatientMasterDatas] m ON m.[Id] = v.[PatientMasterDataId]
        WHERE v.[IsDeleted] = 0 AND v.[Id] > @after ORDER BY v.[Id]`;
      type Row = {
        Id: string;
        RxNo: number | null;
        VisitDate: Date | null;
        FollowUpDate: Date | null;
        Notes: string | null;
        UHID: number | null;
      };
      const of = (table: string, columns: string) =>
        `SELECT CAST([RxVisitId] AS nvarchar(36)) AS [ParentId], ${columns} FROM ${table}
          WHERE [IsDeleted] = 0 AND [RxVisitId] IN (SELECT [value] FROM OPENJSON(@ids)) ORDER BY [CreatedOn]`;
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        const ids = page.map((row) => row.Id);
        const complaints = await childrenOf<{
          ParentId: string;
          Complain: string | null;
          ComplainManual: string | null;
          Duration: string | null;
        }>(context, of('[Rx].[PatientChiefComplains]', '[Complain], [ComplainManual], [Duration]'), ids);
        const impressions = await childrenOf<{
          ParentId: string;
          ImpressionTitle: string | null;
          Remarks: string | null;
        }>(context, of('[Rx].[PatientClinicalimpressions]', '[ImpressionTitle], [Remarks]'), ids);
        const drugs = await childrenOf<{
          ParentId: string;
          Name: string | null;
          Dosage: string | null;
          Duration: string | null;
        }>(
          context,
          `SELECT CAST(d.[RxVisitId] AS nvarchar(36)) AS [ParentId],
            COALESCE(NULLIF(d.[ManualDrugName], ''), b.[Name]) AS [Name], d.[Dosage], d.[Duration]
            FROM [Rx].[Drugs] d LEFT JOIN [Pharmacy].[BrandExtensions] e ON e.[Id] = d.[BrandExtensionId]
            LEFT JOIN [Pharmacy].[BrandNames] b ON b.[Id] = e.[BrandId]
            WHERE d.[IsDeleted] = 0 AND d.[RxVisitId] IN (SELECT [value] FROM OPENJSON(@ids)) ORDER BY d.[CreatedOn]`,
          ids,
        );
        const tests = await childrenOf<{ ParentId: string; Name: string | null }>(
          context,
          `SELECT CAST(x.[RxVisitId] AS nvarchar(36)) AS [ParentId], t.[Name] FROM [Rx].[Investigations] x
            LEFT JOIN [Diag].[TestItems] t ON t.[Id] = x.[TestItemId]
            WHERE x.[IsDeleted] = 0 AND x.[RxVisitId] IN (SELECT [value] FROM OPENJSON(@ids)) ORDER BY x.[CreatedOn]`,
          ids,
        );
        const advice = await childrenOf<{ ParentId: string; Advice: string | null }>(
          context,
          of('[Rx].[AdviceToPatients]', '[Advice]'),
          ids,
        );
        const lines = <T>(map: Map<string, T[]>, id: string) => map.get(id.toLowerCase()) ?? [];
        await write(
          db,
          context,
          report,
          'prescription-history',
          uhids,
          page.map((row) => ({
            oldId: row.Id,
            uhid: row.UHID,
            kind: 'prescription' as const,
            title: 'Prescription',
            number: row.RxNo ? `Rx ${row.RxNo}` : null,
            on: row.VisitDate,
            shared: true,
            body: prescriptionText({
              complaints: lines(complaints, row.Id).flatMap((entry) => {
                const complaint = text(entry.ComplainManual, 300) ?? text(entry.Complain, 300);
                return complaint ? [{ complaint, duration: text(entry.Duration, 100) }] : [];
              }),
              impressions: lines(impressions, row.Id).flatMap((entry) => {
                const title = text(entry.ImpressionTitle, 300);
                const remarks = text(entry.Remarks, 300);
                return title || remarks ? [[title, remarks].filter(Boolean).join(' — ')] : [];
              }),
              drugs: lines(drugs, row.Id).flatMap((entry) => {
                const name = text(entry.Name, 200);
                return name ? [{ name, dosage: text(entry.Dosage, 200), duration: text(entry.Duration, 100) }] : [];
              }),
              tests: lines(tests, row.Id).flatMap((entry) => (text(entry.Name, 200) ? [text(entry.Name, 200)!] : [])),
              advice: lines(advice, row.Id).flatMap((entry) => {
                const said = plainText(entry.Advice);
                return said ? [said] : [];
              }),
              notes: plainText(row.Notes) || null,
              followUpOn: day(row.FollowUpDate),
            }),
          })),
        );
      }
    },
  };
}

/** Old Hospital.DischargeCertificate (an editor's text per stay) → discharge certificates, shown to the patient. */
export function dischargeHistoryLoader(db: DbContext): Loader {
  return {
    name: 'discharge-history',
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      const query = `SELECT TOP (@n) CAST(c.[Id] AS nvarchar(36)) AS [Id], c.[EditorText], c.[DischargeCertificateDate],
        p.[UHID], p.[InvoiceNo] FROM [Hospital].[DischargeCertificate] c
        JOIN [Hospital].[IPDPatientRecords] p ON p.[Id] = c.[IPDPatientId]
        WHERE c.[IsDeleted] = 0 AND c.[Id] > @after ORDER BY c.[Id]`;
      type Row = {
        Id: string;
        EditorText: string | null;
        DischargeCertificateDate: Date | null;
        UHID: number | null;
        InvoiceNo: number | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        await write(
          db,
          context,
          report,
          'discharge-history',
          uhids,
          page.map((row) => ({
            oldId: row.Id,
            uhid: row.UHID,
            kind: 'discharge-summary' as const,
            title: 'Discharge certificate',
            number: row.InvoiceNo ? `Admission ${row.InvoiceNo}` : null,
            on: row.DischargeCertificateDate,
            body: plainText(row.EditorText),
            shared: true,
          })),
        );
      }
    },
  };
}

/**
 * Old EMR notes of stays → clinical notes, for staff only: consultant visits, procedures, ICU course, transfers, nurse
 * handovers (who handed over to whom, acknowledged or not) and handover sheets (their form written out).
 */
export function noteHistoryLoader(db: DbContext): Loader {
  return {
    name: 'note-history',
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      const who = (alias: string) => `COALESCE(NULLIF(${alias}.[FullName], ''), ${alias}.[UserName], 'someone')`;
      for (const spec of [
        {
          table: '[EMR].[ConsultancyVisitNotes]',
          stay: 'IPDPatientId',
          date: 'n.[CreatedOn]',
          label: 'Consultant visit note',
        },
        { table: '[EMR].[ProcedureNotes]', stay: 'IPDPatientId', date: 'n.[EntryDate]', label: 'Procedure note' },
        {
          table: '[EMR].[ICUCourses]',
          stay: 'IPDPatientId',
          note: 'n.[Course]',
          date: 'n.[EntryDate]',
          label: 'ICU course',
        },
        {
          table: '[EMR].[TransferNotesEMR]',
          stay: 'IPDPatientRecordId',
          date: 'n.[CreatedOn]',
          label: 'Transfer note',
          title: `CONCAT('Transfer note', ' (' + NULLIF(n.[DepartmentName], '') + ')')`,
        },
        {
          table: '[EMR].[NurseToNursePatientHandOverRecords]',
          stay: 'IPDPatientRecordId',
          date: 'n.[HODate]',
          label: 'Nurse handover',
          note: `CONCAT('Handed over by ', ${who('b')}, ' to ', ${who('t')}, ' at ', CONVERT(nvarchar(5), n.[HOTime], 108),
            CASE WHEN n.[IsReceipantAcknowledged] = 1 THEN ', acknowledged.' ELSE ', not acknowledged.' END)`,
          joins: `LEFT JOIN [Identity].[Users] b ON b.[Id] = n.[HanOverBy] LEFT JOIN [Identity].[Users] t ON t.[Id] = n.[HandOverTo]`,
        },
        {
          table: '[EMR].[HandOverSheets]',
          stay: 'PatientId',
          note: 'n.[Data]',
          date: 'n.[CreatedOn]',
          label: 'Handover sheet',
          form: true,
        },
      ] as {
        table: string;
        stay: string;
        date: string;
        label: string;
        note?: string;
        title?: string;
        joins?: string;
        form?: boolean;
      }[]) {
        const query = `SELECT TOP (@n) CAST(n.[Id] AS nvarchar(36)) AS [Id], ${spec.note ?? 'n.[Note]'} AS [Note],
          ${spec.title ?? 'NULL'} AS [Title], ${spec.date} AS [On], p.[UHID], p.[InvoiceNo]
          FROM ${spec.table} n JOIN [Hospital].[IPDPatientRecords] p ON p.[Id] = n.[${spec.stay}] ${spec.joins ?? ''}
          WHERE n.[IsDeleted] = 0 AND n.[Id] > @after ORDER BY n.[Id]`;
        type Row = {
          Id: string;
          Note: string | null;
          Title?: string | null;
          On: Date | null;
          UHID: number | null;
          InvoiceNo: number | null;
        };
        for await (const page of pages<Row>(context, query, (row) => row.Id)) {
          await write(
            db,
            context,
            report,
            'note-history',
            uhids,
            page.map((row) => ({
              oldId: row.Id,
              uhid: row.UHID,
              kind: 'note' as const,
              title: text(row.Title, 200) ?? spec.label,
              number: row.InvoiceNo ? `Admission ${row.InvoiceNo}` : null,
              on: row.On,
              body: spec.form ? sheetText(row.Note) : plainText(row.Note),
              shared: false,
            })),
          );
        }
      }
    },
  };
}

export function historyLoaders(db: DbContext): Loader[] {
  return [
    labHistoryLoader(db),
    pathologyTextHistoryLoader(db),
    imagingHistoryLoader(db),
    prescriptionHistoryLoader(db),
    dischargeHistoryLoader(db),
    noteHistoryLoader(db),
  ];
}
