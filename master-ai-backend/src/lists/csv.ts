/** Cells a spreadsheet would run as a formula start with one of these; a leading ' keeps them as text. */
const FORMULA = /^[=+\-@\t\r]/;
/** A plain number stays a number in the spreadsheet, so a negative amount still sums. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: string): string {
  const safe = FORMULA.test(v) && !PLAIN_NUMBER.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV that Excel opens as UTF-8 (₹ and Indian names intact): a byte order mark, then CRLF lines. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
