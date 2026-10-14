# @onehuman/ui

The "Glow" design tokens, shared by web and mobile: a violet-tinted navy base, warm orange actions, and glass cards lit from inside (inspired by n8n.io).

- `darkPalette` and `lightPalette`: every colour token (background, surface, node, lines, glow, warning, success, danger, accent…). The apps use these, never raw colours.
- `gradients` (the action and cool gradients), `effects`, `radius`, `space`, `fontSize` (nothing under 13), and `fontFamily` (Red Hat Display and Red Hat Text).
- `cssVariables()`: the palette as CSS variables for the web app's Tailwind theme.
- `contrastRatio`: used by the tests to check that text meets WCAG AA, including white labels on the action gradient.

Tests (in `__tests__/`): `contrast.test.ts` and `native.test.ts`. Each app also has a guard test that fails on raw colours (`master-ai-web/__tests__/unit/tokens.test.ts`, `master-ai-mobile/__tests__/unit/tokens.test.ts`).
