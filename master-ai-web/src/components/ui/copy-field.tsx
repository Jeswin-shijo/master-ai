import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './button';
import { Input } from './form';

/** A value to hand on (an invite link, a form link, a key), with a Copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard access: the field stays selectable.
    }
  };
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
      <Button type="button" variant="secondary" onClick={copy}>
        {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
