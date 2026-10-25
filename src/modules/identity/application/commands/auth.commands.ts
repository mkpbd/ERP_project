import { Command } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';

export interface ClientInfo {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly sessionId: string;
}

export class RegisterUserCommand extends Command<void> {
  constructor(
    readonly email: string,
    readonly password: string,
    readonly displayName: string,
    readonly username: string | null,
  ) {
    super();
  }
}

export class LoginCommand extends Command<AuthTokens> {
  constructor(
    readonly identifier: string,
    readonly password: string,
    readonly client: ClientInfo,
  ) {
    super();
  }
}

export class RefreshTokensCommand extends Command<AuthTokens> {
  constructor(
    readonly refreshToken: string,
    readonly client: ClientInfo,
  ) {
    super();
  }
}

export class LogoutCommand extends Command<void> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class LogoutAllCommand extends Command<void> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class RevokeSessionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly sessionId: string,
  ) {
    super();
  }
}

export class ChangePasswordCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly currentPassword: string,
    readonly newPassword: string,
  ) {
    super();
  }
}

export class RequestPasswordResetCommand extends Command<void> {
  constructor(readonly email: string) {
    super();
  }
}

export class ResetPasswordCommand extends Command<void> {
  constructor(
    readonly token: string,
    readonly newPassword: string,
  ) {
    super();
  }
}

export class VerifyEmailCommand extends Command<void> {
  constructor(readonly token: string) {
    super();
  }
}

export class ResendEmailVerificationCommand extends Command<void> {
  constructor(readonly email: string) {
    super();
  }
}
