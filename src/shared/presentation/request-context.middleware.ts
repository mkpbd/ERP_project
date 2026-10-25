import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../infrastructure/request-context.js';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

function headerId(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/**
 * Assigns request and correlation ids (accepting well-formed incoming ones)
 * and opens the async context that logging and auditing read from.
 */
export function requestContextMiddleware(request: Request, response: Response, next: NextFunction): void {
  const requestId = headerId(request.headers['x-request-id']) ?? randomUUID();
  const correlationId = headerId(request.headers['x-correlation-id']) ?? requestId;
  request.headers['x-request-id'] = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Correlation-Id', correlationId);

  const userAgent = request.headers['user-agent'];
  RequestContext.run(
    {
      requestId,
      correlationId,
      ipAddress: request.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    },
    next,
  );
}
