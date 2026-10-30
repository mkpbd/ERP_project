import { randomUUID } from 'node:crypto';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { historyRecords, historyValues } from '../../modules/clinical/infrastructure/persistence/clinical.schema.js';
import { patients } from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import { plainText, prescriptionText } from './history-records.js';
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
        await write(
          db,
          context,
          report,
          'lab-history',
          uhids,
          page.map((row) => {
            const lines = details.get(row.Id.toLowerCase()) ?? [];
            const tests = [
              ...new Set(lines.flatMap((line) => (text(line.TestName, 100) ? [text(line.TestName, 100)!] : []))),
            ];
            return {
              oldId: row.Id,
              uhid: row.UHID,
              kind: 'lab-report' as const,
              title: tests.length ? `Laboratory report: ${tests.join(', ')}` : 'Laboratory report',
              number: row.LabNo ? `Lab ${row.LabNo}` : null,
              on: row.ReportDate ?? row.PreparedDate ?? row.CreatedOn,
              body: plainText(row.AnyComments),
              shared: Boolean(row.DeliveryOn) || set(row.ReportVerifierId) !== null,
              values: lines.map((line) => ({
                test: text(line.TestTitle, 200) ?? '',
                result: text(line.TestResult, 500) ?? '',
                unit: text(line.ResultUnit, 50),
                reference: plainText(line.NormalResult).slice(0, 500) || null,
              })),
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

/** Old EMR consultancy visit notes and procedure notes of stays → clinical notes, for staff only. */
export function noteHistoryLoader(db: DbContext): Loader {
  return {
    name: 'note-history',
    dependsOn: ['patients'],
    async run(context, report) {
      const uhids = await patientsByUhid(db);
      for (const spec of [
        { table: '[EMR].[ConsultancyVisitNotes]', date: 'n.[CreatedOn]', title: 'Consultant visit note' },
        { table: '[EMR].[ProcedureNotes]', date: 'n.[EntryDate]', title: 'Procedure note' },
      ]) {
        const query = `SELECT TOP (@n) CAST(n.[Id] AS nvarchar(36)) AS [Id], n.[Note], ${spec.date} AS [On], p.[UHID],
          p.[InvoiceNo] FROM ${spec.table} n JOIN [Hospital].[IPDPatientRecords] p ON p.[Id] = n.[IPDPatientId]
          WHERE n.[IsDeleted] = 0 AND n.[Id] > @after ORDER BY n.[Id]`;
        type Row = { Id: string; Note: string | null; On: Date | null; UHID: number | null; InvoiceNo: number | null };
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
              title: spec.title,
              number: row.InvoiceNo ? `Admission ${row.InvoiceNo}` : null,
              on: row.On,
              body: plainText(row.Note),
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
