# Plan 5 — Web: Glow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app gets the Glow look the owner chose (violet-navy, warm action gradient, glass cards lit from inside, an animated 8-stage canvas). It also gets the screens the case engine needs: a signup wizard, an animated install preview, Home, Cases, the Case page, New request, the public request form, people and invites on Team, and request keys in Settings. Browser tests prove all of it at desktop and phone widths.

**Architecture:**
- **Tokens:** `@onehuman/ui` gets the Glow values and new tokens, with a contrast test that keeps every text pair at WCAG AA. Every web page already colours itself through token classes (`bg-surface`, `text-fg-muted`…), so the new values restyle most of the app at once.
- **Primitives and fonts:** new primitives (action and glass buttons, glass cards, chips, two-tone headings, the mini stage bar) and self-hosted Red Hat fonts carry the look.
- **New screens:** built on the case API from Plans 3 and 4.
- **Tests:** pure helpers (stage dots, filters, Home buckets, navigation by role) get Vitest unit tests in the web package. Playwright drives the real app against the API and worker.

**Tech Stack:** React 19.2.3 (one version repo-wide), Vite 8, Tailwind CSS 4, TanStack Query 5, `motion` 13.4.4 (pinned), `@xyflow/react` 12, `@fontsource/red-hat-display` and `@fontsource/red-hat-text`, Vitest 5, `@playwright/test`.

**Spec:** [docs/superpowers/specs/2026-10-12-org-types-and-case-lifecycle-design.md](../specs/2026-10-12-org-types-and-case-lifecycle-design.md), section 6 (Web and mobile UI) and section 5 (the web end-to-end row). The chosen mockup is `.superpowers/design/direction-a.html`; the n8n.io study is `.superpowers/design/n8n-design-notes.md`. Both are git-ignored and in the main checkout.

## Global Constraints

