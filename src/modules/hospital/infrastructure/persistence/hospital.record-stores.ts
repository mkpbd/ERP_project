import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { HOSPITAL_RECORDS as R, OPD_MANAGE, OPD_READ } from '../../application/hospital.constants.js';
import { doctorClosures, doctors, doctorSchedules, specialities } from './hospital.schema.js';

const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function hospitalRecordTypes(context: DbContext): RecordType[] {
  const record = (name: string, table: RecordTable, options: Omit<RecordStoreOptions, 'name'>): RecordType => ({
    name,
    readPermission: OPD_READ,
    managePermission: OPD_MANAGE,
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
  ];
}
