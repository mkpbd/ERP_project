import { Global, Module } from '@nestjs/common';
import { DashboardRegistry } from './application/dashboards.js';
import { Clock, SystemClock } from './application/ports/clock.js';
import { PatientDocumentRegistry } from './application/patient-documents.js';
import { RECORD_HANDLERS } from './application/record.handlers.js';
import { RecordTypeRegistry } from './application/records.js';
import { ReportRegistry } from './application/reports.js';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    RecordTypeRegistry,
    ReportRegistry,
    DashboardRegistry,
    PatientDocumentRegistry,
    ...RECORD_HANDLERS,
  ],
  exports: [Clock, RecordTypeRegistry, ReportRegistry, DashboardRegistry, PatientDocumentRegistry],
})
export class SharedKernelModule {}
