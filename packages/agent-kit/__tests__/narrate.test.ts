import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { composeOfflinePack, forPeople, humanError, narrateStep, parsePack, resolvePack } from '../src/index';

const PACKS_DIR = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS_DIR)) {
  const file = join(PACKS_DIR, dir, 'pack.yaml');
  if (existsSync(file)) {
    const p = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(p.id, p);
  }
}
const pack = resolvePack(composeOfflinePack('Construction company'), (id) => registry.get(id), 'generated');
const priya = { id: 'fee2aa2f-e558-43e3-a123-a0c532bb301d', customerName: 'Priya Sharma', subject: 'Site visit for villa', status: 'new', followUpOn: '2026-10-10', value: 12000, phone: '+91 98523 14321' };

describe('narrateStep', () => {
  it('tells a search as what was found, with readable lines instead of JSON', () => {
    const n = narrateStep({ tool: 'records.search', status: 'executed', args: { entity: 'Enquiry', limit: 10 }, result: { entity: 'Enquiry', count: 1, records: [priya] }, pack });
    expect(n).toMatchObject({ text: 'Looked up enquiries and found 1.', short: 'Find enquiries', tone: 'info' });
    expect(n.items).toEqual(['Priya Sharma — Site visit for villa · new · follow up on Sat, 10 Oct · ₹12,000']);
  });

  it('reads a pack action as what happened to whom', () => {
    const n = narrateStep({ tool: 'enquiry.mark_contacted', status: 'executed', args: { id: priya.id }, result: { updated: true, id: priya.id, entity: 'Enquiry', data: { ...priya, status: 'contacted' } }, pack });
    expect(n.text).toBe('Marked Priya Sharma\'s enquiry ("Site visit for villa") as contacted.');
    expect(n.short).toBe('Mark contacted');
    expect(n.tone).toBe('done');
  });

  it('explains failures without ids', () => {
    const n = narrateStep({ tool: 'enquiry.mark_contacted', status: 'failed', args: { id: '669d140b-e786-4572-ad12-ded9bfc92ea8' }, error: 'Enquiry 669d140b-e786-4572-ad12-ded9bfc92ea8 not found', pack });
    expect(n.text).toBe("Couldn't mark the enquiry as contacted: that enquiry wasn't found.");
    expect(n.text).not.toMatch(/[0-9a-f]{8}-/);
    expect(n.tone).toBe('problem');
  });

  it('is honest that outbound messages are test-mode until a connector is attached', () => {
    const n = narrateStep({ tool: 'message.send', status: 'executed', args: { channel: 'whatsapp', to: 'Priya Sharma', body: 'Hello Priya, following up on your site visit.' }, result: { status: 'simulated' }, pack });
    expect(n.text).toBe('Sent a WhatsApp message to Priya Sharma (test mode: recorded, not actually sent yet).');
    expect(n.items).toEqual(['"Hello Priya, following up on your site visit."']);
  });

  it('words pending and refused steps for the owner', () => {
    const args = { amount: 12000, currency: 'INR', recipient: 'Asha Menon', reason: 'trip cancelled' };
    expect(narrateStep({ tool: 'refund.issue', status: 'awaiting_approval', args, pack }).text).toBe('Waiting for your approval to refund ₹12,000 to Asha Menon (trip cancelled).');
    expect(narrateStep({ tool: 'refund.issue', status: 'rejected', args, notes: 'Check with me first', pack }).text).toBe('You said no to: refund ₹12,000 to Asha Menon (trip cancelled) ("Check with me first").');
    expect(narrateStep({ tool: 'refund.issue', status: 'blocked', args, pack }).tone).toBe('problem');
  });

  it('tells phone delegation with the outcome of the calls', () => {
    const n = narrateStep({
      tool: 'staff.delegate',
      status: 'executed',
      args: { assignee: 'Ravi', task: 'Make sure the site is cleared before Friday.' },
      result: { summary: "Ravi confirmed it's done: Yes, all cleared.", staff: { name: 'Ravi Kumar' } },
      pack,
    });
    expect(n.text).toBe("Phoned Ravi Kumar to get this done: Make sure the site is cleared before Friday. Ravi confirmed it's done: Yes, all cleared.");
    expect(n.short).toBe('Call Ravi');
  });
});

describe('humanError', () => {
  it.each([
    ['Enquiry 669d140b-e786-4572-ad12-ded9bfc92ea8 not found', "that enquiry wasn't found"],
    [null, 'something went wrong'],
    ['Amount is above the limit.', 'amount is above the limit'],
  ])('%s → %s', (input, expected) => {
    expect(humanError(input)).toBe(expected);
  });
});

describe('forPeople', () => {
  it('drops record ids from sentences a model wrote', () => {
    expect(forPeople('There is an open P1 incident (cd70c34a-12c5-48ef-97c9-31fbce2dccca) which blocks releases.')).toBe('There is an open P1 incident which blocks releases.');
    expect(forPeople('Update record 3f2b9c1e-8a4d-4c2e-9b7a-1d2e3f4a5b6c before Friday.')).toBe('Update record before Friday.');
    expect(forPeople('Waiting on 3f2b9c1e-8a4d-4c2e-9b7a-1d2e3f4a5b6c.')).toBe('Waiting on.');
  });

  it('leaves ordinary sentences alone', () => {
    expect(forPeople('Ramesh got a shock at 3:40 pm (pole 12, Kamalpur feeder).')).toBe('Ramesh got a shock at 3:40 pm (pole 12, Kamalpur feeder).');
  });
});
