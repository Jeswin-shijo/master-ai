import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { Button } from './button';
import { Input } from './form';

/** A value to hand on (an invite link, a form link, a key), with a Copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  const copy = async () => {
    // When nothing can copy, the field stays selectable and says so.
    setResult((await copyText(value)) ? 'copied' : 'failed');
    setTimeout(() => setResult(null), 2000);
  };
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
      <Button type="button" variant="secondary" onClick={copy}>
        {result === 'copied' ? <Check /> : <Copy />} {result === 'copied' ? 'Copied' : result === 'failed' ? 'Select and copy' : 'Copy'}
      </Button>
    </div>
  );
}
