import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { SettingsRepository, TenantLogoRepository } from '../domain/repositories.js';
import { validLogo, type TenantLogo } from '../domain/tenant-logo.js';
import {
  GetSettingsQuery,
  GetTenantLogoQuery,
  RemoveTenantLogoCommand,
  SetTenantLogoCommand,
  UpdateSettingsCommand,
} from './administration.messages.js';
import { SETTINGS_MANAGE_PERMISSION, TENANTS_MANAGE_PERMISSION } from './record-types.js';
import { effectiveSettings } from './settings.js';

@CommandHandler(SetTenantLogoCommand)
export class SetTenantLogoHandler implements ICommandHandler<SetTenantLogoCommand> {
  constructor(
    private readonly logos: TenantLogoRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, tenantId, slot, contentType, data }: SetTenantLogoCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [TENANTS_MANAGE_PERMISSION] });
    const logo = validLogo(contentType, data);
    await this.tx.run(async () => {
      await this.logos.save(tenantId, slot, logo, actor.userId, this.clock.now());
      await this.audit.record({
        action: 'tenant.logo_set',
        actorUserId: actor.userId,
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: { slot, contentType: logo.contentType, bytes: logo.data.length },
      });
    });
  }
}

@CommandHandler(RemoveTenantLogoCommand)
export class RemoveTenantLogoHandler implements ICommandHandler<RemoveTenantLogoCommand> {
  constructor(
    private readonly logos: TenantLogoRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, tenantId, slot }: RemoveTenantLogoCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [TENANTS_MANAGE_PERMISSION] });
    await this.tx.run(async () => {
      if (!(await this.logos.remove(tenantId, slot))) throw new NotFoundError('tenant_logo');
      await this.audit.record({
        action: 'tenant.logo_removed',
        actorUserId: actor.userId,
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: { slot },
      });
    });
  }
}

@QueryHandler(GetTenantLogoQuery)
export class GetTenantLogoHandler implements IQueryHandler<GetTenantLogoQuery> {
  constructor(private readonly logos: TenantLogoRepository) {}

  async execute({ tenantId, slot }: GetTenantLogoQuery): Promise<TenantLogo> {
    const logo = await this.logos.find(tenantId, slot);
    if (!logo) throw new NotFoundError('tenant_logo');
    return logo;
  }
}

@CommandHandler(UpdateSettingsCommand)
export class UpdateSettingsHandler implements ICommandHandler<UpdateSettingsCommand<object>> {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, key, changes }: UpdateSettingsCommand<object>): Promise<object> {
    await this.access.authorize(actor.userId, { permissions: [SETTINGS_MANAGE_PERMISSION] });
    return this.tx.run(async () => {
      const current = effectiveSettings(key, await this.settings.loadForUpdate(key));
      const next = effectiveSettings(key, { ...current, ...changes });
      await this.settings.save(key, next, actor.userId, this.clock.now());
      await this.audit.record({
        action: 'settings.updated',
        actorUserId: actor.userId,
        resourceType: 'settings',
        resourceId: key,
        metadata: { fields: Object.keys(changes).sort() },
      });
      return next;
    });
  }
}

@QueryHandler(GetSettingsQuery)
export class GetSettingsHandler implements IQueryHandler<GetSettingsQuery<object>> {
  constructor(private readonly settings: SettingsRepository) {}

  async execute({ key }: GetSettingsQuery<object>): Promise<object> {
    return effectiveSettings(key, await this.settings.load(key));
  }
}
