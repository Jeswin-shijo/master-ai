import { AlertCircle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-fg-muted', className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger', className)} role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-fg-muted [&_svg]:size-6">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, lead, description, action }: { title: string; lead?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 25 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="mb-8 flex flex-wrap items-end justify-between gap-4"
    >
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-light leading-tight tracking-tight text-fg md:text-4xl">
          {lead && <span className="text-fg-lead">{lead} </span>}
          {title}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-fg-lead">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}
