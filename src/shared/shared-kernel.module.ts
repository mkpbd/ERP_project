import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './application/ports/clock.js';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class SharedKernelModule {}
