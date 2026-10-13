import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'text-fg-body',
  waiting: 'text-warning shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--oh-warning)_40%,transparent)] bg-warning-soft',
  success: 'text-success bg-success-soft',
  danger: 'text-danger bg-danger-soft',
  cool: 'text-accent bg-accent-soft',
} as const;

/** A small rounded label for case facts: priority, risk, department, due. */
export function Chip({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES }) {
  return <span className={cn('chip', TONES[tone], className)} {...props} />;
}
