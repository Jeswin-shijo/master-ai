import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react';
import { Bot, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared motion pieces. Everything respects "reduce motion" through the
 * MotionConfig in the app shell.
 */

export const spring = { type: 'spring', stiffness: 380, damping: 32 } as const;

/** Children slide up and fade in one after another. */
export function Stagger({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export const item = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring },
};

/** A card that rises a little under the pointer. */
export function LiftCard({ children, className, ...props }: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={item} whileHover={{ y: -3 }} transition={spring} className={cn('rounded-xl border border-border bg-surface', className)} {...props}>
      {children}
    </motion.div>
  );
}

/** A number that counts up to its value when it appears or changes. */
export function AnimatedNumber({ value, suffix = '', className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${Math.round(v).toLocaleString('en-IN')}${suffix}`);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className={cn('tabular-nums', className)}>{text}</motion.span>;
}

/** A ring that fills to `value` of `max`, with the count in the middle. */
export function ProgressRing({ value, max, size = 64, label, tone = 'var(--oh-primary)' }: { value: number; max: number; size?: number; label?: string; tone?: string }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${value} of ${max}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--oh-border)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pct >= 1 ? 'var(--oh-success)' : tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute text-sm font-semibold text-fg tabular-nums">
        {value}
        <span className="text-fg-muted">/{max}</span>
      </span>
    </div>
  );
}

/** Manual ⟷ Automatic, with a pill that slides between them. */
export function ModeSwitch({ mode, onChange, disabled, id }: { mode: 'manual' | 'automatic'; onChange: (m: 'manual' | 'automatic') => void; disabled?: boolean; id: string }) {
  const options = [
    { value: 'manual' as const, label: 'Manual', icon: Hand },
    { value: 'automatic' as const, label: 'Automatic', icon: Bot },
  ];
  return (
    <div role="radiogroup" aria-label="How this job is done" className="relative inline-flex rounded-full border border-border bg-muted p-1">
      {options.map((o) => {
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(o.value)}
            className={cn('relative z-10 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', active ? 'text-primary-fg' : 'text-fg-muted hover:text-fg')}
          >
            {active && (
              <motion.span
                layoutId={`mode-pill-${id}`}
                className={cn('absolute inset-0 -z-10 rounded-full shadow-lg', o.value === 'automatic' ? 'bg-primary shadow-primary/30' : 'bg-accent shadow-accent/30')}
                transition={spring}
              />
            )}
            <o.icon className="size-4" aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Concentric rings pulsing out from a phone that is ringing. */
export function RingPulse({ className }: { className?: string }) {
  return (
    <span className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      {[0, 0.5, 1].map((delay) => (
        <motion.span
          key={delay}
          className="absolute inset-0 rounded-full border-2 border-primary"
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, delay, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

/** A tick that draws itself. */
export function DrawCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: 'easeOut' }} />
    </svg>
  );
}
