import { describe, expect, it } from 'vitest';
import { VisitorPass } from '../../../src/modules/hospital/domain/visitor-pass.js';

const error = (run: () => unknown) => {
  try {
    run();
  } catch (caught) {
    return (caught as Error).message;
  }
  return null;
};

describe('a visitor pass', () => {
  it('names the visitor, takes a mobile of digits, and is handed back once', () => {
    const issue = (mobileNo: string | null) =>
      VisitorPass.issue({
        id: 'v',
        number: 'VP-2026-00001',
        admissionId: 'a',
        visitorName: ' Abdul Rahim ',
        relation: 'Husband',
        mobileNo,
        by: 'u',
        at: new Date(),
      });
    expect(error(() => issue('call me'))).toMatch(/digits only/);
    const pass = issue('+880 1711-000001');
    expect(pass.toSnapshot()).toMatchObject({ visitorName: 'Abdul Rahim', status: 'active' });
    pass.handBack('u', new Date());
    expect(error(() => pass.handBack('u', new Date()))).toMatch(/handed back already/);
  });
});
