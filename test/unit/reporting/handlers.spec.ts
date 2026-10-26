import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ReportRenderer, type RenderRequest } from '../../../src/modules/reporting/application/ports.js';
import { ReportAccessService } from '../../../src/modules/reporting/application/report-access.service.js';
import {
  ListMyReportsHandler,
  RenderReportHandler,
  reportFileName,
  SetRoleReportsHandler,
} from '../../../src/modules/reporting/application/reporting.handlers.js';
import {
  ListMyReportsQuery,
  RenderReportCommand,
  SetRoleReportsCommand,
} from '../../../src/modules/reporting/application/reporting.messages.js';
import { RoleReportRepository } from '../../../src/modules/reporting/domain/repositories.js';
import type { AuthorizationProfile } from '../../../src/shared/application/contracts/access-control.js';
import { OrganizationProfile } from '../../../src/shared/application/contracts/organization-profile.js';
import { UserDirectory, type UserSummary } from '../../../src/shared/application/contracts/user-directory.js';
import { defineReport, ReportRegistry, type ReportHeader } from '../../../src/shared/application/reports.js';
import { FixedClock, InlineTransactionManager, RecordingAuditTrail, StubAccessControl } from '../../support/fakes.js';

const actor = (userId: string) => ({ userId, sessionId: 'session' });
const HEADER: ReportHeader = {
  organizationName: 'Test Hospital',
  organizationNameAlt: null,
  address: '',
  hotline: null,
  logoDataUri: null,
};

class RoleAwareAccessControl extends StubAccessControl {
  readonly roleIds = new Map<string, string[]>();
  override async getProfile(userId: string): Promise<AuthorizationProfile> {
    return { ...(await super.getProfile(userId)), roleIds: this.roleIds.get(userId) ?? [] };
  }
}

class MemoryGrants extends RoleReportRepository {
  readonly grants = new Map<string, Set<string>>();
  keysForRoles(roleIds: readonly string[]) {
    return Promise.resolve([...new Set(roleIds.flatMap((id) => [...(this.grants.get(id) ?? [])]))]);
  }
  replace(roleId: string, keys: readonly string[]) {
    this.grants.set(roleId, new Set(keys));
    return Promise.resolve();
  }
}

class RecordingRenderer extends ReportRenderer {
  readonly requests: RenderRequest[] = [];
  render(request: RenderRequest) {
    this.requests.push(request);
    return Promise.resolve({ contentType: 'application/pdf', data: new Uint8Array([1, 2, 3]) });
  }
}

class Directory extends UserDirectory {
  findSummaries(ids: readonly string[]): Promise<UserSummary[]> {
    return Promise.resolve(
      ids.map((id) => ({ id, email: `${id}@example.com`, displayName: `User ${id}`, isActive: true })),
    );
  }
}

class Organization extends OrganizationProfile {
  reportHeader() {
    return Promise.resolve(HEADER);
  }
  patientIdPrefix() {
    return Promise.resolve('');
  }
}

let registry: ReportRegistry;
let access: RoleAwareAccessControl;
let grants: MemoryGrants;
let reports: ReportAccessService;
let renderer: RecordingRenderer;
let audit: RecordingAuditTrail;
const clock = new FixedClock(new Date('2026-10-25T20:30:00Z'));

beforeEach(() => {
  registry = new ReportRegistry();
  registry.register(
    defineReport({
      key: 'test.sales',
      title: 'Daily sales',
      group: 'Test',
      description: '',
      params: z.strictObject({ day: z.iso.date() }),
      load: (params) => Promise.resolve([{ day: params.day, total: 10 }]),
      describe: (params) => `Day: ${params.day}`,
      pdf: { engine: 'html', template: '/unused.hbs' },
    }),
  );
  registry.register(
    defineReport({
      key: 'test.stock',
      title: 'Stock',
      group: 'Test',
      description: '',
      params: z.strictObject({}),
      load: () => Promise.resolve([]),
      xlsx: (rows) => ({ columns: [], rows }),
    }),
  );
  access = new RoleAwareAccessControl();
  grants = new MemoryGrants();
  reports = new ReportAccessService(registry, grants, access);
  renderer = new RecordingRenderer();
  audit = new RecordingAuditTrail();
});

const renderHandler = () =>
  new RenderReportHandler(reports, renderer, new Organization(), new Directory(), audit, clock, {
    timeZone: 'Asia/Dhaka',
  });

