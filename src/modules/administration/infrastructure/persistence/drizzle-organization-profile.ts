import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { ReportHeader } from '../../../../shared/application/reports.js';
import { effectiveSettings } from '../../application/settings.js';
import { settings, tenantLogos, tenants } from './administration.schema.js';

/**
 * The letterhead comes from the first tenant (by creation), as the old reports used `Tenants[0]`.
 * With no tenant yet, reports print without one.
 */
@Injectable()
export class DrizzleOrganizationProfile extends OrganizationProfile {
  constructor(private readonly context: DbContext) {
    super();
  }

  async reportHeader(): Promise<ReportHeader> {
    const [row] = await this.context.db
      .select({
        name: tenants.name,
        nameAlt: tenants.nameAlt,
        address: tenants.address,
        hotline: tenants.hotline,
        logoType: tenantLogos.contentType,
        logo: tenantLogos.data,
      })
      .from(tenants)
      .leftJoin(tenantLogos, and(eq(tenantLogos.tenantId, tenants.id), eq(tenantLogos.slot, 'primary')))
      .orderBy(asc(tenants.createdAt), asc(tenants.id))
      .limit(1);
    if (!row) return { organizationName: '', organizationNameAlt: null, address: '', hotline: null, logoDataUri: null };
    return {
      organizationName: row.name,
      organizationNameAlt: row.nameAlt,
      address: row.address,
      hotline: row.hotline,
      logoDataUri: row.logo && row.logoType ? `data:${row.logoType};base64,${row.logo.toString('base64')}` : null,
    };
  }

  async patientIdPrefix(): Promise<string> {
    const [row] = await this.context.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'general'));
    const prefix = effectiveSettings('general', row?.value ?? null).uhidPrefix;
    return typeof prefix === 'string' ? prefix : '';
  }
}
