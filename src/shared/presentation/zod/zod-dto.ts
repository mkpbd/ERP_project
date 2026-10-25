import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors.js';

type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
  items?: JsonSchema;
};

export interface ZodDtoClass<TSchema extends z.ZodType = z.ZodType> {
  new (): z.output<TSchema>;
  readonly zodSchema: TSchema;
  readonly zodIo: 'input' | 'output';
}

/** DTO class name -> schema, filled as Swagger discovers DTOs. */
const registry = new Map<string, { schema: z.ZodType; io: 'input' | 'output' }>();

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return json;
}

/**
 * Turns a Zod schema into a class usable as a NestJS parameter type.
 * The class carries the schema so that the global ZodValidationPipe can
 * validate, and Swagger can document it (see patchOpenApiWithZodSchemas).
 *
 * Use `io: 'output'` for response DTOs.
 */
export function createZodDto<TSchema extends z.ZodType>(
  schema: TSchema,
  options: { io?: 'input' | 'output' } = {},
): ZodDtoClass<TSchema> {
  const io = options.io ?? 'input';

  class ZodDto {
    static readonly zodSchema = schema;
    static readonly zodIo = io;

    // Called by @nestjs/swagger with `this` bound to the concrete subclass.
    // Flat properties let Swagger expand query DTOs into individual parameters.
    static _OPENAPI_METADATA_FACTORY(this: { name: string }): Record<string, unknown> {
      registry.set(this.name, { schema, io });
      const json = toJsonSchema(schema, io);
      const required = new Set(json.required ?? []);
      const properties: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(json.properties ?? {})) {
        const { type, items, ...rest } = property;
        const isArray = type === 'array';
        properties[key] = {
          ...rest,
          required: required.has(key),
          type: isArray ? (items?.type ?? 'string') : (type ?? 'string'),
          ...(isArray ? { isArray: true } : {}),
        };
      }
      return properties;
    }
  }

  return ZodDto as unknown as ZodDtoClass<TSchema>;
}

/** Replaces Swagger's reflected component schemas with exact JSON Schemas generated from Zod. */
export function patchOpenApiWithZodSchemas(document: OpenAPIObject): OpenAPIObject {
  const schemas = document.components?.schemas ?? {};
  for (const [name, { schema, io }] of registry) {
    if (name in schemas) schemas[name] = toJsonSchema(schema, io);
  }
  return document;
}

/** Validates @Body/@Query/@Param values whose declared type is a Zod DTO. Other values pass through untouched. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;
    const dto = metadata.metatype as Partial<ZodDtoClass> | undefined;
    if (!dto?.zodSchema) return value;

    const result = dto.zodSchema.safeParse(value ?? (metadata.type === 'body' ? undefined : {}));
    if (!result.success) {
      throw new ValidationError(
        'Request validation failed',
        result.error.issues.map((issue) => ({
          path: [metadata.type, ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
