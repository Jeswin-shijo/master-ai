import type { WorkingHours } from '@onehuman/schemas';

/**
 * Time helpers for calls, all in India Standard Time (UTC+5:30, no DST).
 * Due dates come from what people say on the phone ("by tomorrow 5 pm"),
 * and calls are only placed inside working hours and the 9:00–21:00 window
 * Indian rules allow for calls.
 */

const IST_OFFSET_MS = 5.5 * 3_600_000;
const LEGAL_START = 9 * 60;
const LEGAL_END = 21 * 60;

interface IstParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  dow: number;
}

function ist(date: Date): IstParts {
  const t = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: t.getUTCDay() };
}

function fromIst(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MS);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PARTS_OF_DAY: Record<string, number> = {
  morning: 10 * 60,
  noon: 12 * 60,
  afternoon: 15 * 60,
  evening: 18 * 60,
  'end of day': 18 * 60,
  eod: 18 * 60,
  tonight: 20 * 60,
  night: 20 * 60,
};

/** Parse a spoken deadline. Returns null when the text names no time at all. */
export function parseDue(text: string, now: Date = new Date()): Date | null {
  const t = text.toLowerCase();
  const today = ist(now);

  const inHours = /\bin\s+(\d{1,2})\s*(hours?|hrs?)\b/.exec(t);
  if (inHours) return new Date(now.getTime() + Number(inHours[1]) * 3_600_000);

  let dayOffset: number | null = null;
  if (/\bday after tomorrow\b/.test(t)) dayOffset = 2;
  else if (/\btomorrow\b/.test(t)) dayOffset = 1;
  else if (/\b(today|tonight)\b/.test(t)) dayOffset = 0;
  else {
    const inDays = /\bin\s+(\d{1,2})\s*days?\b/.exec(t);
    if (inDays) dayOffset = Number(inDays[1]);
    else if (/\bnext week\b/.test(t)) dayOffset = 7;
    else {
      const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
      if (wd >= 0) dayOffset = ((wd - today.dow + 7) % 7) || 7;
    }
  }

  let minutes: number | null = null;
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t) ?? /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  if (clock) {
    let h = Number(clock[1]);
    const mm = Number(clock[2] ?? 0);
    const ampm = clock[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    minutes = h * 60 + mm;
  } else {
    const part = Object.keys(PARTS_OF_DAY).find((p) => t.includes(p));
    if (part) minutes = PARTS_OF_DAY[part]!;
  }

  if (dayOffset === null && minutes === null) return null;
  const nowMinutes = today.hh * 60 + today.mm;
  if (dayOffset === null) dayOffset = minutes! > nowMinutes ? 0 : 1;
  const base = addDays(fromIst(today.y, today.m, today.d, 0, 0), dayOffset);
  const b = ist(base);
  const at = minutes ?? 18 * 60;
  return fromIst(b.y, b.m, b.d, Math.floor(at / 60), at % 60);
}

/** Default deadline when nobody gave one: tomorrow 6 pm IST. */
export function defaultDue(now: Date = new Date()): Date {
  const t = ist(addDays(now, 1));
  return fromIst(t.y, t.m, t.d, 18, 0);
}

/** Earliest moment at or after `from` inside the person's working hours and the legal calling window. */
export function nextCallableTime(from: Date, hours: WorkingHours): Date {
  const [sh, sm] = hours.start.split(':').map(Number) as [number, number];
  const [eh, em] = hours.end.split(':').map(Number) as [number, number];
  const start = Math.max(sh * 60 + sm, LEGAL_START);
  const end = Math.min(eh * 60 + em, LEGAL_END);
  for (let i = 0; i < 14; i++) {
    const day = ist(addDays(from, i));
    if (!hours.days.includes(day.dow)) continue;
    const cur = i === 0 ? day.hh * 60 + day.mm : 0;
    if (cur < end) {
      const at = Math.max(cur, start);
      if (i === 0 && at === cur) return from;
      return fromIst(day.y, day.m, day.d, Math.floor(at / 60), at % 60);
    }
  }
  return from;
}

/** "Tuesday 13 October, 6 pm" — how the AI says a time on the phone. */
export function speakable(date: Date): string {
  const s = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return s.replace(':00', '').replace(/\s?([ap])\.?m\.?/i, (_, x: string) => ` ${x.toLowerCase()}m`);
}

/**
 * When to follow up: halfway to the deadline (at least an hour after
 * assigning), or an hour before it for short deadlines.
 */
export function followUpTime(now: Date, due: Date): Date {
  const span = due.getTime() - now.getTime();
  if (span <= 2 * 3_600_000) return new Date(Math.max(now.getTime() + 15 * 60_000, due.getTime() - 3_600_000));
  return new Date(now.getTime() + Math.max(3_600_000, span / 2));
}

/** Any day, any hour: for calls limited only by the 9:00–21:00 window (e.g. evening reports). */
export const ANY_HOURS: WorkingHours = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' };

/** The India date, YYYY-MM-DD, that `date` falls on. */
export function istDate(date: Date = new Date()): string {
  const p = ist(date);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The next time a routine runs: on one of `days` (0 = Sunday) at `time` (HH:MM, India time), after `from`. */
export function nextRunAt(days: number[], time: string, from: Date = new Date()): Date | null {
  if (days.length === 0) return null;
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const p = ist(from);
  for (let i = 0; i <= 7; i++) {
    const at = fromIst(p.y, p.m, p.d + i, hh, mm);
    if (at > from && days.includes(ist(at).dow)) return at;
  }
  return null;
}
