import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateRecordHandler,
  DeleteRecordHandler,
  GetRecordHandler,
  ListRecordsHandler,
  UpdateRecordHandler,
} from '../../../src/shared/application/record.handlers.js';
import {
  CreateRecordCommand,
  DeleteRecordCommand,
  GetRecordQuery,
  ListRecordsQuery,
  RecordStore,
  RecordTypeRegistry,
  UpdateRecordCommand,
  type RecordFilter,
} from '../../../src/shared/application/records.js';
import { ForbiddenError, NotFoundError } from '../../../src/shared/domain/errors.js';
import { FixedClock, InlineTransactionManager, RecordingAuditTrail, StubAccessControl } from '../../support/fakes.js';

interface Thing {
  id: string;
  name: string;
  group: string;
}

class MemoryStore extends RecordStore<Thing, { name: string; group: string }> {
  readonly rows = new Map<string, Thing>();
  list(filter: RecordFilter) {
    return Promise.resolve([...this.rows.values()].filter((row) => !filter.group || row.group === filter.group));
  }
  get(id: string) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  insert(id: string, input: { name: string; group: string }) {
    this.rows.set(id, { id, ...input });
    return Promise.resolve();
  }
  update(id: string, changes: Partial<Thing>) {
    const row = this.rows.get(id);
    if (row) Object.assign(row, changes);
    return Promise.resolve(row !== undefined);
  }
  delete(id: string) {
    return Promise.resolve(this.rows.delete(id));
  }
}

const actor = (userId: string) => ({ userId, sessionId: 'session' });

let registry: RecordTypeRegistry;
let store: MemoryStore;
let access: StubAccessControl;
let audit: RecordingAuditTrail;
let tx: InlineTransactionManager;
const clock = new FixedClock();

beforeEach(() => {
  registry = new RecordTypeRegistry();
  store = new MemoryStore();
  registry.register({ name: 'thing', readPermission: null, managePermission: 'things:manage', store });
  registry.register({ name: 'secret', readPermission: 'secrets:read', managePermission: 'secrets:manage', store });
  access = new StubAccessControl();
  access.grant('admin', 'things:manage');
  audit = new RecordingAuditTrail();
  tx = new InlineTransactionManager();
});

describe('record type registry', () => {
  it('refuses duplicate and unknown types', () => {
    expect(() => registry.register({ name: 'thing', readPermission: null, managePermission: 'x:y', store })).toThrow(
      /twice/,
    );
    expect(() => registry.get('nope')).toThrow(/not registered/);
  });
});

describe('record handlers', () => {
  it('creates, updates and deletes with the manage permission and audits each change', async () => {
    const { id } = await new CreateRecordHandler(registry, access, tx, audit, clock).execute(
      new CreateRecordCommand('thing', actor('admin'), { name: 'A', group: 'g' }),
    );
    await new UpdateRecordHandler(registry, access, tx, audit, clock).execute(
      new UpdateRecordCommand('thing', actor('admin'), id, { name: 'B' }),
    );
    expect(store.rows.get(id)).toEqual({ id, name: 'B', group: 'g' });
    await new DeleteRecordHandler(registry, access, tx, audit).execute(
      new DeleteRecordCommand('thing', actor('admin'), id),
    );
    expect(store.rows.size).toBe(0);
    expect(audit.actions()).toEqual(['thing.created:success', 'thing.updated:success', 'thing.deleted:success']);
    expect(audit.entries[1]?.metadata).toEqual({ fields: ['name'] });
  });

  it('refuses writes without the manage permission', async () => {
    const handler = new CreateRecordHandler(registry, access, tx, audit, clock);
    await expect(
      handler.execute(new CreateRecordCommand('thing', actor('reader'), { name: 'A', group: 'g' })),
    ).rejects.toThrow(ForbiddenError);
  });

  it('reports missing records as not found', async () => {
    const update = new UpdateRecordHandler(registry, access, tx, audit, clock);
    await expect(update.execute(new UpdateRecordCommand('thing', actor('admin'), 'x', { name: 'B' }))).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      new GetRecordHandler(registry, access).execute(new GetRecordQuery('thing', actor('u'), 'x')),
    ).rejects.toThrow(/thing not found/);
  });

  it('lets anyone signed in read open types, and checks the read permission otherwise', async () => {
    store.rows.set('1', { id: '1', name: 'A', group: 'g' });
    store.rows.set('2', { id: '2', name: 'B', group: 'h' });
    const list = new ListRecordsHandler(registry, access);
    expect(await list.execute(new ListRecordsQuery('thing', actor('anyone'), { group: 'h' }))).toEqual([
      { id: '2', name: 'B', group: 'h' },
    ]);
    await expect(list.execute(new ListRecordsQuery('secret', actor('anyone')))).rejects.toThrow(ForbiddenError);
  });
});
