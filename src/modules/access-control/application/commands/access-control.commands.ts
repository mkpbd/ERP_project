import { Command } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';

export class CreateRoleCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly name: string,
    readonly description: string,
    readonly permissions: readonly string[],
  ) {
    super();
  }
}

export class UpdateRoleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
    readonly changes: { readonly name?: string; readonly description?: string },
  ) {
    super();
  }
}

export class DeleteRoleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
  ) {
    super();
  }
}

export class GrantRolePermissionsCommand extends Command<{ granted: string[] }> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
    readonly permissions: readonly string[],
  ) {
    super();
  }
}

export class RevokeRolePermissionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
    readonly permission: string,
  ) {
    super();
  }
}

export class AssignUserRoleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly roleId: string,
  ) {
    super();
  }
}

export class RevokeUserRoleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly roleId: string,
  ) {
    super();
  }
}

export class SyncPermissionCatalogCommand extends Command<void> {}
