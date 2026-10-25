import { z } from 'zod';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';
import { isoDate, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';

const permissionKey = z.string().regex(/^[a-z][a-z-]*:[a-z][a-z-]*$/, 'Expected resource:action');
const roleName = z.string().trim().min(2).max(64);
const description = z.string().trim().max(500);

export class CreateRoleDto extends createZodDto(
  z.strictObject({
    name: roleName,
    description: description.default(''),
    permissions: z.array(permissionKey).max(100).default([]),
  }),
) {}

export class UpdateRoleDto extends createZodDto(
  z
    .strictObject({ name: roleName.optional(), description: description.optional() })
    .refine((value) => value.name !== undefined || value.description !== undefined, 'Provide name or description'),
) {}

export class GrantPermissionsDto extends createZodDto(
  z.strictObject({ permissions: z.array(permissionKey).min(1).max(100) }),
) {}

export class RolePermissionParamDto extends createZodDto(z.strictObject({ id: z.uuid(), permission: permissionKey })) {}

export class AssignRoleDto extends createZodDto(z.strictObject({ roleId: z.uuid() })) {}

export class UserRoleParamDto extends createZodDto(z.strictObject({ id: z.uuid(), roleId: z.uuid() })) {}

const roleShape = {
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  createdAt: isoDate,
  updatedAt: isoDate,
};

export class RoleResponseDto extends responseDto(roleShape) {}

export class PermissionResponseDto extends responseDto({ key: z.string(), description: z.string() }) {}

export class UserRoleResponseDto extends responseDto({ roleId: z.uuid(), name: z.string(), assignedAt: isoDate }) {}

export class EffectivePermissionsResponseDto extends responseDto({
  userId: z.uuid(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
}) {}

export class GrantedPermissionsResponseDto extends responseDto({ granted: z.array(z.string()) }) {}
