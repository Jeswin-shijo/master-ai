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
  | 'level5'
  | 'textBody'
  | 'textLead'
  | 'node'
  | 'line5'
  | 'line10'
  | 'line15'
  | 'line20'
  | 'glow'
  | 'onAction';

export type Palette = Record<ColorToken, string>;

/**
 * Glow, inspired by the n8n.io site: a violet-tinted navy, a warm action
 * gradient, cool violet for navigation and agents, green for done. Warm always
 * means a person is needed. Light keeps the same hues at AA contrast.
 */
export const darkPalette: Palette = {
  background: '#0e0918',
  surface: '#1b1728',
  surfaceMuted: '#1f192a',
  node: '#2a2633',
  border: 'rgba(255, 255, 255, 0.10)',
  line5: 'rgba(255, 255, 255, 0.05)',
  line10: 'rgba(255, 255, 255, 0.10)',
  line15: 'rgba(255, 255, 255, 0.15)',
  line20: 'rgba(255, 255, 255, 0.20)',
  text: '#ffffff',
  textBody: '#d1cece',
  textLead: '#b6b5b9',
  textMuted: '#9d9797',
  primary: '#ff7a3a',
  primaryText: '#1b0b02',
  primarySoft: '#3a1a14',
  onAction: '#ffffff',
  accent: '#a06ff6',
  accentSoft: '#241a3d',
  canvas: '#0b0814',
  canvasDot: 'rgba(255, 255, 255, 0.10)',
  glow: '#ee4f27',
  success: '#35a670',
  successSoft: '#10241c',
  warning: '#ff9b26',
  warningSoft: '#2e1d0c',
  danger: '#ff492c',
  dangerSoft: '#34120d',
  info: '#4aa3df',
  infoSoft: '#0f2236',
  level1: '#9d9797',
  level2: '#4aa3df',
  level3: '#35a670',
  level4: '#ff9b26',
  level5: '#ff492c',
};

export const lightPalette: Palette = {
  background: '#f7f5fa',
  surface: '#ffffff',
  surfaceMuted: '#f1eef6',
  node: '#ebe7f2',
  border: 'rgba(22, 15, 36, 0.12)',
  line5: 'rgba(22, 15, 36, 0.05)',
  line10: 'rgba(22, 15, 36, 0.10)',
  line15: 'rgba(22, 15, 36, 0.15)',
  line20: 'rgba(22, 15, 36, 0.20)',
  text: '#160f24',
  textBody: '#2f2a3a',
  textLead: '#55506a',
  textMuted: '#5f5a72',
  primary: '#c2410c',
  primaryText: '#ffffff',
  primarySoft: '#fde9df',
  onAction: '#ffffff',
  accent: '#6b21ef',
  accentSoft: '#efe7ff',
  canvas: '#f4f2f8',
  canvasDot: 'rgba(22, 15, 36, 0.12)',
  glow: '#ee4f27',
  success: '#0f7a52',
  successSoft: '#e2f5ec',
  warning: '#a65200',
  warningSoft: '#fdf0dc',
  danger: '#c62828',
  dangerSoft: '#fbe7e7',
  info: '#1f6fb2',
  infoSoft: '#e6f0fb',
  level1: '#5f5a72',
  level2: '#1f6fb2',
  level3: '#0f7a52',
  level4: '#a65200',
  level5: '#c62828',
};

/** Gradients, rings and glows. Same in both themes; light softens them in CSS. */
export const effects = {
  gradientAction: 'linear-gradient(30deg, #ec6015 0%, #d63a0b 16%, #c8200c 84%, #ad110b 100%)',
  gradientActionSheen: 'linear-gradient(180deg, rgba(255, 214, 170, 0.26) 0%, rgba(255, 214, 170, 0) 34%)',
  gradientCool: 'linear-gradient(141deg, #077ac7, #6b21ef)',
  actionRing: 'inset 0 1px 0 rgba(255, 222, 186, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.07)',
  actionShadow: '0 10px 26px -12px rgba(238, 79, 39, 0.95)',
  actionShadowHover: '0 12px 60px -12px rgba(238, 79, 39, 1)',
  glowWarm: 'rgba(238, 79, 39, 0.30)',
  glowCool: 'rgba(81, 89, 217, 0.17)',
  navActive: 'radial-gradient(70% 170% at 50% 175%, rgba(160, 111, 246, 0.62), rgba(107, 33, 239, 0.24) 72%), rgba(107, 33, 239, 0.12)',
  navActiveRing: 'inset 0 0 0 1px rgba(160, 111, 246, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
} as const;

/** The gradient stops a centred label sits on (16%–84%); white must read on both. */
export const ACTION_LABEL_STOPS = ['#d63a0b', '#c8200c'] as const;

export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { xs: 12, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 } as const;
export const fontFamily = {
  display: "'Red Hat Display', 'Red Hat Text', ui-sans-serif, system-ui, sans-serif",
  sans: "'Red Hat Text', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
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
${Object.entries(effects)
  .map(([k, v]) => `  --oh-effect-${kebab(k)}: ${v};`)
  .join('\n')}
  --oh-font-display: ${fontFamily.display};
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

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = hex(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
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
