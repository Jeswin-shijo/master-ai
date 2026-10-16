/**
 * The list page's web-only helpers: sort marks and the CSV download. The wording
 * the phone shares (labels, the page's query, values in words) lives in @onehuman/sdk.
 */
export { dayLabel, followUpLine, initialView, listParams, NOTE_LABELS, RANGE_LABELS, referenceText, SHOW_LABELS, SOURCE_LABELS, type ListView } from '@onehuman/sdk';

/** Clicking a column header: ascending, then descending, then back to the list's own order. */
export function nextSort(current: string, field: string): string {
  if (current === `${field}:asc`) return `${field}:desc`;
  if (current === `${field}:desc`) return '';
  return `${field}:asc`;
}

export function sortMark(current: string, field: string): string {
  return current === `${field}:asc` ? ' ↑' : current === `${field}:desc` ? ' ↓' : '';
}

/** "bills-2026-10-14.csv", dated in the viewer's own time. */
export function csvFileName(label: string, now = new Date()): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  const day = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return `${slug}-${day}.csv`;
}

/** Excel reads a CSV as UTF-8 (₹, Indian names) only with a byte order mark, which fetch's text() drops. */
export function withBom(text: string): string {
  return text.startsWith('﻿') ? text : `﻿${text}`;
}

/** Hands the viewer a file made in the page; nothing goes in a URL but a local blob. */
export function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([withBom(text)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
