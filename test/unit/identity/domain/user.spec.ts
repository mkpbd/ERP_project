import { describe, expect, it } from 'vitest';
import {
  UserDeactivatedEvent,
  UserLockedOutEvent,
  UserPasswordChangedEvent,
  UserRegisteredEvent,
} from '../../../../src/modules/identity/domain/events.js';
import { DomainError } from '../../../../src/shared/domain/errors.js';
import { makeUser } from '../../../support/fakes.js';

const now = new Date('2026-01-01T00:00:00Z');
const policy = { maxFailedAttempts: 3, lockoutSeconds: 600 };

describe('User aggregate', () => {
  it('raises UserRegistered on registration and starts active', () => {
    const user = makeUser({ now });
    expect(user.isActive).toBe(true);
    expect(user.pullDomainEvents()).toEqual([expect.any(UserRegisteredEvent)]);
    expect(user.pullDomainEvents()).toEqual([]);
  });

  it('locks the account once the failed-attempt limit is reached and resets the counter', () => {
    const user = makeUser();
    user.pullDomainEvents();
    user.recordFailedSignIn(now, policy);
    user.recordFailedSignIn(now, policy);
    expect(user.isLocked(now)).toBe(false);
    expect(user.failedLoginCount).toBe(2);

    user.recordFailedSignIn(now, policy);
    expect(user.isLocked(now)).toBe(true);
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toEqual(new Date(now.getTime() + 600_000));
    expect(user.pullDomainEvents()).toEqual([expect.any(UserLockedOutEvent)]);
  });

  it('unlocks automatically after the lockout period', () => {
    const user = makeUser();
    for (let i = 0; i < 3; i++) user.recordFailedSignIn(now, policy);
    expect(user.isLocked(new Date(now.getTime() + 599_000))).toBe(true);
    expect(user.isLocked(new Date(now.getTime() + 600_001))).toBe(false);
  });

  it('clears failures on successful sign-in', () => {
    const user = makeUser();
    user.recordFailedSignIn(now, policy);
    user.recordSuccessfulSignIn(now);
    expect(user.failedLoginCount).toBe(0);
  });

  it('reports why a correct password still cannot sign in', () => {
    expect(makeUser({ verified: false }).signInBlock(true)).toBe('email_not_verified');
    expect(makeUser({ verified: false }).signInBlock(false)).toBeNull();
    const user = makeUser();
    user.deactivate(now);
    expect(user.signInBlock(false)).toBe('deactivated');
  });

  it('changing the password clears lockout and raises an event', () => {
    const user = makeUser();
    for (let i = 0; i < 3; i++) user.recordFailedSignIn(now, policy);
    user.pullDomainEvents();
    user.changePassword('hash:new', now);
    expect(user.isLocked(now)).toBe(false);
    expect(user.passwordHash).toBe('hash:new');
    expect(user.pullDomainEvents()).toEqual([expect.any(UserPasswordChangedEvent)]);
  });

  it('rejects redundant status transitions', () => {
    const user = makeUser();
    expect(() => user.activate(now)).toThrow(DomainError);
    user.deactivate(now);
    expect(user.pullDomainEvents().at(-1)).toBeInstanceOf(UserDeactivatedEvent);
    expect(() => user.deactivate(now)).toThrow(DomainError);
    user.activate(now);
    expect(user.isActive).toBe(true);
  });

  it('increments its version when persisted', () => {
    const user = makeUser();
    user.markPersisted();
    expect(user.version).toBe(2);
  });
});
