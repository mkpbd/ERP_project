import { z } from 'zod';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';
import {
  isoDate,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { PASSWORD_MAX_LENGTH } from '../../domain/password-policy.js';

// Transport-level bounds only; the domain enforces the actual rules
// (password policy, email/username format) so they live in one place.
const email = z.string().trim().min(3).max(254).meta({ format: 'email', example: 'jane@example.com' });
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const newPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH).meta({ description: '12-128 characters' });
const opaqueToken = z.string().min(16).max(256);

export class RegisterDto extends createZodDto(
  z.strictObject({
    email,
    password: newPassword,
    displayName: z.string().trim().min(1).max(100),
    username: z.string().trim().min(3).max(32).optional(),
  }),
) {}

export class LoginDto extends createZodDto(
  z.strictObject({
    identifier: z.string().trim().min(1).max(254).meta({ description: 'Email address or username' }),
    password,
  }),
) {}

export class RefreshDto extends createZodDto(
  z.strictObject({
    refreshToken: opaqueToken.optional().meta({ description: 'Non-browser clients only; browsers use the cookie' }),
  }),
) {}

export class ForgotPasswordDto extends createZodDto(z.strictObject({ email })) {}

export class ResetPasswordDto extends createZodDto(z.strictObject({ token: opaqueToken, newPassword })) {}

export class ChangePasswordDto extends createZodDto(z.strictObject({ currentPassword: password, newPassword })) {}

export class VerifyEmailDto extends createZodDto(z.strictObject({ token: opaqueToken })) {}

export class ResendVerificationDto extends createZodDto(z.strictObject({ email })) {}

export class CreateUserDto extends createZodDto(
  z.strictObject({
    email,
    password: newPassword,
    displayName: z.string().trim().min(1).max(100),
    username: z.string().trim().min(3).max(32).optional(),
  }),
) {}

export class UpdateUserDto extends createZodDto(z.strictObject({ displayName: z.string().trim().min(1).max(100) })) {}

/** The moment the account stops signing in; null clears it. */
export class UserExpiryDto extends createZodDto(
  z.strictObject({
    expiresAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .nullable(),
  }),
) {}

export class ListUsersQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['active', 'deactivated']).optional(),
    sort: z.enum(['createdAt', 'email', 'displayName']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
) {}

export class SessionIdParamDto extends createZodDto(z.strictObject({ sessionId: z.uuid() })) {}

const userShape = {
  id: z.uuid(),
  email: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  status: z.enum(['active', 'deactivated']),
  emailVerified: z.boolean(),
  lastLoginAt: isoDate.nullable(),
  expiresAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
};

export class UserResponseDto extends responseDto(userShape) {}

export class CurrentUserResponseDto extends responseDto({
  ...userShape,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
}) {}

export class UserPageResponseDto extends responseDto({ items: z.array(z.object(userShape)), ...pageMetaShape }) {}

export class TokenResponseDto extends responseDto({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.int().meta({ description: 'Access token lifetime in seconds' }),
  accessTokenExpiresAt: isoDate,
  refreshTokenExpiresAt: isoDate,
  refreshToken: z
    .string()
    .optional()
    .meta({ description: 'Present only when requested via X-Refresh-Token-Delivery: body' }),
}) {}

export class SessionResponseDto extends responseDto({
  id: z.uuid(),
  createdAt: isoDate,
  lastUsedAt: isoDate,
  expiresAt: isoDate,
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  current: z.boolean(),
}) {}

export class CreatedResponseDto extends responseDto({ id: z.uuid() }) {}

export class RevokedCountResponseDto extends responseDto({ revoked: z.int() }) {}
