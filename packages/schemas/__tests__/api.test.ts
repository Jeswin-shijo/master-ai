import { describe, expect, it } from 'vitest';
import {
  CallSettingsInputSchema,
  CreateCaseInputSchema,
  CreateIntakeKeyInputSchema,
  CreateInviteInputSchema,
  IntakeCaseInputSchema,
  LoginInputSchema,
  PublicFormInputSchema,
  SignupInputSchema,
} from '../src/api';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe('sign-up and sign-in', () => {
  const signup = { companyName: '  Kochi Thermal  ', ownerName: 'Asha', email: 'Asha@Example.COM', password: 'correct horse', sector: 'energy-heavy-industry', orgType: 'power-plant' };

  it('keeps one spelling of an email, and trims names', () => {
    expect(SignupInputSchema.parse(signup)).toMatchObject({ email: 'asha@example.com', companyName: 'Kochi Thermal' });
    expect(LoginInputSchema.parse({ email: 'ASHA@example.com', password: 'x' }).email).toBe('asha@example.com');
  });

  it('wants a password of at least 8 characters, a real sector, and a company name', () => {
    expect(SignupInputSchema.safeParse({ ...signup, password: 'short' }).success).toBe(false);
    expect(SignupInputSchema.safeParse({ ...signup, sector: 'farming' }).success).toBe(false);
    expect(SignupInputSchema.safeParse({ ...signup, companyName: ' A ' }).success).toBe(false);
  });

  it('takes the owner’s own words as the organization type', () => {
    expect(SignupInputSchema.safeParse({ ...signup, orgType: 'Dental clinic in Kochi' }).success).toBe(true);
  });
});

describe('a request', () => {
  it('needs at least a few words, and not a book', () => {
    expect(CreateCaseInputSchema.safeParse({ text: 'ok' }).success).toBe(false);
    expect(CreateCaseInputSchema.safeParse({ text: 'Fix the gate' }).success).toBe(true);
    expect(CreateCaseInputSchema.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('refuses a negative amount', () => {
    expect(CreateCaseInputSchema.safeParse({ text: 'Refund the deposit', amountInr: -1 }).success).toBe(false);
    expect(CreateCaseInputSchema.safeParse({ text: 'Refund the deposit', amountInr: 25000 }).success).toBe(true);
  });
});

describe('the public request form', () => {
  const form = { name: 'Ravi Kumar', text: 'The street light outside gate 2 is off.' };

  it('needs a phone number or an email, and says so in words', () => {
    const r = PublicFormInputSchema.safeParse(form);
    expect(messages(r)).toEqual(['Give a phone number or an email so we can reach you']);
    expect(PublicFormInputSchema.safeParse({ ...form, phone: '+91 98470 12345' }).success).toBe(true);
    expect(PublicFormInputSchema.safeParse({ ...form, email: 'ravi@example.com' }).success).toBe(true);
  });

  it('refuses a phone number too short to call', () => {
    expect(PublicFormInputSchema.safeParse({ ...form, phone: '123' }).success).toBe(false);
  });
});

describe('the intake API', () => {
  it('needs who is asking, and trims the sender’s own reference', () => {
    expect(IntakeCaseInputSchema.safeParse({ text: 'Feeder 7 tripped' }).success).toBe(false);
    expect(IntakeCaseInputSchema.parse({ text: 'Feeder 7 tripped', requester: { name: 'SCADA' }, externalRef: '  evt-1  ' }).externalRef).toBe('evt-1');
  });

  it('needs an API key to say whether it is a system or a partner; a form link never does', () => {
    expect(messages(CreateIntakeKeyInputSchema.safeParse({ kind: 'api', label: 'ERP' }))).toEqual(['An API key needs a source: system or partner']);
    expect(CreateIntakeKeyInputSchema.safeParse({ kind: 'api', label: 'ERP', source: 'system' }).success).toBe(true);
    expect(CreateIntakeKeyInputSchema.safeParse({ kind: 'form', label: 'Website' }).success).toBe(true);
  });
});

describe('an invite', () => {
  it('is for a member with no approval roles unless it says otherwise', () => {
    expect(CreateInviteInputSchema.parse({ name: 'Sunita', email: 'Sunita@Example.com' })).toEqual({ name: 'Sunita', email: 'sunita@example.com', role: 'member', approverRoles: [] });
  });

  it('can never make an owner, and takes role ids in their written form only', () => {
    expect(CreateInviteInputSchema.safeParse({ name: 'X', email: 'x@example.com', role: 'owner' }).success).toBe(false);
    expect(CreateInviteInputSchema.safeParse({ name: 'X', email: 'x@example.com', approverRoles: ['Safety Officer'] }).success).toBe(false);
    expect(CreateInviteInputSchema.safeParse({ name: 'X', email: 'x@example.com', approverRoles: ['safety-officer'] }).success).toBe(true);
  });
});

describe('call settings for outside parties', () => {
  it('takes calling hours for customers and suppliers and a daily cap', () => {
    const s = CallSettingsInputSchema.parse({ partyHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00' }, followUpsPerDay: 20 });
    expect(s).toEqual({ partyHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00' }, followUpsPerDay: 20 });
    expect(CallSettingsInputSchema.safeParse({ followUpsPerDay: 0 }).success).toBe(false);
    expect(CallSettingsInputSchema.safeParse({ followUpsPerDay: 201 }).success).toBe(false);
  });
});
