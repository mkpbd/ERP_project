import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppError, type ErrorKind } from '../domain/errors.js';
import { RequestContext } from '../infrastructure/request-context.js';

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  validation: HttpStatus.BAD_REQUEST,
  unauthenticated: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  business_rule: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
};

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: ReadonlyArray<{ path: string; message: string }>;
  requestId?: string;
  correlationId?: string;
}

/**
 * Renders every error as RFC 9457 Problem Details. Unexpected errors are
 * logged in full but answered with a generic message, so internals never leak.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, path: problem.instance }, 'Unhandled error');
    }
    if (problem.status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDetails {
    const context = RequestContext.current();
    const base = {
      instance: request.path,
      ...(context ? { requestId: context.requestId, correlationId: context.correlationId } : {}),
    };

    if (exception instanceof AppError) {
      const status = STATUS_BY_KIND[exception.kind];
      return {
        ...this.head(status, exception.code),
        detail: exception.message,
        ...base,
        ...(exception.details ? { errors: exception.details } : {}),
      };
    }
    if (exception instanceof ThrottlerException) {
      return { ...this.head(429, 'rate_limited'), detail: 'Too many requests; try again later', ...base };
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      const code =
        status === 404 ? 'route_not_found' : (TITLES[status] ?? 'http_error').toLowerCase().replace(/ /g, '_');
      return { ...this.head(status, code), detail: this.httpDetail(exception), ...base };
    }
    return { ...this.head(500, 'internal_error'), detail: 'An unexpected error occurred', ...base };
  }

  private head(status: number, code: string): Pick<ProblemDetails, 'type' | 'title' | 'status' | 'code'> {
    return { type: `urn:problem-type:${code}`, title: TITLES[status] ?? 'Error', status, code };
  }

  private httpDetail(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    const message = (body as { message?: unknown }).message;
    return typeof message === 'string' ? message : exception.message;
  }
}
