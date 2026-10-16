import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { formatInr, timeAgo, LEVEL_LABELS } from '@onehuman/ui';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function humanize(s: string): string {
  return s.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
