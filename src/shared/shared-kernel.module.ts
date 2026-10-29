import { Global, Module } from '@nestjs/common';
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
    PatientDocumentRegistry,
    ...RECORD_HANDLERS,
  ],
  exports: [Clock, RecordTypeRegistry, ReportRegistry, PatientDocumentRegistry],
})
export class SharedKernelModule {}
