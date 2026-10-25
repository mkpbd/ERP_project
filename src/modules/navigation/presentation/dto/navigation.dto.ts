import { z } from 'zod';
import { isoDate, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().max(500);
const path = z.string().trim().max(255).nullable();
const displayOrder = z.int().min(0).max(1_000_000);
const icon = z.string().trim().max(100).nullable();
const landingPageIconUrl = z.string().trim().max(500).nullable();

export class CreateMenuDto extends createZodDto(
  z.strictObject({
    parentId: z.uuid().nullable().default(null),
    name,
    description: description.default(''),
    path: path.default(null),
    displayOrder: displayOrder.default(0),
    isActive: z.boolean().default(true),
    icon: icon.default(null),
    landingPageIconUrl: landingPageIconUrl.default(null),
  }),
) {}

export class UpdateMenuDto extends createZodDto(
  z
    .strictObject({
      parentId: z.uuid().nullable().optional(),
      name: name.optional(),
      description: description.optional(),
      path: path.optional(),
      displayOrder: displayOrder.optional(),
      isActive: z.boolean().optional(),
      icon: icon.optional(),
      landingPageIconUrl: landingPageIconUrl.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field'),
) {}

export class SetRoleMenusDto extends createZodDto(z.strictObject({ menuIds: z.array(z.uuid()).max(5000) })) {}

export class ResolveMenuQueryDto extends createZodDto(z.object({ path: z.string().trim().min(1).max(255) })) {}

const menuShape = {
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  description: z.string(),
  path: z.string().nullable(),
  displayOrder: z.int(),
  isActive: z.boolean(),
  icon: z.string().nullable(),
  landingPageIconUrl: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  depth: z.int(),
  effectivelyActive: z.boolean(),
};

export class MenuResponseDto extends responseDto(menuShape) {}

export class MenuTrailResponseDto extends responseDto({
  menu: z.object(menuShape),
  ancestors: z.array(z.object(menuShape)),
}) {}

export class RoleMenusResponseDto extends responseDto({ roleId: z.uuid(), menuIds: z.array(z.uuid()) }) {}

export class GrantedMenusResponseDto extends responseDto({ menuIds: z.array(z.uuid()) }) {}
