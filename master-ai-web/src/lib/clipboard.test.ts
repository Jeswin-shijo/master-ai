import { describe, expect, it } from 'vitest';
import { copyText } from './clipboard';

function page({ clipboard, execCommand = true }: { clipboard?: (t: string) => Promise<void>; execCommand?: boolean }) {
  const copied: string[] = [];
  let area: { value: string } | null = null;
  const doc = {
    createElement: () => (area = { value: '', style: {}, setAttribute() {}, select() {}, remove() {} } as never),
    body: { appendChild: () => {} },
    execCommand: (cmd: string) => {
      if (cmd === 'copy' && execCommand && area) copied.push(area.value);
      return execCommand;
    },
  };
  const nav = clipboard ? { clipboard: { writeText: async (t: string) => (await clipboard(t), void copied.push(t)) } } : {};
  return { doc: doc as unknown as Document, nav: nav as Navigator, copied };
}

describe('copyText', () => {
  it('copies with the Clipboard API where the browser offers it', async () => {
    const p = page({ clipboard: async () => {} });
    expect(await copyText('JOB-0001 report', p.doc, p.nav)).toBe(true);
    expect(p.copied).toEqual(['JOB-0001 report']);
  });

  it('still copies on a plain-http address, where browsers hide the Clipboard API', async () => {
    const p = page({});
    expect(await copyText('JOB-0001 report', p.doc, p.nav)).toBe(true);
    expect(p.copied).toEqual(['JOB-0001 report']);
  });

  it('still copies when the browser refuses clipboard access', async () => {
    const p = page({ clipboard: async () => Promise.reject(new Error('NotAllowedError')) });
    expect(await copyText('JOB-0001 report', p.doc, p.nav)).toBe(true);
    expect(p.copied).toEqual(['JOB-0001 report']);
  });

  it('says so when nothing could copy, so the page can tell the person', async () => {
    const p = page({ execCommand: false });
    expect(await copyText('JOB-0001 report', p.doc, p.nav)).toBe(false);
  });
});
