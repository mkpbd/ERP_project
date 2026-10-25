import { describe, expect, it } from 'vitest';
import { RolePermissionsChangedEvent } from '../../../src/modules/access-control/domain/events.js';
import {
  isKnownPermission,
  PERMISSION_CATALOG,
} from '../../../src/modules/access-control/domain/permission-catalog.js';
import { assertCanDelegate, satisfies } from '../../../src/modules/access-control/domain/policy.js';
import { Role } from '../../../src/modules/access-control/domain/role.js';
import { DomainError, ForbiddenError } from '../../../src/shared/domain/errors.js';

const now = new Date('2026-01-01T00:00:00Z');

describe('authorization policy', () => {
  const granted = { roles: ['auditor'], permissions: new Set(['users:read', 'audit:read']) };

  it('requires every permission by default', () => {
    expect(satisfies(granted, { permissions: ['users:read', 'audit:read'] })).toBe(true);
    expect(satisfies(granted, { permissions: ['users:read', 'users:create'] })).toBe(false);
  });

  it('supports any-of semantics', () => {
    expect(satisfies(granted, { permissions: ['users:create', 'audit:read'], mode: 'any' })).toBe(true);
    expect(satisfies(granted, { permissions: ['users:create'], mode: 'any' })).toBe(false);
  });

  it('checks roles as any-of', () => {
    expect(satisfies(granted, { roles: ['admin', 'auditor'] })).toBe(true);
    expect(satisfies(granted, { roles: ['admin'] })).toBe(false);
  });

  it('grants nothing implicitly: no wildcard or super-admin bypass', () => {
    const superAdminWithoutGrants = { roles: ['super-admin'], permissions: new Set<string>() };
    expect(satisfies(superAdminWithoutGrants, { permissions: ['users:read'] })).toBe(false);
    expect(satisfies({ roles: [], permissions: new Set(['*']) }, { permissions: ['users:read'] })).toBe(false);
  });

  it('blocks delegating permissions the actor lacks', () => {
    expect(() => assertCanDelegate(new Set(['users:read']), ['users:read'])).not.toThrow();
    expect(() => assertCanDelegate(new Set(['users:read']), ['users:read', 'audit:read'])).toThrow(ForbiddenError);
  });
});

describe('permission catalog', () => {
  it('uses resource:action names and has no duplicates', () => {
    const keys = PERMISSION_CATALOG.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z-]*:[a-z][a-z-]*$/);
    expect(isKnownPermission('users:read')).toBe(true);
    expect(isKnownPermission('users:fly')).toBe(false);
  });
});

describe('Role aggregate', () => {
  it('validates names and catalog permissions', () => {
    expect(() => Role.create({ id: 'r', name: 'Bad Name', description: '', permissions: [], now })).toThrow(
      DomainError,
    );
    expect(() => Role.create({ id: 'r', name: 'ok-role', description: '', permissions: ['users:fly'], now })).toThrow(
      /Unknown permission/,
    );
    const role = Role.create({
      id: 'r',
      name: 'Support-Team',
      description: ' Helps ',
      permissions: ['users:read'],
      now,
    });
    expect(role.name).toBe('support-team');
    expect(role.description).toBe('Helps');
  });

  it('reports only newly granted permissions and raises one event', () => {
    const role = Role.create({ id: 'r', name: 'support', description: '', permissions: ['users:read'], now });
    expect(role.grant(['users:read', 'audit:read'], now)).toEqual(['audit:read']);
    expect(role.pullDomainEvents()).toEqual([expect.any(RolePermissionsChangedEvent)]);
    expect(role.grant(['audit:read'], now)).toEqual([]);
    expect(role.pullDomainEvents()).toEqual([]);
  });

  it('revokes permissions', () => {
    const role = Role.create({ id: 'r', name: 'support', description: '', permissions: ['users:read'], now });
    expect(role.revoke('users:read', now)).toBe(true);
    expect(role.revoke('users:read', now)).toBe(false);
  });

  it('keeps system roles immutable', () => {
    const role = Role.restore({
      id: 'r',
      name: 'super-admin',
      description: '',
      isSystem: true,
      permissions: new Set(['users:read']),
      createdAt: now,
      updatedAt: now,
    });
    expect(() => role.grant(['audit:read'], now)).toThrow(/System roles/);
    expect(() => role.revoke('users:read', now)).toThrow(/System roles/);
    expect(() => role.update({ name: 'other' }, now)).toThrow(/System roles/);
    expect(() => role.assertDeletable()).toThrow(/System roles/);
  });
});