- Every check must stay green: `pnpm turbo run build typecheck test`. Shared packages are consumed from `dist/` (`pnpm build:packages` after changing `packages/*`).
- **Colours come only from `@onehuman/ui` tokens** via token classes or `var(--oh-…)`. No raw Tailwind colours, no hex in components (CLAUDE.md).
- **Colour always means the same thing:** warm (action gradient, `waiting` #ff9b26) means a person is needed; green (`success` #35a670) means done; cool violet/blue means navigation and agents; red (`danger` #ff492c) means critical or P1.
- **Dark-first.** Light stays available in Settings with the same hues at AA contrast.
- **Fonts:** Red Hat Display 300/400 for headings (two tones: a grey lead-in and a white payoff); Red Hat Text for the interface, with tabular numbers for times. Self-hosted through `@fontsource`, with no font CDN at runtime.
- **Radii:** 8 / 12 / 16. Cards have no drop shadows. Depth comes from a 1px inner white/10 ring, a warm top highlight and soft radial glows.
- **Motion:** use `motion` (pinned; shared pieces in `src/components/motion.tsx`). Content fades up 25px over 0.55s on entry, and hovers take 300ms. The live-stage effects are CSS keyframes. Everything respects reduced motion: `MotionConfig reducedMotion="user"` in the shell plus a CSS media query, and the halo becomes a static ring.
- **People never see tool names, ids or JSON** (CLAUDE.md). Case files render as sentences; approval details go through `readableFields`.
- **Accessibility:** text meets AA; focus rings are lilac and always visible; interactive targets are at least 44px at phone width; text is at least 13px. Not-started stages also say "Not started" in words.
- **One React version** repo-wide (Expo's). New dependencies are pinned to exact versions at least 14 days old (`npm view <pkg> time`).
- Inspired by n8n.io; copies none of n8n's logo, name, illustrations or text.

## Deviations from the spec (decided while planning)

1. **The top-bar search finds cases** (number, title, requester), by opening `/cases?q=`. A search across everything is later work.
2. **The command center becomes Home.** "Give a goal" is replaced by **New request**. Goal pages (`/goals/:id`) stay and open from a case's stage 6, Reports and Audit.
3. **The public request form is a web page** at `/r/:tenantId/:key`, the path the intake key returns.
4. **Below `lg` width the Case page shows the stage dots, not the canvas.** Eight named nodes can't stay legible narrower than that. The case file below it carries every stage either way.
5. **The stage-6 work shows as its report on the Case page**, with a link to the goal page, where the goal canvas and its calls already live. The spec puts the goal canvas inside the execute stage. A second canvas inside the case canvas page would be heavy, and unreadable at phone width. The case file timeline, with each stage's summary, stands in for "latest activity".
6. **Mobile is Plan 6.** The token change also reaches the mobile app, which reads the same palette objects. Its screens are restyled there.

## Review Focus

These inputs aren't covered by any happy-path test and are the most likely to hurt a real user. Each line names the test that pins it.

1. **Very long or hostile request text** (a 4,000-character customer message, an unbroken 300-character string, `<b>` and `<script>` in it): it must wrap and clamp without breaking the layout, and render as text. Pinned in Task 10, `cases.spec.ts` "long request text wraps and stays text".
2. **A workspace without stage names** (installed before Plan 2) **or a stage never reached**: the canvas and the dots show the generic names and say "Not started" in words. Pinned in Task 2, `cases.test.ts` "falls back to the generic stage names" and "says not started in words".
3. **Reduced motion**: the live stage stops spinning, pulsing and flowing, and the halo becomes a static ring. Pinned in Task 10, `cases.spec.ts` "reduced motion stops the live stage".
4. **Phone width (390px)**: no sideways scrolling on Home, Cases, the Case page or Approvals, and buttons at least 44px tall. Pinned in Task 10's phone project, `layout.spec.ts` "no sideways scroll at phone width".
5. **A member signed in**: no owner/admin pages in the navigation, no kill switch, and New request still there. Pinned in Task 2, `nav.test.ts` "members see the work pages only", and in Task 10, `roles.spec.ts`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/ui/src/index.ts`, `packages/ui/src/contrast.test.ts` (new) | Glow palette and new tokens, fonts, gradients; AA contrast test | 1 |
| `master-ai-web/src/index.css` | Token mapping, glass/glow/action utilities, live-stage keyframes, canvas edges, reduced motion | 1, 4, 6 |
| `master-ai-web/src/main.tsx` | Fonts, `MotionConfig`, routes for Home, Cases, Case, the public form | 1, 3, 5, 6, 7 |
| `master-ai-web/src/components/ui/*` | Button (action, glass, cool), Card (glass), Badge, Chip, PageHeader (two-tone), Dialog, CopyField | 2, 3, 8 |
| `master-ai-web/src/lib/cases.ts` + `cases.test.ts` (new) | Stage dots, filters, Home buckets, due times, generic stage names | 2, 5 |
| `master-ai-web/src/lib/nav.ts` + `nav.test.ts` (new) | Navigation by access role | 2 |
| `master-ai-web/src/lib/new-request.ts` (new), `components/new-request.tsx` (new) | New request, openable from anywhere with a preset | 3 |
| `master-ai-web/src/components/app-shell.tsx` | Glass sidebar, company switcher, top bar (search, New request, Pause all agents) | 3 |
| `master-ai-web/src/routes/auth.tsx`, `onboarding.tsx`, `components/stages-preview.tsx` (new) | Signup wizard; animated install preview | 4 |
| `master-ai-web/src/routes/cases.tsx`, `public-form.tsx` (new) | Cases list; public request form | 5 |
| `packages/sdk/src/case-file.ts` + test (new) | The case file as sentences, shared with mobile | 6 |
| `master-ai-web/src/components/stage-dots.tsx`, `case-canvas.tsx`, `case-file.tsx`, `case-report.tsx` (new); `routes/case.tsx` (new) | Mini stage bar, 8-stage canvas, case-file timeline, case report; the Case page | 2, 6 |
| `master-ai-web/src/routes/home.tsx` (new, replaces `command-center.tsx`), `reports.tsx`, `approvals.tsx`, `components/approval-card.tsx` | Home; case reports; the inbox with case context | 7 |
| `master-ai-web/src/lib/people.ts` + test, `components/people.tsx`, `components/request-keys.tsx` (new); `routes/team.tsx`, `settings.tsx`, `routines.tsx`, `workflows.tsx` | People, invites and approval roles; request keys; New request from routines and workflows | 8 |
| `master-ai-web/src/tokens.test.ts` (new) and the older screens | No raw colours, hex or tiny text; the remaining screens in Glow | 9 |
| `master-ai-web/playwright.config.ts`, `master-ai-web/e2e/*` (new) | Browser tests at desktop and phone widths | 10 |

---

### Task 1: Glow tokens, fonts and the CSS foundation

**Files:**
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`, `packages/ui/tsconfig.json`
- Create: `packages/ui/src/contrast.test.ts`
- Modify: `master-ai-web/src/index.css`, `master-ai-web/src/main.tsx`, `master-ai-web/package.json`

**Interfaces:**
- Produces (`@onehuman/ui`):
  - `Palette` gains `textBody`, `textLead`, `node`, `line5`, `line10`, `line15`, `line20`, `glow`, `onAction`.
  - `effects` (gradients, rings, shadows, nav glow) and `ACTION_LABEL_STOPS`.
  - `contrastRatio(a, b)`.
  - `radius` becomes 8/12/16 (`sm`/`md`/`lg`); `fontFamily.display` is added.
  - CSS variables `--oh-…` for all of it.
- Produces (web CSS): token classes `bg-node`, `text-fg-body`, `text-fg-lead`, `border-line-10`, `text-on-action`, `font-display`, and so on. Utilities `.page-glow`, `.glass`, `.glass-warm`, `.btn-action`, `.btn-glass`, `.btn-cool`, `.nav-active`, `.chip`, `.dots-floor`. Live-stage classes `.live-node`, `.live-spin`, `.live-halo`, `.edge-flow`, `.pulse-dot`, `.breathe`, with a reduced-motion override.

- [ ] **Step 1: Write the failing contrast test**

Add a test script and Vitest to `packages/ui/package.json` (`"test": "vitest run"` in `scripts`, `"vitest": "^5.0.3"` in `devDependencies`, the version every other package uses), and exclude tests from the build typecheck in `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/ui/src/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ACTION_LABEL_STOPS, contrastRatio, darkPalette, lightPalette, type ColorToken } from './index';

const AA = 4.5;
const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ['text', 'background'],
  ['textBody', 'background'],
  ['textLead', 'background'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textBody', 'surface'],
  ['primary', 'background'],
  ['accent', 'background'],
  ['success', 'background'],
  ['success', 'successSoft'],
  ['warning', 'background'],
  ['warning', 'warningSoft'],
  ['danger', 'background'],
  ['danger', 'dangerSoft'],
  ['info', 'background'],
];

describe.each([
  ['dark', darkPalette],
  ['light', lightPalette],
] as const)('%s palette', (_name, p) => {
  it.each(TEXT_PAIRS)('%s on %s meets AA', (fg, bg) => {
    expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the action gradient', () => {
  it('keeps white labels at AA where the label sits', () => {
    for (const stop of ACTION_LABEL_STOPS) expect(contrastRatio(darkPalette.onAction, stop)).toBeGreaterThanOrEqual(AA);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0e0918', '#0e0918')).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm install --offline && pnpm --filter @onehuman/ui exec vitest run`
Expected: FAIL: `contrastRatio` and `ACTION_LABEL_STOPS` are not exported.

- [ ] **Step 3: The Glow tokens**

In `packages/ui/src/index.ts`:

1. Extend `ColorToken` with `| 'textBody' | 'textLead' | 'node' | 'line5' | 'line10' | 'line15' | 'line20' | 'glow' | 'onAction'`.

2. Replace `darkPalette` and `lightPalette` and update the comment above them:

```ts
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
```

3. Replace `radius` and `fontFamily`:

```ts
export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;
export const fontFamily = {
  display: "'Red Hat Display', 'Red Hat Text', ui-sans-serif, system-ui, sans-serif",
  sans: "'Red Hat Text', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;
```

4. In `cssVariables()`, emit the effects and the display font in the `:root` block (after the radius lines):

```ts
${Object.entries(effects)
  .map(([k, v]) => `  --oh-effect-${kebab(k)}: ${v};`)
  .join('\n')}
  --oh-font-display: ${fontFamily.display};
```

5. Add the contrast helper (WCAG 2.1 relative luminance), exported:

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @onehuman/ui exec vitest run`
Expected: PASS (32 tests). If a pair falls below 4.5, darken the light value (or lighten the dark value) by the smallest step that passes, keeping its hue, and record the new value in the ledger.

- [ ] **Step 5: Self-hosted fonts**

Pick the newest versions of `@fontsource/red-hat-display` and `@fontsource/red-hat-text` that are at least 14 days old (`npm view @fontsource/red-hat-display time --json`), add them to `master-ai-web/package.json` `dependencies` as exact versions, and run `pnpm install`. Check that `git diff pnpm-lock.yaml` adds only these two packages; if pnpm re-resolves other packages, revert the lockfile and add them by hand as in Plan 3.

In `master-ai-web/src/main.tsx`, before `import './index.css';`:

```ts
import '@fontsource/red-hat-display/300.css';
import '@fontsource/red-hat-display/400.css';
import '@fontsource/red-hat-text/400.css';
import '@fontsource/red-hat-text/500.css';
import '@fontsource/red-hat-text/600.css';
```

- [ ] **Step 6: The CSS foundation**

Replace `master-ai-web/src/index.css` with:

```css
@import 'tailwindcss';
@import '@onehuman/ui/theme.css';

/* Map the shared design tokens (CSS variables from @onehuman/ui) into Tailwind. */
@theme inline {
  --color-background: var(--oh-background);
  --color-surface: var(--oh-surface);
  --color-muted: var(--oh-surface-muted);
  --color-node: var(--oh-node);
  --color-border: var(--oh-border);
  --color-line-5: var(--oh-line5);
  --color-line-10: var(--oh-line10);
  --color-line-15: var(--oh-line15);
  --color-line-20: var(--oh-line20);
  --color-fg: var(--oh-text);
  --color-fg-body: var(--oh-text-body);
  --color-fg-lead: var(--oh-text-lead);
  --color-fg-muted: var(--oh-text-muted);
  --color-primary: var(--oh-primary);
  --color-primary-fg: var(--oh-primary-text);
  --color-primary-soft: var(--oh-primary-soft);
  --color-on-action: var(--oh-on-action);
  --color-accent: var(--oh-accent);
  --color-accent-soft: var(--oh-accent-soft);
  --color-canvas: var(--oh-canvas);
  --color-canvas-dot: var(--oh-canvas-dot);
  --color-glow: var(--oh-glow);
  --color-success: var(--oh-success);
  --color-success-soft: var(--oh-success-soft);
  --color-warning: var(--oh-warning);
  --color-warning-soft: var(--oh-warning-soft);
  --color-danger: var(--oh-danger);
  --color-danger-soft: var(--oh-danger-soft);
  --color-info: var(--oh-info);
  --color-info-soft: var(--oh-info-soft);
  --color-level-1: var(--oh-level1);
  --color-level-2: var(--oh-level2);
  --color-level-3: var(--oh-level3);
  --color-level-4: var(--oh-level4);
  --color-level-5: var(--oh-level5);
  --font-sans: var(--oh-font-sans);
  --font-display: var(--oh-font-display);
  --font-mono: var(--oh-font-mono);
  --radius-sm: var(--oh-radius-sm);
  --radius-md: var(--oh-radius-md);
  --radius-lg: var(--oh-radius-lg);
  /* The smallest text is 13px (Global Constraints), so text-xs is 13px here. */
  --text-xs: 0.8125rem;
  --text-xs--line-height: 1.125rem;
}

@custom-variant light (&:where([data-theme='light'], [data-theme='light'] *));

html,
body,
#root {
  height: 100%;
}

body {
  background: var(--oh-background);
  color: var(--oh-text-body);
  font-family: var(--oh-font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1,
h2,
h3 {
  font-family: var(--oh-font-display);
  color: var(--oh-text);
  letter-spacing: -0.01em;
}

:focus-visible {
  outline: 2px solid var(--oh-accent);
  outline-offset: 2px;
}

::selection {
  background: var(--oh-primary-soft);
}

/* ---------- Glow surfaces ---------- */

/* The page: one background, told apart by soft glows (never stripes). */
.page-glow {
  background:
    radial-gradient(900px 560px at 10% 0%, var(--oh-effect-glow-cool), transparent 70%),
    radial-gradient(1100px 760px at 50% 110%, color-mix(in oklab, var(--oh-glow) 12%, transparent), transparent 70%),
    var(--oh-background);
}

/* A card lit from inside: a 1px white/10 ring and a faint top highlight, no drop shadow. */
.glass {
  background: linear-gradient(180deg, color-mix(in oklab, var(--oh-surface) 90%, var(--oh-text) 4%), var(--oh-surface) 40%);
  box-shadow:
    inset 0 0 0 1px var(--oh-line10),
    inset 0 1px 0 var(--oh-line10);
}

/* The same card with the warm top edge: something here needs a person. */
.glass-warm {
  background:
    radial-gradient(80% 120% at 0% 0%, color-mix(in oklab, var(--oh-warning) 12%, transparent), transparent 70%),
    var(--oh-surface);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklab, var(--oh-warning) 24%, transparent),
    inset 0 1px 0 color-mix(in oklab, var(--oh-warning) 30%, transparent);
}

/* The primary action: warm gradient with a sheen, white label. */
.btn-action {
  color: var(--oh-on-action);
  background: var(--oh-effect-gradient-action-sheen), var(--oh-effect-gradient-action);
  box-shadow: var(--oh-effect-action-ring), var(--oh-effect-action-shadow);
  transition: box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn-action:hover {
  box-shadow: var(--oh-effect-action-ring), var(--oh-effect-action-shadow-hover);
}

.btn-glass {
  background-color: var(--oh-line10);
  box-shadow:
    inset 0 0 0 1px var(--oh-line10),
    inset 0 1px 0 var(--oh-line10);
  transition: background-color 0.3s;
}
.btn-glass:hover {
  background-color: var(--oh-line15);
}

.btn-cool {
  color: var(--oh-on-action);
  background: var(--oh-effect-gradient-cool);
  box-shadow: inset 0 1px 0 var(--oh-line20);
}

/* The active navigation item: a lilac glow rising from below. */
.nav-active {
  background: var(--oh-effect-nav-active);
  box-shadow: var(--oh-effect-nav-active-ring);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  background: var(--oh-line5);
  box-shadow: inset 0 0 0 1px var(--oh-line10);
}

/* A field of dots fading in from below, like n8n's canvas floor. */
.dots-floor {
  background: radial-gradient(var(--oh-line15) 1px, transparent 1.4px) 8px 8px / 16px 16px;
  mask: linear-gradient(180deg, transparent, #000 85%);
}

/* n8n-style dotted canvas */
.canvas-dots {
  background-color: var(--oh-canvas);
  background-image: radial-gradient(var(--oh-canvas-dot) 1.2px, transparent 1.2px);
  background-size: 22px 22px;
}

/* Brand glow behind hero headers */
.hero-glow {
  background:
    radial-gradient(60% 120% at 15% 0%, color-mix(in oklab, var(--oh-glow) 22%, transparent), transparent 70%),
    radial-gradient(50% 110% at 85% 10%, color-mix(in oklab, var(--oh-accent) 20%, transparent), transparent 70%);
}

:root[data-theme='light'] .page-glow,
:root[data-theme='light'] .hero-glow {
  background: var(--oh-background);
}

/* ---------- The live stage ---------- */

@keyframes oh-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes oh-halo {
  0% {
    transform: scale(1);
    opacity: 0.85;
  }
  75%,
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
@keyframes oh-ping {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--oh-warning) 60%, transparent);
  }
  80%,
  100% {
    box-shadow: 0 0 0 7px transparent;
  }
}
@keyframes oh-flow {
  to {
    stroke-dashoffset: -24;
  }
}
@keyframes oh-breathe {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
@keyframes oh-pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@keyframes oh-ring {
  0%,
  100% {
    transform: rotate(0deg);
  }
  10%,
  30% {
    transform: rotate(-14deg);
  }
  20%,
  40% {
    transform: rotate(14deg);
  }
  50% {
    transform: rotate(0deg);
  }
}

/* The node of the stage the case is in: a rotating light sweep inside a pulsing halo. */
.live-node {
  position: relative;
  box-shadow:
    0 0 0 6px color-mix(in oklab, var(--oh-glow) 9%, transparent),
    0 0 44px 4px color-mix(in oklab, var(--oh-glow) 42%, transparent);
}
.live-spin {
  position: absolute;
  inset: -40px;
  background: conic-gradient(from 0deg, transparent 0deg 140deg, var(--oh-warning) 220deg, var(--oh-glow) 300deg, transparent 345deg);
  animation: oh-spin 2.8s linear infinite;
}
.live-halo {
  position: absolute;
  inset: -2px;
  border-radius: 18px;
  box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--oh-glow) 65%, transparent);
  opacity: 0;
  animation: oh-halo 2.4s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
}
.edge-flow {
  stroke-dasharray: 0.5 11.5;
  stroke-linecap: round;
  animation: oh-flow 1.1s linear infinite;
}
.pulse-dot {
  animation: oh-ping 1.8s ease-out infinite;
}
.breathe {
  animation: oh-breathe 3.6s ease-in-out infinite;
}
.live-dot {
  animation: oh-pulse-dot 1.6s ease-in-out infinite;
}
.ringing {
  animation: oh-ring 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .live-spin,
  .edge-flow,
  .pulse-dot,
  .breathe,
  .live-dot,
  .ringing {
    animation: none !important;
  }
  .live-spin {
    display: none;
  }
  /* The halo stays as a static ring. */
  .live-halo {
    animation: none !important;
    opacity: 0.45;
    transform: scale(1.14);
  }
}

/* React Flow, themed with our tokens */
.react-flow {
  --xy-background-color: transparent;
  --xy-edge-stroke: var(--oh-line20);
  --xy-edge-stroke-width: 1.5;
  --xy-node-border-radius: 12px;
  --xy-controls-button-background-color: var(--oh-surface);
  --xy-controls-button-background-color-hover: var(--oh-surface-muted);
  --xy-controls-button-color: var(--oh-text);
  --xy-controls-button-border-color: var(--oh-border);
  --xy-attribution-background-color: transparent;
}
.react-flow__attribution {
  display: none;
}
.react-flow__handle {
  opacity: 0;
}
```

- [ ] **Step 7: Run every check**

Run: `pnpm build:packages && pnpm turbo run build typecheck test && pnpm --filter @onehuman/mobile exec tsc --noEmit`
Expected: all succeed. The `ui` package now has a `test` task too.

- [ ] **Step 8: Commit**

```bash
git add packages/ui master-ai-web pnpm-lock.yaml
git commit -m "feat(ui): Glow tokens with an AA contrast test, Red Hat fonts and the CSS foundation"
```

### Task 2: Primitives, stage dots and navigation by role

**Files:**
- Modify: `master-ai-web/package.json` (Vitest), `master-ai-web/vite.config.ts`
- Create: `master-ai-web/src/lib/cases.ts`, `master-ai-web/src/lib/cases.test.ts`, `master-ai-web/src/lib/nav.ts`, `master-ai-web/src/lib/nav.test.ts`
- Modify: `master-ai-web/src/components/ui/button.tsx`, `card.tsx`, `badge.tsx`, `feedback.tsx`
- Create: `master-ai-web/src/components/ui/chip.tsx`, `master-ai-web/src/components/stage-dots.tsx`

**Interfaces:**
- Produces (`lib/cases.ts`): `GENERIC_STAGE_NAMES`, `stageNames(lifecycle?)`, `type DotState`, `FINAL_STATUSES`, `WAITING_ON_PEOPLE`, `dotsFromCase(c)`, `dotsFromStages(stages)`, `dotLabel(state)`, `type CaseFilters`, `caseMatches(c, f)`, `homeBuckets(cases, now)`, `statusWords(status)`, `priorityTone(p)`.
- Produces (`lib/nav.ts`): `type NavItem`, `NAV`, `navFor(role)`.
- Produces (components): `Button` variants `primary` (action gradient), `secondary` (glass), `cool`, `ghost`, `danger`, `success`, `warning`; `Card` (glass); `Badge` tone `waiting`; `Chip` (`tone`: neutral, waiting, success, danger, cool); `PageHeader` with an optional `lead` (the grey first half of a two-tone title); `StageDots`.

- [ ] **Step 1: Vitest for the web package**

In `master-ai-web/package.json`, add `"test": "vitest run"` to `scripts` and `"vitest": "^5.0.3"` to `devDependencies`. In `master-ai-web/vite.config.ts`, keep browser tests out of Vitest:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

(add `/// <reference types="vitest/config" />` as the first line so the `test` key typechecks), then `pnpm install --offline`.

- [ ] **Step 2: Write the failing tests**

Create `master-ai-web/src/lib/cases.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Case } from '@onehuman/schemas';
import { caseMatches, dotLabel, dotsFromCase, dotsFromStages, GENERIC_STAGE_NAMES, homeBuckets, stageNames } from './cases';

const base: Case = {
  id: 'c1', workspaceId: 'w1', number: 42, code: 'WO-0042', title: 'Boiler feed pump B vibration', source: 'staff',
  requester: { name: 'Ravi Kumar' }, category: 'breakdown', categoryName: 'Breakdown', priority: 'P2', risk: 'medium',
  department: 'Maintenance', amountInr: null, assignee: { name: 'Suresh', title: 'Maintenance lead' }, respondBy: null,
  resolveBy: null, stage: 'approve', status: 'waiting_approval', outcome: null, goalId: null,
  createdAt: '2026-10-13T04:30:00Z', updatedAt: '2026-10-13T04:30:00Z', closedAt: null,
};

describe('stage names', () => {
  it('falls back to the generic stage names', () => {
    expect(stageNames(null).approve).toBe('Approval Gate');
    const named = stageNames({ stages: [{ key: 'approve', name: 'Permit & clearance' }] });
    expect(named.approve).toBe('Permit & clearance');
    expect(named.review).toBe(GENERIC_STAGE_NAMES.review);
  });
});

describe('stage dots', () => {
  it('marks earlier stages done and the current one as waiting on a person', () => {
    expect(dotsFromCase(base)).toEqual(['done', 'done', 'done', 'done', 'waiting', 'todo', 'todo', 'todo']);
    expect(dotsFromCase({ ...base, stage: 'execute', status: 'in_progress' })[5]).toBe('live');
  });

  it('shows a closed case all done and a stopped case stopped', () => {
    expect(dotsFromCase({ ...base, stage: 'report', status: 'closed' })).toEqual(Array(8).fill('done'));
    expect(dotsFromCase({ ...base, stage: 'report', status: 'rejected' }).slice(0, 2)).toEqual(['stopped', 'stopped']);
  });

  it('reads the exact state of each stage from the timeline', () => {
    expect(dotsFromStages([{ status: 'done' }, { status: 'skipped' }, { status: 'waiting_approval' }, { status: 'running' }, { status: 'pending' }])).toEqual([
      'done', 'skipped', 'waiting', 'live', 'todo',
    ]);
  });

  it('says not started in words', () => {
    expect(dotLabel('todo')).toBe('Not started');
    expect(dotLabel('waiting')).toBe('Waiting for a person');
  });
});

describe('case filters', () => {
  it('finds a case by number, title or requester, whatever the case of the letters', () => {
    expect(caseMatches(base, { q: 'wo-0042' })).toBe(true);
    expect(caseMatches(base, { q: 'PUMP B' })).toBe(true);
    expect(caseMatches(base, { q: 'ravi' })).toBe(true);
    expect(caseMatches(base, { q: 'conveyor' })).toBe(false);
  });

  it('filters by stage, priority, status group and assignee', () => {
    expect(caseMatches(base, { stage: 'approve', priority: 'P2', status: 'waiting', assignee: 'sure' })).toBe(true);
    expect(caseMatches(base, { status: 'closed' })).toBe(false);
    expect(caseMatches(base, { priority: 'P1' })).toBe(false);
  });
});

describe('home', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('counts open cases by stage, lists what waits on people and what is about to miss its deadline', () => {
    const soon = { ...base, id: 'c2', stage: 'execute' as const, status: 'in_progress' as const, resolveBy: '2026-10-13T20:00:00Z' };
    const later = { ...base, id: 'c3', stage: 'execute' as const, status: 'in_progress' as const, resolveBy: '2026-10-20T10:00:00Z' };
    const done = { ...base, id: 'c4', status: 'closed' as const, stage: 'report' as const };
    const b = homeBuckets([base, soon, later, done], now);
    expect(b.open).toBe(3);
    expect(b.byStage.execute).toBe(2);
    expect(b.byStage.approve).toBe(1);
    expect(b.waiting.map((c) => c.id)).toEqual(['c1']);
    expect(b.atRisk.map((c) => c.id)).toEqual(['c2']);
  });
});
```

Create `master-ai-web/src/lib/nav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { navFor } from './nav';

const labels = (role: 'owner' | 'admin' | 'member') => navFor(role).map((i) => i.label);

describe('navigation by access role', () => {
  it('members see the work pages only', () => {
    expect(labels('member')).toEqual(['Home', 'Cases', 'Approvals', 'Team', 'Routines', 'Calls', 'Reports', 'Knowledge']);
  });

  it('the owner and admins also see the admin pages', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(labels(role)).toEqual(expect.arrayContaining(['Workflows', 'Agents', 'Records', 'Industry pack', 'Audit', 'Settings']));
    }
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @onehuman/web exec vitest run`
Expected: FAIL: cannot find `./cases` and `./nav`.

- [ ] **Step 4: Write the helpers**

Create `master-ai-web/src/lib/cases.ts`:

```ts
import { STAGE_KEYS, type Case, type CaseStageStatus, type CaseStatus, type PriorityId, type StageKey } from '@onehuman/schemas';

/** The generic stage names (spec), for workspaces that name none of their own. */
export const GENERIC_STAGE_NAMES: Record<StageKey, string> = {
  request: 'Request / Event Created',
  review: 'Admin Review & Validation',
  classify: 'Classification & Priority',
  assign: 'Assignment',
  approve: 'Approval Gate',
  execute: 'Execution & Monitoring',
  close: 'Verification & Closure',
  report: 'Reporting & Continuous Improvement',
};

/** This organization's stage names, falling back to the generic ones. */
export function stageNames(lifecycle?: { stages: { key: StageKey; name: string }[] } | null): Record<StageKey, string> {
  const names = { ...GENERIC_STAGE_NAMES };
  for (const s of lifecycle?.stages ?? []) names[s.key] = s.name;
  return names;
}

export type DotState = 'done' | 'live' | 'waiting' | 'todo' | 'skipped' | 'stopped';

export const FINAL_STATUSES: readonly CaseStatus[] = ['closed', 'rejected', 'cancelled', 'escalated'];
export const WAITING_ON_PEOPLE: readonly CaseStatus[] = ['needs_info', 'waiting_approval', 'waiting_signoff'];

/** The list's mini stage bar, from the case alone. */
export function dotsFromCase(c: Pick<Case, 'stage' | 'status'>): DotState[] {
  if (c.status === 'closed') return STAGE_KEYS.map(() => 'done');
  if (FINAL_STATUSES.includes(c.status)) return STAGE_KEYS.map((k) => (k === 'report' ? 'done' : 'stopped'));
  const at = STAGE_KEYS.indexOf(c.stage);
  const current: DotState = WAITING_ON_PEOPLE.includes(c.status) ? 'waiting' : 'live';
  return STAGE_KEYS.map((_, i) => (i < at ? 'done' : i === at ? current : 'todo'));
}

/** The exact state of each stage, from the case report's timeline. */
export function dotsFromStages(stages: { status: CaseStageStatus }[]): DotState[] {
  return stages.map(({ status }) => {
    switch (status) {
      case 'done':
        return 'done';
      case 'skipped':
        return 'skipped';
      case 'failed':
        return 'stopped';
      case 'pending':
        return 'todo';
      case 'running':
        return 'live';
      default:
        return 'waiting';
    }
  });
}

const DOT_WORDS: Record<DotState, string> = {
  done: 'Done',
  live: 'In progress',
  waiting: 'Waiting for a person',
  todo: 'Not started',
  skipped: 'Not needed',
  stopped: 'Stopped',
};

export function dotLabel(state: DotState): string {
  return DOT_WORDS[state];
}

const STATUS_WORDS: Record<CaseStatus, string> = {
  open: 'Open',
  needs_info: 'Needs details',
  waiting_approval: 'Waiting for approval',
  in_progress: 'In progress',
  waiting_signoff: 'Waiting for sign-off',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  escalated: 'With a person',
};

export function statusWords(status: CaseStatus): string {
  return STATUS_WORDS[status];
}

/** Chip tone for a priority: P1 is critical (red), the rest are neutral. */
export function priorityTone(p: PriorityId | null): 'danger' | 'waiting' | 'neutral' {
  return p === 'P1' ? 'danger' : p === 'P2' ? 'waiting' : 'neutral';
}

export interface CaseFilters {
  q?: string;
  stage?: StageKey | '';
  priority?: PriorityId | '';
  /** open: not ended; waiting: on a person; closed: ended. */
  status?: 'open' | 'waiting' | 'closed' | '';
  assignee?: string;
}

export function caseMatches(c: Case, f: CaseFilters): boolean {
  const q = f.q?.trim().toLowerCase();
  if (q && ![c.code, c.title, c.requester.name].some((s) => s.toLowerCase().includes(q))) return false;
  if (f.stage && c.stage !== f.stage) return false;
  if (f.priority && c.priority !== f.priority) return false;
  if (f.status === 'open' && FINAL_STATUSES.includes(c.status)) return false;
  if (f.status === 'waiting' && !WAITING_ON_PEOPLE.includes(c.status)) return false;
  if (f.status === 'closed' && !FINAL_STATUSES.includes(c.status)) return false;
  const who = f.assignee?.trim().toLowerCase();
  if (who && !(c.assignee?.name ?? '').toLowerCase().includes(who)) return false;
  return true;
}

/** Home: open cases by stage, what waits on people, and what is within a day of its deadline. */
export function homeBuckets(cases: Case[], now: Date) {
  const open = cases.filter((c) => !FINAL_STATUSES.includes(c.status));
  const byStage = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])) as Record<StageKey, number>;
  for (const c of open) byStage[c.stage]++;
  const dayAhead = now.getTime() + 24 * 3_600_000;
  const atRisk = open
    .filter((c) => c.resolveBy && Date.parse(c.resolveBy) <= dayAhead)
    .sort((a, b) => Date.parse(a.resolveBy!) - Date.parse(b.resolveBy!));
  return { open: open.length, byStage, waiting: open.filter((c) => WAITING_ON_PEOPLE.includes(c.status)), atRisk };
}
```

Create `master-ai-web/src/lib/nav.ts`:

```ts
import {
  Bot,
  BookOpen,
  Database,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  Package,
  Phone,
  Repeat,
  ScrollText,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { HumanRole } from '@onehuman/schemas';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Only the owner and admins change these. */
  managersOnly?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/cases', label: 'Cases', icon: FolderKanban },
  { to: '/approvals', label: 'Approvals', icon: Inbox },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/routines', label: 'Routines', icon: Repeat },
  { to: '/calls', label: 'Calls', icon: Phone },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/workflows', label: 'Workflows', icon: Workflow, managersOnly: true },
  { to: '/agents', label: 'Agents', icon: Bot, managersOnly: true },
  { to: '/records', label: 'Records', icon: Database, managersOnly: true },
  { to: '/pack', label: 'Industry pack', icon: Package, managersOnly: true },
  { to: '/audit', label: 'Audit', icon: ScrollText, managersOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, managersOnly: true },
];

export function navFor(role: HumanRole | undefined): NavItem[] {
  const manager = role === 'owner' || role === 'admin';
  return NAV.filter((i) => !i.managersOnly || manager);
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm --filter @onehuman/web exec vitest run`
Expected: PASS (10 tests).

- [ ] **Step 6: The primitives**

Replace the variants in `master-ai-web/src/components/ui/button.tsx`:

```ts
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
```

In `card.tsx`, the card is glass, with a hairline header:

```tsx
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass rounded-lg', className)} {...props} />;
}
```

and in `CardHeader` use `border-b border-line-10` (instead of `border-border`) and `text-fg` for the title.

In `badge.tsx`, add the tones `waiting: 'bg-warning-soft text-warning'` and `cool: 'bg-accent-soft text-accent'`.

Create `master-ai-web/src/components/ui/chip.tsx`:

```tsx
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
```

In `feedback.tsx`, make `PageHeader` two-tone (a grey lead-in and a white payoff) with the entry fade-up:

```tsx
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
```

(import `motion` from `motion/react`).

Create `master-ai-web/src/components/stage-dots.tsx`:

```tsx
import { dotLabel, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

const DOT: Record<DotState, string> = {
  done: 'bg-success',
  live: 'btn-action',
  waiting: 'bg-warning pulse-dot',
  todo: 'border border-dashed border-line-20',
  skipped: 'bg-line-15',
  stopped: 'bg-line-10',
};

/** The 8 stages as dots: green done, warm live, dashed not started. Each dot says its state in words. */
export function StageDots({ states, names, className }: { states: DotState[]; names: string[]; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-1', className)} aria-label="Stages">
      {states.map((s, i) => (
        <li key={i} className={cn('size-2.5 rounded-full', DOT[s])} title={`${names[i]}: ${dotLabel(s)}`}>
          <span className="sr-only">{`${names[i]}: ${dotLabel(s)}`}</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: Run every check**

Run: `pnpm turbo run build typecheck test`
Expected: all succeed (web now runs its own tests).

- [ ] **Step 8: Commit**

```bash
git add master-ai-web pnpm-lock.yaml
git commit -m "feat(web): Glow primitives, stage dots, case helpers and navigation by role"
```

### Task 3: The shell, New request, and live updates for cases

A glass sidebar with the active-item glow and the company card (and switcher), and a top bar with case search, the gradient **New request** button and **Pause all agents**. New request opens from anywhere: the top bar, Workflows' *Start*, a flagged routine answer.

This task is UI only. It is verified by typecheck and build here, and by the browser tests in Task 10.

**Files:**
- Create: `master-ai-web/src/components/ui/dialog.tsx`, `master-ai-web/src/lib/new-request.ts`, `master-ai-web/src/components/new-request.tsx`
- Modify (replace): `master-ai-web/src/components/app-shell.tsx`
- Modify: `master-ai-web/src/lib/realtime.ts`, `master-ai-web/src/main.tsx`

**Interfaces:**
- Consumes: `navFor` (Task 2); `api.cases.create`, `api.auth.me/switchCompany`; the session store (`companies`, `setUser`, `signIn`).
- Produces: `Dialog({ open, onClose, title, lead?, children })`; `useNewRequest` store (`open`, `preset`, `show(preset?)`, `hide()`), `NewRequestPreset { text?; category? }`; `NewRequestDialog`.

- [ ] **Step 1: The dialog and the New request store**

Create `master-ai-web/src/components/ui/dialog.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/** A modal on a dimmed, blurred page. Escape or a click outside closes it. */
export function Dialog({ open, onClose, title, lead, children }: { open: boolean; onClose: () => void; title: string; lead?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="glass w-full max-w-lg rounded-lg p-6"
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 id="dialog-title" className="font-display text-2xl font-light text-fg">
              {lead && <span className="text-fg-lead">{lead} </span>}
              {title}
            </h2>
            <div className="mt-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

Create `master-ai-web/src/lib/new-request.ts`:

```ts
import { create } from 'zustand';

export interface NewRequestPreset {
  text?: string;
  /** A case type id, e.g. from the Workflows gallery. */
  category?: string;
}

/** New request opens from anywhere: the top bar, Workflows, a flagged routine answer. */
export const useNewRequest = create<{
  open: boolean;
  preset: NewRequestPreset | null;
  show: (preset?: NewRequestPreset) => void;
  hide: () => void;
}>((set) => ({
  open: false,
  preset: null,
  show: (preset) => set({ open: true, preset: preset ?? null }),
  hide: () => set({ open: false }),
}));
```

- [ ] **Step 2: The New request dialog**

Create `master-ai-web/src/components/new-request.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useNewRequest } from '@/lib/new-request';

/** "New request": what's needed, in the person's own words. The case engine does the rest. */
export function NewRequestDialog() {
  const { open, preset, hide } = useNewRequest();
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list, enabled: open });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const label = lifecycle?.case.label ?? 'Request';
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [onBehalf, setOnBehalf] = useState('');

  useEffect(() => {
    if (!open) return;
    setText(preset?.text ?? '');
    setCategory(preset?.category ?? '');
    setAmount('');
    setOnBehalf('');
  }, [open, preset]);

  const create = useMutation({
    mutationFn: () =>
      api.cases.create({
        text,
        ...(category && { category }),
        ...(amount.trim() && { amountInr: Number(amount.replace(/[,₹\s]/g, '')) }),
        ...(onBehalf.trim() && { requester: { name: onBehalf.trim() } }),
      }),
    onSuccess: (c) => {
      hide();
      navigate(`/cases/${c.id}`);
    },
  });

  return (
    <Dialog open={open} onClose={hide} lead="New" title={label.toLowerCase()}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) create.mutate();
        }}
      >
        <Field label="What's needed?" htmlFor="request-text" hint="In your own words. The system checks, sorts and routes it.">
          <Textarea id="request-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} required minLength={3} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type (optional)" htmlFor="request-type">
            <Select id="request-type" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Let the system decide</option>
              {(lifecycle?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount in ₹ (optional)" htmlFor="request-amount">
            <Input id="request-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 45,000" />
          </Field>
        </div>
        <Field label="On behalf of (optional)" htmlFor="request-for" hint="A walk-in customer or a caller, if it isn't you.">
          <Input id="request-for" value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)} />
        </Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={hide}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Raise {label.toLowerCase()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 3: The shell**

Replace `master-ai-web/src/components/app-shell.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, Plus, Power, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { brandPalette, darkPalette, lightPalette } from '@onehuman/ui';
import { NewRequestDialog } from '@/components/new-request';
import { PhoneSimulator } from '@/components/phone-simulator';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { navFor } from '@/lib/nav';
import { useNewRequest } from '@/lib/new-request';
import { useRealtimeConnection } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Tenant white-labelling: apply the brand colour on top of the shared tokens. */
function useBrandColor(brandColor?: string) {
  useEffect(() => {
    const root = document.documentElement;
    if (!brandColor) {
      ['--oh-primary', '--oh-primary-soft', '--oh-primary-text'].forEach((v) => root.style.removeProperty(v));
      return;
    }
    const choice = root.dataset.theme;
    const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) || !choice;
    const p = brandPalette(dark ? darkPalette : lightPalette, brandColor);
    root.style.setProperty('--oh-primary', p.primary);
    root.style.setProperty('--oh-primary-soft', p.primarySoft);
    root.style.setProperty('--oh-primary-text', p.primaryText);
  }, [brandColor]);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function AppShell() {
  const { user, companies, signIn, signOut, setTenant, setUser } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const realtime = useRealtimeConnection();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const showNewRequest = useNewRequest((s) => s.show);
  const manager = user?.role === 'owner' || user?.role === 'admin';

  // Role and approver roles are read fresh, so a change made by the owner shows without signing in again.
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me, refetchInterval: 60_000 });
  useEffect(() => {
    if (me.data) setUser(me.data.user, me.data.companies);
  }, [me.data, setUser]);
  const switchCompany = useMutation({
    mutationFn: (tenantId: string) => api.auth.switchCompany(tenantId),
    onSuccess: (auth) => {
      queryClient.clear();
      signIn(auth);
      navigate('/');
    },
  });

  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const approvals = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  useBrandColor(tenant.data?.settings.brandColor);
  useEffect(() => {
    if (tenant.data) setTenant(tenant.data);
  }, [tenant.data, setTenant]);

  const paused = tenant.data?.status === 'paused';
  const killSwitch = useMutation({
    mutationFn: () => (paused ? api.tenant.resume() : api.tenant.pause()),
    onSuccess: (t) => {
      queryClient.setQueryData(['tenant'], t);
      void queryClient.invalidateQueries();
    },
  });

  const pendingCount = approvals.data?.length ?? 0;
  const location = useLocation();
  const outlet = useOutlet();

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {navFor(user?.role).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            cn(
              'group relative flex h-10 items-center gap-3 rounded-sm px-2.5 text-sm font-medium transition-colors duration-300',
              isActive ? 'text-fg' : 'text-fg-body/75 hover:bg-line-5 hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-active" className="nav-active absolute inset-0 -z-10 rounded-sm" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <Icon className={cn('size-[18px]', isActive ? 'text-accent' : 'text-fg-muted')} aria-hidden />
              <span className="flex-1">{label}</span>
              {to === '/approvals' && pendingCount > 0 && <span className="btn-action rounded-full px-1.5 py-px text-xs font-semibold">{pendingCount}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="page-glow flex h-full print:block print:h-auto">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-line-10 bg-background/85 px-3 py-4 backdrop-blur-xl md:static md:flex print:hidden',
          menuOpen ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center gap-2.5 px-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <p className="font-display text-sm font-medium tracking-[0.09em] text-fg">ONEHUMAN OS</p>
        </div>
        <div className="glass mt-5 flex items-center gap-2.5 rounded-md p-2.5">
          <span className="btn-cool grid size-8 shrink-0 place-items-center rounded-sm text-xs font-semibold">{initials(tenant.data?.name ?? '…')}</span>
          {companies.length > 1 ? (
            <Select aria-label="Switch company" className="h-8 min-w-0 flex-1 text-sm" value={user?.tenantId} onChange={(e) => switchCompany.mutate(e.target.value)} disabled={switchCompany.isPending}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{tenant.data?.name ?? '…'}</p>
          )}
        </div>
        <div className="mt-5 flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-4 space-y-3 border-t border-line-10 px-2 pt-4 text-xs text-fg-muted">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', realtime === 'open' ? 'live-dot bg-success' : realtime === 'connecting' ? 'bg-warning' : 'bg-fg-muted')} aria-hidden />
            {realtime === 'open' ? 'Live' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-fg-body">{user?.name}</span>
            <button className="inline-flex items-center gap-1 hover:text-fg" onClick={signOut}>
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-20 bg-background/60 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line-10 px-3 sm:gap-3 md:px-6 print:hidden">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <form
            role="search"
            className="relative hidden max-w-sm flex-1 sm:block"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/cases${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases" aria-label="Search cases" className="pl-9" />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => showNewRequest()}>
              <Plus /> New request
            </Button>
            {manager && (
              <Button
                variant={paused ? 'success' : 'secondary'}
                onClick={() => {
                  if (paused || window.confirm('Pause every agent in the company? Running work stops at its next step.')) killSwitch.mutate();
                }}
                loading={killSwitch.isPending}
                title="Company-wide kill switch"
                aria-label={paused ? 'Resume all agents' : 'Pause all agents'}
              >
                <Power className={paused ? '' : 'text-danger'} />
                <span className="max-lg:hidden">{paused ? 'Resume all agents' : 'Pause all agents'}</span>
              </Button>
            )}
          </div>
        </header>
        {paused && (
          <div className="border-b border-line-10 bg-warning-soft px-6 py-2 text-sm text-warning print:hidden" role="status">
            The kill switch is on. Every agent is paused and no action can run until you resume.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 print:overflow-visible print:p-0">
          <div className="mx-auto max-w-6xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <NewRequestDialog />
      <div className="print:hidden">
        <PhoneSimulator />
      </div>
    </div>
  );
}
```

In `master-ai-web/src/main.tsx`, wrap the router once so every page (signup and onboarding too) respects reduced motion:

```tsx
import { MotionConfig } from 'motion/react';
// …
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
```

(keep the existing render shape and only add the `MotionConfig` wrapper).

- [ ] **Step 4: Live updates for cases and people**

In `master-ai-web/src/lib/realtime.ts`, inside `onEvent`, after the existing area checks, add:

```ts
        if (area === 'case' || area === 'approval') {
          void queryClient.invalidateQueries({ queryKey: ['cases'] });
          if (area === 'case' && event.refId) void queryClient.invalidateQueries({ queryKey: ['case', event.refId] });
          if (area === 'approval') void queryClient.invalidateQueries({ queryKey: ['case'] });
        }
        if (area === 'member' || area === 'invite') {
          void queryClient.invalidateQueries({ queryKey: ['members'] });
          void queryClient.invalidateQueries({ queryKey: ['invites'] });
        }
        if (area === 'intake_key') void queryClient.invalidateQueries({ queryKey: ['intake-keys'] });
```

- [ ] **Step 5: Run every check**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed.

- [ ] **Step 6: Commit**

```bash
git add master-ai-web/src
git commit -m "feat(web): Glow shell with case search, New request and live case updates"
```

### Task 4: The signup wizard and the animated install preview

The signup wizard has three steps:
1. Five sector cards, with a warm ring on the one selected.
2. The ready-made organization types in that sector, or "Something else" in the person's own words.
3. The account.

The install preview then shows the 8 stages animating in, named for the organization, with its case types, approval roles, agents and records. This task is UI only; it is verified by build here and by Task 10's signup test.

**Files:**
- Modify (replace): `master-ai-web/src/routes/auth.tsx`, `master-ai-web/src/routes/onboarding.tsx`
- Create: `master-ai-web/src/components/stages-preview.tsx`
- Modify: `master-ai-web/src/index.css` (`.select-card`)

**Interfaces:**
- Consumes: `SECTORS`, `ORG_TYPES`, `SectorId` (schemas); `api.auth.signup/login`, `api.onboarding.preview/install`; `PackSummary`.
- Produces: `AuthLayout({ title, lead?, subtitle, wide?, children })`, `LoginPage`, `SignupPage`, `StagesPreview({ names, caseLabel })`, `OnboardingPage`.

- [ ] **Step 1: The selectable card style**

Append to `master-ai-web/src/index.css`, before the live-stage section:

```css
/* A choice card (sectors, organization types): glass at rest, a warm ring and lift when chosen. */
.select-card {
  background: linear-gradient(180deg, var(--oh-line5), transparent 140%), var(--oh-surface);
  box-shadow:
    inset 0 0 0 1px var(--oh-line10),
    inset 0 1px 0 var(--oh-line10);
  transition:
    transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.3s,
    background-color 0.3s;
}
.select-card:hover {
  background-color: var(--oh-line5);
}
.select-card[aria-checked='true'] {
  transform: translateY(-6px);
  background:
    radial-gradient(90% 58% at 50% 0%, color-mix(in oklab, var(--oh-glow) 30%, transparent), transparent 72%),
    var(--oh-surface);
  box-shadow:
    inset 0 0 0 1px var(--oh-glow),
    inset 0 1px 0 color-mix(in oklab, var(--oh-warning) 40%, transparent),
    0 26px 60px -26px color-mix(in oklab, var(--oh-glow) 80%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .select-card,
  .select-card[aria-checked='true'] {
    transform: none;
    transition: none;
  }
}
```

- [ ] **Step 2: Sign-in and the signup wizard**

Replace `master-ai-web/src/routes/auth.tsx` with:

```tsx
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Cpu, HeartPulse, Landmark, Sparkles, Truck, Zap, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { ORG_TYPES, SECTORS, type SectorId } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AuthLayout({ title, lead, subtitle, wide, children }: { title: string; lead?: string; subtitle: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="page-glow relative flex min-h-full justify-center overflow-hidden px-4 py-10 sm:py-14">
      <div className="dots-floor pointer-events-none absolute inset-x-0 bottom-0 h-64" aria-hidden />
      <div className={cn('relative w-full', wide ? 'max-w-5xl' : 'max-w-md')}>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <p className="font-display text-sm font-medium tracking-[0.09em] text-fg">ONEHUMAN OS</p>
        </div>
        <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} className={cn('mt-10', wide && 'text-center')}>
          <h1 className="font-display text-4xl leading-[1.05] font-light tracking-tight text-fg sm:text-5xl">
            {lead && <span className="block text-fg-lead">{lead}</span>}
            <span className="block">{title}</span>
          </h1>
          <p className={cn('mt-4 text-base font-light text-fg-body', wide && 'mx-auto max-w-xl')}>{subtitle}</p>
        </motion.div>
        <div className="mt-10">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate(auth.tenant.onboarded ? '/' : '/onboarding');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthLayout lead="Welcome back." title="Your agents kept working." subtitle="Sign in to see what needs you.">
      <form onSubmit={submit} className="glass space-y-4 rounded-lg p-6">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={login.error} />
        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-lead">
        New here?{' '}
        <Link to="/signup" className="font-medium text-fg underline decoration-line-20 underline-offset-4 hover:decoration-fg">
          Set up your organization
        </Link>
      </p>
    </AuthLayout>
  );
}

const SECTOR_ICONS: Record<SectorId, LucideIcon> = {
  'energy-heavy-industry': Zap,
  'trade-logistics-tourism': Truck,
  'finance-development': Landmark,
  'technology-innovation': Cpu,
  'public-services': HeartPulse,
};
const STEPS = ['Organization type', 'Your organization', 'Account'] as const;
const OTHER = 'other';
const step = { initial: { opacity: 0, y: 25 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } as const;

function StepIndicator({ at }: { at: number }) {
  return (
    <ol className="mb-10 flex flex-wrap items-center justify-center gap-y-3" aria-label="Signup steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center" aria-current={i === at ? 'step' : undefined}>
          {i > 0 && <span className={cn('mx-3 h-px w-8 sm:w-20', i <= at ? 'bg-glow' : 'border-t border-dashed border-line-20')} aria-hidden />}
          <span
            className={cn(
              'grid size-7 place-items-center rounded-sm text-xs font-semibold tabular-nums',
              i === at ? 'btn-action' : i < at ? 'bg-success-soft text-success' : 'text-fg-lead outline-1 outline-line-20 outline-dashed',
            )}
          >
            {i < at ? <Check className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn('ml-2 text-sm max-sm:sr-only', i === at ? 'text-fg' : 'text-fg-muted')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function SignupPage() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  const [at, setAt] = useState(0);
  const [sector, setSector] = useState<SectorId | null>(null);
  const [orgType, setOrgType] = useState<string | null>(null);
  const [ownWords, setOwnWords] = useState('');
  const [form, setForm] = useState({ companyName: '', ownerName: '', email: '', password: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const signup = useMutation({
    mutationFn: () =>
      api.auth.signup({ ...form, sector: sector!, orgType: orgType === OTHER ? ownWords.trim() : orgType!, ...(orgType === OTHER && { industry: ownWords.trim() }) }),
    onSuccess: (auth) => {
      signIn(auth);
      navigate('/onboarding');
    },
  });
  const typeReady = !!orgType && (orgType !== OTHER || ownWords.trim().length >= 2);

  return (
    <AuthLayout wide lead="Tell us what you run." title="Every stage gets your words." subtitle="Pick your kind of organization. Your requests, approvals and reports are set up the way your sector works.">
      <StepIndicator at={at} />
      <AnimatePresence mode="wait">
        {at === 0 && (
          <motion.div key="sector" {...step}>
            <div role="radiogroup" aria-label="Sector" className="grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-5">
              {SECTORS.map((s) => {
                const Icon = SECTOR_ICONS[s.id];
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={sector === s.id} onClick={() => setSector(s.id)} className="select-card flex min-h-48 flex-col items-start rounded-lg p-5 text-left">
                    <span className="grid size-11 place-items-center rounded-md bg-node text-accent">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="mt-8 font-display text-lg leading-tight text-fg">{s.name}</span>
                    <span className="mt-2 text-sm text-fg-lead">{s.examples}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-10 flex justify-center">
              <Button size="lg" disabled={!sector} onClick={() => (setOrgType(null), setAt(1))}>
                Continue
              </Button>
            </div>
          </motion.div>
        )}
        {at === 1 && sector && (
          <motion.div key="type" {...step}>
            <div role="radiogroup" aria-label="Type of organization" className="mx-auto grid max-w-4xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
              {ORG_TYPES.filter((t) => t.sector === sector).map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={orgType === t.id} onClick={() => setOrgType(t.id)} className="select-card min-h-28 rounded-lg p-5 text-left">
                  <span className="font-display text-lg leading-tight text-fg">{t.name}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={orgType === OTHER} onClick={() => setOrgType(OTHER)} className="select-card min-h-28 rounded-lg p-5 text-left">
                <span className="flex items-center gap-2 font-display text-lg leading-tight text-fg">
                  <Sparkles className="size-4 text-accent" aria-hidden /> Something else
                </span>
                <span className="mt-2 block text-sm text-fg-lead">Describe it in your own words</span>
              </button>
            </div>
            {orgType === OTHER && (
              <div className="mx-auto mt-6 max-w-md text-left">
                <Field label="What does your organization do?" htmlFor="own-words" hint="For example: “Insurance broker in Pune”.">
                  <Input id="own-words" value={ownWords} onChange={(e) => setOwnWords(e.target.value)} autoFocus />
                </Field>
              </div>
            )}
            <div className="mt-10 flex justify-center gap-3">
              <Button variant="ghost" size="lg" onClick={() => setAt(0)}>
                Back
              </Button>
              <Button size="lg" disabled={!typeReady} onClick={() => setAt(2)}>
                Continue
              </Button>
            </div>
          </motion.div>
        )}
        {at === 2 && (
          <motion.form
            key="account"
            {...step}
            className="glass mx-auto max-w-md space-y-4 rounded-lg p-6 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              signup.mutate();
            }}
          >
            <Field label="Organization name" htmlFor="company">
              <Input id="company" value={form.companyName} onChange={set('companyName')} required minLength={2} />
            </Field>
            <Field label="Your name" htmlFor="owner">
              <Input id="owner" autoComplete="name" value={form.ownerName} onChange={set('ownerName')} required />
            </Field>
            <Field label="Email" htmlFor="signup-email">
              <Input id="signup-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
              <Input id="signup-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
            </Field>
            <ErrorNote error={signup.error} />
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setAt(1)}>
                Back
              </Button>
              <Button type="submit" className="flex-1" loading={signup.isPending}>
                Create my organization
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      <p className="mt-8 text-center text-sm text-fg-lead">
        Already set up?{' '}
        <Link to="/login" className="font-medium text-fg underline decoration-line-20 underline-offset-4 hover:decoration-fg">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
```

`routes/invite.tsx` keeps working with the new `AuthLayout` signature (it uses its own layout).

- [ ] **Step 3: The stages preview**

Create `master-ai-web/src/components/stages-preview.tsx`:

```tsx
import { motion } from 'motion/react';

/** The 8 stages, named for the organization, rising in one after another. */
export function StagesPreview({ names, caseLabel }: { names: string[]; caseLabel: string }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={`The 8 stages of every ${caseLabel.toLowerCase()}`}>
      {names.map((name, i) => (
        <motion.li
          key={`${i}-${name}`}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
          className="glass flex items-center gap-3 rounded-md p-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-node font-display text-sm text-fg tabular-nums">{i + 1}</span>
          <span className="text-sm font-medium text-fg">{name}</span>
        </motion.li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: The install preview**

Replace `master-ai-web/src/routes/onboarding.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import type { PackDraft } from '@onehuman/schemas';
import { PackSummary } from '@/components/pack-summary';
import { StagesPreview } from '@/components/stages-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { GENERIC_STAGE_NAMES, stageNames } from '@/lib/cases';
import { useSession } from '@/lib/session';

/**
 * The platform adapts to the organization: it picks a ready-made setup or
 * composes one, shows exactly what it will set up (the 8 stages in the
 * organization's own words first), and installs it on approval.
 */
export function OnboardingPage() {
  const tenant = useSession((s) => s.tenant);
  const setTenant = useSession((s) => s.setTenant);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [industry, setIndustry] = useState(tenant?.industry ?? '');
  const [sampleData, setSampleData] = useState(true);
  const [draft, setDraft] = useState<PackDraft | null>(null);

  const preview = useMutation({
    mutationFn: (opts: { industry?: string; forceGenerate?: boolean }) => api.onboarding.preview(opts),
    onSuccess: setDraft,
  });
  const install = useMutation({
    mutationFn: () => api.onboarding.install({ draftId: draft!.id, sampleData }),
    onSuccess: async () => {
      setTenant(await api.tenant.get());
      await queryClient.invalidateQueries();
      navigate('/');
    },
  });

  // Draft once on arrival, from the organization type chosen at signup.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    preview.mutate({});
  }, [preview]);

  const lc = draft?.pack.lifecycle;
  const names = Object.values(stageNames(lc));
  const caseLabel = lc?.case.label ?? 'Case';
  const approvers = (lc?.roles ?? []).filter((r) => r.id !== 'owner');

  return (
    <div className="page-glow min-h-full">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
          <p className="text-sm font-medium text-warning">Last step</p>
          <h1 className="mt-2 font-display text-4xl leading-[1.05] font-light text-fg sm:text-5xl">
            <span className="block text-fg-lead">Your organization,</span>
            <span className="block">ready to run.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base font-light text-fg-body">
            This is set up for <span className="text-fg">{draft?.industry ?? tenant?.industry}</span>. Nothing runs until you install it, and every risky step still needs the right person's approval.
          </p>
        </motion.div>

        <form
          className="mt-6 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            preview.mutate({ industry });
          }}
        >
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="max-w-md" aria-label="Describe your organization" />
          <Button type="submit" variant="secondary" loading={preview.isPending && !preview.variables?.forceGenerate}>
            <RefreshCw /> Adapt to this
          </Button>
        </form>

        <ErrorNote error={preview.error} className="mt-4" />
        {preview.isPending && <Spinner label="Setting up your organization…" />}

        {draft && !preview.isPending && (
          <div className="mt-10 space-y-10">
            <section>
              <h2 className="font-display text-2xl font-light text-fg">
                <span className="text-fg-lead">Every request becomes a</span> {caseLabel.toLowerCase()}.
              </h2>
              <p className="mt-2 text-sm text-fg-lead">It runs these 8 stages, named the way you work.</p>
              <div className="mt-5">
                <StagesPreview names={names.length === 8 ? names : Object.values(GENERIC_STAGE_NAMES)} caseLabel={caseLabel} />
              </div>
            </section>

            {lc && (
              <section className="grid gap-4 md:grid-cols-2">
                <div className="glass rounded-lg p-5">
                  <h3 className="text-base font-medium">Kinds of {lc.case.plural.toLowerCase()}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lc.categories.map((c) => (
                      <Chip key={c.id} tone={c.priority === 'P1' ? 'danger' : 'neutral'}>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="glass rounded-lg p-5">
                  <h3 className="text-base font-medium">Who approves</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {approvers.length === 0 && <li className="text-fg-lead">You approve everything that needs approval.</li>}
                    {approvers.map((r) => (
                      <li key={r.id}>
                        <span className="text-fg">{r.name}</span> <span className="text-fg-lead">· {r.approves}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-fg-muted">Invite these people from Team. Until then, their approvals come to you.</p>
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-light text-fg">{draft.pack.name}</h2>
              <Badge tone={draft.source === 'registry' ? 'success' : 'cool'}>
                {draft.generator === 'registry' ? 'Ready-made' : draft.generator === 'llm' ? 'Designed by AI' : 'Built from your sector'}
              </Badge>
              {draft.source === 'registry' && (
                <Button variant="ghost" size="sm" onClick={() => preview.mutate({ industry: draft.industry, forceGenerate: true })}>
                  <Sparkles /> Design a custom setup instead
                </Button>
              )}
            </div>
            <p className="-mt-6 text-sm text-fg-lead">{draft.rationale}</p>
            <PackSummary pack={draft.pack} />

            <div className="flex flex-wrap items-center gap-4 border-t border-line-10 pt-6">
              <label className="flex items-center gap-2 text-sm text-fg-body">
                <input type="checkbox" checked={sampleData} onChange={(e) => setSampleData(e.target.checked)} className="size-4 accent-[var(--oh-glow)]" />
                Add a few sample records and people so I can try it
              </label>
              <Button size="lg" className="ml-auto" onClick={() => install.mutate()} loading={install.isPending}>
                Install and open Home
              </Button>
            </div>
            <ErrorNote error={install.error} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run every check**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed.

- [ ] **Step 6: Commit**

```bash
git add master-ai-web/src
git commit -m "feat(web): signup wizard by sector and type, and the animated install preview"
```

### Task 5: The Cases list and the public request form

The Cases list is searchable and filterable. Each row shows the number, the title, who asked, chips for priority, department, assignee and due time, and the mini stage bar with the stage named in words. The top-bar search lands here (`?q=`). The public request form at `/r/:tenantId/:key` lets a customer raise a request without an account.

**Files:**
- Modify: `master-ai-web/src/lib/cases.ts`, `master-ai-web/src/lib/cases.test.ts` (`dueWords`)
- Create: `master-ai-web/src/routes/cases.tsx`, `master-ai-web/src/routes/public-form.tsx`
- Modify: `master-ai-web/src/main.tsx` (routes)

**Interfaces:**
- Consumes: `caseMatches`, `CaseFilters`, `dotsFromCase`, `stageNames`, `statusWords`, `priorityTone`, `FINAL_STATUSES`, `WAITING_ON_PEOPLE` (Task 2); `StageDots`, `Chip`, `PageHeader` (Task 2); `useNewRequest` (Task 3); `AuthLayout` (Task 4); `api.cases.list('all')`, `api.intake.form/submitForm`.
- Produces: `dueWords(resolveBy, now): { text: string; late: boolean } | null`; `CasesPage`; `PublicFormPage`; the routes `/cases` and `/r/:tenantId/:key`.

- [ ] **Step 1: Write the failing test**

Add `dueWords` to the import in `master-ai-web/src/lib/cases.test.ts` and append:

```ts
describe('due times in words', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('says how long is left, or how late it is', () => {
    expect(dueWords('2026-10-13T20:00:00Z', now)).toEqual({ text: 'Due in 10 hours', late: false });
    expect(dueWords('2026-10-13T10:20:00Z', now)).toEqual({ text: 'Due in less than an hour', late: false });
    expect(dueWords('2026-10-11T10:00:00Z', now)).toEqual({ text: 'Overdue by 2 days', late: true });
    expect(dueWords(null, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/web exec vitest run src/lib/cases.test.ts`
Expected: FAIL: `dueWords` is not exported.

- [ ] **Step 3: Write `dueWords`**

Append to `master-ai-web/src/lib/cases.ts`:

```ts
/** "Due in 3 hours", "Overdue by 2 days", or null without a deadline. */
export function dueWords(resolveBy: string | null, now: Date): { text: string; late: boolean } | null {
  if (!resolveBy) return null;
  const ms = Date.parse(resolveBy) - now.getTime();
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const span = hours < 1 ? 'less than an hour' : hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
  return ms >= 0 ? { text: `Due in ${span}`, late: false } : { text: `Overdue by ${span}`, late: true };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @onehuman/web exec vitest run`
Expected: PASS (11 tests).

- [ ] **Step 5: The Cases list**

Create `master-ai-web/src/routes/cases.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PRIORITY_IDS, STAGE_KEYS, type Case, type PriorityId, type StageKey } from '@onehuman/schemas';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { caseMatches, dotsFromCase, dueWords, FINAL_STATUSES, priorityTone, stageNames, statusWords, WAITING_ON_PEOPLE, type CaseFilters } from '@/lib/cases';
import { useNewRequest } from '@/lib/new-request';
import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'waiting', label: 'Waiting on people' },
  { value: 'closed', label: 'Finished' },
  { value: 'all', label: 'All' },
] as const;

function CaseRow({ c, names, now }: { c: Case; names: Record<StageKey, string>; now: Date }) {
  const ended = FINAL_STATUSES.includes(c.status);
  const due = ended ? null : dueWords(c.resolveBy, now);
  return (
    <li>
      <Link
        to={`/cases/${c.id}`}
        className="glass flex flex-col gap-3 rounded-lg p-4 transition-colors duration-300 hover:bg-line-5 sm:flex-row sm:items-center sm:gap-6"
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span className="font-medium tabular-nums">{c.code}</span>
            <span aria-hidden>·</span>
            <span className="max-w-full truncate">{c.requester.name}</span>
            {c.categoryName && (
              <>
                <span aria-hidden>·</span>
                <span>{c.categoryName}</span>
              </>
            )}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-fg [overflow-wrap:anywhere]">{c.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.priority && <Chip tone={priorityTone(c.priority)}>{c.priority}</Chip>}
            {c.department && <Chip>{c.department}</Chip>}
            {c.assignee && <Chip>{c.assignee.name}</Chip>}
            {due && <Chip tone={due.late ? 'danger' : 'neutral'}>{due.text}</Chip>}
          </div>
        </div>
        <div className="shrink-0 sm:w-60">
          <StageDots states={dotsFromCase(c)} names={STAGE_KEYS.map((k) => names[k])} />
          <p className="mt-1.5 text-xs">
            <span className={cn(WAITING_ON_PEOPLE.includes(c.status) ? 'text-warning' : 'text-fg-body')}>{statusWords(c.status)}</span>
            {!ended && <span className="text-fg-muted"> · {names[c.stage]}</span>}
          </p>
        </div>
      </Link>
    </li>
  );
}

/** Every case, searchable by number, title or requester and filterable by stage, priority, status and assignee. */
export function CasesPage() {
  const [params, setParams] = useSearchParams();
  const showNewRequest = useNewRequest((s) => s.show);
  const q = params.get('q') ?? '';
  // A search looks through finished cases too.
  const statusTab = params.get('status') ?? (q ? 'all' : 'open');
  const filters: CaseFilters = {
    q,
    stage: (params.get('stage') ?? '') as StageKey | '',
    priority: (params.get('priority') ?? '') as PriorityId | '',
    status: statusTab === 'all' ? '' : (statusTab as CaseFilters['status']),
    assignee: params.get('assignee') ?? '',
  };
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const cases = useQuery({ queryKey: ['cases', 'all'], queryFn: () => api.cases.list('all') });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const plural = lifecycle?.case.plural ?? 'Cases';
  const shown = (cases.data ?? []).filter((c) => caseMatches(c, filters));
  const now = new Date();

  return (
    <div>
      <PageHeader
        lead={`${plural},`}
        title="from request to report."
        description="Every request runs the same 8 stages. Open one to see where it is and who it waits on."
        action={
          <Button onClick={() => showNewRequest()}>
            <Plus /> New request
          </Button>
        }
      />

      <div className="glass mb-4 flex flex-col gap-3 rounded-lg p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Number, title or who asked" aria-label={`Search ${plural.toLowerCase()}`} className="pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <Select aria-label="Stage" value={filters.stage} onChange={(e) => set('stage', e.target.value)}>
            <option value="">Every stage</option>
            {STAGE_KEYS.map((k, i) => (
              <option key={k} value={k}>
                {i + 1}. {names[k]}
              </option>
            ))}
          </Select>
          <Select aria-label="Priority" value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_IDS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Input aria-label="Assigned to" placeholder="Assigned to" value={filters.assignee} onChange={(e) => set('assignee', e.target.value)} className="col-span-2 sm:col-span-1 lg:w-44" />
        </div>
      </div>

      <div role="tablist" aria-label="Status" className="mb-5 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={statusTab === t.value}
            onClick={() => set('status', t.value)}
            className={cn(
              'h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11',
              statusTab === t.value ? 'nav-active text-fg' : 'text-fg-muted hover:bg-line-5 hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorNote error={cases.error} className="mb-4" />
      {cases.isLoading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={q ? `Nothing matches “${q}”` : `No ${plural.toLowerCase()} here`}>
          Requests from your team, your customers' form and your systems all land here.
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label={plural}>
          {shown.map((c) => (
            <CaseRow key={c.id} c={c} names={names} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: The public request form**

Create `master-ai-web/src/routes/public-form.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { AuthLayout } from '@/routes/auth';

const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

/** The public request form: a customer raises a request without an account. */
export function PublicFormPage() {
  const { tenantId = '', key = '' } = useParams();
  const form = useQuery({ queryKey: ['public-form', tenantId, key], queryFn: () => api.intake.form(tenantId, key), retry: false });
  const [fields, setFields] = useState({ name: '', phone: '', email: '', text: '' });
  const set = (k: keyof typeof fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const send = useMutation({
    mutationFn: () =>
      api.intake.submitForm(tenantId, key, {
        name: fields.name,
        text: fields.text,
        ...(fields.phone.trim() && { phone: fields.phone.trim() }),
        ...(fields.email.trim() && { email: fields.email.trim() }),
      }),
  });

  if (form.isPending) return <Spinner label="Opening the form…" />;
  if (form.error || !form.data) {
    return (
      <AuthLayout lead="This link" title="doesn't work any more." subtitle="Ask the organization for a new one.">
        <ErrorNote error={form.error} />
      </AuthLayout>
    );
  }
  const { companyName, caseLabel } = form.data;
  const noun = caseLabel.toLowerCase();

  if (send.data) {
    return (
      <AuthLayout lead="Thank you." title="We have your request." subtitle={`${companyName} will contact you. Keep this reference.`}>
        <div className="glass flex items-center gap-4 rounded-lg p-5" role="status">
          <CheckCircle2 className="size-7 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-sm text-fg-lead">Your reference</p>
            <p className="font-display text-2xl text-fg tabular-nums">{send.data.code}</p>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const reachable = !!fields.phone.trim() || !!fields.email.trim();
  return (
    <AuthLayout lead={companyName} title={`Raise ${withArticle(noun)}.`} subtitle="Tell us what you need. We reply on the phone number or email you give.">
      <form
        className="glass space-y-4 rounded-lg p-6"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label="Your name" htmlFor="pf-name">
          <Input id="pf-name" autoComplete="name" value={fields.name} onChange={set('name')} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="pf-phone">
            <Input id="pf-phone" type="tel" autoComplete="tel" value={fields.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" htmlFor="pf-email">
            <Input id="pf-email" type="email" autoComplete="email" value={fields.email} onChange={set('email')} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-fg-muted">A phone number or an email, so we can reach you.</p>
        <Field label="What do you need?" htmlFor="pf-text">
          <Textarea id="pf-text" rows={5} value={fields.text} onChange={set('text')} required minLength={3} maxLength={4000} />
        </Field>
        <ErrorNote error={send.error} />
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!reachable}>
          Send {noun}
        </Button>
      </form>
    </AuthLayout>
  );
}
```

- [ ] **Step 7: The routes**

In `master-ai-web/src/main.tsx`, import `CasesPage` and `PublicFormPage`, add `{ path: 'cases', element: <CasesPage /> }` inside the app shell's children (after the index route), and add the public form next to the invite route, outside the session guard:

```tsx
  { path: '/invite/:tenantId/:token', element: <InvitePage /> },
  { path: '/r/:tenantId/:key', element: <PublicFormPage /> },
```

- [ ] **Step 8: Run every check**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed; 11 web tests.

- [ ] **Step 9: Commit**

```bash
git add master-ai-web/src
git commit -m "feat(web): the Cases list with search and filters, and the public request form"
```

### Task 6: The Case page

The page shows one case through its 8 stages:
- **The canvas:** the stages in two rows of four, named for the organization. Green ones are done. The stage the case is in glows: a light sweep while agents work, a warm halo while it waits on a person. Edges ahead are dashed, and the person it waits on hangs under that stage.
- **The case file:** each stage's findings as sentences, never keys or JSON.
- **The waiting banner:** approve or sign off inline (role holders), or add the missing details.
- **Below the file:** the stage-6 work and the stage-8 report.

Below `lg`, the canvas gives way to the stage dots, because 8 nodes can't stay legible at that width.

The case file becomes sentences through a helper in `@onehuman/sdk`, so the mobile app (Plan 6) shows the same words.

**Files:**
- Create: `packages/sdk/src/case-file.ts`, `packages/sdk/src/case-file.test.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `master-ai-web/src/index.css` (canvas edges, warm halo)
- Create: `master-ai-web/src/components/case-canvas.tsx`, `master-ai-web/src/components/case-file.tsx`, `master-ai-web/src/components/case-report.tsx`, `master-ai-web/src/routes/case.tsx`
- Modify: `master-ai-web/src/main.tsx` (route)

**Interfaces:**
- Consumes: `dotsFromStages`, `dotLabel`, `DotState`, `stageNames`, `statusWords`, `priorityTone`, `dueWords`, `FINAL_STATUSES` (Tasks 2, 5); `Chip`, `StageDots`, `Dialog` (Tasks 2–3); `GoalReportCard`, `CopyReportButton` (`components/goal-report.tsx`); `signDecision` (`lib/device-key.ts`); `api.cases.get/addInfo/cancel`, `api.approvals.list('pending', { mine: true })`, `api.approvals.decide`.
- Produces: `caseFileLines(file: CaseFile, words?: { roleName?: (id: string) => string; when?: (iso: string) => string }): Partial<Record<StageKey, string[]>>` (sdk); `CaseCanvas({ states, names, person, selected, onSelect })`, `type CasePerson { stage; name; doing; waiting }`; `CaseTimeline({ rows, states, lines, requestText?, selected })`; `CaseReportCard({ report, linked? })`; `CasePage`; route `/cases/:id`. DOM hooks for the browser tests: canvas squares carry `data-stage` and `data-stage-state`; timeline items carry `data-timeline-stage` and `data-stage-state`.

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/case-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CaseFile } from '@onehuman/schemas';
import { caseFileLines } from './case-file';

const when = (iso: string) => iso.slice(0, 10);
const roleName = (id: string) => ({ 'safety-officer': 'the safety officer', owner: 'the owner' })[id] ?? 'the right person';

const file: CaseFile = {
  request: {
    title: 'Hot work permit',
    summary: 'Welding of chute liner plates at Conveyor 3B tomorrow.',
    requester: { name: 'Shree Fabricators' },
    source: 'partner',
    receivedAt: '2026-10-13T04:30:00Z',
    text: 'M/s Shree Fabricators: we will start welding tomorrow.',
    amountInr: 45000,
  },
  review: {
    outcome: 'needs_info',
    provisionalCategory: null,
    checks: [
      { name: 'Place given', ok: true },
      { name: 'Crew size', ok: false, note: 'not stated' },
    ],
    missing: [{ key: 'area', label: 'which area' }],
    toConfirm: ['Fire watch arranged'],
  },
  classify: {
    category: 'high-risk-permit',
    categoryName: 'High-risk permit',
    priority: 'P2',
    risk: 'high',
    department: 'Safety',
    amountInr: null,
    respondBy: '2026-10-13T08:30:00Z',
    resolveBy: '2026-10-14T04:30:00Z',
    reasons: ['Welding is hot work.'],
  },
  assign: { assignee: { name: 'Suresh', title: 'Shift engineer' }, team: 'Maintenance', deadline: '2026-10-14T04:30:00Z', reason: 'Suresh runs the conveyor area.' },
  approve: { required: true, approverRole: 'safety-officer', decision: 'approved', decidedBy: 'Sunita', notes: 'Permit HW-118 issued' },
  execute: { goalId: 'g1', status: 'completed', summary: 'Permit issued and the crew briefed.', costInr: 0, evidence: ['Permit HW-118 sent to the contractor.'] },
  close: { verified: true, findings: ['Area inspected after work.'], signoff: { required: true, role: 'safety-officer', decision: 'approved', by: 'Sunita' }, outcome: 'resolved' },
  report: { text: 'HW-0007 closed in 1 day.', slaMet: true, minutesPerStage: [], recurring: { count: 3, note: 'Third hot-work request at Conveyor 3B this month.' } },
};

describe('the case file in words', () => {
  const lines = caseFileLines(file, { when, roleName });

  it('says who asked, from where, and what they asked', () => {
    expect(lines.request).toEqual(['Shree Fabricators, from a partner, on 2026-10-13.', 'Welding of chute liner plates at Conveyor 3B tomorrow.', 'Amount given: ₹45,000.']);
  });

  it('says what is missing and what a person must confirm', () => {
    expect(lines.review).toEqual(['Needs: which area.', 'Checked: Place given.', 'Not yet: Crew size (not stated).', 'A person confirms: Fire watch arranged.']);
  });

  it('names the type, deadlines, assignee, approver, sign-off and report in sentences', () => {
    expect(lines.classify?.slice(0, 2)).toEqual(['High-risk permit, P2, high risk, for Safety.', 'Respond by 2026-10-13; resolve by 2026-10-14.']);
    expect(lines.assign?.[0]).toBe('Assigned to Suresh, Shift engineer (Maintenance).');
    expect(lines.approve).toEqual(['Approved by Sunita.', 'Note: Permit HW-118 issued']);
    expect(lines.close).toEqual(['Checked and resolved.', 'Area inspected after work.', 'Signed off by Sunita.']);
    expect(lines.report).toEqual(['HW-0007 closed in 1 day.', 'Finished within the deadline.', 'Third hot-work request at Conveyor 3B this month.']);
  });

  it('uses the role name when no person is named, and never shows keys or JSON', () => {
    const late = caseFileLines({ approve: { required: true, approverRole: 'safety-officer', decision: 'rejected' } }, { when, roleName });
    expect(late.approve).toEqual(['Rejected by the safety officer.']);
    const all = Object.values(lines).flat().join('\n');
    expect(all).not.toMatch(/[{}[\]]|goalId|high-risk-permit|safety-officer/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/sdk exec vitest run src/case-file.test.ts`
Expected: FAIL: cannot find `./case-file`.

- [ ] **Step 3: Write `caseFileLines`**

Create `packages/sdk/src/case-file.ts`:

```ts
import type { CaseFile, CaseSource, StageKey } from '@onehuman/schemas';

const FROM: Record<CaseSource, string> = {
  owner: 'raised by the owner',
  staff: 'raised by the team',
  customer: 'from a customer',
  system: 'from a connected system',
  partner: 'from a partner',
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const defaultWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const stripStop = (s: string) => s.replace(/[.\s]+$/, '');

export interface CaseFileWords {
  /** A lifecycle role id (or "owner") as people say it, e.g. "the safety officer". */
  roleName?: (id: string) => string;
  /** How a date and time reads. */
  when?: (iso: string) => string;
}

/**
 * Each stage's findings as plain sentences for the case page. People never
 * see the case file's keys, ids or JSON.
 */
export function caseFileLines(file: CaseFile, words: CaseFileWords = {}): Partial<Record<StageKey, string[]>> {
  const role = words.roleName ?? ((id: string) => (id === 'owner' ? 'the owner' : 'the right person'));
  const when = words.when ?? defaultWhen;
  const out: Partial<Record<StageKey, string[]>> = {};
  const { request, review, classify, assign, approve, execute, close, report } = file;

  if (request) {
    out.request = [
      `${request.requester.name}, ${FROM[request.source]}, on ${when(request.receivedAt)}.`,
      request.summary,
      ...(request.amountInr !== undefined ? [`Amount given: ${inr.format(request.amountInr)}.`] : []),
    ];
  }
  if (review) {
    const lines: string[] = [];
    if (review.outcome === 'complete') lines.push('Everything needed is there.');
    if (review.outcome === 'needs_info') lines.push(`Needs: ${review.missing.map((m) => m.label).join(', ')}.`);
    if (review.outcome === 'not_eligible') lines.push(`Not eligible: ${stripStop(review.reason ?? 'outside what this organization does')}.`);
    for (const c of review.checks) lines.push(`${c.ok ? 'Checked' : 'Not yet'}: ${c.name}${c.note ? ` (${c.note})` : ''}.`);
    if (review.toConfirm.length > 0) lines.push(`A person confirms: ${review.toConfirm.join(', ')}.`);
    out.review = lines;
  }
  if (classify) {
    out.classify = [
      `${classify.categoryName}, ${classify.priority}, ${classify.risk} risk, for ${classify.department}.`,
      `Respond by ${when(classify.respondBy)}; resolve by ${when(classify.resolveBy)}.`,
      ...(classify.amountInr !== null ? [`Amount: ${inr.format(classify.amountInr)}.`] : []),
      ...classify.reasons,
    ];
  }
  if (assign) {
    const who = assign.assignee ? `${assign.assignee.name}${assign.assignee.title ? `, ${assign.assignee.title}` : ''} (${assign.team})` : `the ${assign.team} team`;
    out.assign = [`Assigned to ${who}.`, `Due ${when(assign.deadline)}.`, assign.reason];
  }
  if (approve) {
    const who = approve.decidedBy ?? (approve.approverRole ? role(approve.approverRole) : 'a person');
    const decision = {
      not_required: 'No approval needed.',
      approved: `Approved by ${who}.`,
      rejected: `Rejected by ${who}.`,
      expired: 'Nobody decided in time, so it stopped.',
      blocked: 'Your rules do not allow this.',
    }[approve.decision];
    out.approve = [decision, ...(approve.notes ? [`Note: ${approve.notes}`] : [])];
  }
  if (execute) {
    out.execute = [execute.summary, ...execute.evidence, ...(execute.costInr > 0 ? [`AI cost: ${inr.format(execute.costInr)}.`] : [])];
  }
  if (close) {
    const s = close.signoff;
    const by = s.by ?? (s.role ? role(s.role) : 'a person');
    const signoff = !s.required
      ? []
      : s.decision === 'approved'
        ? [`Signed off by ${by}.`]
        : s.decision === 'rejected'
          ? [`Sign-off refused by ${by}.`]
          : s.decision === 'expired'
            ? ['Nobody signed off in time.']
            : [`Waiting for ${by} to sign off.`];
    out.close = [close.outcome === 'resolved' ? 'Checked and resolved.' : 'Checked: not resolved.', ...close.findings, ...signoff];
  }
  if (report) {
    out.report = [
      report.text,
      ...(report.slaMet === true ? ['Finished within the deadline.'] : report.slaMet === false ? ['Missed the deadline.'] : []),
      ...(report.recurring ? [report.recurring.note] : []),
    ];
  }
  return out;
}
```

In `packages/sdk/src/index.ts`, add `export * from './case-file';` after `./report`.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @onehuman/sdk exec vitest run && pnpm --filter @onehuman/sdk build`
Expected: PASS (the 4 new tests and every existing sdk test); the build writes `dist/`.

- [ ] **Step 5: Canvas edges and the warm halo**

Append to `master-ai-web/src/index.css`:

```css
/* The case canvas: green behind, a warm flow into the stage the case is in, dashed ahead. */
.react-flow__edge.edge-done .react-flow__edge-path {
  stroke: color-mix(in oklab, var(--oh-success) 75%, transparent);
}
.react-flow__edge.edge-live .react-flow__edge-path {
  stroke: var(--oh-glow);
  stroke-width: 2.5;
  stroke-dasharray: 0.5 11.5;
  stroke-linecap: round;
  animation: oh-flow 1.1s linear infinite;
}
.react-flow__edge.edge-todo .react-flow__edge-path {
  stroke: var(--oh-line20);
  stroke-dasharray: 4 6;
}
/* A stage waiting on a person pulses warm instead of agent-violet. */
.live-halo-warm {
  box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--oh-warning) 70%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .react-flow__edge.edge-live .react-flow__edge-path {
    animation: none !important;
  }
}
```

- [ ] **Step 6: The 8-stage canvas**

Create `master-ai-web/src/components/case-canvas.tsx`:

```tsx
import { useMemo } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, UserRound, X } from 'lucide-react';
import { STAGE_KEYS, type StageKey } from '@onehuman/schemas';
import { dotLabel, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

/** Someone the case waits on (an approver, the requester), or who is doing the work. */
export interface CasePerson {
  stage: StageKey;
  name: string;
  doing: string;
  waiting: boolean;
}

interface StageData extends Record<string, unknown> {
  stage: StageKey;
  n: number;
  name: string;
  state: DotState;
  selected: boolean;
  person: CasePerson | null;
}

const GAP_X = 190;
const ROW_Y = 236;
/** Everything drawn, labels included, so fitView keeps the labels in view. */
const FRAME = { x: -48, y: -24, w: 3 * GAP_X + 76 + 96, h: ROW_Y + 76 + 170 };

const LABEL_TONE: Record<DotState, string> = {
  done: 'text-success',
  live: 'text-fg-body',
  waiting: 'text-warning',
  todo: 'text-fg-muted',
  skipped: 'text-fg-muted',
  stopped: 'text-danger',
};

const RING: Record<DotState, string> = {
  done: 'shadow-[inset_0_0_0_1.5px_var(--oh-success)]',
  live: 'shadow-[inset_0_0_0_1.5px_var(--oh-glow)]',
  waiting: 'shadow-[inset_0_0_0_1.5px_var(--oh-warning)]',
  todo: 'outline-1 -outline-offset-1 outline-dashed outline-line-20',
  skipped: 'shadow-[inset_0_0_0_1px_var(--oh-line10)]',
  stopped: 'shadow-[inset_0_0_0_1.5px_var(--oh-danger)]',
};

function StageNode({ data }: NodeProps<Node<StageData, 'stage'>>) {
  const { stage, n, name, state, selected, person } = data;
  return (
    <div
      data-stage={stage}
      data-stage-state={state}
      className={cn(
        'relative size-[76px] rounded-lg bg-node',
        state === 'live' && 'live-node',
        state === 'skipped' && 'opacity-60',
        selected && 'outline-2 outline-offset-4 outline-accent',
      )}
    >
      {state === 'live' && (
        <span className="absolute inset-0 overflow-hidden rounded-lg" aria-hidden>
          <span className="live-spin" />
          <span className="absolute inset-[1.5px] rounded-[10.5px] bg-node" />
        </span>
      )}
      {(state === 'live' || state === 'waiting') && <span className={cn('live-halo', state === 'waiting' && 'live-halo-warm')} aria-hidden />}
      <span className={cn('absolute inset-0 rounded-lg', RING[state])} aria-hidden />
      <span className={cn('relative grid size-full place-items-center font-display text-2xl tabular-nums', state === 'todo' || state === 'skipped' ? 'text-fg-muted' : 'text-fg')}>
        {n}
      </span>
      {state === 'done' && (
        <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-success-soft text-success shadow-[inset_0_0_0_1px_var(--oh-success)]">
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )}
      {state === 'stopped' && (
        <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-danger-soft text-danger shadow-[inset_0_0_0_1px_var(--oh-danger)]">
          <X className="size-3" strokeWidth={3} aria-hidden />
        </span>
      )}
      {/* Ports, as on n8n nodes: green once the stage is done. */}
      <span className={cn('absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full', state === 'done' ? 'bg-success' : 'bg-line-20')} aria-hidden />
      <span className={cn('absolute top-1/2 -right-1 size-2 -translate-y-1/2 rounded-full', state === 'done' ? 'bg-success' : 'bg-line-20')} aria-hidden />
      <Handle id="l-in" type="target" position={Position.Left} />
      <Handle id="r-out" type="source" position={Position.Right} />
      <Handle id="r-in" type="target" position={Position.Right} />
      <Handle id="l-out" type="source" position={Position.Left} />
      <div className="absolute top-full left-1/2 mt-3 w-[150px] -translate-x-1/2 text-center">
        <p className="line-clamp-2 text-sm leading-tight font-medium text-fg">{name}</p>
        <p className={cn('mt-1 text-xs', LABEL_TONE[state])}>{dotLabel(state)}</p>
        {person && (
          <div className="glass-warm mt-2.5 flex items-center gap-2 rounded-md p-2 text-left" data-person>
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-warning-soft text-warning', person.waiting && 'pulse-dot')}>
              <UserRound className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-fg">{person.name}</span>
              <span className="block truncate text-xs text-fg-lead">{person.doing}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FrameNode() {
  return <div style={{ width: FRAME.w, height: FRAME.h }} aria-hidden />;
}

const nodeTypes = { stage: StageNode, frame: FrameNode };
const behind = (s: DotState | undefined) => s === 'done' || s === 'skipped';

/**
 * The 8 stages in two rows of four: 1–4 left to right, then 5–8 right to left
 * under them, so every name stays readable without zooming out.
 */
export function CaseCanvas({
  states,
  names,
  person,
  selected,
  onSelect,
}: {
  states: DotState[];
  names: string[];
  person: CasePerson | null;
  selected: StageKey | null;
  onSelect: (stage: StageKey) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      { id: 'frame', type: 'frame', position: { x: FRAME.x, y: FRAME.y }, data: {}, selectable: false, focusable: false, style: { pointerEvents: 'none' } },
    ];
    STAGE_KEYS.forEach((stage, i) => {
      const x = i < 4 ? i * GAP_X : (7 - i) * GAP_X;
      const data: StageData = { stage, n: i + 1, name: names[i] ?? stage, state: states[i] ?? 'todo', selected: selected === stage, person: person?.stage === stage ? person : null };
      nodes.push({ id: stage, type: 'stage', position: { x, y: i < 4 ? 0 : ROW_Y }, data });
    });
    const edges: Edge[] = STAGE_KEYS.slice(1).map((target, j) => {
      const source = STAGE_KEYS[j]!;
      const from = states[j];
      const to = states[j + 1];
      const className = behind(to) ? 'edge-done' : behind(from) && (to === 'live' || to === 'waiting') ? 'edge-live' : 'edge-todo';
      // 4 → 5 turns down on the right; the second row runs right to left.
      if (j === 3) return { id: `${source}-${target}`, source, target, sourceHandle: 'r-out', targetHandle: 'r-in', type: 'smoothstep', pathOptions: { offset: 48, borderRadius: 18 }, className };
      if (j > 3) return { id: `${source}-${target}`, source, target, sourceHandle: 'l-out', targetHandle: 'r-in', type: 'straight', className };
      return { id: `${source}-${target}`, source, target, sourceHandle: 'r-out', targetHandle: 'l-in', type: 'straight', className };
    });
    return { nodes, edges };
  }, [states, names, person, selected]);

  return (
    <div className="glass h-[500px] overflow-hidden rounded-lg" data-testid="case-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.type === 'stage') onSelect(node.id as StageKey);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--oh-canvas-dot)" />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 7: The case file timeline**

Create `master-ai-web/src/components/case-file.tsx`:

```tsx
import type { CaseReport, StageKey } from '@onehuman/schemas';
import { dotLabel, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

const BADGE: Record<DotState, string> = {
  done: 'bg-success-soft text-success',
  live: 'btn-action',
  waiting: 'bg-warning-soft text-warning pulse-dot',
  todo: 'text-fg-muted outline-1 -outline-offset-1 outline-dashed outline-line-20',
  skipped: 'bg-line-5 text-fg-muted',
  stopped: 'bg-danger-soft text-danger',
};
const WORDS: Record<DotState, string> = {
  done: 'text-success',
  live: 'text-fg-body',
  waiting: 'text-warning',
  todo: 'text-fg-muted',
  skipped: 'text-fg-muted',
  stopped: 'text-danger',
};

function took(minutes: number): string {
  return minutes < 60 ? `${Math.max(1, Math.round(minutes))} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
}

/** What each stage found, in sentences. The requester's own words stay text, however long or odd. */
export function CaseTimeline({
  rows,
  states,
  lines,
  requestText,
  selected,
}: {
  rows: CaseReport['stages'];
  states: DotState[];
  lines: Partial<Record<StageKey, string[]>>;
  requestText?: string;
  selected: StageKey | null;
}) {
  return (
    <ol className="mt-5">
      {rows.map((row, i) => {
        const state = states[i] ?? 'todo';
        return (
          <li
            key={row.stage}
            id={`stage-${row.stage}`}
            data-timeline-stage={row.stage}
            data-stage-state={state}
            className={cn('relative pb-6 pl-12 last:pb-0', selected === row.stage && 'rounded-md bg-line-5')}
          >
            <span className={cn('absolute top-0 left-0 grid size-8 place-items-center rounded-sm text-xs font-semibold tabular-nums', BADGE[state])}>{i + 1}</span>
            {i < rows.length - 1 && <span className="absolute top-10 bottom-1 left-4 w-px bg-line-10" aria-hidden />}
            <div className="flex flex-wrap items-baseline gap-x-3 pt-1">
              <h3 className="text-sm font-medium text-fg">{row.name}</h3>
              <span className={cn('text-xs', WORDS[state])}>{dotLabel(state)}</span>
              {row.minutes !== null && state === 'done' && <span className="text-xs text-fg-muted tabular-nums">{took(row.minutes)}</span>}
            </div>
            {row.summary && <p className="mt-1 text-sm text-fg-body [overflow-wrap:anywhere]">{row.summary}</p>}
            {(lines[row.stage] ?? []).length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-fg-lead">
                {lines[row.stage]!.map((line, j) => (
                  <li key={j} className="whitespace-pre-line [overflow-wrap:anywhere]">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {row.stage === 'request' && requestText && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-fg-muted hover:text-fg">Their own words</summary>
                <p className="mt-2 max-h-64 overflow-y-auto rounded-md bg-line-5 p-3 whitespace-pre-line text-fg-body [overflow-wrap:anywhere]" data-testid="request-text">
                  {requestText}
                </p>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 8: The case report card**

Create `master-ai-web/src/components/case-report.tsx`:

```tsx
import { Link } from 'react-router';
import type { CaseReport } from '@onehuman/schemas';
import { CopyReportButton } from '@/components/goal-report';
import { Chip } from '@/components/ui/chip';
import { statusWords } from '@/lib/cases';
import { formatDateTime } from '@/lib/utils';

/** Stage 8's report, in words a client understands. */
export function CaseReportCard({ report, linked }: { report: CaseReport; linked?: boolean }) {
  const text = [`${report.code}: ${report.title}`, report.text, report.outcome].filter(Boolean).join('\n\n');
  return (
    <article className="glass overflow-hidden rounded-lg break-inside-avoid" aria-label={`Report for ${report.code}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted tabular-nums">{report.code}</p>
          <h2 className="font-medium text-fg [overflow-wrap:anywhere]">
            {linked ? (
              <Link to={`/cases/${report.caseId}`} className="hover:underline">
                {report.title}
              </Link>
            ) : (
              report.title
            )}
          </h2>
          <p className="mt-0.5 text-sm text-fg-lead">
            {statusWords(report.status)}
            {report.closedAt ? ` · finished ${formatDateTime(report.closedAt)}` : ` · raised ${formatDateTime(report.createdAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {report.slaMet !== null && <Chip tone={report.slaMet ? 'success' : 'danger'}>{report.slaMet ? 'On time' : 'Late'}</Chip>}
          <CopyReportButton text={text} />
        </div>
      </header>
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="whitespace-pre-line text-fg-body [overflow-wrap:anywhere]">{report.text}</p>
        {report.outcome && <p className="text-fg">{report.outcome}</p>}
        {report.recurring && <p className="text-warning">{report.recurring.note}</p>}
      </div>
    </article>
  );
}
```

- [ ] **Step 9: The Case page**

Create `master-ai-web/src/routes/case.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Send, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { STAGE_KEYS, type ApprovalRequest, type Case, type CaseSource, type StageKey } from '@onehuman/schemas';
import { caseFileLines } from '@onehuman/sdk';
import { CaseCanvas, type CasePerson } from '@/components/case-canvas';
import { CaseTimeline } from '@/components/case-file';
import { CaseReportCard } from '@/components/case-report';
import { GoalReportCard } from '@/components/goal-report';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { dotsFromStages, dueWords, FINAL_STATUSES, priorityTone, stageNames, statusWords } from '@/lib/cases';
import { signDecision } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { formatInr } from '@/lib/utils';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FROM: Record<CaseSource, string> = { owner: 'Raised by the owner', staff: 'Raised by the team', customer: 'From a customer', system: 'From a system', partner: 'From a partner' };

function personFor(c: Case, gate: ApprovalRequest | undefined, roleName: (id: string) => string): CasePerson | null {
  if (gate?.stage) return { stage: gate.stage, name: cap(roleName(gate.approver)), doing: gate.stage === 'close' ? 'Signs off' : 'Approves', waiting: true };
  if (c.status === 'needs_info') return { stage: 'review', name: c.requester.name, doing: 'Adds the missing details', waiting: true };
  if (c.stage === 'execute' && c.assignee && !FINAL_STATUSES.includes(c.status)) return { stage: 'execute', name: c.assignee.name, doing: 'Doing the work', waiting: false };
  return null;
}

/** Approve or sign off right here when it's yours to decide; otherwise say who decides. */
function GateBanner({ gate, canDecide, who, caseId }: { gate: ApprovalRequest; canDecide: boolean; who: string; caseId: string }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const signoff = gate.stage === 'close';
  const decide = useMutation({
    mutationFn: async (decision: 'approved' | 'rejected') => {
      const signed = await signDecision({ approvalId: gate.id, decision, notes: notes || undefined });
      return api.approvals.decide(gate.id, { decision, notes: notes || undefined, ...signed });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  return (
    <section className="glass-warm rounded-lg p-5" aria-label={signoff ? 'Sign-off' : 'Approval'}>
      <p className="text-sm font-medium text-warning">{signoff ? 'Waiting for sign-off' : 'Waiting for approval'}</p>
      <h2 className="mt-1 text-lg text-fg [overflow-wrap:anywhere]">{gate.summary}</h2>
      {gate.reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-fg-body">
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {gate.evidence.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          {gate.evidence.map((e, i) => (
            <div key={i} className="contents">
              <dt className="text-fg-muted">{e.label}</dt>
              <dd className="whitespace-pre-line text-fg [overflow-wrap:anywhere]">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {canDecide ? (
        <div className="mt-4 space-y-3">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="A note for the record (optional)" aria-label="Note for the record" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide.mutate('approved')} loading={decide.isPending && decide.variables === 'approved'}>
              <Check /> {signoff ? 'Sign off' : 'Approve'}
            </Button>
            <Button variant="danger" onClick={() => decide.mutate('rejected')} loading={decide.isPending && decide.variables === 'rejected'}>
              <X /> {signoff ? 'Refuse sign-off' : 'Reject'}
            </Button>
          </div>
          <ErrorNote error={decide.error} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-lead">{cap(who)} decides this. They have been told.</p>
      )}
    </section>
  );
}

function AddDetails({ caseId, missing }: { caseId: string; missing: { label: string }[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api.cases.addInfo(caseId, { text }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });
  return (
    <section className="glass-warm rounded-lg p-5" aria-label="Missing details">
      <p className="text-sm font-medium text-warning">Needs details</p>
      <h2 className="mt-1 text-lg text-fg">{missing.length > 0 ? `Missing: ${missing.map((m) => m.label).join(', ')}.` : 'Review asked for more details.'}</h2>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="The missing details" placeholder="Add what's missing. Review runs again." />
        <Button type="submit" loading={add.isPending} disabled={!text.trim()}>
          <Send /> Send details
        </Button>
        <ErrorNote error={add.error} />
      </form>
    </section>
  );
}

function CancelCase({ caseId, noun }: { caseId: string; noun: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.cases.cancel(caseId, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <X /> Cancel
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} lead="Cancel" title={`this ${noun}?`}>
        <p className="text-sm text-fg-lead">Work on it stops at its next step. The record stays.</p>
        <div className="mt-4">
          <Field label="Why (optional)" htmlFor="cancel-reason">
            <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={cancel.error} className="mt-3" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
            Cancel {noun}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** One case: where it is in the 8 stages, who it waits on, and what each stage found. */
export function CasePage() {
  const { id = '' } = useParams();
  const role = useSession((s) => s.user?.role);
  const manager = role === 'owner' || role === 'admin';
  const [selected, setSelected] = useState<StageKey | null>(null);
  const detail = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.cases.get(id),
    // Live updates arrive over the realtime stream; a slow poll covers a dropped connection.
    refetchInterval: (q) => (q.state.data && !FINAL_STATUSES.includes(q.state.data.case.status) ? 5000 : false),
  });
  const mine = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  useEffect(() => {
    if (selected) document.getElementById(`stage-${selected}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error ?? new Error('This case was not found')} />;

  const { case: c, label, file, approvals, report } = detail.data;
  const lifecycle = (workspaces.data?.find((w) => w.id === c.workspaceId) ?? workspaces.data?.[0])?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const roleName = (rid: string) => (rid === 'owner' ? 'the owner' : (lifecycle?.roles.find((r) => r.id === rid)?.name ?? 'the right person'));
  const rows = STAGE_KEYS.map((k) => report.stages.find((s) => s.stage === k) ?? { stage: k, name: names[k], status: 'pending' as const, minutes: null, summary: null });
  const states = dotsFromStages(rows);
  const stageLabels = rows.map((r) => r.name || names[r.stage]);
  const lines = caseFileLines(file, { roleName });
  const ended = FINAL_STATUSES.includes(c.status);
  const gate = approvals.find((a) => a.kind === 'case_gate' && a.status === 'pending');
  const canDecide = !!gate && (mine.data ?? []).some((a) => a.id === gate.id);
  const person = personFor(c, gate, roleName);
  const due = ended ? null : dueWords(c.resolveBy, new Date());
  const noun = label.label.toLowerCase();

  return (
    <div className="space-y-6">
      <Link to="/cases" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {label.plural}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">
            <span className="tabular-nums">{c.code}</span> · <span className="[overflow-wrap:anywhere]">{c.requester.name}</span> · {statusWords(c.status)}
          </p>
          <h1 className="mt-1 font-display text-3xl leading-tight font-light text-fg [overflow-wrap:anywhere] md:text-4xl">{c.title}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.categoryName && <Chip tone="cool">{c.categoryName}</Chip>}
            {c.priority && <Chip tone={priorityTone(c.priority)}>{c.priority}</Chip>}
            {c.risk && <Chip>{c.risk} risk</Chip>}
            {c.department && <Chip>{c.department}</Chip>}
            {c.amountInr !== null && <Chip>{formatInr(c.amountInr)}</Chip>}
            {c.assignee && <Chip>{c.assignee.name}</Chip>}
            {due && <Chip tone={due.late ? 'danger' : 'neutral'}>{due.text}</Chip>}
            <Chip>{FROM[c.source]}</Chip>
          </div>
          {c.outcome && <p className="mt-3 text-sm text-fg-body">{c.outcome}</p>}
        </div>
        {manager && !ended && <CancelCase caseId={c.id} noun={noun} />}
      </header>

      {c.status === 'needs_info' && <AddDetails caseId={c.id} missing={file.review?.missing ?? []} />}
      {gate && <GateBanner gate={gate} canDecide={canDecide} who={roleName(gate.approver)} caseId={c.id} />}

      <section aria-label="Stages">
        <div className="hidden lg:block">
          <CaseCanvas states={states} names={stageLabels} person={person} selected={selected} onSelect={setSelected} />
        </div>
        <div className="glass rounded-lg p-4 lg:hidden">
          <StageDots states={states} names={stageLabels} />
          <p className="mt-2 text-sm text-fg-body">
            {ended ? statusWords(c.status) : `${stageLabels[STAGE_KEYS.indexOf(c.stage)]}: ${statusWords(c.status)}`}
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section className="glass min-w-0 rounded-lg p-5" aria-label="Case file">
          <h2 className="font-display text-xl font-light text-fg">
            <span className="text-fg-lead">What each stage</span> found
          </h2>
          <CaseTimeline rows={rows} states={states} lines={lines} requestText={file.request?.text} selected={selected} />
        </section>
        <aside className="min-w-0 space-y-4">
          {rows[7]!.status === 'done' && <CaseReportCard report={report} />}
          {report.work && <GoalReportCard report={report.work} actions={false} />}
          {c.goalId && (
            <Link to={`/goals/${c.goalId}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              See the work step by step <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
```

In `master-ai-web/src/main.tsx`, import `CasePage` and add `{ path: 'cases/:id', element: <CasePage /> }` after the `cases` route.

- [ ] **Step 10: Run every check**

Run: `pnpm build:packages && pnpm turbo run build typecheck test --filter=@onehuman/web --filter=@onehuman/sdk`
Expected: all succeed.

- [ ] **Step 11: Commit**

```bash
git add packages/sdk master-ai-web/src
git commit -m "feat(web): the Case page with the 8-stage canvas, the case file in words, and decisions inline"
```

### Task 7: Home, case reports, and the Approvals inbox

**Home** replaces the command center. It has:
- a two-tone greeting with the pulse;
- four tiles: open cases, waiting on you, about to miss the deadline, done today;
- the open cases counted by stage, each count linking to the filtered list;
- what waits on people and what is about to run late;
- what needs you, with the team, today's check-ins, and the KPIs.

**Reports** lists case reports next to agent jobs.

**Approvals** turns glass. Case approvals and sign-offs come first, and each links to its case.

This task is UI only. It is verified by build here and by Task 10.

**Files:**
- Create: `master-ai-web/src/routes/home.tsx`
- Delete: `master-ai-web/src/routes/command-center.tsx`
- Modify: `master-ai-web/src/main.tsx`, `master-ai-web/src/routes/reports.tsx`, `master-ai-web/src/routes/approvals.tsx`, `master-ai-web/src/components/approval-card.tsx`

**Interfaces:**
- Consumes: `homeBuckets`, `dotsFromCase`, `dueWords`, `stageNames`, `statusWords` (Tasks 2, 5); `StageDots`, `Chip`, `Card`, `PageHeader` (Task 2); `useNewRequest` (Task 3); `CaseReportCard` (Task 6); `AnimatedNumber`, `ProgressRing`, `RingPulse` (`components/motion.tsx`); `time12` (`routes/routines.tsx`); `WorkReport.cases`.
- Produces: `HomePage` at `/`; the `ApprovalCard` link "Open the case" for case approvals.

- [ ] **Step 1: Home**

Create `master-ai-web/src/routes/home.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Phone, PhoneMissed, Plus, Repeat, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { STAGE_KEYS, type Case } from '@onehuman/schemas';
import { AnimatedNumber, ProgressRing, RingPulse } from '@/components/motion';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { dotsFromCase, dueWords, homeBuckets, stageNames, statusWords } from '@/lib/cases';
import { useNewRequest } from '@/lib/new-request';
import { useSession } from '@/lib/session';
import { cn, formatInr } from '@/lib/utils';
import { time12 } from '@/routes/routines';

function CaseLine({ c, names, now }: { c: Case; names: string[]; now: Date }) {
  const due = dueWords(c.resolveBy, now);
  return (
    <li>
      <Link to={`/cases/${c.id}`} className="flex flex-col gap-2 px-5 py-3 transition-colors duration-300 hover:bg-line-5 sm:flex-row sm:items-center sm:gap-4">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{c.title}</span>
          <span className="block truncate text-xs text-fg-muted">
            <span className="tabular-nums">{c.code}</span> · {statusWords(c.status)}
            {due && <span className={due.late ? 'text-danger' : undefined}> · {due.text}</span>}
          </span>
        </span>
        <StageDots states={dotsFromCase(c)} names={names} />
      </Link>
    </li>
  );
}

/** Home: where every request is, what waits on people, and what needs you. */
export function HomePage() {
  const user = useSession((s) => s.user);
  const showNewRequest = useNewRequest((s) => s.show);
  const overview = useQuery({ queryKey: ['ops', 'overview'], queryFn: api.ops.overview, refetchInterval: 60_000 });
  const cases = useQuery({ queryKey: ['cases', 'open'], queryFn: () => api.cases.list('open') });
  const mine = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals.list });
  const delegations = useQuery({ queryKey: ['delegations', 'all'], queryFn: () => api.delegations.list() });
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const dotNames = STAGE_KEYS.map((k) => names[k]);
  const plural = (lifecycle?.case.plural ?? 'Cases').toLowerCase();
  const now = new Date();
  const b = homeBuckets(cases.data ?? [], now);
  const pulse = overview.data?.pulse;
  const needsYou = mine.data ?? [];
  const reviews = (goals.data ?? []).filter((g) => g.status === 'awaiting_plan_approval');
  const dayAgo = now.getTime() - 86_400_000;
  const teamStuck = (delegations.data ?? []).filter(
    (d) => ['declined', 'blocked', 'not_done', 'unreachable'].includes(d.status) && d.completedAt && Date.parse(d.completedAt) > dayAgo,
  );
  const withTeam = (delegations.data ?? []).filter((d) => d.stage !== 'closed');
  const activeRoutines = (routines.data ?? []).filter((r) => r.status === 'active');
  const firstName = user?.name.split(' ')[0];

  const tiles = [
    { label: `Open ${plural}`, value: b.open, tone: 'text-fg', to: '/cases' },
    { label: 'Waiting on you', value: needsYou.length, tone: needsYou.length ? 'text-warning' : 'text-fg', to: '/approvals' },
    { label: 'About to miss the deadline', value: b.atRisk.length, tone: b.atRisk.length ? 'text-danger' : 'text-fg', to: '/cases' },
    { label: 'Done today', value: pulse?.completedToday ?? 0, tone: 'text-success', to: '/reports' },
  ];

  return (
    <div className="space-y-8">
      <section className="hero-glow relative -mx-4 overflow-hidden px-4 py-10 md:mx-0 md:rounded-lg md:px-8">
        <div className="dots-floor pointer-events-none absolute inset-x-0 bottom-0 h-32" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-3xl min-w-0">
            <h1 className="font-display text-4xl leading-[1.05] font-light tracking-tight text-fg md:text-5xl">
              <span className="block text-fg-lead">{firstName ? `Good to see you, ${firstName}.` : 'Good to see you.'}</span>
              <span className="block">{pulse?.headline ?? 'Here is where things stand.'}</span>
            </h1>
            {pulse && pulse.lines.length > 0 && <p className="mt-4 text-base font-light text-fg-body">{pulse.lines.join(' ')}</p>}
          </div>
          <Button size="lg" onClick={() => showNewRequest()}>
            <Plus /> New request
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="glass rounded-lg px-4 py-4 transition-colors duration-300 hover:bg-line-5">
            <p className="text-sm text-fg-lead">{t.label}</p>
            <p className={cn('mt-1 font-display text-3xl font-light tabular-nums', t.tone)}>
              <AnimatedNumber value={t.value} />
            </p>
          </Link>
        ))}
      </div>

      <section aria-labelledby="by-stage">
        <h2 id="by-stage" className="font-display text-2xl font-light text-fg">
          <span className="text-fg-lead">Open {plural}</span> by stage
        </h2>
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STAGE_KEYS.map((k, i) => (
            <li key={k}>
              <Link to={`/cases?stage=${k}`} className="glass flex h-full flex-col rounded-lg p-4 transition-colors duration-300 hover:bg-line-5">
                <span className="grid size-7 place-items-center rounded-sm bg-node text-xs font-semibold text-fg tabular-nums">{i + 1}</span>
                <span className="mt-3 line-clamp-2 min-h-10 text-sm text-fg-body">{names[k]}</span>
                <span className={cn('mt-2 font-display text-3xl font-light tabular-nums', b.byStage[k] ? 'text-fg' : 'text-fg-muted')}>{b.byStage[k]}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Waiting on people" description="Approvals, sign-offs and missing details." action={<Link to="/cases?status=waiting" className="text-sm text-accent hover:underline">All</Link>} />
            {cases.isLoading ? (
              <Spinner />
            ) : b.waiting.length === 0 ? (
              <EmptyState title="Nobody is holding anything up" />
            ) : (
              <ul className="divide-y divide-line-10">
                {b.waiting.slice(0, 8).map((c) => (
                  <CaseLine key={c.id} c={c} names={dotNames} now={now} />
                ))}
              </ul>
            )}
          </Card>

          {b.atRisk.length > 0 && (
            <Card>
              <CardHeader title="About to miss the deadline" description="Due within a day, or already late." />
              <ul className="divide-y divide-line-10">
                {b.atRisk.slice(0, 6).map((c) => (
                  <CaseLine key={c.id} c={c} names={dotNames} now={now} />
                ))}
              </ul>
            </Card>
          )}

          {withTeam.length > 0 && (
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Phone className="size-4 text-accent" aria-hidden /> With your team
                  </span>
                }
                description="Work handed to people in charge, followed up by phone."
                action={<Link to="/calls" className="text-sm text-accent hover:underline">All calls</Link>}
              />
              <ul className="divide-y divide-line-10">
                {withTeam.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {d.staffName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{d.title}</span>
                        <span className="block truncate text-xs text-fg-muted">{d.staffName}</span>
                      </span>
                      <span className="flex gap-1" aria-hidden>
                        {(['assign', 'follow_up', 'confirm'] as const).map((st) => {
                          const done = d.calls.some((c) => c.stage === st && c.status === 'completed');
                          return <span key={st} className={cn('size-2 rounded-full', done ? 'bg-success' : d.stage === st ? 'live-dot bg-accent' : 'bg-line-15')} />;
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className={needsYou.length + reviews.length + teamStuck.length > 0 ? 'glass-warm' : undefined}>
            <CardHeader title="Needs you" />
            {needsYou.length + reviews.length + teamStuck.length === 0 ? (
              <CardBody className="text-sm text-fg-lead">Nothing needs you right now.</CardBody>
            ) : (
              <ul className="divide-y divide-line-10">
                {needsYou.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link to={a.kind === 'case_gate' && a.caseId ? `/cases/${a.caseId}` : '/approvals'} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ShieldCheck className="size-4 shrink-0 text-warning" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{a.summary}</span>
                      <Chip tone="waiting">{a.kind === 'case_gate' ? (a.stage === 'close' ? 'Sign-off' : 'Approval') : 'Agent step'}</Chip>
                    </Link>
                  </li>
                ))}
                {reviews.map((g) => (
                  <li key={g.id}>
                    <Link to={`/goals/${g.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ClipboardCheck className="size-4 shrink-0 text-warning" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">Check the plan: {g.text}</span>
                    </Link>
                  </li>
                ))}
                {teamStuck.map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <PhoneMissed className="size-4 shrink-0 text-danger" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {d.staffName}: {d.outcome?.summary ?? 'could not finish'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {activeRoutines.length > 0 && (
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Repeat className="size-4 text-accent" aria-hidden /> Today's check-ins
                  </span>
                }
                action={<Link to="/routines" className="text-sm text-accent hover:underline">All</Link>}
              />
              <ul className="divide-y divide-line-10">
                {activeRoutines.map((r) => (
                  <li key={r.id}>
                    <Link to={`/routines/${r.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ProgressRing value={r.today.reported} max={r.today.expected} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {r.mode === 'automatic' ? 'AI calls' : 'Filled in by hand'} at {time12(r.time)}
                          {r.today.flags.length > 0 && <span className="text-warning"> · {r.today.flags.length} problem{r.today.flags.length === 1 ? '' : 's'}</span>}
                        </span>
                      </span>
                      {r.today.calling > 0 && (
                        <span className="relative grid size-8 place-items-center rounded-full bg-success-soft text-success" title="Calling now">
                          <Phone className="size-4" aria-hidden />
                          <RingPulse />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="KPIs" description="From your industry setup." />
            <CardBody className="space-y-3">
              {overview.data?.kpis.map((k) => (
                <div key={k.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-fg">{k.name}</span>
                  {k.value === null ? (
                    <span className="text-xs text-fg-muted" title={k.note}>
                      needs a connection
                    </span>
                  ) : (
                    <span className="font-semibold text-fg tabular-nums">
                      {k.unit === 'inr' ? formatInr(k.value) : k.unit === 'percent' ? `${k.value}%` : k.unit === 'minutes' ? `${k.value} min` : k.value}
                    </span>
                  )}
                </div>
              ))}
              {overview.isLoading && <Spinner className="py-4" />}
              <p className="border-t border-line-10 pt-3 text-sm text-fg-lead">
                AI spend today <span className="float-right font-medium text-fg tabular-nums">{formatInr(pulse?.spendTodayInr ?? 0)}</span>
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

In `master-ai-web/src/main.tsx`, import `HomePage` from `@/routes/home`, use `{ index: true, element: <HomePage /> }`, and remove the `CommandCenterPage` import. Then delete the old page:

```bash
git rm master-ai-web/src/routes/command-center.tsx
grep -rn "command-center\|CommandCenterPage" master-ai-web/src
```

Expected: the grep prints nothing.

- [ ] **Step 2: Case reports in Reports**

In `master-ai-web/src/routes/reports.tsx`:
1. Import `CaseReportCard` from `@/components/case-report`.
2. Change the `PageHeader` to `lead="What got done,"`, `title="in plain words."`, with the same description. Show its `action` when `data && (data.goals.length > 0 || data.cases.length > 0)`.
3. Replace the first stats entry (`'Jobs'`) with:

```ts
        { label: 'Requests', value: data.totals.cases, hint: `${data.totals.goals} agent job${data.totals.goals === 1 ? '' : 's'}` },
```

4. Build the copied text from cases first, then the jobs:

```ts
  const allText = data
    ? [
        `${company ?? 'Work'} report: ${label.toLowerCase()}`,
        '',
        ...data.cases.map((c) => `${c.code}: ${c.title}\n${c.text}\n`),
        ...data.goals.map((g) => `${reportText(g)}\n`),
      ]
        .join('\n')
        .trim()
    : '';
```

5. Restyle the period tabs like the Cases status tabs (`h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11`, active `nav-active text-fg`, rest `text-fg-muted hover:bg-line-5 hover:text-fg`). Make each stat tile `glass rounded-lg px-4 py-3`.
6. Show the empty state only when both lists are empty, with the text "Raise a request with New request. Its report appears here when it closes." Render the lists as:

```tsx
      {data && data.cases.length > 0 && (
        <section className="space-y-4" aria-label="Requests">
          <h2 className="font-display text-xl font-light text-fg">Requests</h2>
          {data.cases.map((c) => (
            <CaseReportCard key={c.caseId} report={c} linked />
          ))}
        </section>
      )}
      {data && data.goals.length > 0 && (
        <section className="space-y-4" aria-label="Agent jobs">
          <h2 className="font-display text-xl font-light text-fg">Agent jobs</h2>
          {data.goals.map((g) => (
            <GoalReportCard key={g.goalId} report={g} linked />
          ))}
        </section>
      )}
```

- [ ] **Step 3: The Approvals inbox**

In `master-ai-web/src/routes/approvals.tsx`:
1. Make the header two-tone: `lead="Decisions"`, `title="waiting for you."`, description "Approvals and sign-offs for your role, and agent steps your rules stopped. The rules, not the AI, decided each one needs a person."
2. Replace the underlined tabs and the separate checkbox with one row:

```tsx
      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Approvals">
        {(['pending', 'all'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11', tab === t ? 'nav-active text-fg' : 'text-fg-muted hover:bg-line-5 hover:text-fg')}
          >
            {t === 'pending' ? 'Waiting for you' : 'History'}
          </button>
        ))}
        {role !== 'member' && (
          <label className="ml-auto flex items-center gap-2 text-sm text-fg-lead">
            <input type="checkbox" checked={!mine} onChange={(e) => setMine(!e.target.checked)} className="size-4 accent-[var(--oh-glow)]" />
            Everyone's, not only mine
          </label>
        )}
      </div>
```

3. List case steps before agent steps:

```tsx
          {[...(list.data ?? [])]
            .sort((a, b) => Number(b.kind === 'case_gate') - Number(a.kind === 'case_gate'))
            .map((a) => (
              <ApprovalCard key={a.id} approval={a} compact={tab === 'all'} />
            ))}
```

In `master-ai-web/src/components/approval-card.tsx`:
1. Import `FolderKanban` from `lucide-react`.
2. Change the article to `<article className="glass rounded-lg" data-kind={approval.kind}>` (the browser tests tell agent steps from case steps by it), every `border-t border-border` to `border-t border-line-10`, and the blockquote's `border-primary/40` to `border-line-20`.
3. Say what kind of decision it is in the header line:

```tsx
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {approval.kind === 'case_gate' ? (
              <>
                <FolderKanban className="size-3.5 text-warning" aria-hidden />
                <span className="text-warning">{approval.stage === 'close' ? 'Sign-off' : 'Approval'}</span>
              </>
            ) : (
              <>
                <Bot className="size-3.5" aria-hidden />
                <span>{approval.agentName}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{timeAgo(approval.createdAt)}</span>
          </div>
```

4. Make the warm action the approve button: drop `variant="success"` from **Approve** and **Approve edited**, so they use `primary`.
5. Let every case approval open its case. In the footer, after the "View goal" link, add the link below. Also render it under the decided line when the approval is no longer pending, so the History tab has it too:

```tsx
          {approval.caseId && (
            <Link to={`/cases/${approval.caseId}`} className="text-xs text-accent hover:underline">
              Open the case
            </Link>
          )}
```

- [ ] **Step 4: Run every check**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed.

- [ ] **Step 5: Commit**

```bash
git add -A master-ai-web/src
git commit -m "feat(web): Home by stage and by person, case reports, and approvals that open their case"
```

### Task 8: People and invites, request keys, and New request from routines and workflows

The pages that feed cases get their screens:
- **Team:**
  - people with a login, with their access and the approval roles they hold;
  - invites, whose link is shown once to copy;
  - who approves what, with "nobody yet, so it comes to the owner";
  - linking a login to the person the AI phones;
  - the existing people in charge.
- **Settings → Requests from outside:** a customer form link and API keys for systems and partners.
- **Routines and Workflows:** a routine's flagged problem and a workflow's *Start* open New request, pre-filled, instead of making a goal.

**Files:**
- Create: `master-ai-web/src/lib/people.ts`, `master-ai-web/src/lib/people.test.ts`
- Create: `master-ai-web/src/components/ui/copy-field.tsx`, `master-ai-web/src/components/people.tsx`, `master-ai-web/src/components/request-keys.tsx`
- Modify (replace): `master-ai-web/src/routes/team.tsx`
- Modify: `master-ai-web/src/routes/settings.tsx`, `master-ai-web/src/routes/routines.tsx`, `master-ai-web/src/routes/workflows.tsx`

**Interfaces:**
- Consumes: `useNewRequest` (Task 3); `Chip`, `Card`, `PageHeader` (Task 2); `api.members.list/update/remove`, `api.invites.list/create/revoke`, `api.intakeKeys.list/create/revoke`, `api.team.*`; `API_URL` (`lib/api.ts`); `Member`, `Invite`, `CreatedInvite`, `CreatedIntakeKey`, `LifecycleRole`, `StaffMember` (schemas).
- Produces: `roleHolders(roles, members)`, `canEditMember(me, m)`, `canRemoveMember(me, m)`; `CopyField({ label, value })`; `MemberCard`, `InviteForm`, `InviteList`, `WhoApproves` (`components/people.tsx`); `RequestKeysCard`. Browser-test hooks: the invite link field is labelled "Invite link"; the form link field is labelled "Form link".

- [ ] **Step 1: Write the failing test**

Create `master-ai-web/src/lib/people.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LifecycleRole, Member } from '@onehuman/schemas';
import { canEditMember, canRemoveMember, roleHolders } from './people';

const member = (over: Partial<Member>): Member => ({
  id: 'p1', name: 'Sunita', email: 's@example.com', role: 'member', approverRoles: [], status: 'active', staffId: null, createdAt: '2026-10-13T04:30:00Z', ...over,
});
const roles: LifecycleRole[] = [
  { id: 'owner', name: 'Owner', approves: 'anything' },
  { id: 'safety-officer', name: 'Safety officer', approves: 'hot work and confined spaces' },
  { id: 'finance-head', name: 'Finance head', approves: 'spends above ₹1,00,000' },
];

describe('who approves what', () => {
  it('lists the active holders of each role, and leaves out the owner role', () => {
    const team = [
      member({ id: 'a', name: 'Sunita', approverRoles: ['safety-officer'] }),
      member({ id: 'b', name: 'Manoj', approverRoles: ['safety-officer'], status: 'paused' }),
    ];
    expect(roleHolders(roles, team)).toEqual([
      { role: roles[1], holders: ['Sunita'] },
      { role: roles[2], holders: [] },
    ]);
  });
});

describe('who may change whom', () => {
  const owner = { role: 'owner' as const, principalId: 'o' };
  const admin = { role: 'admin' as const, principalId: 'a' };
  const plain = { role: 'member' as const, principalId: 'm' };

  it('members change nobody, and nobody changes the owner here', () => {
    expect(canEditMember(plain, member({}))).toBe(false);
    expect(canEditMember(admin, member({ role: 'owner' }))).toBe(false);
    expect(canEditMember(owner, member({ role: 'admin' }))).toBe(true);
  });

  it('nobody removes themself', () => {
    expect(canRemoveMember(admin, member({ id: 'a', role: 'admin' }))).toBe(false);
    expect(canRemoveMember(owner, member({ id: 'x' }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/web exec vitest run src/lib/people.test.ts`
Expected: FAIL: cannot find `./people`.

- [ ] **Step 3: Write the helpers**

Create `master-ai-web/src/lib/people.ts`:

```ts
import type { HumanRole, LifecycleRole, Member } from '@onehuman/schemas';

/** Each approval role and who holds it now. With nobody, its approvals go to the owner. */
export function roleHolders(roles: LifecycleRole[], members: Member[]): { role: LifecycleRole; holders: string[] }[] {
  return roles
    .filter((r) => r.id !== 'owner')
    .map((role) => ({ role, holders: members.filter((m) => m.status === 'active' && m.approverRoles.includes(role.id)).map((m) => m.name) }));
}

interface Me {
  role: HumanRole;
  principalId: string;
}

/** The owner and admins change people; nobody changes the owner here. The server checks again. */
export function canEditMember(me: Me, m: Member): boolean {
  return me.role !== 'member' && m.role !== 'owner' && m.status !== 'retired';
}

export function canRemoveMember(me: Me, m: Member): boolean {
  return canEditMember(me, m) && m.id !== me.principalId;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @onehuman/web exec vitest run`
Expected: PASS (14 tests).

- [ ] **Step 5: The copy field**

Create `master-ai-web/src/components/ui/copy-field.tsx`:

```tsx
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
```

- [ ] **Step 6: People, invites and who approves what**

Create `master-ai-web/src/components/people.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import type { CreatedInvite, HumanRole, Invite, LifecycleRole, Member, StaffMember } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { CopyField } from '@/components/ui/copy-field';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { canEditMember, canRemoveMember, roleHolders } from '@/lib/people';
import { formatDateTime } from '@/lib/utils';

const ACCESS: Record<HumanRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function RolePicker({ roles, value, onChange, idPrefix }: { roles: LifecycleRole[]; value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  if (roles.length === 0) return <p className="text-sm text-fg-lead">Your setup has no approval roles yet.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-fg">Approves as</legend>
      {roles.map((r) => (
        <label key={r.id} htmlFor={`${idPrefix}-${r.id}`} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-0">
          <input
            id={`${idPrefix}-${r.id}`}
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--oh-glow)]"
            checked={value.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
          />
          <span>
            <span className="text-fg">{r.name}</span> <span className="text-fg-lead">· {r.approves}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A person with a login: access, approval roles, and the person in charge they answer calls as. */
export function MemberCard({ member, roles, staff, me }: { member: Member; roles: LifecycleRole[]; staff: StaffMember[]; me: { role: HumanRole; principalId: string } }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [access, setAccess] = useState<'admin' | 'member'>(member.role === 'admin' ? 'admin' : 'member');
  const [approverRoles, setApproverRoles] = useState(member.approverRoles);
  const [staffId, setStaffId] = useState(member.staffId ?? '');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['members'] });
  const save = useMutation({
    mutationFn: () => api.members.update(member.id, { role: access, approverRoles, staffId: staffId || null }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.members.remove(member.id), onSuccess: refresh });
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'A role no longer in your setup';
  const linked = staff.find((s) => s.id === member.staffId);

  return (
    <article className="glass rounded-lg p-5" aria-label={member.name}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(member.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{member.name}</p>
          <p className="truncate text-sm text-fg-lead">{member.email}</p>
        </div>
        <Chip tone={member.role === 'member' ? 'neutral' : 'cool'}>{ACCESS[member.role]}</Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {member.role === 'owner' && <Chip tone="waiting">Approves anything</Chip>}
        {member.approverRoles.map((r) => (
          <Chip key={r} tone="waiting">
            {roleName(r)}
          </Chip>
        ))}
        {member.status === 'paused' && <Chip>Paused</Chip>}
      </div>
      {linked && <p className="mt-2 text-xs text-fg-muted">Answers calls as {linked.name}</p>}

      {editing ? (
        <form
          className="mt-4 space-y-4 border-t border-line-10 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Access" htmlFor={`access-${member.id}`}>
            <Select id={`access-${member.id}`} value={access} onChange={(e) => setAccess(e.target.value as 'admin' | 'member')}>
              <option value="member">Member: does the work, decides for their roles</option>
              <option value="admin">Admin: also manages people and settings</option>
            </Select>
          </Field>
          <RolePicker roles={roles} value={approverRoles} onChange={setApproverRoles} idPrefix={`roles-${member.id}`} />
          <Field label="Answers calls as" htmlFor={`staff-${member.id}`} hint="The person in charge the AI phones, if this is them.">
            <Select id={`staff-${member.id}`} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Nobody</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        canEditMember(me, member) && (
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            {canRemoveMember(me, member) && (
              <Button
                variant="ghost"
                size="sm"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${member.name}? They lose access at once.`)) remove.mutate();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        )
      )}
      <ErrorNote error={save.error ?? remove.error} className="mt-3" />
    </article>
  );
}

/** Invite by email; the link is shown once, to send however the owner likes. */
export function InviteForm({ roles, onDone }: { roles: LifecycleRole[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ name: string; email: string; role: 'admin' | 'member' }>({ name: '', email: '', role: 'member' });
  const [approverRoles, setApproverRoles] = useState<string[]>([]);
  const [made, setMade] = useState<CreatedInvite | null>(null);
  const invite = useMutation({
    mutationFn: () => api.invites.create({ ...form, approverRoles }),
    onSuccess: (inv) => {
      setMade(inv);
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  if (made) {
    return (
      <Card className="glass-warm">
        <CardHeader title={`Send this link to ${made.name}`} description="It works once and lasts 7 days. Send it on WhatsApp, SMS or email." />
        <CardBody className="space-y-3">
          <CopyField label="Invite link" value={made.link} />
          <Button variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Invite a person" description="They get their own login, see the work, and decide what their roles approve." />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Name" htmlFor="inv-name">
            <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email" htmlFor="inv-email">
            <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Access" htmlFor="inv-role">
            <Select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <RolePicker roles={roles} value={approverRoles} onChange={setApproverRoles} idPrefix="inv-roles" />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={invite.isPending}>
              <UserPlus /> Create invite link
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
        <ErrorNote error={invite.error} className="mt-3" />
      </CardBody>
    </Card>
  );
}

/** Open invites, each withdrawable. */
export function InviteList({ invites, roles }: { invites: Invite[]; roles: LifecycleRole[] }) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => api.invites.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  return (
    <Card>
      <CardHeader title="Invites not yet used" />
      <ul className="divide-y divide-line-10">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">
                {i.name} <span className="font-normal text-fg-lead">· {i.email}</span>
              </span>
              <span className="block text-xs text-fg-muted">
                {ACCESS[i.role]}
                {i.approverRoles.length > 0 && ` · approves as ${i.approverRoles.map((r) => roles.find((x) => x.id === r)?.name ?? 'a role').join(', ')}`} · expires{' '}
                {formatDateTime(i.expiresAt)}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)} loading={revoke.isPending && revoke.variables === i.id}>
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
      <ErrorNote error={revoke.error} className="mx-5 mb-4" />
    </Card>
  );
}

/** Each approval role and who holds it. Unheld roles send their approvals to the owner. */
export function WhoApproves({ roles, members }: { roles: LifecycleRole[]; members: Member[] }) {
  return (
    <Card>
      <CardHeader title="Who approves what" description="Set by your organization type. A role with nobody in it sends its approvals to the owner." />
      <ul className="divide-y divide-line-10">
        {roleHolders(roles, members).map(({ role, holders }) => (
          <li key={role.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
            <span className="font-medium text-fg">{role.name}</span>
            <span className="min-w-0 flex-1 text-fg-lead">{role.approves}</span>
            <span className={holders.length > 0 ? 'text-fg' : 'text-warning'}>{holders.length > 0 ? holders.join(', ') : 'Nobody yet, so it comes to the owner'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 7: The Team page**

Replace `master-ai-web/src/routes/team.tsx` with:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, UserPlus, UserRound } from 'lucide-react';
import type { StaffMember } from '@onehuman/schemas';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { initials, InviteForm, InviteList, MemberCard, WhoApproves } from '@/components/people';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PersonCard({ person, manager }: { person: StaffMember; manager: boolean }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.team.update(person.id, { status: person.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
  return (
    <article className="glass rounded-lg p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(person.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{person.name}</p>
          <p className="truncate text-sm text-fg-lead">{person.title}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-muted tabular-nums">
            <Phone className="size-3" aria-hidden /> {person.phone}
          </p>
        </div>
        <Chip tone={person.status === 'active' ? 'success' : 'neutral'}>{person.status === 'active' ? 'Active' : 'Off'}</Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {person.responsibilities.map((r) => (
          <Chip key={r}>{r}</Chip>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Calls', person.stats.calls],
          ['Open jobs', person.stats.openDelegations],
          ['Done', person.stats.done],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md bg-line-5 py-2">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="font-semibold text-fg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          Calls {person.workingHours.days.map((d) => DAYS[d]).join(' ')} · {person.workingHours.start}–{person.workingHours.end}
        </span>
        {manager && (
          <button className="min-h-11 hover:text-fg sm:min-h-0" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {person.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        )}
      </div>
    </article>
  );
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '+91 ', title: '', responsibilities: '', start: '09:00', end: '19:00' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () =>
      api.team.add({
        name: form.name,
        phone: form.phone,
        title: form.title,
        responsibilities: form.responsibilities.split(',').map((s) => s.trim()).filter(Boolean),
        workingHours: { days: [1, 2, 3, 4, 5, 6], start: form.start, end: form.end },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader title="Add a person in charge" description="The AI phones them to assign work, follow up and confirm it's done." />
      <CardBody>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Name" htmlFor="p-name">
            <Input id="p-name" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Phone" htmlFor="p-phone">
            <Input id="p-phone" value={form.phone} onChange={set('phone')} required />
          </Field>
          <Field label="Job title" htmlFor="p-title">
            <Input id="p-title" value={form.title} onChange={set('title')} placeholder="Operations manager" required />
          </Field>
          <Field label="In charge of" htmlFor="p-resp" hint="Comma separated, e.g. bookings, hotels, inspections">
            <Input id="p-resp" value={form.responsibilities} onChange={set('responsibilities')} />
          </Field>
          <Field label="Calls from" htmlFor="p-start">
            <Input id="p-start" type="time" value={form.start} onChange={set('start')} />
          </Field>
          <Field label="Calls until" htmlFor="p-end">
            <Input id="p-end" type="time" value={form.end} onChange={set('end')} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={add.isPending}>
              Add to team
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
        <ErrorNote error={add.error} className="mt-3" />
      </CardBody>
    </Card>
  );
}

/** People with a login and the roles they approve for, open invites, and the people in charge the AI phones. */
export function TeamPage() {
  const user = useSession((s) => s.user);
  const manager = user?.role === 'owner' || user?.role === 'admin';
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list });
  const members = useQuery({ queryKey: ['members'], queryFn: api.members.list });
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites.list, enabled: manager });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const roles = (workspaces.data?.[0]?.pack.lifecycle?.roles ?? []).filter((r) => r.id !== 'owner');
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const people = (members.data ?? []).filter((m) => m.status !== 'retired');
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending');

  return (
    <div className="space-y-10">
      <PageHeader
        lead="Your people,"
        title="and what each one decides."
        description="People with a login see the work and decide what their roles approve. People in charge get the AI's phone calls."
        action={
          manager &&
          !inviting && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus /> Invite a person
            </Button>
          )
        }
      />
      <PackUpdatesBanner />
      {inviting && <InviteForm roles={roles} onDone={() => setInviting(false)} />}

      <section aria-labelledby="logins" className="space-y-4">
        <h2 id="logins" className="font-display text-xl font-light text-fg">
          People with a login
        </h2>
        <ErrorNote error={members.error} />
        {members.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {user &&
              people.map((m) => <MemberCard key={m.id} member={m} roles={roles} staff={team.data ?? []} me={{ role: user.role, principalId: user.principalId }} />)}
          </div>
        )}
      </section>

      {manager && pending.length > 0 && <InviteList invites={pending} roles={roles} />}
      {roles.length > 0 && <WhoApproves roles={roles} members={people} />}

      <section aria-labelledby="in-charge" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="in-charge" className="font-display text-xl font-light text-fg">
              People in charge
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-lead">
              Work is handed to them by phone: the AI assigns it, follows up and confirms it's done. Calls only go out in their working hours (9 am–9 pm at most).
            </p>
          </div>
          {manager && !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus /> Add person
            </Button>
          )}
        </div>
        {adding && <AddPerson onDone={() => setAdding(false)} />}
        {team.isLoading && <Spinner />}
        <ErrorNote error={team.error} />
        {team.data?.length === 0 && !adding && (
          <EmptyState icon={<UserRound />} title="No one in charge yet">
            Add the people in charge so work can be handed to them by phone.
          </EmptyState>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {team.data?.map((p) => <PersonCard key={p.id} person={p} manager={manager} />)}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Requests from outside**

Create `master-ai-web/src/components/request-keys.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, KeyRound, Plus } from 'lucide-react';
import type { CreatedIntakeKey } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { api, API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';

/** Requests from outside: a public form for customers, keys for systems and partners. Each becomes a case. */
export function RequestKeysCard() {
  const queryClient = useQueryClient();
  const tenantId = useSession((s) => s.user?.tenantId);
  const keys = useQuery({ queryKey: ['intake-keys'], queryFn: api.intakeKeys.list });
  const [kind, setKind] = useState<'form' | 'api'>('form');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<'system' | 'partner'>('system');
  const [made, setMade] = useState<CreatedIntakeKey | null>(null);
  const create = useMutation({
    mutationFn: () => api.intakeKeys.create({ kind, label, ...(kind === 'api' && { source }) }),
    onSuccess: (k) => {
      setMade(k);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['intake-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.intakeKeys.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intake-keys'] }),
  });
  const live = (keys.data ?? []).filter((k) => !k.revokedAt);

  return (
    <Card>
      <CardHeader title="Requests from outside" description="A form for your customers, and keys for the systems and partners that raise requests. Each request becomes a case." />
      <CardBody className="space-y-5">
        {made && (
          <div className="glass-warm space-y-3 rounded-md p-4" role="status">
            <p className="text-sm font-medium text-fg">{made.kind === 'form' ? 'Your request form is ready. Share this link.' : 'Copy this key now. It is shown only once.'}</p>
            {made.kind === 'form' && made.formPath ? (
              <CopyField label="Form link" value={`${window.location.origin}${made.formPath}`} />
            ) : (
              <CopyField label="Key" value={made.key} />
            )}
            {made.kind === 'api' && (
              <details className="text-sm text-fg-lead">
                <summary className="cursor-pointer hover:text-fg">For the person connecting your system</summary>
                <p className="mt-2">
                  Send requests to <span className="break-all text-fg">{`${API_URL}/intake/${tenantId}/cases`}</span> with this key as a bearer token.
                </p>
              </details>
            )}
            <Button variant="ghost" size="sm" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        )}

        {keys.isLoading ? (
          <Spinner />
        ) : live.length === 0 ? (
          <p className="text-sm text-fg-lead">No form or key yet.</p>
        ) : (
          <ul className="divide-y divide-line-10">
            {live.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                {k.kind === 'form' ? <Globe className="size-4 text-accent" aria-hidden /> : <KeyRound className="size-4 text-accent" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{k.label}</span>
                  <span className="block text-xs text-fg-muted">
                    {k.kind === 'form' ? 'Customer form' : k.source === 'partner' ? 'Partner key' : 'System key'} · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'not used yet'}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoke.isPending && revoke.variables === k.id}
                  onClick={() => {
                    if (window.confirm(`Stop “${k.label}”? Requests sent with it will be refused.`)) revoke.mutate(k.id);
                  }}
                >
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-muted">Links and keys are shown once. Lost one? Stop it and make a new one.</p>

        <form
          className="grid gap-3 border-t border-line-10 pt-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Kind" htmlFor="key-kind">
            <Select id="key-kind" value={kind} onChange={(e) => setKind(e.target.value as 'form' | 'api')}>
              <option value="form">Customer form</option>
              <option value="api">System or partner key</option>
            </Select>
          </Field>
          <Field label="Name" htmlFor="key-label" hint={kind === 'form' ? 'For example: Website contact page' : 'For example: SCADA alarms'}>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
          </Field>
          {kind === 'api' && (
            <Field label="Who sends" htmlFor="key-source">
              <Select id="key-source" value={source} onChange={(e) => setSource(e.target.value as 'system' | 'partner')}>
                <option value="system">One of our systems</option>
                <option value="partner">A partner</option>
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" loading={create.isPending}>
              <Plus /> {kind === 'form' ? 'Make a form link' : 'Make a key'}
            </Button>
          </div>
        </form>
        <ErrorNote error={create.error ?? revoke.error} />
      </CardBody>
    </Card>
  );
}
```

In `master-ai-web/src/routes/settings.tsx`, import `RequestKeysCard` and render `<RequestKeysCard />` right after the Appearance card.

- [ ] **Step 9: Routines and workflows open New request**

In `master-ai-web/src/routes/routines.tsx`, inside `RoutineBoardPage`:
1. Remove the `toGoal` mutation, and its `<ErrorNote error={toGoal.error} />`.
2. Add `const showNewRequest = useNewRequest((s) => s.show);` (import from `@/lib/new-request`).
3. Make each flagged problem's button:

```tsx
                  <Button size="sm" variant="warning" onClick={() => showNewRequest({ text: `Sort this out: ${f}` })}>
                    <Flag /> Raise a request
                  </Button>
```

Remove the `navigate` constant in `RoutineBoardPage` (only `toGoal` used it). Keep the `useNavigate` import, which the routine list above still uses.

In `master-ai-web/src/routes/workflows.tsx`:
1. Replace `const navigate = useNavigate();` with `const showNewRequest = useNewRequest((s) => s.show);` (import from `@/lib/new-request`; drop the `useNavigate` import).
2. Add a `start` helper that picks the case type this workflow runs for, if there is one:

```tsx
  const start = (wf: { id: string; name: string }) => {
    const category = pack?.lifecycle?.categories.find((c) => c.workflow === wf.id)?.id;
    showNewRequest(category ? { category } : { text: wf.name });
  };
```

3. Make the card button `onClick={() => start(wf)}`, labelled **Start**, with `text-accent` instead of `text-primary`.

- [ ] **Step 10: Run every check**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed; 14 web tests.

- [ ] **Step 11: Commit**

```bash
git add master-ai-web/src
git commit -m "feat(web): people, invites and approval roles on Team, request keys in Settings, New request from routines and workflows"
```

### Task 9: The restyle sweep, guarded by a test

A test now fails the build when a component uses a raw Tailwind colour, a hex value, or text under 13px. Print styles are exempt, because reports print on white paper. Then the remaining older screens move to Glow:
- glass cards;
- token-only status colours;
- two-tone page headings;
- cool (lilac) links for navigation.

**Files:**
- Create: `master-ai-web/src/tokens.test.ts`
- Modify: `master-ai-web/package.json` (`@types/node`)
- Modify: `master-ai-web/src/components/goal-canvas.tsx`, `phone-simulator.tsx`, `checkin-form.tsx`, `delegation-card.tsx`, `goal-report.tsx`, `motion.tsx`
- Modify: `master-ai-web/src/routes/workflows.tsx`, `routines.tsx`, `settings.tsx`, `knowledge.tsx`, `records.tsx`, `calls.tsx`, `pack.tsx`, `agents.tsx`, `audit.tsx`, `goal-detail.tsx`

**Interfaces:**
- Consumes: the tokens and utility classes from Task 1 (`glass`, `bg-*-soft`, `text-accent`, `bg-line-5`, `divide-line-10`); `PageHeader`'s `lead` (Task 2); `darkPalette` (`@onehuman/ui`).
- Produces: `src/tokens.test.ts`, the guard every later web change runs against.

- [ ] **Step 1: Write the failing test**

In `master-ai-web/package.json`, add `"@types/node": "^24.19.2"` to `devDependencies` (the version the sdk already uses), then `pnpm install --offline`.

Create `master-ai-web/src/tokens.test.ts`:

```ts
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsxFiles(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

/** Reports print on white paper, so `print:` classes may use plain black and white. */
const withoutPrint = (source: string) => source.replace(/print:[^\s"'`]+/g, '');

const RAW_COLOUR =
  /(?<![\w-])(?:bg|text|border|ring|outline|shadow|fill|stroke|from|via|to|decoration|divide)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;
const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/g;
const TINY_TEXT = /text-\[(\d+(?:\.\d+)?)px\]/g;

function offenders(pattern: RegExp, keep: (m: RegExpMatchArray) => boolean = () => true): string[] {
  return tsxFiles(SRC).flatMap((file) =>
    [...withoutPrint(readFileSync(file, 'utf8')).matchAll(pattern)].filter(keep).map((m) => `${relative(SRC, file)}: ${m[0]}`),
  );
}

describe('colour and type come from the Glow tokens', () => {
  it('uses no raw Tailwind colours', () => {
    expect(offenders(RAW_COLOUR)).toEqual([]);
  });

  it('uses no hex colours in components', () => {
    expect(offenders(HEX)).toEqual([]);
  });

  it('keeps all text at 13px or more', () => {
    expect(offenders(TINY_TEXT, (m) => Number(m[1]) < 13)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @onehuman/web exec vitest run src/tokens.test.ts`
Expected: FAIL, listing at least:
- `components/goal-canvas.tsx` (`text-white`, `text-black`, `shadow-black/20`, `text-[10px]`, `text-[11px]`);
- `components/phone-simulator.tsx` (`text-white`, `shadow-black/40`);
- `components/checkin-form.tsx` (`bg-black/50`, `shadow-black/50`);
- `components/delegation-card.tsx` (`text-[10px]`);
- `routes/workflows.tsx` (`text-white`, `text-black`, `text-[10px]`);
- `routes/routines.tsx` (`text-[11px]`);
- `routes/settings.tsx` (`#ea4b71`).

- [ ] **Step 3: Replace each offender with tokens**

Status badges that sat on solid colour use the soft token pair, which the contrast test (Task 1) already holds at AA. Overlays use the background token. Floating panels drop their drop shadow and become glass.

| File | Replace | With |
|---|---|---|
| `components/goal-canvas.tsx` (`StatusDot`) | `bg-success text-white` | `bg-success-soft text-success shadow-[inset_0_0_0_1px_var(--oh-success)]` |
| | `bg-warning text-black` | `bg-warning-soft text-warning shadow-[inset_0_0_0_1px_var(--oh-warning)]` |
| | `bg-danger text-white` | `bg-danger-soft text-danger shadow-[inset_0_0_0_1px_var(--oh-danger)]` |
| `components/goal-canvas.tsx` (`StepNode`) | `bg-surface shadow-lg shadow-black/20 transition-colors` | `bg-node transition-colors` |
| | `bg-accent px-1 text-[10px] leading-5 font-semibold text-white` | `bg-accent-soft px-1 text-xs leading-5 font-semibold text-accent` |
| | `ring-2 ring-primary ring-offset-2 ring-offset-canvas` (both nodes) | `ring-2 ring-accent ring-offset-2 ring-offset-canvas` |
| `components/goal-canvas.tsx` (labels) | `text-[11px]`, `text-[10px]` | `text-xs` |
| `components/goal-canvas.tsx` (container) | `rounded-xl border border-border bg-canvas` | `glass rounded-lg` |
| `components/phone-simulator.tsx` (3 panels) | `rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40` | `glass rounded-lg` |
| `components/phone-simulator.tsx` (call icons) | `bg-success text-white` | `bg-success-soft text-success` |
| | `'grid size-9 place-items-center rounded-full text-white', ended ? 'bg-fg-muted' : 'bg-success'` | `'grid size-9 place-items-center rounded-full', ended ? 'bg-line-10 text-fg-muted' : 'bg-success-soft text-success'` |
| `components/checkin-form.tsx` | `bg-black/50` | `bg-background/70` |
| | `rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50` | `glass rounded-lg` |
| `components/delegation-card.tsx` | `text-[10px]` | `text-xs` |
| `routes/routines.tsx` | `text-[11px]` | `text-xs` |
| `routes/workflows.tsx` (`capabilityIcons`) | `bg-primary text-primary-fg` | `bg-warning-soft text-warning` (a person is phoned) |
| | `bg-accent text-white` | `bg-accent-soft text-accent` |
| | `bg-info text-white` | `bg-info-soft text-info` |
| | `bg-warning text-black` | `bg-warning-soft text-warning` |
| | `bg-success text-black` | `bg-success-soft text-success` |
| | `bg-muted text-fg` (both) | `bg-node text-fg` |
| `routes/workflows.tsx` (step numbers) | `size-4 place-items-center rounded-full bg-muted text-[10px]` | `size-5 place-items-center rounded-full bg-node text-xs` |
| `routes/workflows.tsx` (cards) | `rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary/60` | `glass rounded-lg p-5 transition-colors duration-300 hover:bg-line-5` |
| `routes/settings.tsx` | `?? '#ea4b71'` | `?? darkPalette.primary` (import `darkPalette` from `@onehuman/ui`) |

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @onehuman/web exec vitest run`
Expected: PASS (17 tests).

- [ ] **Step 5: Glass cards, lilac links, hairlines**

The remaining older cards and links move to Glow in one mechanical pass. Run from `master-ai-web/src` (BSD `sed`, as on macOS):

```bash
cd master-ai-web/src
grep -rlE "rounded-(xl|2xl|lg) border border-border bg-surface" routes components | xargs sed -i '' -E 's/rounded-(xl|2xl|lg) border border-border bg-surface/glass rounded-lg/g'
grep -rl "hover:bg-muted/60" routes components | xargs sed -i '' 's#hover:bg-muted/60#hover:bg-line-5#g'
grep -rl "divide-border" routes components | xargs sed -i '' 's/divide-border/divide-line-10/g'
grep -rl "text-primary hover:underline" routes components | xargs sed -i '' 's/text-primary hover:underline/text-accent hover:underline/g'
cd ../..
git diff --stat
```

Expected: the diff touches only class strings. Read it once. Every replaced card is a plain container, and no form field (`components/ui/form.tsx` styles inputs with `border-border bg-surface` on purpose) is caught: the pattern needs `rounded-* border border-border bg-surface` together, which inputs don't use.

- [ ] **Step 6: Two-tone headings on the remaining pages**

Give each remaining `PageHeader` a grey lead-in and a white payoff (descriptions unchanged):

| Page | `lead` | `title` |
|---|---|---|
| `knowledge.tsx` | `What your agents` | `know.` |
| `records.tsx` | `Your business` | `records.` |
| `calls.tsx` | `Calls with` | `your team.` |
| `pack.tsx` | `Industry setup:` | `{ws.pack.name}` (unchanged) |
| `agents.tsx` | `Your AI` | `team.` |
| `audit.tsx` | `goalId ? 'Step by step,' : 'Everything that happened,'` | `goalId ? 'replayed.' : 'on the record.'` |
| `settings.tsx` | `Your` | `settings.` |

- [ ] **Step 7: Run every check, and look at both themes**

Run: `pnpm turbo run build typecheck test --filter=@onehuman/web`
Expected: all succeed; 17 web tests.

With `pnpm dev` running, open Home, Cases, a Case page, Approvals, Team, Settings, Workflows and a goal page in dark, then switch Settings → Appearance → Light and open them again. Expected: no white-on-white or black-on-black text, glass cards readable in both themes, the live stage visible in both. Task 10's theme test pins the light background.

- [ ] **Step 8: Commit**

```bash
git add master-ai-web pnpm-lock.yaml
git commit -m "feat(web): restyle the remaining screens to Glow, with a test that keeps colours on tokens"
```

### Task 10: Browser tests at desktop and phone widths

Playwright drives the real app (API, worker and web from `pnpm dev`, offline LLM mode). The journey test is the spec's web end-to-end row:
1. Sign up by sector and type, and see the stages named for a power plant.
2. Install.
3. Invite the safety officer, who joins in their own browser.
4. Raise a hot-work request and watch the pipeline run to the permit gate.
5. The safety officer approves it inline.
6. The work runs, the safety officer signs off, and the report appears.

Smaller tests pin the Review Focus inputs: long and hostile text, reduced motion, phone width, a member's view, the public form, and the light theme.

These tests cover screens built in Tasks 3–9, so they are expected to pass on the first run. If one fails, that's a finding: fix the screen, not the test, unless the test is wrong.

**Files:**
- Modify: `master-ai-web/package.json` (`@playwright/test`, `e2e` script, `typecheck`), `package.json` (root `e2e` script), `CLAUDE.md` (Commands)
- Create: `master-ai-web/playwright.config.ts`, `master-ai-web/e2e/tsconfig.json`, `master-ai-web/e2e/global-setup.ts`, `master-ai-web/e2e/helpers.ts`
- Create: `master-ai-web/e2e/journey.spec.ts`, `cases.spec.ts`, `roles.spec.ts`, `theme.spec.ts`, `layout.spec.ts`
- Modify: `.gitignore` (`master-ai-web/test-results`, `master-ai-web/playwright-report`)

**Interfaces:**
- Consumes: every screen above and its test hooks:
  - `data-stage` / `data-stage-state` and `data-person` on the canvas (`data-testid="case-canvas"`);
  - `data-testid="request-text"`;
  - the regions "Approval" and "Sign-off";
  - `article[data-kind]`;
  - the fields "Invite link" and "Form link";
  - the list "The 8 stages of every job".

  Also `createClient` (sdk), `ORG_TYPES` (schemas), `lightPalette` (ui).
- Produces: `pnpm e2e`.

- [ ] **Step 1: Install Playwright, pinned**

Pick the newest `@playwright/test` version published at least 14 days before today:

```bash
npm view @playwright/test time --json | node -e '
const t = JSON.parse(require("fs").readFileSync(0, "utf8"));
const cutoff = Date.now() - 14 * 864e5;
const ok = Object.entries(t).filter(([v, d]) => /^\d+\.\d+\.\d+$/.test(v) && Date.parse(d) <= cutoff).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
console.log(ok[0][0]);'
```

Add it to `master-ai-web/package.json` `devDependencies` as an exact version (`"@playwright/test": "<that version>"`). Add the scripts:

```json
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p e2e/tsconfig.json"
```

Add the root script `"e2e": "pnpm --filter @onehuman/web e2e"`. Then:

```bash
pnpm install
git diff --stat pnpm-lock.yaml
pnpm --filter @onehuman/web exec playwright install chromium
```

Expected: the lockfile diff adds Playwright and its two packages only (`playwright`, `playwright-core`). If it re-resolves anything else (the Expo app in particular), revert the lockfile and add the dependency by hand with `pnpm install --offline` (Plan 3 ruling). Chromium downloads to `~/Library/Caches/ms-playwright`.

Append to `.gitignore`:

```
master-ai-web/test-results
master-ai-web/playwright-report
```

- [ ] **Step 2: Configuration and helpers**

Create `master-ai-web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real app. Start everything first with `pnpm dev`
 * (API :3000, worker, web :5173, offline LLM mode), then run `pnpm e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /layout\.spec/ },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      testMatch: /layout\.spec/,
    },
  ],
});
```

Create `master-ai-web/e2e/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["node"], "lib": ["ES2023", "DOM"] },
  "include": ["./**/*.ts", "../playwright.config.ts"]
}
```

Create `master-ai-web/e2e/global-setup.ts`:

```ts
/** Fail fast, with the fix, when the app isn't running. */
export default async function globalSetup() {
  const api = process.env.E2E_API_URL ?? 'http://localhost:3000';
  const web = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
  for (const [name, url] of [
    ['API', `${api}/health`],
    ['web app', web],
  ] as const) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (!ok) throw new Error(`The ${name} is not answering at ${url}. Start everything with \`pnpm dev\` first.`);
  }
}
```

Create `master-ai-web/e2e/helpers.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { ORG_TYPES, type AuthResponse, type CaseDetail, type TenantSummary } from '@onehuman/schemas';
import { createClient, type ApiClient } from '@onehuman/sdk';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';
export const uniqueEmail = (who: string) => `${who}+${randomBytes(4).toString('hex')}@example.com`;

/** A real hot-work request from the power-plant test set (evals/suites/power-plant.yaml, contractor-welding). */
export const WELDING =
  'M/s Shree Fabricators: we will start welding of chute liner plates at Conveyor 3B transfer house tomorrow 10 am, 4 welders and 1 helper. Please arrange hot work permit.';

export interface Org {
  api: ApiClient;
  auth: AuthResponse;
  tenant: TenantSummary;
}

/** A ready organization made through the API, for tests that aren't about signing up. */
export async function newOrganization(orgType: string): Promise<Org> {
  const type = ORG_TYPES.find((t) => t.id === orgType);
  if (!type) throw new Error(`No organization type ${orgType}`);
  let token: string | null = null;
  const api = createClient({ baseUrl: API_URL, getToken: () => token });
  const auth = await api.auth.signup({
    companyName: `E2E ${type.name} ${randomBytes(2).toString('hex')}`,
    ownerName: 'Asha Owner',
    email: uniqueEmail('owner'),
    password: PASSWORD,
    sector: type.sector,
    orgType,
  });
  token = auth.token;
  const draft = await api.onboarding.preview();
  await api.onboarding.install({ draftId: draft.id, sampleData: true });
  return { api, auth, tenant: await api.tenant.get() };
}

/** Open the app already signed in, the way the web app stores its session. */
export async function signInAs(page: Page, who: { auth: AuthResponse; tenant: TenantSummary }) {
  const saved = JSON.stringify({ token: who.auth.token, user: who.auth.user, tenant: who.tenant, companies: who.auth.companies ?? [] });
  await page.addInitScript((value) => localStorage.setItem('onehuman.session', value), saved);
}

export async function waitForCase(api: ApiClient, id: string, until: (d: CaseDetail) => boolean, timeoutMs = 240_000): Promise<CaseDetail> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const d = await api.cases.get(id);
    if (until(d)) return d;
    if (Date.now() > end) throw new Error(`${d.case.code} stayed at ${d.case.stage} (${d.case.status})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** How far the page, or the scrolling main area, can scroll sideways. 0 means it can't. */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(...[document.documentElement, document.querySelector('main')].filter((el): el is HTMLElement => !!el).map((el) => el.scrollWidth - el.clientWidth)),
  );
}

/** Approve every agent step waiting in this person's inbox. Case approvals and sign-offs are left alone. */
export async function approveAgentSteps(page: Page) {
  await page.goto('/approvals');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const steps = page.locator('article[data-kind="action"]');
  await page.getByText('Nothing needs your approval').or(page.locator('article').first()).first().waitFor();
  for (let n = await steps.count(); n > 0; n = await steps.count()) {
    await steps.first().getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForFunction((before) => document.querySelectorAll('article[data-kind="action"]').length < before, n);
  }
}
```

- [ ] **Step 3: The journey**

Create `master-ai-web/e2e/journey.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { approveAgentSteps, PASSWORD, uniqueEmail, WELDING } from './helpers';

test('a power plant signs up, and a hot-work job runs all 8 stages with the safety officer deciding in their own browser', async ({ page, browser }) => {
  test.setTimeout(600_000);

  await test.step('sign up by sector and type', async () => {
    await page.goto('/signup');
    await page.getByRole('radio', { name: /Energy & Heavy Industry/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: 'Power plant & utilities' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Organization name').fill('Kochi Thermal E2E');
    await page.getByLabel('Your name').fill('Asha Owner');
    await page.getByLabel('Email').fill(uniqueEmail('owner'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create my organization' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  await test.step('the install preview names the 8 stages for a power plant', async () => {
    const stages = page.getByRole('list', { name: 'The 8 stages of every job' });
    await expect(stages.getByRole('listitem')).toHaveCount(8, { timeout: 60_000 });
    await expect(stages).toContainText('Permit & clearance');
    await page.getByRole('button', { name: 'Install and open Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good to see you');
  });

  await test.step('simulated staff answer the calls', async () => {
    await page.goto('/settings');
    const auto = page.getByRole('radio', { name: /A simulated staff member/ });
    await auto.check();
    await expect(auto).toBeChecked();
  });

  let inviteLink = '';
  await test.step('invite the safety officer', async () => {
    await page.goto('/team');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Sunita Safety');
    await page.getByLabel('Email').fill(uniqueEmail('sunita'));
    await page.getByRole('checkbox', { name: /Safety officer/ }).check();
    await page.getByRole('button', { name: 'Create invite link' }).click();
    inviteLink = await page.getByLabel('Invite link').inputValue();
    expect(inviteLink).toContain('/invite/');
  });

  const officerContext = await browser.newContext();
  const sunita = await officerContext.newPage();
  await test.step('the safety officer joins from the link, in their own browser', async () => {
    await sunita.goto(new URL(inviteLink).pathname);
    await sunita.getByLabel('Choose a password').fill(PASSWORD);
    await sunita.getByRole('button', { name: /^Join / }).click();
    await expect(sunita.getByRole('heading', { level: 1 })).toContainText('Good to see you, Sunita');
  });

  let caseUrl = '';
  await test.step('the owner raises a hot-work request', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New request' }).first().click();
    await page.getByLabel("What's needed?").fill(WELDING);
    await page.getByRole('button', { name: 'Raise job' }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    caseUrl = new URL(page.url()).pathname;
  });

  const canvas = page.getByTestId('case-canvas');
  await test.step('the stages run on their own up to the permit, which waits for the safety officer', async () => {
    await expect(canvas.locator('[data-stage="approve"]')).toHaveAttribute('data-stage-state', 'waiting', { timeout: 240_000 });
    for (const stage of ['request', 'review', 'classify', 'assign']) {
      await expect(canvas.locator(`[data-stage="${stage}"]`)).toHaveAttribute('data-stage-state', /done|skipped/);
    }
    await expect(canvas.locator('[data-person]')).toContainText('Safety officer');
    await expect(page.getByRole('region', { name: 'Approval' })).toBeVisible();
  });

  await test.step('the safety officer opens it from their inbox and approves it inline', async () => {
    await sunita.goto('/approvals');
    const gate = sunita.locator('article[data-kind="case_gate"]').first();
    await gate.getByRole('link', { name: 'Open the case' }).click();
    await sunita.getByLabel('Note for the record').fill('Permit HW-118 issued, area checked');
    await sunita.getByRole('region', { name: 'Approval' }).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(sunita.getByRole('region', { name: 'Approval' })).toHaveCount(0);
  });

  await test.step('the work runs (the owner approves any agent step) until the sign-off waits', async () => {
    await expect
      .poll(
        async () => {
          await approveAgentSteps(page);
          await page.goto(caseUrl);
          return canvas.locator('[data-stage="close"]').getAttribute('data-stage-state');
        },
        { timeout: 360_000, intervals: [5_000] },
      )
      .toBe('waiting');
  });

  await test.step('the safety officer signs off, and the job closes with its report', async () => {
    await sunita.goto(caseUrl);
    await sunita.getByRole('region', { name: 'Sign-off' }).getByRole('button', { name: 'Sign off' }).click();
    await expect(canvas.locator('[data-stage="report"]')).toHaveAttribute('data-stage-state', 'done', { timeout: 240_000 });
    await expect(page.getByRole('article', { name: /^Report for JOB-/ })).toBeVisible();
    await expect(page.getByText('Signed off by Sunita Safety.')).toBeVisible();
  });

  await test.step('Reports lists the job', async () => {
    await page.goto('/reports');
    await expect(page.getByRole('region', { name: 'Requests' })).toContainText('JOB-');
  });

  await officerContext.close();
});
```

- [ ] **Step 4: Cases, hostile text, reduced motion and the public form**

Create `master-ai-web/e2e/cases.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { newOrganization, sidewaysOverflow, signInAs, waitForCase, WELDING } from './helpers';

test('long request text wraps and stays text', async ({ page }) => {
  const org = await newOrganization('travel-agency');
  const text = [
    '<b>Bold?</b> <script>window.__pwned = true</script>',
    'x'.repeat(300),
    'The group of 42 students from St. Mary’s needs the Munnar deposit refunded. '.repeat(60),
  ]
    .join(' ')
    .slice(0, 4000);
  const c = await org.api.cases.create({ text });
  await signInAs(page, org);

  await page.goto(`/cases/${c.id}`);
  await page.getByText('Their own words').click({ timeout: 60_000 });
  await expect(page.getByTestId('request-text')).toContainText('<script>window.__pwned = true</script>');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(page.locator('main script')).toHaveCount(0);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(`/cases?q=${encodeURIComponent(c.code)}`);
  await expect(page.getByRole('link', { name: new RegExp(c.code) })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

test('reduced motion stops the live stage, and the halo becomes a static ring', async ({ page }) => {
  const org = await newOrganization('power-plant');
  const c = await org.api.cases.create({ text: WELDING });
  await waitForCase(org.api, c.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  await signInAs(page, org);

  const halo = page.getByTestId('case-canvas').locator('[data-stage="approve"] .live-halo');
  const animation = () => halo.evaluate((el) => getComputedStyle(el).animationName);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/cases/${c.id}`);
  await expect.poll(animation).toBe('oh-halo');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animation).toBe('none');
  expect(Number(await halo.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0);
  const ping = page.getByTestId('case-canvas').locator('[data-person] .pulse-dot');
  expect(await ping.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('a customer raises a request through the public form, and it arrives as a case', async ({ page, browser }) => {
  const org = await newOrganization('municipal');
  await signInAs(page, org);
  await page.goto('/settings');
  await page.locator('#key-label').fill('Website');
  await page.getByRole('button', { name: 'Make a form link' }).click();
  const link = await page.getByLabel('Form link').inputValue();

  const customerContext = await browser.newContext();
  const form = await customerContext.newPage();
  await form.goto(new URL(link).pathname);
  await form.getByLabel('Your name').fill('Ramesh');
  await form.getByLabel('Phone').fill('9846001122');
  await form.getByLabel('What do you need?').fill('Street light pole 14 in Sector 4 is sparking after the rain');
  await form.getByRole('button', { name: /^Send / }).click();
  const code = (await form.getByText(/^[A-Z]{2,4}-\d{4}$/).textContent())!.trim();
  await customerContext.close();

  await page.goto(`/cases?q=${encodeURIComponent(code)}`);
  await expect(page.getByRole('link', { name: new RegExp(code) })).toBeVisible();
});
```

- [ ] **Step 5: A member's view and the light theme**

Create `master-ai-web/e2e/roles.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createClient } from '@onehuman/sdk';
import { API_URL, newOrganization, PASSWORD, signInAs, uniqueEmail } from './helpers';

test('a member sees the work pages only, keeps New request, and has no kill switch or team controls', async ({ page }) => {
  const org = await newOrganization('power-plant');
  const invite = await org.api.invites.create({ name: 'Manoj Member', email: uniqueEmail('manoj') });
  const auth = await createClient({ baseUrl: API_URL }).invites.accept(org.tenant.id, invite.path.split('/').pop()!, { password: PASSWORD });
  await signInAs(page, { auth, tenant: auth.tenant });

  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Cases', 'Approvals', 'Team', 'Routines', 'Calls', 'Reports', 'Knowledge']);
  await expect(page.getByRole('button', { name: /all agents/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New request' }).first()).toBeVisible();

  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'People with a login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite a person' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
});
```

Create `master-ai-web/e2e/theme.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { lightPalette } from '@onehuman/ui';
import { newOrganization, signInAs } from './helpers';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('the light theme puts the same app on the light background', async ({ page }) => {
  const org = await newOrganization('it-services');
  await signInAs(page, org);
  await page.addInitScript(() => localStorage.setItem('onehuman.theme', 'light'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(lightPalette.background));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
```

- [ ] **Step 6: Phone width**

Create `master-ai-web/e2e/layout.spec.ts` (runs in the 390px phone project only):

```ts
import { expect, test } from '@playwright/test';
import { newOrganization, sidewaysOverflow, signInAs } from './helpers';

test('no sideways scroll at phone width, and the main buttons are big enough to tap', async ({ page }) => {
  const org = await newOrganization('hospital');
  const c = await org.api.cases.create({ text: `Patient in bed 12 needs the discharge summary approved before 5 pm today. ${'y'.repeat(300)}` });
  await signInAs(page, org);

  for (const path of ['/', '/cases', `/cases/${c.id}`, '/approvals']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await sidewaysOverflow(page), path).toBeLessThanOrEqual(0);
  }

  await page.goto('/');
  for (const button of await page.getByRole('button', { name: 'New request' }).all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
```

- [ ] **Step 7: Run them**

With `pnpm infra:up` done and one `pnpm dev` running in another terminal:

Run: `pnpm e2e`
Expected: 7 passed: `journey`, `cases` ×3, `roles` and `theme` on desktop, and `layout` on the phone. On a failure, open the trace (`pnpm --filter @onehuman/web exec playwright show-trace test-results/<test>/trace.zip`), find the cause with superpowers:systematic-debugging, and fix the screen.

Run: `pnpm turbo run build typecheck test`
Expected: all succeed (the web typecheck now covers `e2e/` too).

- [ ] **Step 8: Document the command**

In `CLAUDE.md`, under **Commands**, after the `pnpm smoke` line, add:

```markdown
- `pnpm e2e` — browser tests (Playwright, Chromium) against a running `pnpm dev`: the signup-to-report journey at desktop width, plus a 390px phone project
```

- [ ] **Step 9: Commit**

```bash
git add master-ai-web package.json pnpm-lock.yaml .gitignore CLAUDE.md
git commit -m "test(web): browser tests from signup to report, at desktop and phone widths"
```
