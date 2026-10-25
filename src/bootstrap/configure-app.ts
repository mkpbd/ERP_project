import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '../config/configuration.js';
import { ProblemDetailsFilter } from '../shared/presentation/problem-details.filter.js';
import { requestContextMiddleware } from '../shared/presentation/request-context.middleware.js';
import { patchOpenApiWithZodSchemas, ZodValidationPipe } from '../shared/presentation/zod/zod-dto.js';

/** HTTP pipeline shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  // File uploads (logos, staff photos and documents) are sent as raw bytes. This is the largest
  // allowed size; each handler enforces its own limit and checks the bytes match the type.
  app.useBodyParser('raw', { type: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], limit: '5mb' });

  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || config.http.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Correlation-Id',
      'X-Refresh-Token-Delivery',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  if (config.http.swaggerEnabled) {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ERP Backend API')
      .setDescription(
        'All routes require a bearer access token unless documented as public. Errors use RFC 9457 Problem Details (application/problem+json).',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addCookieAuth('erp_rt', { type: 'apiKey', in: 'cookie', name: 'erp_rt' }, 'refresh-cookie')
      .build(),
  );
  patchOpenApiWithZodSchemas(document);
  addProblemDetails(document);
  return document;
}

function addProblemDetails(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ProblemDetails = {
    type: 'object',
    required: ['type', 'title', 'status', 'detail', 'instance', 'code'],
    properties: {
      type: { type: 'string', example: 'urn:problem-type:validation_failed' },
      title: { type: 'string', example: 'Bad Request' },
      status: { type: 'integer', example: 400 },
      detail: { type: 'string' },
      instance: { type: 'string', example: '/api/v1/users' },
      code: { type: 'string', description: 'Stable machine-readable error code' },
      errors: {
        type: 'array',
        items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } },
      },
      requestId: { type: 'string' },
      correlationId: { type: 'string' },
    },
  };
  const problem = {
    description: 'Error (RFC 9457 Problem Details)',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
  };
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === 'object' && 'responses' in operation) {
        (operation as { responses: Record<string, unknown> }).responses.default ??= problem;
      }
    }
  }
}
