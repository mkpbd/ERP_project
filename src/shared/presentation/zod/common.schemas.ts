import { z } from 'zod';
import { createZodDto } from './zod-dto.js';

export class IdParamDto extends createZodDto(z.strictObject({ id: z.uuid() })) {}

export const paginationShape = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const pageMetaShape = {
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
  totalPages: z.int(),
};

export const isoDate = z.iso.datetime();

/**
 * PATCH body for a record: every field optional, at least one present.
 * Pass fields without defaults so absent fields stay absent.
 */
export function updateSchema<TShape extends z.ZodRawShape>(fields: TShape) {
  return z
    .strictObject(fields)
    .partial()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
}

/** Response shape of a record: id, its fields, timestamps. */
export function recordResponseShape<TShape extends z.ZodRawShape>(fields: TShape) {
  return { id: z.uuid(), ...fields, createdAt: isoDate, updatedAt: isoDate };
}

/** Response DTO helper: documents a JSON object returned by an endpoint. */
export function responseDto<TShape extends z.ZodRawShape>(shape: TShape) {
  return createZodDto(z.object(shape), { io: 'output' });
}

export class MessageResponseDto extends responseDto({ message: z.string() }) {}
