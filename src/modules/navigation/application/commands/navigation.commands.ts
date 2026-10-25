import { Command } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';
import type { MenuChanges } from '../../domain/menu.js';

export interface MenuInput {
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly path: string | null;
  readonly displayOrder: number;
  readonly isActive: boolean;
  readonly icon: string | null;
  readonly landingPageIconUrl: string | null;
}

export class CreateMenuCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: MenuInput,
  ) {
    super();
  }
}

export class UpdateMenuCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly menuId: string,
    readonly changes: MenuChanges,
  ) {
    super();
  }
}

export class DeleteMenuCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly menuId: string,
  ) {
    super();
  }
}

/** Replaces the role's menus. Ancestors of every listed menu are granted too. */
export class SetRoleMenusCommand extends Command<{ menuIds: string[] }> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
    readonly menuIds: readonly string[],
  ) {
    super();
  }
}
