import { describe, expect, it } from 'vitest';
import {
  assertDuringStay,
  checkedBirth,
  checkedDeath,
  ClinicalNote,
  type BirthDetails,
  type DeathDetails,
} from '../../../src/modules/clinical/domain/emr.js';

const at = new Date('2026-10-30T04:00:00Z');
const hours = (n: number) => new Date(at.getTime() + n * 3_600_000);
const base = {
  id: 'n',
  admissionId: 'a',
  patientId: 'p',
  doctorId: null,
  notedAt: at,
  note: 'Patient comfortable, afebrile.',
  handedTo: null,
  by: 'nurse',
  at,
};

describe('notes', () => {
  it('names the doctor on a round, and who takes over on a handover only', () => {
    expect(() => ClinicalNote.write({ ...base, kind: 'round' })).toThrow(/names the doctor/);
    expect(ClinicalNote.write({ ...base, kind: 'round', doctorId: 'd' }).toSnapshot().doctorId).toBe('d');
    expect(() => ClinicalNote.write({ ...base, kind: 'handover' })).toThrow(/names who takes over/);
    expect(() => ClinicalNote.write({ ...base, kind: 'procedure', handedTo: 'u' })).toThrow(/names who takes over/);
    expect(() => ClinicalNote.write({ ...base, kind: 'handover', handedTo: 'nurse' })).toThrow(/to someone else/);
    expect(() => ClinicalNote.write({ ...base, kind: 'icu', note: '  ' })).toThrow(/Give the note/);
  });

  it('is corrected by its writer within a day', () => {
    const note = ClinicalNote.write({ ...base, kind: 'procedure' });
    expect(() => note.correct('Changed', 'someone', hours(1))).toThrow(/Only its writer/);
    note.correct('Dressing changed, wound clean.', 'nurse', hours(23));
    expect(note.toSnapshot()).toMatchObject({ note: 'Dressing changed, wound clean.', version: 2 });
    expect(() => note.correct('Later', 'nurse', hours(25))).toThrow(/within 24 hours/);
  });

  it('is acknowledged by the nurse taking over, once', () => {
    const note = ClinicalNote.write({ ...base, kind: 'handover', handedTo: 'night' });
    expect(() => note.acknowledge('nurse', hours(1))).toThrow(/Only the one taking over/);
    note.acknowledge('night', hours(1));
    note.acknowledge('night', hours(2));
    expect(note.toSnapshot()).toMatchObject({ acknowledgedAt: hours(1), version: 2 });
  });

  it('happened during the stay, not ahead of now', () => {
    const dayOf = (moment: Date) => moment.toISOString().slice(0, 10);
    expect(() => assertDuringStay(hours(1), at, dayOf, '2026-10-29', 'time')).toThrow(/not ahead/);
    expect(() => assertDuringStay(hours(-48), at, dayOf, '2026-10-29', 'time')).toThrow(/before the admission/);
    expect(() => assertDuringStay(hours(-1), at, dayOf, '2026-10-29', 'time')).not.toThrow();
  });
});

describe('death and birth records', () => {
  const death: DeathDetails = {
    diedAt: at,
    cause: ' Cardiac arrest ',
    antecedentCause: 'Acute myocardial infarction',
    otherConditions: null,
    deceasedNid: '1234567890',
    guardianName: 'Rahim',
    guardianNid: null,
    guardianRelation: 'Son',
    familyContactNo: '01711000000',
  };
  const birth: BirthDetails = {
    childName: null,
    childSex: 'female',
    bornAt: at,
    deliveryMode: 'caesarean',
    birthWeightKg: 3.256,
    fatherName: 'Karim',
    grandfatherName: null,
    religion: 'Islam',
    fatherPresentAddress: null,
    fatherPermanentAddress: null,
    comments: null,
  };

  it('needs a cause of death, NIDs of 10, 13 or 17 digits and a mobile to reach the family', () => {
    expect(checkedDeath(death).cause).toBe('Cardiac arrest');
    expect(() => checkedDeath({ ...death, cause: '' })).toThrow(/cause of death/);
    expect(() => checkedDeath({ ...death, guardianNid: '12345' })).toThrow(/10, 13 or 17 digits/);
    expect(() => checkedDeath({ ...death, familyContactNo: '0123' })).toThrow(/mobile/);
  });

  it('weighs a newborn 0.3 to 7 kg, kept to 10 g', () => {
    expect(checkedBirth(birth).birthWeightKg).toBe(3.26);
    expect(() => checkedBirth({ ...birth, birthWeightKg: 8 })).toThrow(/0.3 to 7 kg/);
  });
});
