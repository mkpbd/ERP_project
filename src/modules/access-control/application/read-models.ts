export interface RoleView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly permissions: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PermissionView {
  readonly key: string;
  readonly description: string;
}

export interface UserRoleView {
  readonly roleId: string;
  readonly name: string;
  readonly assignedAt: Date;
}

export interface EffectivePermissionsView {
  readonly userId: string;
  readonly roles: string[];
  readonly permissions: string[];
}

export abstract class AccessReadRepository {
  abstract getProfile(userId: string): Promise<{ roles: string[]; roleIds: string[]; permissions: string[] }>;
  abstract listRoles(): Promise<RoleView[]>;
  abstract getRole(roleId: string): Promise<RoleView | null>;
  abstract listPermissions(): Promise<PermissionView[]>;
  abstract listUserRoles(userId: string): Promise<UserRoleView[]>;
}

export interface AccessControlSettings {
  readonly profileCacheTtlSeconds: number;
}

export const ACCESS_CONTROL_SETTINGS = Symbol('ACCESS_CONTROL_SETTINGS');
