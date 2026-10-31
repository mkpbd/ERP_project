import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  DIAG_MANAGE,
  DIAG_READ,
  HOSPITAL_RECORDS as R,
  OPD_MANAGE,
  OPD_READ,
} from '../../application/hospital.constants.js';
import { IPD_MANAGE, IPD_READ } from '../../application/ipd.messages.js';
import { OT_MANAGE, OT_READ } from '../../application/ot.messages.js';
import {
  bedCategories,
  cardProviders,
  beds,
  corporateClients,
  diagnosticDepartments,
  diagnosticPackages,
  diagnosticTests,
  homeCollectionAreas,
  homeCollectionWindows,
  testAppointmentWindows,
  testPreparations,
  doctorClosures,
  doctors,
  doctorSchedules,
  serviceGroups,
  services,
  specialities,
  wards,
  otRooms,
  operations,
  otTypes,
  anaesthesiaTypes,
  surgeryProcedures,
} from './hospital.schema.js';

const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function hospitalRecordTypes(context: DbContext): RecordType[] {
  const ipd: [string, string] = [IPD_READ, IPD_MANAGE];
  const ot: [string, string] = [OT_READ, OT_MANAGE];
  const diag: [string, string] = [DIAG_READ, DIAG_MANAGE];
  const record = (
    name: string,
    table: RecordTable,
    options: Omit<RecordStoreOptions, 'name'>,
    [readPermission, managePermission] = [OPD_READ, OPD_MANAGE],
  ): RecordType => ({
    name,
    readPermission,
    managePermission,
    store: new DrizzleRecordStore(context, table, { name, ...options }),
  });

  return [
    record(R.speciality, specialities, {
      orderBy: [specialities.name],
      search: [specialities.name],
      unique: { hospital_specialities_name_uq: taken('speciality_name_taken', 'This speciality exists') },
    }),
    record(R.doctor, doctors, {
      orderBy: [doctors.name],
      filters: {
        specialityId: doctors.specialityId,
        isConsultant: doctors.isConsultant,
        isActive: doctors.isActive,
        userId: doctors.userId,
      },
      search: [doctors.name, doctors.code, doctors.degrees],
      unique: {
        hospital_doctors_code_uq: taken('doctor_code_taken', 'Another doctor has this code'),
        hospital_doctors_user_uq: taken('doctor_user_taken', 'The login is tied to another doctor'),
      },
      references: {
        [fk('hospital_doctors', 'speciality_id', 'hospital_specialities')]: R.speciality,
        [fk('hospital_doctors', 'user_id', 'users')]: 'user',
      },
    }),
    record(R.doctorSchedule, doctorSchedules, {
      orderBy: [doctorSchedules.doctorId, doctorSchedules.dayOfWeek],
      filters: { doctorId: doctorSchedules.doctorId, dayOfWeek: doctorSchedules.dayOfWeek },
      unique: {
        hospital_doctor_schedules_day_uq: taken('schedule_day_taken', 'The doctor already sits on this weekday'),
      },
      references: { [fk('hospital_doctor_schedules', 'doctor_id', 'hospital_doctors')]: R.doctor },
    }),
    record(R.doctorClosure, doctorClosures, {
      orderBy: [doctorClosures.closedOn],
      filters: {
        doctorId: doctorClosures.doctorId,
        from: { column: doctorClosures.closedOn, op: 'gte' },
        to: { column: doctorClosures.closedOn, op: 'lte' },
      },
      unique: { hospital_doctor_closures_day_uq: taken('closure_day_taken', 'The doctor is already off that day') },
      references: { [fk('hospital_doctor_closures', 'doctor_id', 'hospital_doctors')]: R.doctor },
    }),
    record(R.serviceGroup, serviceGroups, {
      orderBy: [serviceGroups.name],
      filters: { parentId: serviceGroups.parentId },
      search: [serviceGroups.name],
      unique: { hospital_service_groups_name_uq: taken('service_group_name_taken', 'This group exists') },
      references: { [fk('hospital_service_groups', 'parent_id', 'hospital_service_groups')]: R.serviceGroup },
    }),
    record(R.service, services, {
      orderBy: [services.name],
      filters: { groupId: services.groupId, isOpd: services.isOpd, isIpd: services.isIpd, isActive: services.isActive },
      search: [services.name, services.code],
      unique: {
        hospital_services_code_uq: taken('service_code_taken', 'Another service has this code'),
        hospital_services_name_uq: taken('service_name_taken', 'The group already has this service'),
      },
      references: { [fk('hospital_services', 'group_id', 'hospital_service_groups')]: R.serviceGroup },
    }),
    record(R.corporateClient, corporateClients, {
      orderBy: [corporateClients.name],
      filters: { payment: corporateClients.payment, isActive: corporateClients.isActive },
      search: [corporateClients.name, corporateClients.contactPerson],
      unique: {
        hospital_corporate_clients_name_uq: taken('corporate_client_name_taken', 'This corporate client exists'),
      },
    }),
    record(
      R.ward,
      wards,
      {
        orderBy: [wards.name],
        filters: { isActive: wards.isActive },
        search: [wards.name, wards.floor],
        unique: { hospital_wards_name_uq: taken('ward_name_taken', 'This ward exists') },
      },
      ipd,
    ),
    record(
      R.bedCategory,
      bedCategories,
      {
        orderBy: [bedCategories.name],
        search: [bedCategories.name],
        unique: { hospital_bed_categories_name_uq: taken('bed_category_name_taken', 'This bed category exists') },
      },
      ipd,
    ),
    record(
      R.bed,
      beds,
      {
        orderBy: [beds.wardId, beds.displayOrder, beds.code],
        filters: { wardId: beds.wardId, categoryId: beds.categoryId, status: beds.status, isActive: beds.isActive },
        search: [beds.code],
        unique: { hospital_beds_code_uq: taken('bed_code_taken', 'Another bed has this code') },
        references: {
          [fk('hospital_beds', 'ward_id', 'hospital_wards')]: R.ward,
          [fk('hospital_beds', 'category_id', 'hospital_bed_categories')]: R.bedCategory,
        },
      },
      ipd,
    ),
    record(
      R.diagnosticDepartment,
      diagnosticDepartments,
      {
        orderBy: [diagnosticDepartments.name],
        filters: { kind: diagnosticDepartments.kind },
        search: [diagnosticDepartments.name],
        unique: {
          hospital_diagnostic_departments_name_uq: taken('department_name_taken', 'This department exists'),
        },
      },
      diag,
    ),
    record(
      R.diagnosticTest,
      diagnosticTests,
      {
        orderBy: [diagnosticTests.name],
        filters: { departmentId: diagnosticTests.departmentId, isActive: diagnosticTests.isActive },
        search: [diagnosticTests.name, diagnosticTests.shortName, diagnosticTests.code],
        unique: {
          hospital_diagnostic_tests_code_uq: taken('test_code_taken', 'Another test has this code'),
          hospital_diagnostic_tests_name_uq: taken('test_name_taken', 'The department already has this test'),
        },
        references: {
          [fk('hospital_diagnostic_tests', 'department_id', 'hospital_diagnostic_departments')]: R.diagnosticDepartment,
        },
      },
      diag,
    ),
    record(
      R.diagnosticPackage,
      diagnosticPackages,
      {
        orderBy: [diagnosticPackages.name],
        filters: { isActive: diagnosticPackages.isActive },
        search: [diagnosticPackages.name],
        unique: { hospital_diagnostic_packages_name_uq: taken('package_name_taken', 'This package exists') },
      },
      diag,
    ),
    record(
      R.testAppointmentWindow,
      testAppointmentWindows,
      {
        orderBy: [testAppointmentWindows.displayOrder, testAppointmentWindows.startTime],
        filters: { isActive: testAppointmentWindows.isActive, departmentId: testAppointmentWindows.departmentId },
        search: [testAppointmentWindows.label],
        unique: {
          hospital_test_appointment_windows_label_uq: taken(
            'window_label_taken',
            'The department already has a window of this name',
          ),
        },
        references: {
          [fk('hospital_test_appointment_windows', 'department_id', 'hospital_diagnostic_departments')]:
            R.diagnosticDepartment,
        },
      },
      diag,
    ),
    record(
      R.homeCollectionArea,
      homeCollectionAreas,
      {
        orderBy: [homeCollectionAreas.name],
        filters: { isActive: homeCollectionAreas.isActive },
        search: [homeCollectionAreas.name],
        unique: { hospital_home_collection_areas_name_uq: taken('area_name_taken', 'This area exists') },
      },
      diag,
    ),
    record(
      R.homeCollectionWindow,
      homeCollectionWindows,
      {
        orderBy: [homeCollectionWindows.displayOrder, homeCollectionWindows.label],
        filters: { isActive: homeCollectionWindows.isActive },
        unique: { hospital_home_collection_windows_label_uq: taken('window_label_taken', 'This window exists') },
      },
      diag,
    ),
    record(
      R.cardProvider,
      cardProviders,
      {
        orderBy: [cardProviders.name],
        filters: { isActive: cardProviders.isActive },
        search: [cardProviders.name],
        unique: { hospital_card_providers_name_uq: taken('card_provider_name_taken', 'This card provider exists') },
      },
      diag,
    ),
    record(
      R.testPreparation,
      testPreparations,
      {
        orderBy: [testPreparations.displayOrder, testPreparations.title],
        filters: {
          isActive: testPreparations.isActive,
          departmentId: testPreparations.departmentId,
          testId: testPreparations.testId,
        },
        search: [testPreparations.title, testPreparations.titleBn],
        references: {
          [fk('hospital_test_preparations', 'department_id', 'hospital_diagnostic_departments')]:
            R.diagnosticDepartment,
          [fk('hospital_test_preparations', 'test_id', 'hospital_diagnostic_tests')]: R.diagnosticTest,
        },
      },
      diag,
    ),
    record(
      R.otRoom,
      otRooms,
      {
        orderBy: [otRooms.name],
        filters: { isActive: otRooms.isActive },
        search: [otRooms.name, otRooms.floor],
        unique: { hospital_ot_rooms_name_uq: taken('ot_room_name_taken', 'This OT room exists') },
      },
      ot,
    ),
    record(
      R.operation,
      operations,
      {
        orderBy: [operations.name],
        filters: { isActive: operations.isActive },
        search: [operations.name],
        unique: { hospital_operations_name_uq: taken('operation_name_taken', 'This operation exists') },
      },
      ot,
    ),
    record(
      R.otType,
      otTypes,
      {
        orderBy: [otTypes.name],
        search: [otTypes.name],
        unique: { hospital_ot_types_name_uq: taken('ot_type_name_taken', 'This OT type exists') },
      },
      ot,
    ),
    record(
      R.anaesthesiaType,
      anaesthesiaTypes,
      {
        orderBy: [anaesthesiaTypes.name],
        search: [anaesthesiaTypes.name],
        unique: {
          hospital_anaesthesia_types_name_uq: taken('anaesthesia_type_name_taken', 'This anaesthesia type exists'),
        },
      },
      ot,
    ),
    record(
      R.surgeryProcedure,
      surgeryProcedures,
      {
        orderBy: [surgeryProcedures.title],
        search: [surgeryProcedures.title, surgeryProcedures.area],
        unique: { hospital_surgery_procedures_title_uq: taken('procedure_title_taken', 'This procedure exists') },
      },
      ot,
    ),
  ];
}
