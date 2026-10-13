import { readFileSync } from 'node:fs';
import { checkDraft } from './check-lib.ts';
import { formatScorecard } from './runner.ts';

/**
 * pnpm pack:check --pack <pack.yaml> [--suite <suite.yaml>]
 * Checks a draft pack and its test set against the packs on disk.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const packPath = arg('pack');
if (!packPath) {
  console.error('Usage: pnpm pack:check --pack <pack.yaml> [--suite <suite.yaml>]');
  process.exit(2);
}
const suitePath = arg('suite');
const result = checkDraft({
  packYaml: readFileSync(packPath, 'utf8'),
  suiteYaml: suitePath ? readFileSync(suitePath, 'utf8') : undefined,
  packsDir: new URL('../../packs', import.meta.url).pathname,
});
if (result.scorecard) console.log(formatScorecard(result.scorecard));
if (result.ok) console.log(`✓ ${result.packId}: no issues`);
else console.log(`✗ ${result.packId ?? packPath}: ${result.issues.length} issue(s)\n- ${result.issues.join('\n- ')}`);
process.exit(result.ok ? 0 : 1);