describe('report registry', () => {
  it('rejects bad keys, duplicates and reports without an output', () => {
    const base = { title: 't', group: 'g', description: '', params: z.object({}), load: () => Promise.resolve([]) };
    expect(() =>
      registry.register(defineReport({ ...base, key: 'NoDot', xlsx: () => ({ columns: [], rows: [] }) })),
    ).toThrow(/Invalid report key/);
    expect(() =>
      registry.register(defineReport({ ...base, key: 'test.sales', xlsx: () => ({ columns: [], rows: [] }) })),
    ).toThrow(/twice/);
    expect(() => registry.register(defineReport({ ...base, key: 'test.empty' }))).toThrow(/no output format/);
  });

  it('names files in ASCII with the local date', () => {
    expect(reportFileName('Daily sales (OPD) — জেলা', clock.now(), 'Asia/Dhaka', 'pdf')).toBe(
      'daily-sales-opd-2026-10-26.pdf',
    );
    expect(reportFileName('জেলা', clock.now(), 'Asia/Dhaka', 'xlsx')).toBe('report-2026-10-26.xlsx');
  });
});

describe('running reports', () => {
  it('lists only granted reports, or all with reports:access-all', async () => {
    grants.grants.set('cashier', new Set(['test.sales']));
    access.roleIds.set('jane', ['cashier']);
    const list = new ListMyReportsHandler(reports);
    expect((await list.execute(new ListMyReportsQuery(actor('jane')))).map((report) => report.key)).toEqual([
      'test.sales',
    ]);
    access.grant('root', 'reports:access-all');
    expect(await list.execute(new ListMyReportsQuery(actor('root')))).toHaveLength(2);
  });

  it('validates parameters, renders with the letterhead and audits the run', async () => {
    access.grant('root', 'reports:access-all');
    await expect(
      renderHandler().execute(new RenderReportCommand(actor('root'), 'test.sales', 'pdf', { day: 'yesterday' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: [expect.objectContaining({ path: 'body.params.day' })],
    });

    const file = await renderHandler().execute(
      new RenderReportCommand(actor('root'), 'test.sales', 'pdf', { day: '2026-10-25' }),
    );
    expect(file).toMatchObject({ fileName: 'daily-sales-2026-10-26.pdf', contentType: 'application/pdf' });
    expect(renderer.requests[0]).toMatchObject({
      filters: 'Day: 2026-10-25',
      context: { header: HEADER, printedBy: 'User root', timeZone: 'Asia/Dhaka' },
      data: [{ day: '2026-10-25', total: 10 }],
    });
    expect(audit.actions()).toEqual(['report.rendered:success']);
  });

  it('refuses unknown reports, ungranted reports and missing formats', async () => {
    await expect(
      renderHandler().execute(new RenderReportCommand(actor('jane'), 'test.nope', 'pdf', {})),
    ).rejects.toMatchObject({
      code: 'report_not_found',
    });
    await expect(
      renderHandler().execute(new RenderReportCommand(actor('jane'), 'test.stock', 'xlsx', {})),
    ).rejects.toMatchObject({
      code: 'report_not_granted',
    });
    access.grant('root', 'reports:access-all');
    await expect(
      renderHandler().execute(new RenderReportCommand(actor('root'), 'test.stock', 'pdf', {})),
    ).rejects.toMatchObject({
      code: 'report_format_unsupported',
    });
    expect(renderer.requests).toHaveLength(0);
  });
});

describe('granting reports to roles', () => {
  const handler = () =>
    new SetRoleReportsHandler(registry, reports, grants, access, new InlineTransactionManager(), audit, clock);

  it('lets assigners hand out only reports they can run', async () => {
    access.grant('manager', 'reports:assign');
    access.roleIds.set('manager', ['managers']);
    grants.grants.set('managers', new Set(['test.sales']));

    await expect(
      handler().execute(new SetRoleReportsCommand(actor('manager'), 'clerks', ['test.sales'])),
    ).resolves.toEqual({
      roleId: 'clerks',
      reportKeys: ['test.sales'],
    });
    await expect(
      handler().execute(new SetRoleReportsCommand(actor('manager'), 'clerks', ['test.stock'])),
    ).rejects.toThrow(/reports you can run yourself/);
    await expect(
      handler().execute(new SetRoleReportsCommand(actor('manager'), 'clerks', ['test.nope'])),
    ).rejects.toThrow(/report not found/);
    expect(audit.actions()).toEqual(['role.reports_changed:success']);
  });

  it('drops grants for reports that no longer exist without a delegation check', async () => {
    access.grant('manager', 'reports:assign');
    grants.grants.set('clerks', new Set(['old.removed']));
    await handler().execute(new SetRoleReportsCommand(actor('manager'), 'clerks', []));
    expect(grants.grants.get('clerks')?.size).toBe(0);
  });
});
