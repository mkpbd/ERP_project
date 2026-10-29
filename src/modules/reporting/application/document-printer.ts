import { Inject, Injectable } from '@nestjs/common';
import { DocumentPrinter, type PrintedDocument } from '../../../shared/application/contracts/document-printer.js';
import { OrganizationProfile } from '../../../shared/application/contracts/organization-profile.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { ReportRegistry } from '../../../shared/application/reports.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { REPORTING_SETTINGS, ReportRenderer, type ReportingSettings } from './ports.js';
import { reportFileName } from './reporting.handlers.js';

/** No staff user prints these (the patient portal). */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** Prints a registered report as PDF for a caller that has decided who may read it (the patient portal). */
@Injectable()
export class RegistryDocumentPrinter extends DocumentPrinter {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly renderer: ReportRenderer,
    private readonly organization: OrganizationProfile,
    private readonly clock: Clock,
    @Inject(REPORTING_SETTINGS) private readonly settings: ReportingSettings,
  ) {
    super();
  }

  async printPdf(key: string, params: unknown, printedBy: string): Promise<PrintedDocument> {
    const definition = this.registry.get(key);
    if (!definition?.pdf) throw new NotFoundError('report');
    const parsed = definition.params.parse(params);
    const context = {
      actor: { userId: NOBODY, sessionId: NOBODY },
      header: await this.organization.reportHeader(),
      generatedAt: this.clock.now(),
      printedBy,
      timeZone: this.settings.timeZone,
    };
    const data = await definition.load(parsed, context);
    const filters = definition.describe?.(parsed, data) ?? '';
    const file = await this.renderer.render({ definition, data, context, format: 'pdf', filters });
    return { fileName: reportFileName(definition.title, context.generatedAt, context.timeZone, 'pdf'), ...file };
  }
}
