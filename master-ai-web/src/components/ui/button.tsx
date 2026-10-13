import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** The warm action: a person starts or approves something. */
        primary: 'btn-action',
        secondary: 'btn-glass text-fg',
        /** Navigation and agent actions. */
        cool: 'btn-cool',
        ghost: 'text-fg-body hover:bg-line-5 hover:text-fg',
        danger: 'bg-danger-soft text-danger shadow-[inset_0_0_0_1px_var(--oh-danger)]',
        success: 'bg-success-soft text-success shadow-[inset_0_0_0_1px_var(--oh-success)]',
        warning: 'bg-warning-soft text-warning shadow-[inset_0_0_0_1px_var(--oh-warning)]',
      },
      size: {
        sm: 'h-8 px-3 max-sm:h-11',
        md: 'h-10 px-4 max-sm:h-11',
        lg: 'h-12 min-w-44 px-8 text-base max-sm:w-full',
        icon: 'size-10 max-sm:size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
