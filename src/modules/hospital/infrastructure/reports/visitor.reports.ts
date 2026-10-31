import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import type { VisitorPassReadRepository } from '../../application/visitor.messages.js';
import { uhidLabel } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old Visiting Card print: a card for the attendant, with the patient, the bed and the pass number in a barcode. */
export function visitorPassReport(
  read: VisitorPassReadRepository,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'hospital.visitor-pass',
    title: 'Visitor pass',
    group: 'Hospital',
    description: "An attendant's pass for an admitted patient: the visitor, the patient, ward and bed, with a barcode.",
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const pass = await read.card(params.id);
      if (!pass) throw new NotFoundError('visitor_pass');
      if (!pass.valid) throw new DomainError('pass_not_valid', 'The pass was handed back, or the patient has left');
      return {
        organization: report.header,
        pass: { ...pass, uhidLabel: uhidLabel(await organization.patientIdPrefix(), pass.uhid) },
        barcode: code39Svg(pass.number),
      };
    },
    describe: (_params, data) => `${data.pass.number} · ${data.pass.visitorName}`,
    pdf: {
      engine: 'html',
      template: template('visitor-pass'),
      bare: true,
      paper: { width: '85.6mm', height: '54mm' },
    },
  });
}
