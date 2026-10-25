import { Command } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';

export class CreateUserCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly email: string,
    readonly password: string,
    readonly displayName: string,
    readonly username: string | null,
  ) {
    super();
  }
}

export class UpdateUserCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly displayName: string,
  ) {
    super();
  }
}

export class DeactivateUserCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}

export class ActivateUserCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}

export class RevokeUserSessionsCommand extends Command<{ revoked: number }> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}

export class BootstrapAdministratorCommand extends Command<{ created: boolean; userId: string | null }> {
  constructor(
    readonly email: string,
    readonly password: string,
    readonly displayName: string,
  ) {
    super();
  }
}
