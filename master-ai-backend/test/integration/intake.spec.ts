import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../src/common/auth';
import { CasesService } from '../../src/cases/cases.service';
import { IntakeService } from '../../src/cases/intake.service';
import { anyIp, boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let intake: IntakeService;
let plant: Org;
let clinic: Org;

beforeAll(async () => {
  h = await boot();
  intake = h.get(IntakeService);
  [plant, clinic] = await Promise.all([newOrg(h, 'power-plant'), newOrg(h, 'hospital')]);
});
afterAll(() => h.close());

const customer = { name: 'Ravi Kumar', phone: '+91 98470 12345', text: 'The street light outside gate 2 has been off for three nights.' };
const started = () => h.temporal.filter((c) => c.method === 'startCase').map((c) => (c.args[0] as { caseId: string }).caseId);

describe('the public request form', () => {
  it('shows the company and its word for a request, and opens a case that starts its stages', async () => {
    const made = await intake.createKey(plant.session, { kind: 'form', label: 'Website' });
    expect(made.formPath).toBe(`/r/${plant.tenantId}/${made.key}`);
    expect(await intake.form(plant.tenantId, made.key, anyIp())).toMatchObject({ caseLabel: 'Job' });
    const { code } = await intake.submitForm(plant.tenantId, made.key, customer, anyIp());
    expect(code).toMatch(/^JOB-\d{4}$/);
    const opened = (await h.get(CasesService).list(plant.tenantId, 'all')).find((c) => c.code === code)!;
    expect(opened).toMatchObject({ source: 'customer', requester: { name: 'Ravi Kumar' } });
    expect(started()).toContain(opened.id);
  });

  it("doesn't open under another company's id", async () => {
    const made = await intake.createKey(plant.session, { kind: 'form', label: 'Website' });
    await expect(intake.form(clinic.tenantId, made.key, anyIp())).rejects.toBeInstanceOf(NotFoundException);
    await expect(intake.submitForm(clinic.tenantId, made.key, customer, anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops working once its link is withdrawn', async () => {
    const made = await intake.createKey(plant.session, { kind: 'form', label: 'Old poster' });
    await intake.revokeKey(plant.session, made.id);
    await expect(intake.form(plant.tenantId, made.key, anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still takes customers’ requests while the kill switch is on; the owner’s own are refused', async () => {
    const org = await newOrg(h, 'municipal');
    const made = await intake.createKey(org.session, { kind: 'form', label: 'Ward office' });
    await h.owner.query(`update tenants set status = 'paused' where id = $1`, [org.tenantId]);
    await expect(intake.submitForm(org.tenantId, made.key, customer, anyIp())).resolves.toMatchObject({ code: expect.any(String) });
    await expect(h.get(CasesService).create(org.session, { text: customer.text })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('the intake API', () => {
  it('needs its key as a bearer token, and a form link is not one', async () => {
    const form = await intake.createKey(plant.session, { kind: 'form', label: 'Website' });
    const body = { text: customer.text, requester: { name: 'Billing system' } };
    await expect(intake.submit(plant.tenantId, undefined, body, anyIp())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(intake.submit(plant.tenantId, `Bearer ${form.key}`, body, anyIp())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers a repeated externalRef with the same case, even when both arrive at once', async () => {
    const api = await intake.createKey(plant.session, { kind: 'api', label: 'SCADA', source: 'system' });
    const body = { text: 'Feeder 7 tripped on earth fault at 14:02.', requester: { name: 'SCADA' }, externalRef: `scada-${Date.now()}` };
    const [one, two] = await Promise.all([
      intake.submit(plant.tenantId, `Bearer ${api.key}`, body, anyIp()),
      intake.submit(plant.tenantId, `Bearer ${api.key}`, body, anyIp()),
    ]);
    expect(one.caseId).toBe(two.caseId);
    expect([one.duplicate, two.duplicate].sort()).toEqual([false, true]);
    const again = await intake.submit(plant.tenantId, `Bearer ${api.key}`, body, anyIp());
    expect(again).toMatchObject({ caseId: one.caseId, duplicate: true });
  });
});

describe('intake keys', () => {
  it('are kept only as a hash, with a short hint to recognise them', async () => {
    const made = await intake.createKey(plant.session, { kind: 'api', label: 'ERP', source: 'partner' });
    const { rows } = await h.owner.query<{ key_hash: string; hint: string }>(`select key_hash, hint from intake_keys where id = $1`, [made.id]);
    expect(rows[0]!.key_hash).not.toContain(made.key);
    expect(made.key.endsWith(rows[0]!.hint) || made.key.startsWith(rows[0]!.hint)).toBe(true);
  });

  it('are made and withdrawn only by the owner or an admin', async () => {
    const member: Session = { ...plant.session, role: 'member' };
    await expect(intake.createKey(member, { kind: 'form', label: 'Mine' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(intake.listKeys(member)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
