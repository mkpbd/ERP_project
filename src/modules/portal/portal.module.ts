import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { PORTAL_ENGAGEMENT_HANDLERS } from './application/portal-engagement.handlers.js';
import { PORTAL_HANDLERS } from './application/portal.handlers.js';
import { OtpHasher, PortalRepository, PortalTokens, SmsSender } from './application/portal.ports.js';
import { DrizzlePortalRepository } from './infrastructure/persistence/drizzle-portal.repository.js';
import { HmacOtpHasher, JwtPortalTokens, LogSmsSender } from './infrastructure/security/portal-security.js';
import { PortalController } from './presentation/portal.controllers.js';
import { PortalEngagementController } from './presentation/portal-engagement.controller.js';
import { PortalGuard } from './presentation/portal.guard.js';

/**
 * The patient portal (step 11e; old AnonymousUser / AnonymousUserVerification): sign-in with a one-time code sent to
 * the patient's mobile or email, a patient token of its own, and the patient's own documents — listed from the
 * modules that own them (PatientDocumentRegistry) and printed through the DocumentPrinter.
 */
@Module({
  controllers: [PortalController, PortalEngagementController],
  providers: [
    ...PORTAL_HANDLERS,
    ...PORTAL_ENGAGEMENT_HANDLERS,
    PortalGuard,
    { provide: PortalRepository, useClass: DrizzlePortalRepository },
    { provide: PortalTokens, useClass: JwtPortalTokens },
    { provide: OtpHasher, useClass: HmacOtpHasher },
    {
      provide: SmsSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LogSmsSender(config.isProduction),
    },
  ],
})
export class PortalModule {}
