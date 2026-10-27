/** Seeing doctors, their schedules and the appointment books. */
export const OPD_READ = 'opd:read';
/** Keeping the doctors, specialities, chamber schedules and closed days. */
export const OPD_MANAGE = 'opd:manage';
/** Booking appointments and marking arrivals, no-shows and cancellations. */
export const OPD_BOOK = 'opd:book';
/** Paying doctors their shares of OPD and indoor bills. */
export const DOCTOR_PAY = 'doctor:pay';

export const HOSPITAL_RECORDS = {
  speciality: 'hospital_speciality',
  doctor: 'hospital_doctor',
  doctorSchedule: 'hospital_doctor_schedule',
  doctorClosure: 'hospital_doctor_closure',
  serviceGroup: 'hospital_service_group',
  service: 'hospital_service',
  corporateClient: 'hospital_corporate_client',
  ward: 'hospital_ward',
  bedCategory: 'hospital_bed_category',
  bed: 'hospital_bed',
} as const;
