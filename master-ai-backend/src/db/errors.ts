/** True when `err`, or an error it wraps, is Postgres's unique violation on `constraint`. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 3; depth++) {
    const pg = e as { code?: string; constraint?: string; cause?: unknown };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
    e = pg.cause;
  }
  return false;
}
