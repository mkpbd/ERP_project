/**
 * Error categories understood by every layer. The presentation layer maps
 * each kind to an HTTP status; inner layers never mention HTTP.
 */
export type ErrorKind =
  'validation' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'business_rule' | 'rate_limited';

export class AppError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly details?: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A business invariant was violated. */
export class DomainError extends AppError {
  constructor(code: string, message: string) {
    super('business_rule', code, message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ReadonlyArray<{ path: string; message: string }>) {
    super('validation', 'validation_failed', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('not_found', `${resource}_not_found`, `${resource.replace(/_/g, ' ')} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super('conflict', code, message);
  }
}

export class AuthenticationError extends AppError {
  constructor(code = 'invalid_credentials', message = 'Invalid credentials') {
    super('unauthenticated', code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(code = 'forbidden', message = 'You are not allowed to perform this action') {
    super('forbidden', code, message);
  }
}
