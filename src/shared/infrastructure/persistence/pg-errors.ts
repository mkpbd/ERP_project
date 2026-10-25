interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

function violatedConstraint(error: unknown, ...codes: string[]): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgErrorLike;
    if (candidate.code !== undefined && codes.includes(candidate.code)) return candidate.constraint ?? '';
    current = candidate.cause;
  }
  return null;
}

/** Returns the violated constraint name when `error` (or its cause) is a unique violation. */
export function uniqueViolationConstraint(error: unknown): string | null {
  return violatedConstraint(error, '23505');
}

/**
 * Returns the violated constraint name when `error` (or its cause) is a foreign key violation:
 * 23503, or 23001 which PostgreSQL raises for `ON DELETE RESTRICT`.
 */
export function foreignKeyViolationConstraint(error: unknown): string | null {
  return violatedConstraint(error, '23503', '23001');
}

/** Returns the violated constraint name when `error` (or its cause) is a CHECK violation. */
export function checkViolationConstraint(error: unknown): string | null {
  return violatedConstraint(error, '23514');
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
