/** Seeing doctors, their schedules and the appointment books. */
export const OPD_READ = 'opd:read';
/** Keeping the doctors, specialities, chamber schedules and closed days. */
export const OPD_MANAGE = 'opd:manage';
/** Booking appointments and marking arrivals, no-shows and cancellations. */
export const OPD_BOOK = 'opd:book';

export const HOSPITAL_RECORDS = {
  speciality: 'hospital_speciality',
  doctor: 'hospital_doctor',
  doctorSchedule: 'hospital_doctor_schedule',
  doctorClosure: 'hospital_doctor_closure',
  serviceGroup: 'hospital_service_group',
  service: 'hospital_service',
  corporateClient: 'hospital_corporate_client',
} as const;
