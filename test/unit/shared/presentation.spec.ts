import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigValidationError, loadConfig } from '../../../src/config/configuration.js';
import { RefreshCookie } from '../../../src/modules/identity/presentation/refresh-cookie.js';
import {
  AppError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../../src/shared/domain/errors.js';
import { RequestContext } from '../../../src/shared/infrastructure/request-context.js';
import { ProblemDetailsFilter } from '../../../src/shared/presentation/problem-details.filter.js';
import { createZodDto, ZodValidationPipe } from '../../../src/shared/presentation/zod/zod-dto.js';

describe('ZodValidationPipe', () => {
  class BodyDto extends createZodDto(
    z.strictObject({ name: z.string().min(2), age: z.coerce.number().int().optional() }),
  ) {}
  const pipe = new ZodValidationPipe();

  it('returns parsed, coerced data', () => {
    expect(pipe.transform({ name: 'Al', age: '42' }, { type: 'body', metatype: BodyDto })).toEqual({
      name: 'Al',
      age: 42,
    });
  });

  it('rejects unknown keys (mass assignment) with field paths', () => {
    try {
      pipe.transform({ name: 'Al', isAdmin: true }, { type: 'body', metatype: BodyDto });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toEqual([{ path: 'body', message: expect.stringContaining('isAdmin') }]);
    }
  });

  it('reports nested paths and leaves non-DTO parameters alone', () => {
    expect(() => pipe.transform({ name: 'A' }, { type: 'body', metatype: BodyDto })).toThrow(/validation/i);
    expect(pipe.transform('raw', { type: 'body', metatype: String })).toBe('raw');
    expect(pipe.transform('raw', { type: 'custom', metatype: BodyDto })).toBe('raw');
  });
});

describe('ProblemDetailsFilter', () => {
  function run(exception: unknown) {
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    const request = { path: '/api/v1/things' } as Request;
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response as unknown as Response }),
    } as ArgumentsHost;
    RequestContext.run(
      { requestId: 'req-12345678', correlationId: 'corr-12345678', ipAddress: null, userAgent: null },
      () => new ProblemDetailsFilter().catch(exception, host),
    );
    return { status: response.status.mock.calls[0]?.[0] as number, body: response.json.mock.calls[0]?.[0], response };
  }

  it.each([
    [new NotFoundError('user'), 404, 'user_not_found'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new ConflictError('email_taken', 'x'), 409, 'email_taken'],
    [new DomainError('weak_password', 'x'), 422, 'weak_password'],
    [new ThrottlerException(), 429, 'rate_limited'],
    [new BadRequestException('Unexpected token in JSON'), 400, 'bad_request'],
  ])('maps %o to %i', (exception, status, code) => {
    const { body } = run(exception);
    expect(body).toMatchObject({
      status,
      code,
      type: `urn:problem-type:${code}`,
      instance: '/api/v1/things',
      requestId: 'req-12345678',
    });
  });

  it('hides internals of unexpected errors', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('connection string postgres://user:secret@db'));
    expect(logged).toHaveBeenCalled();
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body).toMatchObject({ code: 'internal_error', detail: 'An unexpected error occurred' });
  });

  it('adds WWW-Authenticate to 401 responses and uses problem+json', () => {
    const { response } = run(new AppError('unauthenticated', 'invalid_token', 'x'));
    expect(response.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
  });
});

describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/db',
    JWT_ISSUER: 'i',
    JWT_AUDIENCE: 'a',
    JWT_SIGNING_KEYS: `k1:${'s'.repeat(40)}`,
    APP_PUBLIC_URL: 'http://localhost',
    MAIL_FROM: 'x@example.com',
  };

  it('applies secure defaults', () => {
    const config = loadConfig(base);
    expect(config.http.cookieSecure).toBe(true);
    expect(config.jwt.accessTokenTtlSeconds).toBe(900);
    expect(config.auth.emailVerificationRequired).toBe(true);
  });

  it('rejects short secrets without echoing them', () => {
    try {
      loadConfig({ ...base, JWT_SIGNING_KEYS: 'k1:tooshort' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as Error).message).toContain('JWT_SIGNING_KEYS');
      expect((error as Error).message).not.toContain('tooshort');
    }
  });

  it('enforces production safety rules', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'file' })).toThrow(/MAIL_TRANSPORT/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://x',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });
});

describe('RefreshCookie CSRF protection', () => {
  const cookie = new RefreshCookie(true);
  const request = (cookies: Record<string, string>, csrfHeader?: string) =>
    ({ cookies, headers: csrfHeader ? { 'x-csrf-token': csrfHeader } : {} }) as unknown as Request;

  it('uses a __Secure- cookie when secure', () => {
    expect(cookie.name).toBe('__Secure-erp_rt');
    expect(new RefreshCookie(false).name).toBe('erp_rt');
  });

  it('requires the double-submit token to match', () => {
    expect(cookie.readVerified(request({}))).toBeNull();
    expect(() => cookie.readVerified(request({ '__Secure-erp_rt': 'rt', erp_csrf: 'abc' }))).toThrow(/CSRF/);
    expect(() => cookie.readVerified(request({ '__Secure-erp_rt': 'rt', erp_csrf: 'abc' }, 'abd'))).toThrow(/CSRF/);
    expect(cookie.readVerified(request({ '__Secure-erp_rt': 'rt', erp_csrf: 'abc' }, 'abc'))).toBe('rt');
  });

  it('sets HttpOnly, SameSite=Strict, path-scoped refresh cookie', () => {
    const response = { cookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };
    cookie.set(response, 'rt', new Date(Date.now() + 1000));
    expect(response.cookie).toHaveBeenCalledWith(
      '__Secure-erp_rt',
      'rt',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/v1/auth' }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'erp_csrf',
      expect.any(String),
      expect.objectContaining({ httpOnly: false }),
    );
  });
});
