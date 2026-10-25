import { Global, Module } from '@nestjs/common';
import { AuditTrail } from '../../shared/application/ports/audit-trail.js';
import { AuditLogReadRepository, GetAuditLogsHandler } from './application/audit-log.queries.js';
import { DrizzleAuditLogReadRepository, DrizzleAuditTrail } from './infrastructure/drizzle-audit.repository.js';
import { AuditLogsController } from './presentation/audit-logs.controller.js';

@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [
    GetAuditLogsHandler,
    { provide: AuditTrail, useClass: DrizzleAuditTrail },
    { provide: AuditLogReadRepository, useClass: DrizzleAuditLogReadRepository },
  ],
  exports: [AuditTrail],
})
export class AuditModule {}
