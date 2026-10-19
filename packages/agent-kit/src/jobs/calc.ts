type Result = { ok: true; value: number } | { ok: false; reason: string };

const BAD = 'Not a sum this check can work out';

class Fail extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) i++;
    else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(src.slice(i))!;
      out.push({ t: 'name', v: m[0] });
      i += m[0].length;
    } else if ('+-*/()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else throw new Fail(BAD);
  }
  return out;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const s = raw.replace(/[,₹\s]/g, '');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  return null;
}

/**
 * Works out a small sum: numbers, names, + - * /, brackets and unary minus. Names are looked up
 * through `values`. A recursive-descent parser; nothing is ever evaluated as code.
 */
export function evalCalc(expr: string, values: (path: string) => unknown): Result {
  try {
    const toks = lex(expr);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (v: string) => {
      const t = peek();
      return t !== undefined && t.t === 'op' && t.v === v;
    };
    const expression = (): number => {
      let left = term();
      while (isOp('+') || isOp('-')) {
        const op = (toks[pos++] as { v: string }).v;
        const right = term();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };
    const term = (): number => {
      let left = unary();
      while (isOp('*') || isOp('/')) {
        const op = (toks[pos++] as { v: string }).v;
        const right = unary();
        if (op === '*') left *= right;
        else {
          if (right === 0) throw new Fail('Division by zero');
          left /= right;
        }
      }
      return left;
    };
    const unary = (): number => {
      if (isOp('-')) {
        pos++;
        return -unary();
      }
      return primary();
    };
    const primary = (): number => {
      const t = toks[pos++];
      if (!t) throw new Fail(BAD);
      if (t.t === 'num') return t.v;
      if (t.t === 'name') {
        const n = toNumber(values(t.v));
        if (n === null) throw new Fail(`${t.v} is missing or not a number`);
        return n;
      }
      if (t.v === '(') {
        const v = expression();
        if (!isOp(')')) throw new Fail(BAD);
        pos++;
        return v;
      }
      throw new Fail(BAD);
    };
    if (toks.length === 0) throw new Fail(BAD);
    const value = expression();
    if (pos !== toks.length) throw new Fail(BAD);
    if (!Number.isFinite(value)) throw new Fail(BAD);
    return { ok: true, value: Math.round(value * 100) / 100 };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, reason: e.message };
    throw e;
  }
}
