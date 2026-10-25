import type { LogoSlot, TenantLogo } from './tenant-logo.js';

export abstract class TenantLogoRepository {
  /** Throws NotFoundError (tenant) when the tenant does not exist. */
  abstract save(tenantId: string, slot: LogoSlot, logo: TenantLogo, updatedBy: string, now: Date): Promise<void>;
  abstract find(tenantId: string, slot: LogoSlot): Promise<TenantLogo | null>;
  /** Returns false when there was no logo. */
  abstract remove(tenantId: string, slot: LogoSlot): Promise<boolean>;
}

export abstract class SettingsRepository {
  abstract load(key: string): Promise<Record<string, unknown> | null>;
  /** Locks the settings row until the transaction ends (null when it does not exist yet). */
  abstract loadForUpdate(key: string): Promise<Record<string, unknown> | null>;
  abstract save(key: string, value: Record<string, unknown>, updatedBy: string, now: Date): Promise<void>;
}
