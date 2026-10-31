import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import { DomainError } from '../../../shared/domain/errors.js';
import {
  UserActivatedEvent,
  UserDeactivatedEvent,
  UserLockedOutEvent,
  UserPasswordChangedEvent,
  UserRegisteredEvent,
} from './events.js';
import type { DisplayName, Email, Username } from './value-objects.js';

export type UserStatus = 'active' | 'deactivated';

export interface UserProps {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date;
  mfaEnabled: boolean;
  /** The account stops signing in from this moment (old UserExpireDateSetup); null: never. */
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LockoutPolicy {
  readonly maxFailedAttempts: number;
  readonly lockoutSeconds: number;
}

/** Why an account that presented the correct password still may not sign in. */
export type SignInBlock = 'deactivated' | 'expired' | 'email_not_verified';

export class User extends AggregateRoot {
  private constructor(private readonly props: UserProps) {
    super();
  }

  static register(params: {
    id: string;
    email: Email;
    username: Username | null;
    displayName: DisplayName;
    passwordHash: string;
    emailVerified: boolean;
    now: Date;
  }): User {
    const user = new User({
      id: params.id,
      email: params.email.value,
      username: params.username?.value ?? null,
      displayName: params.displayName.value,
      passwordHash: params.passwordHash,
      status: 'active',
      emailVerifiedAt: params.emailVerified ? params.now : null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: params.now,
      mfaEnabled: false,
      expiresAt: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    user.raise(new UserRegisteredEvent(params.id, params.now));
    return user;
  }

  static restore(props: UserProps): User {
    return new User({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get username(): string | null {
    return this.props.username;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get isActive(): boolean {
    return this.props.status === 'active';
  }
  get isEmailVerified(): boolean {
    return this.props.emailVerifiedAt !== null;
  }
  get mfaEnabled(): boolean {
    return this.props.mfaEnabled;
  }
  get failedLoginCount(): number {
    return this.props.failedLoginCount;
  }
  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }
  get version(): number {
    return this.props.version;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt !== null && this.props.expiresAt <= now;
  }

  isLocked(now: Date): boolean {
    return this.props.lockedUntil !== null && this.props.lockedUntil > now;
  }

  signInBlock(requireVerifiedEmail: boolean, now: Date): SignInBlock | null {
    if (!this.isActive) return 'deactivated';
    if (this.isExpired(now)) return 'expired';
    if (requireVerifiedEmail && !this.isEmailVerified) return 'email_not_verified';
    return null;
  }

  /** Counts a wrong password. Reaching the limit locks the account and restarts the count. */
  recordFailedSignIn(now: Date, policy: LockoutPolicy): void {
    const attempts = this.props.failedLoginCount + 1;
    if (attempts >= policy.maxFailedAttempts) {
      const lockedUntil = new Date(now.getTime() + policy.lockoutSeconds * 1000);
      this.props.failedLoginCount = 0;
      this.props.lockedUntil = lockedUntil;
      this.raise(new UserLockedOutEvent(this.id, lockedUntil, now));
    } else {
      this.props.failedLoginCount = attempts;
    }
    this.touch(now);
  }

  recordSuccessfulSignIn(now: Date): void {
    this.props.failedLoginCount = 0;
    this.props.lockedUntil = null;
    this.props.lastLoginAt = now;
    this.touch(now);
  }

  /** Replaces the hash without a policy change, e.g. after argon2 parameters were raised. */
  upgradePasswordHash(passwordHash: string, now: Date): void {
    this.props.passwordHash = passwordHash;
    this.touch(now);
  }

  changePassword(passwordHash: string, now: Date): void {
    this.props.passwordHash = passwordHash;
    this.props.passwordChangedAt = now;
    this.props.failedLoginCount = 0;
    this.props.lockedUntil = null;
    this.touch(now);
    this.raise(new UserPasswordChangedEvent(this.id, now));
  }

  verifyEmail(now: Date): void {
    if (this.props.emailVerifiedAt !== null) return;
    this.props.emailVerifiedAt = now;
    this.touch(now);
  }

  rename(displayName: DisplayName, now: Date): void {
    this.props.displayName = displayName.value;
    this.touch(now);
  }

  deactivate(now: Date): void {
    if (this.props.status === 'deactivated') {
      throw new DomainError('user_already_deactivated', 'User is already deactivated');
    }
    this.props.status = 'deactivated';
    this.touch(now);
    this.raise(new UserDeactivatedEvent(this.id, now));
  }

  /** Sets or clears the moment the account stops signing in. */
  setExpiry(expiresAt: Date | null, now: Date): void {
    this.props.expiresAt = expiresAt;
    this.touch(now);
  }

  activate(now: Date): void {
    if (this.props.status === 'active') {
      throw new DomainError('user_already_active', 'User is already active');
    }
    this.props.status = 'active';
    this.props.failedLoginCount = 0;
    this.props.lockedUntil = null;
    this.touch(now);
    this.raise(new UserActivatedEvent(this.id, now));
  }

  /** Called by the repository after a successful optimistic-concurrency write. */
  markPersisted(): void {
    this.props.version += 1;
  }

  toSnapshot(): Readonly<UserProps> {
    return { ...this.props };
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
  }
}
