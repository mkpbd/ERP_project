import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { AuthenticationError } from '../../../shared/domain/errors.js';

export const AUTH_COOKIE_PATH = '/api/v1/auth';
export const CSRF_COOKIE = 'erp_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const TOKEN_DELIVERY_HEADER = 'x-refresh-token-delivery';

/**
 * Browser refresh-token transport: an HttpOnly, SameSite=Strict cookie scoped
 * to the auth routes, plus a double-submit CSRF token that the client must
 * echo in the X-CSRF-Token header when refreshing with the cookie.
 */
export class RefreshCookie {
  constructor(private readonly secure: boolean) {}

  get name(): string {
    // The __Secure- prefix makes browsers refuse the cookie over plain HTTP.
    return this.secure ? '__Secure-erp_rt' : 'erp_rt';
  }

  wantsBodyDelivery(request: Request): boolean {
    return request.headers[TOKEN_DELIVERY_HEADER] === 'body';
  }

  set(response: Response, refreshToken: string, expiresAt: Date): void {
    response.cookie(this.name, refreshToken, {
      ...this.baseOptions(),
      httpOnly: true,
      path: AUTH_COOKIE_PATH,
      expires: expiresAt,
    });
    response.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
      ...this.baseOptions(),
      httpOnly: false,
      path: '/',
      expires: expiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.name, { ...this.baseOptions(), httpOnly: true, path: AUTH_COOKIE_PATH });
    response.clearCookie(CSRF_COOKIE, { ...this.baseOptions(), httpOnly: false, path: '/' });
  }

  /** Reads the cookie token after verifying the double-submit CSRF token. */
  readVerified(request: Request): string | null {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[this.name];
    if (!token) return null;
    const expected = cookies?.[CSRF_COOKIE];
    const presented = request.headers[CSRF_HEADER];
    if (!expected || typeof presented !== 'string' || !safeEqual(expected, presented)) {
      throw new AuthenticationError('csrf_token_invalid', 'Missing or invalid CSRF token');
    }
    return token;
  }

  private baseOptions(): CookieOptions {
    return { secure: this.secure, sameSite: 'strict' };
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
