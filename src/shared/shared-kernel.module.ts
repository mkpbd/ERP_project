import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './application/ports/clock.js';
import { RECORD_HANDLERS } from './application/record.handlers.js';
import { RecordTypeRegistry } from './application/records.js';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, RecordTypeRegistry, ...RECORD_HANDLERS],
  exports: [Clock, RecordTypeRegistry],
})
export class SharedKernelModule {}
