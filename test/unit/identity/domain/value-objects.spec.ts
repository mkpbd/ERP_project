import { describe, expect, it } from 'vitest';
import { assertAcceptablePassword } from '../../../../src/modules/identity/domain/password-policy.js';
import { Session } from '../../../../src/modules/identity/domain/session.js';
import { DisplayName, Email, Username } from '../../../../src/modules/identity/domain/value-objects.js';
import { DomainError } from '../../../../src/shared/domain/errors.js';

describe('Email', () => {
  it('normalizes case and whitespace', () => {
    expect(Email.create('  Jane.Doe@Example.COM ').value).toBe('jane.doe@example.com');
  });

  it.each(['no-at-sign', 'a@b', '@example.com', `${'a'.repeat(250)}@x.io`])('rejects %s', (raw) => {
    expect(() => Email.create(raw)).toThrow(DomainError);
  });
});

describe('Username', () => {
  it('accepts and lowercases valid usernames', () => {
    expect(Username.create('Jane_Doe-1').value).toBe('jane_doe-1');
  });

  it.each(['ab', '-start', 'end.', 'with space', 'has@at', 'x'.repeat(33)])('rejects %s', (raw) => {
    expect(() => Username.create(raw)).toThrow(DomainError);
  });

  it('never accepts an @, so identifiers with @ are emails', () => {
    expect(Username.looksLikeEmail('jane@example.com')).toBe(true);
    expect(Username.looksLikeEmail('jane')).toBe(false);
  });
});

describe('DisplayName', () => {
  it('collapses whitespace and enforces length', () => {
    expect(DisplayName.create('  Jane    Doe ').value).toBe('Jane Doe');
    expect(() => DisplayName.create('   ')).toThrow(DomainError);
    expect(() => DisplayName.create('x'.repeat(101))).toThrow(DomainError);
  });
});

describe('password policy', () => {
  const context = { email: 'jane.doe@example.com', username: 'janed' };

  it('accepts a long passphrase', () => {
    expect(() => assertAcceptablePassword('correct horse battery staple', context)).not.toThrow();
  });

  it.each([
    ['too short', 'Sh0rt!pass'],
    ['too long', 'x'.repeat(129)],
    ['contains email local part', 'my-jane.doe-password'],
    ['contains username', 'iamjanedforever'],
    ['too repetitive', 'aaaaaaaaaaaaaaaa'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(() => assertAcceptablePassword(password, context)).toThrow(/Password/);
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // 6 code points but 12 UTF-16 units: too short.
    expect(() => assertAcceptablePassword('🔒🔑🚪🧱🪟🛡', context)).toThrow(DomainError);
  });
});

describe('Session', () => {
  it('is active until revoked or expired and truncates long user agents', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = Session.open({
      id: 's',
      userId: 'u',
      now,
      ttlSeconds: 60,
      userAgent: 'x'.repeat(600),
      ipAddress: null,
    });
    expect(session.isActive(now)).toBe(true);
    expect(session.isActive(new Date(now.getTime() + 61_000))).toBe(false);
    expect(session.toSnapshot().userAgent).toHaveLength(512);
    expect(session.belongsTo('u')).toBe(true);
    expect(session.belongsTo('other')).toBe(false);
  });
});
