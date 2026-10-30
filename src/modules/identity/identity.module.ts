import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { SecurityAlertHandler } from './application/events/security-alert.handlers.js';
import { LoginHandler } from './application/handlers/login.handler.js';
import {
  ChangePasswordHandler,
  RequestPasswordResetHandler,
  ResetPasswordHandler,
} from './application/handlers/password.handlers.js';
import { RefreshTokensHandler } from './application/handlers/refresh-tokens.handler.js';
import {
  RegisterUserHandler,
  ResendEmailVerificationHandler,
  VerifyEmailHandler,
} from './application/handlers/registration.handlers.js';
import {
  LogoutAllHandler,
  LogoutHandler,
  RevokeSessionHandler,
  RevokeUserSessionsHandler,
} from './application/handlers/session.handlers.js';
import {
  ActivateUserHandler,
  BootstrapAdministratorHandler,
  CreateUserHandler,
  DeactivateUserHandler,
  UpdateUserHandler,
} from './application/handlers/user-admin.handlers.js';
import {
  GetCurrentUserHandler,
  GetUserByIdHandler,
  ListMySessionsHandler,
  ListUserSessionsHandler,
  ListUsersHandler,
} from './application/handlers/user.query-handlers.js';
import {
  AccessTokenService,
  AUTH_SETTINGS,
  OpaqueTokenGenerator,
  PasswordHasher,
  type AuthSettings,
} from './application/ports.js';
import { UserReadRepository } from './application/read-models.js';
import { EmailVerificationService } from './application/services/email-verification.service.js';
import { RequestAuthenticator } from './application/services/request-authenticator.js';
import { SessionTokenService } from './application/services/session-token.service.js';
import {
  EmailVerificationTokenRepository,
  PasswordResetTokenRepository,
  RefreshTokenRepository,
  SessionRepository,
  UserRepository,
} from './domain/repositories.js';
import {
  DrizzleEmailVerificationTokenRepository,
  DrizzlePasswordResetTokenRepository,
} from './infrastructure/persistence/drizzle-one-time-token.repository.js';
import {
  DrizzleRefreshTokenRepository,
  DrizzleSessionRepository,
} from './infrastructure/persistence/drizzle-session.repository.js';
import {
  DrizzleUserDirectory,
  DrizzleUserReadRepository,
} from './infrastructure/persistence/drizzle-user-read.repository.js';
import { DrizzleUserRepository } from './infrastructure/persistence/drizzle-user.repository.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { JwtAccessTokenService } from './infrastructure/security/jwt-access-token.service.js';
import { RandomOpaqueTokenGenerator } from './infrastructure/security/random-opaque-token.generator.js';
import { AuthController } from './presentation/auth.controller.js';
import { AuthenticationGuard } from './presentation/authentication.guard.js';
import { RefreshCookie } from './presentation/refresh-cookie.js';
import { UsersController } from './presentation/users.controller.js';

const commandHandlers = [
  RegisterUserHandler,
  LoginHandler,
  RefreshTokensHandler,
  LogoutHandler,
  LogoutAllHandler,
  RevokeSessionHandler,
  RevokeUserSessionsHandler,
  ChangePasswordHandler,
  RequestPasswordResetHandler,
  ResetPasswordHandler,
  VerifyEmailHandler,
  ResendEmailVerificationHandler,
  CreateUserHandler,
  UpdateUserHandler,
  DeactivateUserHandler,
  ActivateUserHandler,
  BootstrapAdministratorHandler,
];
const queryHandlers = [
  GetCurrentUserHandler,
  GetUserByIdHandler,
  ListUsersHandler,
  ListMySessionsHandler,
  ListUserSessionsHandler,
];
const eventHandlers = [SecurityAlertHandler];

/** Accounts, credentials, sessions and tokens. Publishes UserDirectory to other modules. */
@Global()
@Module({
  controllers: [AuthController, UsersController],
  providers: [
    ...commandHandlers,
    ...queryHandlers,
    ...eventHandlers,
    SessionTokenService,
    EmailVerificationService,
    RequestAuthenticator,
    AuthenticationGuard,
    {
      provide: AUTH_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): AuthSettings => ({
        registrationEnabled: config.auth.registrationEnabled,
        emailVerificationRequired: config.auth.emailVerificationRequired,
        lockout: { maxFailedAttempts: config.auth.maxFailedLoginAttempts, lockoutSeconds: config.auth.lockoutSeconds },
        refreshTokenTtlSeconds: config.jwt.refreshTokenTtlSeconds,
        passwordResetTokenTtlSeconds: config.auth.passwordResetTokenTtlSeconds,
        emailVerificationTokenTtlSeconds: config.auth.emailVerificationTokenTtlSeconds,
        appPublicUrl: config.mail.appPublicUrl,
      }),
    },
    {
      provide: RefreshCookie,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new RefreshCookie(config.http.cookieSecure),
    },
    { provide: UserRepository, useClass: DrizzleUserRepository },
    { provide: SessionRepository, useClass: DrizzleSessionRepository },
    { provide: RefreshTokenRepository, useClass: DrizzleRefreshTokenRepository },
    { provide: PasswordResetTokenRepository, useClass: DrizzlePasswordResetTokenRepository },
    { provide: EmailVerificationTokenRepository, useClass: DrizzleEmailVerificationTokenRepository },
    { provide: UserReadRepository, useClass: DrizzleUserReadRepository },
    { provide: UserDirectory, useClass: DrizzleUserDirectory },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccessTokenService, useClass: JwtAccessTokenService },
    { provide: OpaqueTokenGenerator, useClass: RandomOpaqueTokenGenerator },
  ],
  exports: [UserDirectory, AuthenticationGuard],
})
export class IdentityModule {}
