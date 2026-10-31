import { sql, type SQLWrapper } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { dayOf, sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import {
  admissions,
  bedCategories,
  beds,
  bedStays,
  corporateClients,
  diagnosticBillLines,
  diagnosticBills,
  diagnosticDepartments,
  diagnosticTests,
  doctors,
  homeCollectionAreas,
  homeCollections,
  ipdBills,
  opdBillLines,
  opdBills,
  patients,
  testAppointments,
  wards,
} from '../persistence/hospital.schema.js';

/** Who a bill is owed by: the patient, a company or a staff member. */
const payer = (bill: typeof opdBills | typeof ipdBills | typeof diagnosticBills) =>
  sql`case when ${bill.corporateClientId} is not null then 'Company' when ${bill.staffId} is not null then 'Staff'
    else 'Patient' end`;
const company = (bill: typeof opdBills | typeof ipdBills | typeof diagnosticBills) => ({
  label: 'Company',
  expr: sql`coalesce((select ${corporateClients.name} from ${corporateClients}
    where ${corporateClients.id} = ${bill.corporateClientId}), 'Not a company')`,
});
const referrer = (column: SQLWrapper) => ({
  label: 'Referring doctor',
  expr: sql`coalesce((select ${doctors.name} from ${doctors} where ${doctors.id} = ${column}), 'Not referred')`,
});
const opdDue = sql`${opdBills.net} - ${opdBills.paid} - ${opdBills.collected}`;
const ipdDue = sql`${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected}`;
const diagnosticNet = sql`${diagnosticBills.net} - ${diagnosticBills.cancelled}`;
const diagnosticDue = sql`${diagnosticNet} - ${diagnosticBills.paid} - ${diagnosticBills.collected} + ${diagnosticBills.refunded}`;
/** The ward a patient lies in now. */
const wardNow = sql`(select ${wards.name} from ${bedStays} join ${beds} on ${beds.id} = ${bedStays.bedId}
  join ${wards} on ${wards.id} = ${beds.wardId}
  where ${bedStays.admissionId} = ${admissions.id} and ${bedStays.toAt} is null limit 1)`;

/**
 * Old management dashboard's hospital heads (admissions, OPD, indoor bill, discount, due) and the diagnostic
 * dashboard: counts for anyone who reads the desk, money with dashboard:finance. Bills count on their bill day.
 */
export function hospitalDashboards(context: DbContext): DashboardSection[] {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  const billedOpd = sql`${opdBills.status} = 'billed'`;
  const billedIpd = sql`${ipdBills.status} = 'billed'`;
  const billedDiagnostic = sql`${diagnosticBills.status} <> 'cancelled'`;
  return [
    {
      key: 'outpatients',
      title: 'Outpatients',
      order: 10,
      permissions: ['opd:read'],
      heads: [
        head({
          key: 'outpatients.registered',
          label: 'New patients',
          unit: 'count',
          hint: 'UHIDs registered',
          from: sql`${patients}`,
          day: () => sql`${patients.registeredOn}`,
          where: () => sql`${patients.mergedIntoId} is null`,
          value: sql`count(*)`,
          dimensions: { user: { label: 'Registered by', expr: sql`${patients.registeredBy}`, users: true } },
        }),
        head({
          key: 'outpatients.bills',
          label: 'OPD bills',
          unit: 'count',
          from: sql`${opdBills}`,
          day: () => sql`${opdBills.billedOn}`,
          where: () => billedOpd,
          value: sql`count(*)`,
          dimensions: {
            payer: { label: 'Payer', expr: payer(opdBills) },
            user: { label: 'Billed by', expr: sql`${opdBills.billedBy}`, users: true },
          },
        }),
        head({
          key: 'outpatients.consultations',
          label: 'Consultations',
          unit: 'count',
          from: sql`${opdBillLines} join ${opdBills} on ${opdBills.id} = ${opdBillLines.billId}`,
          day: () => sql`${opdBills.billedOn}`,
          where: () => sql`${billedOpd} and ${opdBillLines.visitType} is not null`,
          value: sql`count(*)`,
          dimensions: {
            doctor: {
              label: 'Doctor',
              expr: sql`(select ${doctors.name} from ${doctors} where ${doctors.id} = ${opdBillLines.doctorId})`,
            },
            visit: { label: 'Visit', expr: sql`${opdBillLines.visitType}` },
          },
        }),
        head({
          key: 'outpatients.billed',
          label: 'OPD billed',
          unit: 'money',
          hint: 'Net of discounts',
          from: sql`${opdBills}`,
          day: () => sql`${opdBills.billedOn}`,
          where: () => billedOpd,
          value: sql`sum(${opdBills.net})`,
          dimensions: {
            payer: { label: 'Payer', expr: payer(opdBills) },
            company: company(opdBills),
            user: { label: 'Billed by', expr: sql`${opdBills.billedBy}`, users: true },
          },
        }),
        head({
          key: 'outpatients.discount',
          label: 'OPD discount',
          unit: 'money',
          from: sql`${opdBills}`,
          day: () => sql`${opdBills.billedOn}`,
          where: () => billedOpd,
          value: sql`sum(${opdBills.discount})`,
          dimensions: { user: { label: 'Billed by', expr: sql`${opdBills.billedBy}`, users: true } },
        }),
        head({
          key: 'outpatients.due',
          label: 'OPD dues now',
          unit: 'money',
          hint: 'Unpaid OPD bills, all time',
          from: sql`${opdBills}`,
          where: () => sql`${billedOpd} and ${opdDue} > 0`,
          value: sql`sum(${opdDue})`,
          dimensions: { payer: { label: 'Payer', expr: payer(opdBills) }, company: company(opdBills) },
        }),
      ],
    },
    {
      key: 'inpatients',
      title: 'Inpatients',
      order: 20,
      permissions: ['ipd:read'],
      heads: [
        head({
          key: 'inpatients.admissions',
          label: 'Admissions',
          unit: 'count',
          from: sql`${admissions}`,
          day: (range) => dayOf(admissions.admittedAt, range),
          where: () => sql`${admissions.status} <> 'cancelled'`,
          value: sql`count(*)`,
          dimensions: {
            kind: { label: 'Kind', expr: sql`${admissions.kind}` },
            referrer: referrer(admissions.referredById),
            user: { label: 'Admitted by', expr: sql`${admissions.admittedBy}`, users: true },
          },
        }),
        head({
          key: 'inpatients.discharges',
          label: 'Discharges',
          unit: 'count',
          from: sql`${admissions}`,
          day: (range) => dayOf(admissions.dischargedAt, range),
          where: () => sql`${admissions.status} = 'discharged'`,
          value: sql`count(*)`,
          dimensions: { type: { label: 'Discharge type', expr: sql`${admissions.dischargeType}` } },
        }),
        head({
          key: 'inpatients.admitted',
          label: 'Admitted now',
          unit: 'count',
          from: sql`${admissions}`,
          where: () => sql`${admissions.status} = 'admitted'`,
          value: sql`count(*)`,
          dimensions: {
            ward: { label: 'Ward', expr: wardNow },
            kind: { label: 'Kind', expr: sql`${admissions.kind}` },
          },
        }),
        head({
          key: 'inpatients.free-beds',
          label: 'Free beds now',
          unit: 'count',
          from: sql`${beds} join ${wards} on ${wards.id} = ${beds.wardId}
            join ${bedCategories} on ${bedCategories.id} = ${beds.categoryId}`,
          where: () => sql`${beds.status} = 'available' and ${beds.isActive}`,
          value: sql`count(*)`,
          dimensions: {
            ward: { label: 'Ward', expr: sql`${wards.name}` },
            category: { label: 'Category', expr: sql`${bedCategories.name}` },
          },
        }),
        head({
          key: 'inpatients.billed',
          label: 'Indoor billed',
          unit: 'money',
          hint: 'Final bills, net of discounts',
          from: sql`${ipdBills}`,
          day: () => sql`${ipdBills.billedOn}`,
          where: () => billedIpd,
          value: sql`sum(${ipdBills.net})`,
          dimensions: {
            payer: { label: 'Payer', expr: payer(ipdBills) },
            company: company(ipdBills),
            user: { label: 'Billed by', expr: sql`${ipdBills.billedBy}`, users: true },
          },
        }),
        head({
          key: 'inpatients.discount',
          label: 'Indoor discount',
          unit: 'money',
          from: sql`${ipdBills}`,
          day: () => sql`${ipdBills.billedOn}`,
          where: () => billedIpd,
          value: sql`sum(${ipdBills.discount})`,
          dimensions: { user: { label: 'Billed by', expr: sql`${ipdBills.billedBy}`, users: true } },
        }),
        head({
          key: 'inpatients.due',
          label: 'Indoor dues now',
          unit: 'money',
          hint: 'Unpaid final bills, all time',
          from: sql`${ipdBills}`,
          where: () => sql`${billedIpd} and ${ipdDue} > 0`,
          value: sql`sum(${ipdDue})`,
          dimensions: { payer: { label: 'Payer', expr: payer(ipdBills) }, company: company(ipdBills) },
        }),
      ],
    },
    {
      key: 'diagnostics',
      title: 'Diagnostics',
      order: 30,
      permissions: ['diag:read'],
      heads: [
        head({
          key: 'diagnostics.bills',
          label: 'Diagnostic bills',
          unit: 'count',
          from: sql`${diagnosticBills}`,
          day: () => sql`${diagnosticBills.billedOn}`,
          where: () => billedDiagnostic,
          value: sql`count(*)`,
          dimensions: {
            referrer: referrer(diagnosticBills.referredById),
            user: { label: 'Billed by', expr: sql`${diagnosticBills.billedBy}`, users: true },
          },
        }),
        head({
          key: 'diagnostics.tests',
          label: 'Tests',
          unit: 'count',
          from: sql`${diagnosticBillLines} join ${diagnosticBills} on ${diagnosticBills.id} = ${diagnosticBillLines.billId}
            join ${diagnosticTests} on ${diagnosticTests.id} = ${diagnosticBillLines.testId}
            join ${diagnosticDepartments} on ${diagnosticDepartments.id} = ${diagnosticTests.departmentId}`,
          day: () => sql`${diagnosticBills.billedOn}`,
          where: () => sql`${billedDiagnostic} and ${diagnosticBillLines.status} <> 'cancelled'`,
          value: sql`count(*)`,
          dimensions: {
            department: { label: 'Department', expr: sql`${diagnosticDepartments.name}` },
            test: { label: 'Test', expr: sql`${diagnosticTests.name}` },
          },
        }),
        head({
          key: 'diagnostics.appointments',
          label: 'Test appointments',
          unit: 'count',
          hint: 'Booked for the day, not cancelled',
          from: sql`${testAppointments}`,
          day: () => sql`${testAppointments.appointmentDate}`,
          where: () => sql`${testAppointments.status} <> 'cancelled'`,
          value: sql`count(*)`,
          dimensions: {
            window: { label: 'Window', expr: sql`${testAppointments.windowLabel}` },
            status: { label: 'Status', expr: sql`${testAppointments.status}` },
            via: { label: 'Booked through', expr: sql`${testAppointments.bookedVia}` },
          },
        }),
        head({
          key: 'diagnostics.home-collections',
          label: 'Home collections',
          unit: 'count',
          hint: 'Visits for the day, not cancelled',
          from: sql`${homeCollections} join ${homeCollectionAreas} on ${homeCollectionAreas.id} = ${homeCollections.areaId}`,
          day: () => sql`${homeCollections.collectionDate}`,
          where: () => sql`${homeCollections.status} <> 'cancelled'`,
          value: sql`count(*)`,
          dimensions: {
            area: { label: 'Area', expr: sql`${homeCollectionAreas.name}` },
            status: { label: 'Status', expr: sql`${homeCollections.status}` },
            collector: { label: 'Collector', expr: sql`${homeCollections.collectorId}`, users: true },
          },
        }),
        head({
          key: 'diagnostics.billed',
          label: 'Diagnostic billed',
          unit: 'money',
          hint: 'Net of discounts and cancelled tests',
          from: sql`${diagnosticBills}`,
          day: () => sql`${diagnosticBills.billedOn}`,
          where: () => billedDiagnostic,
          value: sql`sum(${diagnosticNet})`,
          dimensions: {
            referrer: referrer(diagnosticBills.referredById),
            payer: { label: 'Payer', expr: payer(diagnosticBills) },
            user: { label: 'Billed by', expr: sql`${diagnosticBills.billedBy}`, users: true },
          },
        }),
        head({
          key: 'diagnostics.discount',
          label: 'Diagnostic discount',
          unit: 'money',
          from: sql`${diagnosticBills}`,
          day: () => sql`${diagnosticBills.billedOn}`,
          where: () => billedDiagnostic,
          value: sql`sum(${diagnosticBills.discount})`,
          dimensions: { user: { label: 'Billed by', expr: sql`${diagnosticBills.billedBy}`, users: true } },
        }),
        head({
          key: 'diagnostics.due',
          label: 'Diagnostic dues now',
          unit: 'money',
          hint: 'Unpaid diagnostic bills, all time',
          from: sql`${diagnosticBills}`,
          where: () => sql`${billedDiagnostic} and ${diagnosticDue} > 0`,
          value: sql`sum(${diagnosticDue})`,
          dimensions: { payer: { label: 'Payer', expr: payer(diagnosticBills) }, company: company(diagnosticBills) },
        }),
      ],
    },
  ];
}
