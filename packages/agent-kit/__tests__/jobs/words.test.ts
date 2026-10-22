import { describe, expect, it } from 'vitest';
import { findEscalation, matchWords, type EffectiveEscalation } from '../../src/jobs';

const set = (id: string, words: string[]): EffectiveEscalation => ({
  id,
  label: id,
  words,
  reply: null,
  alert: `${id} alert`,
  inherited: false,
  fromPack: false,
});

describe('matchWords', () => {
  it('matches whole words ignoring punctuation and case', () => {
    expect(matchWords('Fire! Please help', ['fire'])).toEqual(['fire']);
  });
  it('does not match inside longer words', () => {
    expect(matchWords('check the firewall', ['fire'])).toEqual([]);
  });
  it('allows common suffixes', () => {
    expect(matchWords('water is LEAKING', ['leak'])).toEqual(['leak']);
  });
  it('matches phrases across spaces', () => {
    expect(matchWords('smell of gas  leak.', ['gas leak'])).toEqual(['gas leak']);
  });
  it('matches Devanagari and romanised Hindi', () => {
    expect(matchWords('घर में आग लगी है', ['आग'])).toEqual(['आग']);
    expect(matchWords('bhaiya aag lag gayi', ['aag'])).toEqual(['aag']);
  });
  it('applies the suffix to the last phrase token only', () => {
    expect(matchWords('gas leaks', ['gas leak'])).toEqual(['gas leak']);
    expect(matchWords('gases leak', ['gas leak'])).toEqual([]);
  });
  it('ignores zero-width characters inside a word, in the text or in the list', () => {
    for (const ch of ['​', '‌', '‍', '﻿', '⁠', '­']) {
      expect(matchWords(`आत्म${ch}हत्या`, ['आत्महत्या']), JSON.stringify(ch)).toEqual(['आत्महत्या']);
      expect(matchWords(`sui${ch}cide`, ['suicide']), JSON.stringify(ch)).toEqual(['suicide']);
    }
    expect(matchWords('आत्महत्या', ['आत्म‍हत्या'])).toEqual(['आत्म‍हत्या']);
  });
  it('reads a run of # as a number with exactly that many digits', () => {
    expect(matchWords('mera pin 1234', ['pin ####'])).toEqual(['pin ####']);
    expect(matchWords('OTP: 4821 hai', ['otp ####'])).toEqual(['otp ####']);
    expect(matchWords('मेरा पिन १२३४ है', ['पिन ####'])).toEqual(['पिन ####']);
    expect(matchWords('pin is 560034', ['pin ####', 'pin is ####'])).toEqual([]);
    expect(matchWords('pin 123', ['pin ####'])).toEqual([]);
    expect(matchWords('pin abcd', ['pin ####'])).toEqual([]);
    expect(matchWords('otp4821', ['otp ####'])).toEqual([]);
    expect(matchWords('my otp is 482193', ['otp is ######'])).toEqual(['otp is ######']);
  });
});

describe('findEscalation', () => {
  it('returns the matching set and words', () => {
    expect(findEscalation('there is a crack in the beam', [set('safety', ['crack', 'collapse'])])?.words).toEqual(['crack']);
  });
  it('returns the first matching set', () => {
    const r = findEscalation('fire and crack', [set('a', ['fire']), set('b', ['crack'])]);
    expect(r?.set.id).toBe('a');
  });
  it('returns null without a match', () => {
    expect(findEscalation('all fine', [set('a', ['fire'])])).toBeNull();
  });
});
