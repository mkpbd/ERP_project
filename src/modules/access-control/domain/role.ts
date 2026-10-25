import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import { DomainError } from '../../../shared/domain/errors.js';
import { RolePermissionsChangedEvent } from './events.js';
import { isKnownPermission } from './permission-catalog.js';

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export interface RoleProps {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Set<string>;
  createdAt: Date;
  updatedAt: Date;
}

export class Role extends AggregateRoot {
  private constructor(private readonly props: RoleProps) {
    super();
  }

  static create(params: {
    id: string;
    name: string;
    description: string;
    permissions: Iterable<string>;
    now: Date;
  }): Role {
    const role = new Role({
      id: params.id,
      name: Role.validName(params.name),
      description: Role.validDescription(params.description),
      isSystem: false,
      permissions: new Set(),
      createdAt: params.now,
      updatedAt: params.now,
    });
    role.addPermissions(params.permissions);
    return role;
  }

  static restore(props: RoleProps): Role {
    return new Role({ ...props, permissions: new Set(props.permissions) });
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
  }
  get isSystem(): boolean {
    return this.props.isSystem;
  }
  get permissions(): ReadonlySet<string> {
    return this.props.permissions;
  }

  update(changes: { name?: string; description?: string }, now: Date): void {
    this.assertMutable();
    if (changes.name !== undefined) this.props.name = Role.validName(changes.name);
    if (changes.description !== undefined) this.props.description = Role.validDescription(changes.description);
    this.props.updatedAt = now;
  }

  /** Returns the permissions that were newly granted. */
  grant(permissions: Iterable<string>, now: Date): string[] {
    this.assertMutable();
    const added = this.addPermissions(permissions);
    if (added.length > 0) {
      this.props.updatedAt = now;
      this.raise(new RolePermissionsChangedEvent(this.id, now));
    }
    return added;
  }

  revoke(permission: string, now: Date): boolean {
    this.assertMutable();
    if (!this.props.permissions.delete(permission)) return false;
    this.props.updatedAt = now;
    this.raise(new RolePermissionsChangedEvent(this.id, now));
    return true;
  }

  assertDeletable(): void {
    this.assertMutable();
  }

  toSnapshot(): Readonly<RoleProps> {
    return { ...this.props, permissions: new Set(this.props.permissions) };
  }

  private addPermissions(permissions: Iterable<string>): string[] {
    const added: string[] = [];
    for (const permission of permissions) {
      if (!isKnownPermission(permission)) {
        throw new DomainError('unknown_permission', `Unknown permission: ${permission}`);
      }
      if (!this.props.permissions.has(permission)) {
        this.props.permissions.add(permission);
        added.push(permission);
      }
    }
    return added;
  }

  private assertMutable(): void {
    if (this.props.isSystem) {
      throw new DomainError('system_role_immutable', 'System roles cannot be modified');
    }
  }

  private static validName(name: string): string {
    const normalized = name.trim().toLowerCase();
    if (!ROLE_NAME_PATTERN.test(normalized)) {
      throw new DomainError(
        'invalid_role_name',
        'Role name must be 2-64 characters of a-z, 0-9 or "-" and start with a letter',
      );
    }
    return normalized;
  }

  private static validDescription(description: string): string {
    const trimmed = description.trim();
    if (trimmed.length > 500) throw new DomainError('invalid_role_description', 'Description is too long');
    return trimmed;
  }
}
