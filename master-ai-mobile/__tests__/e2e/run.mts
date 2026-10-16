/**
 * `pnpm e2e:mobile`: the phone flows in Expo Go on the Android emulator.
 * Needs `pnpm dev` (API :3000), Metro (`pnpm --filter @onehuman/mobile start`, :8082),
 * a running emulator with Expo Go, and the Maestro CLI in ~/.maestro/bin.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { API_URL, PASSWORD, seed, seedLists } from './seed.mts';

const ADB = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
const MAESTRO = process.env.MAESTRO ?? join(homedir(), '.maestro/bin/maestro');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const answers = (url: string) =>
  fetch(url).then(
    (r) => r.ok,
    () => false,
  );
const adb = (...args: string[]) => execFileSync(ADB, args).toString();

if (!(await answers(`${API_URL}/health`))) fail(`The API is not answering at ${API_URL}. Start everything with \`pnpm dev\` first.`);
if (!(await answers('http://localhost:8082/status'))) fail('Metro is not running on :8082. Run `pnpm --filter @onehuman/mobile start` in another terminal.');
if (!/emulator-\d+\s+device/.test(adb('devices'))) fail('No Android emulator is running. Start it with `~/Library/Android/sdk/emulator/emulator -avd Pixel_10_Pro`.');
if (!adb('shell', 'pm', 'list', 'packages', 'host.exp.exponent').includes('host.exp.exponent')) fail('Expo Go is not on the emulator. Press `a` once in the Metro terminal to install it.');
for (const port of ['3000', '8082']) adb('reverse', `tcp:${port}`, `tcp:${port}`);

const env = { ...(await seed()), ...(await seedLists()) };
console.log(`✓ Seeded ${env.COMPANY}: ${env.HOT_WORK_CODE} waits for the safety officer, ${env.OVERHAUL_CODE} for the owner`);
console.log(`✓ Seeded a trader: bill ${env.LISTS_BILL} has a customer's "paid" waiting in Lists`);

// The live stage pulses forever, and a screen that never stops animating never lets UI Automator
// read it. So the flows run with Android's animations off, which is also the phone's reduced-motion
// setting: the live stage shows its still ring (Review Focus 4). The previous values come back after.
const SCALES = ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale'];
const before = SCALES.map((k) => adb('shell', 'settings', 'get', 'global', k).trim());
for (const k of SCALES) adb('shell', 'settings', 'put', 'global', k, '0');

const vars = Object.entries({ ...env, PASSWORD }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const run = spawnSync(MAESTRO, ['test', join(import.meta.dirname, 'flows'), ...vars], { stdio: 'inherit' });

SCALES.forEach((k, i) => adb('shell', 'settings', 'put', 'global', k, before[i] === 'null' ? '1' : before[i]!));
process.exit(run.status ?? 1);
