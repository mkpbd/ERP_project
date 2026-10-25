import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { LogoSlot, TenantLogo } from '../domain/tenant-logo.js';

export class SetTenantLogoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly tenantId: string,
    readonly slot: LogoSlot,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemoveTenantLogoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly tenantId: string,
    readonly slot: LogoSlot,
  ) {
    super();
  }
}

export class GetTenantLogoQuery extends Query<TenantLogo> {
  constructor(
    readonly actor: Actor,
    readonly tenantId: string,
    readonly slot: LogoSlot,
  ) {
    super();
  }
}

export class UpdateSettingsCommand<T extends object> extends Command<T> {
  constructor(
    readonly actor: Actor,
    readonly key: string,
    readonly changes: Partial<T>,
  ) {
    super();
  }
}

export class GetSettingsQuery<T extends object> extends Query<T> {
  constructor(
    readonly actor: Actor,
    readonly key: string,
  ) {
    super();
  }
}
