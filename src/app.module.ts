import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { AccessControlModule } from './modules/access-control/access-control.module.js';
import { AuthorizationGuard } from './modules/access-control/presentation/authorization.guard.js';
import { AdministrationModule } from './modules/administration/administration.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { HrModule } from './modules/hr/hr.module.js';
import { AuthenticationGuard } from './modules/identity/presentation/authentication.guard.js';
import { LocationModule } from './modules/location/location.module.js';
import { NavigationModule } from './modules/navigation/navigation.module.js';
import { MenuAccessGuard } from './modules/navigation/presentation/menu-access.guard.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { RequestContext } from './shared/infrastructure/request-context.js';
import { AUTH_RATE_LIMIT_KEY } from './shared/presentation/auth.decorators.js';
import { SharedKernelModule } from './shared/shared-kernel.module.js';

/** Paths never written to logs, wherever they appear. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            genReqId: (request: IncomingMessage) => String(request.headers['x-request-id']),
            redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
            customProps: () => ({ correlationId: RequestContext.current()?.correlationId }),
            // Query strings may carry search terms (PII); log the path only.
            serializers: {
              req: (request: { id: unknown; method: string; url: string }) => ({
                id: request.id,
                method: request.method,
                path: request.url.split('?')[0],
              }),
            },
            autoLogging: { ignore: (request: IncomingMessage) => request.url?.includes('/health/') ?? false },
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: config.rateLimit.ttlSeconds * 1000, limit: config.rateLimit.limit },
            {
              name: 'auth',
              ttl: config.rateLimit.ttlSeconds * 1000,
              limit: config.rateLimit.authLimit,
              // Only routes marked @AuthRateLimit() count against the stricter bucket.
              skipIf: (context) =>
                context.getHandler && !Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getHandler()),
            },
          ],
        }),
        CqrsModule.forRoot(),
        SharedKernelModule,
        DatabaseModule,
        NotificationsModule,
        AuditModule,
        AccessControlModule,
        IdentityModule,
        NavigationModule,
        LocationModule,
        AdministrationModule,
        ReportingModule,
        HrModule,
        HealthModule,
      ],
      // Order matters: rate limit, then authenticate, then authorize (permissions, then pages).
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_GUARD, useExisting: AuthorizationGuard },
        { provide: APP_GUARD, useExisting: MenuAccessGuard },
      ],
    };
  }
}
