import { describe, expect, it } from 'vitest';
import {
  CreateIntakeKeyInputSchema,
  PublicFormInputSchema,
  SignupInputSchema,
  summarizeEvent,
} from '@onehuman/schemas';
import { createClient } from './client';

describe('signup asks for the sector and organization type', () => {
  const base = { companyName: 'Kochi Thermal', ownerName: 'Asha', email: 'a@example.com', password: 'long enough' };

  it('refuses a signup without a sector', () => {
    expect(SignupInputSchema.safeParse({ ...base, orgType: 'power-plant' }).success).toBe(false);
  });

  it('accepts a ready-made type or the owner’s own words', () => {
    expect(SignupInputSchema.safeParse({ ...base, sector: 'energy-heavy-industry', orgType: 'power-plant' }).success).toBe(true);
    expect(SignupInputSchema.safeParse({ ...base, sector: 'finance-development', orgType: 'Insurance broker in Pune' }).success).toBe(true);
  });
});

describe('request bodies', () => {
  it('needs a phone or an email on the public form', () => {
    expect(PublicFormInputSchema.safeParse({ name: 'Ravi', text: 'Street light broken near the bus stand' }).success).toBe(false);
    expect(PublicFormInputSchema.safeParse({ name: 'Ravi', phone: '9847012345', text: 'Street light broken near the bus stand' }).success).toBe(true);
  });

  it('needs a source for an API key', () => {
    expect(CreateIntakeKeyInputSchema.safeParse({ kind: 'api', label: 'SCADA alarms' }).success).toBe(false);
    expect(CreateIntakeKeyInputSchema.safeParse({ kind: 'api', label: 'SCADA alarms', source: 'system' }).success).toBe(true);
    expect(CreateIntakeKeyInputSchema.safeParse({ kind: 'form', label: 'Website form' }).success).toBe(true);
  });
});

describe('case events read as sentences', () => {
  it('summarises a new case and a closed one', () => {
    expect(summarizeEvent('case.created', { code: 'WO-0042', title: 'Boiler feed pump B vibration', label: 'Work order' })).toBe(
      'New work order WO-0042: Boiler feed pump B vibration',
    );
    expect(summarizeEvent('case.closed', { code: 'WO-0042', status: 'closed', outcome: 'Pump realigned and tested' })).toBe(
      'WO-0042 closed: Pump realigned and tested',
    );
  });
});

describe('intake API client', () => {
  it('sends the intake key, not the session token', async () => {
    const seen: Record<string, string>[] = [];
    const api = createClient({
      baseUrl: 'http://api.test',
      getToken: () => 'session-token',
      fetch: (async (_url: string, init: { headers: Record<string, string> }) => {
        seen.push(init.headers);
        return new Response(JSON.stringify({ caseId: 'c1', code: 'WO-0001', duplicate: false }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await api.intake.submit('11111111-1111-4111-8111-111111111111', 'ohk_secret', { text: 'Feed pump trip alarm', requester: { name: 'SCADA' } });
    expect(seen[0]!.Authorization).toBe('Bearer ohk_secret');
  });
});
