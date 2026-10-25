import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { SettingsRepository, TenantLogoRepository } from '../../domain/repositories.js';
import type { LogoContentType, LogoSlot, TenantLogo } from '../../domain/tenant-logo.js';
import { settings, tenantLogos } from './administration.schema.js';

@Injectable()
export class DrizzleTenantLogoRepository extends TenantLogoRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async save(tenantId: string, slot: LogoSlot, logo: TenantLogo, updatedBy: string, now: Date): Promise<void> {
    const row = { contentType: logo.contentType, data: Buffer.from(logo.data), updatedAt: now, updatedBy };
    try {
      await this.context.db
        .insert(tenantLogos)
        .values({ tenantId, slot, ...row })
        .onConflictDoUpdate({ target: [tenantLogos.tenantId, tenantLogos.slot], set: row });
    } catch (error) {
      if (foreignKeyViolationConstraint(error) === 'tenant_logos_tenant_id_tenants_id_fk') {
        throw new NotFoundError('tenant');
      }
      throw error;
    }
  }

  async find(tenantId: string, slot: LogoSlot): Promise<TenantLogo | null> {
    const [row] = await this.context.db
      .select({ contentType: tenantLogos.contentType, data: tenantLogos.data })
      .from(tenantLogos)
      .where(and(eq(tenantLogos.tenantId, tenantId), eq(tenantLogos.slot, slot)))
      .limit(1);
    // tenant_logos_type_ck guarantees the content type.
    return row ? { contentType: row.contentType as LogoContentType, data: row.data } : null;
  }

  async remove(tenantId: string, slot: LogoSlot): Promise<boolean> {
    const rows = await this.context.db
      .delete(tenantLogos)
      .where(and(eq(tenantLogos.tenantId, tenantId), eq(tenantLogos.slot, slot)))
      .returning({ tenantId: tenantLogos.tenantId });
    return rows.length > 0;
  }
}

@Injectable()
export class DrizzleSettingsRepository extends SettingsRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async load(key: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.context.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
    return row?.value ?? null;
  }

  async loadForUpdate(key: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.context.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .for('update');
    return row?.value ?? null;
  }

  async save(key: string, value: Record<string, unknown>, updatedBy: string, now: Date): Promise<void> {
    await this.context.db
      .insert(settings)
      .values({ key, value, updatedAt: now, updatedBy })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now, updatedBy } });
  }
}
