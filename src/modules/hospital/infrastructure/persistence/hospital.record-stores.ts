import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { HOSPITAL_RECORDS as R, OPD_MANAGE, OPD_READ } from '../../application/hospital.constants.js';
import { IPD_MANAGE, IPD_READ } from '../../application/ipd.messages.js';
import {
  bedCategories,
  beds,
  corporateClients,
  doctorClosures,
  doctors,
  doctorSchedules,
  serviceGroups,
  services,
  specialities,
  wards,
} from './hospital.schema.js';

const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function hospitalRecordTypes(context: DbContext): RecordType[] {
  const ipd: [string, string] = [IPD_READ, IPD_MANAGE];
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
  ];
}
