interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Returns the violated constraint name when `error` (or its cause) is a unique violation. */
export function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgErrorLike;
    if (candidate.code === '23505') return candidate.constraint ?? '';
    current = candidate.cause;
  }
  return null;
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
