// Generates dist/theme.css from the TypeScript tokens so web (CSS variables)
// and mobile (JS objects) read the same values.
import { writeFileSync } from 'node:fs';
import { cssVariables } from '../dist/index.mjs';

writeFileSync(new URL('../dist/theme.css', import.meta.url), cssVariables());
console.log('ui: wrote dist/theme.css');
