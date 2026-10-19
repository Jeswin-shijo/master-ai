import { describe, expect, it } from 'vitest';
import type { JobCheck } from '@onehuman/schemas';
import { runCheck, type EffectiveEscalation } from '../../src/jobs';

const set: EffectiveEscalation = {
  id: 'legal',
  label: 'Legal threat',
  words: ['lawyer', 'court'],
  reply: null,
  alert: 'owner',
  inherited: false,
  fromPack: true,
};
const ctx = (seen = false) => ({ escalations: [set], seen: async () => seen });
const base = { on_fail: 'stop', message: 'Check failed' } as const;
const chk = (body: Record<string, unknown>) => ({ ...base, ...body }) as JobCheck;

describe('runCheck', () => {
  it('escalate', async () => {
    const c = chk({ escalate: { text: '{{trigger.text}}' } });
    const bad = await runCheck(c, { trigger: { text: 'I will call my lawyer' } }, ctx());
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.message).toBe('Check failed');
      expect(bad.escalation?.set.id).toBe('legal');
    }
    expect((await runCheck(c, { trigger: { text: 'hello' } }, ctx())).ok).toBe(true);
  });
  it('required', async () => {
    const c = chk({ required: { fields: ['trigger.name', 'trigger.phone'] } });
    expect((await runCheck(c, { trigger: { name: 'A', phone: '1' } }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { trigger: { name: 'A', phone: '' } }, ctx())).ok).toBe(false);
  });
  it('in_data', async () => {
    const c = chk({ in_data: { value: 'draft.text', among: 'listings' } });
    const listings = [{ price: 4500000 }];
    const ok = await runCheck(c, { draft: { text: 'The 2BHK is ₹45,00,000' }, listings }, ctx());
    expect(ok.ok).toBe(true);
    const bad = await runCheck(c, { draft: { text: 'The 2BHK is ₹40,00,000' }, listings }, ctx());
    expect(bad.ok).toBe(false);
  });
  it('in_data reads Indian price formats', async () => {
    const c = chk({ in_data: { value: 'draft.text', among: 'listings' } });
    const listings = [{ price: 4500000 }];
    const run = (t: string) => runCheck(c, { draft: { text: t }, listings }, ctx());
    for (const t of ['Rs40,00,000', '₹40L', 'INR40,00,000', '₹9Cr', '1.2 crore', '40lakh'])
      expect((await run(t)).ok, t).toBe(false);
    for (const t of ['₹45L', '45 lakh', 'Rs45,00,000', 'The 2BHK is ₹45,00,000', '45Lakh', 'Rs. 45,00,000'])
      expect((await run(t)).ok, t).toBe(true);
  });
  it('in_data with a non-string value compares deeply', async () => {
    const c = chk({ in_data: { value: 'x', among: 'rows' } });
    expect((await runCheck(c, { x: { a: 1 }, rows: [{ k: { a: 1 } }] }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { x: { a: 2 }, rows: [{ k: { a: 1 } }] }, ctx())).ok).toBe(false);
  });
  it('limit with a string max path', async () => {
    const c = chk({ limit: { value: 'offer', max: 'listing.price', factor: 0.9 } });
    expect((await runCheck(c, { offer: 90, listing: { price: 100 } }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { offer: 95, listing: { price: 100 } }, ctx())).ok).toBe(false);
  });
  it('limit with min', async () => {
    const c = chk({ limit: { value: 'v', min: 10 } });
    expect((await runCheck(c, { v: 10 }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { v: 9 }, ctx())).ok).toBe(false);
  });
  it('adds_up', async () => {
    const c = chk({ adds_up: { total: 't', plus: ['a', 'b'], minus: ['d'], tolerance: 1 } });
    expect((await runCheck(c, { t: 110, a: 100, b: 20, d: 10 }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { t: 120, a: 100, b: 20, d: 10 }, ctx())).ok).toBe(false);
  });
  it('within_days', async () => {
    const c = chk({ within_days: { date: 'd', days: 7 } });
    const today = '2026-10-19';
    expect((await runCheck(c, { today, d: '2026-10-25' }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { today, d: '2026-10-27' }, ctx())).ok).toBe(false);
    expect((await runCheck(c, { today, d: '2026-10-18' }, ctx())).ok).toBe(false);
  });
  it('duplicate uses seen', async () => {
    const keys: string[] = [];
    const c = chk({ duplicate: { key: 'inv-{{trigger.no}}' } });
    const mk = (seen: boolean) => ({
      escalations: [],
      seen: async (k: string) => (keys.push(k), seen),
    });
    expect((await runCheck(c, { trigger: { no: 7 } }, mk(false))).ok).toBe(true);
    expect((await runCheck(c, { trigger: { no: 7 } }, mk(true))).ok).toBe(false);
    expect(keys[0]).toBe('inv-7');
  });
  it('says_not', async () => {
    const c = chk({ says_not: { text: 'draft.text', phrases: ['refund'] } });
    expect((await runCheck(c, { draft: { text: 'we will refund you' } }, ctx())).ok).toBe(false);
    expect((await runCheck(c, { draft: { text: 'thanks' } }, ctx())).ok).toBe(true);
  });
  it('valid', async () => {
    const c = chk({ valid: { value: 'p', as: 'pan' } });
    expect((await runCheck(c, { p: 'AAPFU0939F' }, ctx())).ok).toBe(true);
    expect((await runCheck(c, { p: 'nope' }, ctx())).ok).toBe(false);
  });
  it('calc returns value', async () => {
    const c = chk({ calc: { expr: 'a * 2' }, as: 'double' });
    expect(await runCheck(c, { a: 4 }, ctx())).toEqual({ ok: true, value: 8 });
    expect((await runCheck(chk({ calc: { expr: 'a / 0' }, as: 'x' }), { a: 4 }, ctx())).ok).toBe(false);
  });
  it('a missing path fails in plain words, without dots', async () => {
    const c = chk({ limit: { value: 'item.dueDate', max: 5 } });
    const r = await runCheck(c, { item: {} }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('due date');
      expect(r.message).not.toContain('.');
    }
  });
});
