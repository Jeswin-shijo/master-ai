import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const pub = (f: string) => new URL(`../../public/${f}`, import.meta.url);

describe('the page shell (index.html)', () => {
  it('describes the product for search results and link previews (WhatsApp, email, Slack)', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]{60,160}"/);
    for (const p of ['og:title', 'og:description', 'og:type', 'og:site_name']) expect(html).toContain(`property="${p}"`);
    expect(html).toContain('name="twitter:card"');
  });

  it('says what to do when JavaScript is off, or when the app could not start in this browser', () => {
    expect(html).toMatch(/<noscript>[^<]*JavaScript[^<]*<\/noscript>/);
    expect(html).toContain('<script src="/browser-check.js"></script>');
    expect(readFileSync(pub('browser-check.js'), 'utf8')).toContain("getElementById('no-start')");
    expect(html).toContain('id="no-start" hidden');
  });

  it('can be added to a phone’s home screen with a proper icon', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string }[] };
    expect(manifest).toMatchObject({ name: 'ONEHUMAN OS', start_url: '/', display: 'standalone' });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    for (const i of manifest.icons) expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
    expect(existsSync(pub('apple-touch-icon.png'))).toBe(true);
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(pub('robots.txt'), 'utf8');
  it('lets search engines see sign-in and sign-up, and nothing behind a login or a link key', () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/login$/m);
    expect(robots).toMatch(/^Allow: \/signup$/m);
    expect(robots).toMatch(/^Disallow: \/$/m);
  });
});
