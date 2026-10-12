/**
 * @onehuman/ui: one set of design tokens for the web command center and the
 * mobile app. Web consumes `theme.css` (CSS variables); mobile consumes the
 * objects below. A tenant's brand colour overrides `primary` at runtime.
 */

export type ColorToken =
  | 'background'
  | 'surface'
  | 'surfaceMuted'
  | 'border'
  | 'text'
  | 'textMuted'
  | 'primary'
  | 'primaryText'
  | 'primarySoft'
  | 'accent'
  | 'accentSoft'
  | 'canvas'
  | 'canvasDot'
  | 'success'
  | 'successSoft'
  | 'warning'
  | 'warningSoft'
  | 'danger'
  | 'dangerSoft'
  | 'info'
  | 'infoSoft'
  | 'level1'
  | 'level2'
  | 'level3'
  | 'level4'
  | 'level5';

export type Palette = Record<ColorToken, string>;

/**
 * n8n-inspired: deep purple-black surfaces, a pink-coral primary and a violet
 * accent. Dark is the default; light keeps the same hues with AA contrast.
 */
export const darkPalette: Palette = {
  background: '#0e0b16',
  surface: '#171320',
  surfaceMuted: '#221d2e',
  border: '#2e2840',
  text: '#f3f1f8',
  textMuted: '#a39db4',
  primary: '#ea4b71',
  primaryText: '#ffffff',
  primarySoft: '#3b1627',
  accent: '#8b7bff',
  accentSoft: '#231d45',
  canvas: '#110e1a',
  canvasDot: '#2b2540',
  success: '#3ccf8e',
  successSoft: '#11301f',
  warning: '#f6b74a',
  warningSoft: '#3a2c12',
  danger: '#ff5d6c',
  dangerSoft: '#3d1419',
  info: '#6fa8ff',
  infoSoft: '#16264a',
  level1: '#9a95ab',
  level2: '#6fa8ff',
  level3: '#3ccf8e',
  level4: '#f6b74a',
  level5: '#ff5d6c',
};

export const lightPalette: Palette = {
  background: '#f6f5fa',
  surface: '#ffffff',
  surfaceMuted: '#efedf5',
  border: '#e2deec',
  text: '#1b1726',
  textMuted: '#66607a',
  primary: '#d63862',
  primaryText: '#ffffff',
  primarySoft: '#fde8ee',
  accent: '#6650e8',
  accentSoft: '#ece9ff',
  canvas: '#f4f3f8',
  canvasDot: '#d8d4e3',
  success: '#12855a',
  successSoft: '#e2f5ec',
  warning: '#a65f00',
  warningSoft: '#fdf1dc',
  danger: '#c62839',
  dangerSoft: '#fbe6e8',
  info: '#2c5fd1',
  infoSoft: '#e6edfc',
  level1: '#66607a',
  level2: '#2c5fd1',
  level3: '#12855a',
  level4: '#a65f00',
  level5: '#c62839',
};

export const radius = { sm: 6, md: 8, lg: 12, full: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { xs: 12, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 } as const;
export const fontFamily = {
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function vars(p: Palette): string {
  return Object.entries(p)
    .map(([k, v]) => `  --oh-${kebab(k)}: ${v};`)
    .join('\n');
}

/** CSS for web: dark by default (n8n look); light via [data-theme="light"] or the OS setting when the user picks "system". */
export function cssVariables(): string {
  return `/* Generated from @onehuman/ui tokens. Do not edit. */
:root {
${vars(darkPalette)}
  --oh-radius-sm: ${radius.sm}px;
  --oh-radius-md: ${radius.md}px;
  --oh-radius-lg: ${radius.lg}px;
  --oh-font-sans: ${fontFamily.sans};
  --oh-font-mono: ${fontFamily.mono};
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root[data-theme='system'] {
${vars(lightPalette)}
    color-scheme: light;
  }
}
:root[data-theme='light'] {
${vars(lightPalette)}
  color-scheme: light;
}
`;
}

/** Tenant white-labelling: swap the primary colour, keep everything else. */
export function brandPalette(base: Palette, brandColor?: string | null): Palette {
  if (!brandColor || !/^#[0-9a-f]{6}$/i.test(brandColor)) return base;
  return { ...base, primary: brandColor, primarySoft: mix(brandColor, base.surface, 0.88), primaryText: readableOn(brandColor) };
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v * (1 - t) + pb[i]! * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hex(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function readableOn(bg: string): string {
  const [r, g, b] = hex(bg).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#111111' : '#ffffff';
}

export const LEVEL_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Observe',
  2: 'Draft',
  3: 'Act',
  4: 'Needs approval',
  5: 'Blocked',
};

export function levelColor(level: number, palette: Palette = darkPalette): string {
  return palette[`level${Math.min(5, Math.max(1, level))}` as ColorToken];
}

export function riskTone(score: number): 'low' | 'medium' | 'high' {
  if (score < 35) return 'low';
  if (score < 75) return 'medium';
  return 'high';
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatInr(amount: number): string {
  return inr.format(amount);
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
