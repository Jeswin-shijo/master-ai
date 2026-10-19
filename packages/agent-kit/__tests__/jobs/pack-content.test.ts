import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { escalationsFor, matchWords, parsePack, resolvePack, validatePackRefs } from '../../src/index';

const PACKS_DIR = join(__dirname, '../../../../packs');

function loadRegistry(): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const dir of readdirSync(PACKS_DIR)) {
    const file = join(PACKS_DIR, dir, 'pack.yaml');
    if (!existsSync(file)) continue;
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
  return registry;
}

const registry = loadRegistry();
const lookup = (id: string) => registry.get(id);
const ids = [...registry.keys()];
const DEVANAGARI = /\p{Script=Devanagari}/u;

describe('pack job cards', () => {
  it.each(ids)('%s: every own agent has a mission and at least two never items', (id) => {
    for (const agent of registry.get(id)!.agents) {
      expect(agent.job, `${id}/${agent.role} job`).toBeDefined();
      expect(agent.job!.mission.length, `${id}/${agent.role} mission`).toBeGreaterThan(0);
      expect(agent.job!.mission.length).toBeLessThanOrEqual(300);
      expect(agent.job!.never.length, `${id}/${agent.role} never`).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(ids)('%s: no jobs entry and clean references', (id) => {
    const resolved = resolvePack(registry.get(id)!, lookup);
    expect((registry.get(id)!.jobs ?? []).length).toBe(0);
    expect(validatePackRefs(resolved)).toEqual([]);
  });
});

describe('shared escalation sets', () => {
  const sets = registry.get('core-business')!.escalations ?? [];
  const get = (id: string) => sets.find((s) => s.id === id)!;

  it('defines the five sets with the right scope', () => {
    expect(sets.map((s) => [s.id, s.for])).toEqual([
      ['emergency', 'customer_facing'],
      ['distress', 'customer_facing'],
      ['anger', 'customer_facing'],
      ['legal-threat', 'customer_facing'],
      ['secrets', 'customer_facing'],
    ]);
    for (const s of sets) expect(s.alert).toBe('owner');
  });

  it('has Devanagari and Hinglish words in every set', () => {
    for (const s of sets) {
      expect(s.words.some((w) => DEVANAGARI.test(w)), `${s.id} devanagari`).toBe(true);
      expect(s.words.some((w) => /^[a-z ]+$/.test(w)), `${s.id} latin`).toBe(true);
    }
    expect(get('emergency').words).toContain('aag');
    expect(get('distress').words).toContain('khudkushi');
    expect(get('distress').words).not.toContain('madad');
  });

  it('uses the verbatim labels and replies', () => {
    expect(sets.map((s) => s.label)).toEqual([
      'Emergencies',
      'Distress or self-harm',
      'Anger or abuse',
      'Legal threats',
      'OTPs, PINs or card numbers',
    ]);
    expect(get('emergency').reply).toBe('If anyone is in danger, please call 112 now. We have alerted our team and a person will contact you right away.');
    expect(get('distress').reply).toBe(
      "We're sorry you are going through this. A person from our team will contact you shortly. If you are in danger or thinking of harming yourself, please call 112 or the Tele-MANAS helpline on 14416.",
    );
    expect(get('anger').reply).toBe("We're sorry. A person from our team will contact you shortly.");
    expect(get('legal-threat').reply).toBe('Thank you. A senior person from our team will contact you about this.');
    expect(get('secrets').reply).toBe("Please don't share OTPs, PINs, passwords or card numbers here. We will never ask for them.");
  });

  it('gives shared sets to customer-facing agents only', () => {
    const core = resolvePack(registry.get('core-business')!, lookup);
    expect(escalationsFor(core, 'case-coordinator')).toEqual([]);
    expect(escalationsFor(resolvePack(registry.get('crm-base')!, lookup), 'enquiry-intake').map((e) => e.id)).toEqual([
      'emergency',
      'distress',
      'anger',
      'legal-threat',
      'secrets',
    ]);
  });

  it('does not flag an ordinary password reset or khudkhushi misses', () => {
    expect(matchWords('I forgot my password, please reset', get('secrets').words)).toEqual([]);
    expect(matchWords('my password is abc', get('secrets').words)).toEqual(['password is']);
    expect(matchWords('mar jaunga main', get('distress').words)).toEqual(['mar jaunga']);
  });

  it('catches people sharing an OTP or PIN, and not an ordinary mention', () => {
    const words = get('secrets').words;
    for (const text of ['my otp is 4821', 'OTP hai 4821', 'mera pin 1234', 'मेरा ओटीपी 4821', 'मेरा पिन 1234 है']) {
      expect(matchWords(text, words), text).not.toEqual([]);
    }
    expect(matchWords('I forgot my password, please reset', words)).toEqual([]);
    expect(matchWords('पिन कोड 560001', words)).toEqual([]);
  });
});
