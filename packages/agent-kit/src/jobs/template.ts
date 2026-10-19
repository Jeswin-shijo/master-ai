/** Reads a dotted path from a scope; array indexes are digits. Undefined when anything is absent. */
export function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  let cur: unknown = scope;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(key)) return undefined;
      cur = cur[Number(key)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

const ONE = /^\s*\{\{\s*([^{}\s]+)\s*\}\}\s*$/;
const ANY = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/**
 * Fills `{{ path }}` placeholders. A string that is exactly one placeholder gives the raw value;
 * otherwise values are written into the text and a missing or null one becomes empty and is listed.
 * Objects and arrays are filled recursively.
 */
export function fillTemplate(
  value: unknown,
  scope: Record<string, unknown>,
): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  const note = (p: string) => {
    if (!missing.includes(p)) missing.push(p);
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const one = ONE.exec(v);
      if (one) {
        const got = resolvePath(scope, one[1]!);
        if (got === undefined || got === null) {
          note(one[1]!);
          return '';
        }
        return got;
      }
      return v.replace(ANY, (_m, p: string) => {
        const got = resolvePath(scope, p);
        if (got === undefined || got === null) {
          note(p);
          return '';
        }
        return typeof got === 'object' ? JSON.stringify(got) : String(got);
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { value: walk(value), missing };
}
