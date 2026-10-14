import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../src/common/auth';
import { MembersService } from '../../src/members/members.service';
import { anyIp, boot, newOrg, PASSWORD, uniqueEmail, type Harness, type Org } from './harness';

let h: Harness;
let members: MembersService;
let plant: Org;
let clinic: Org;

beforeAll(async () => {
  h = await boot();
  members = h.get(MembersService);
  [plant, clinic] = await Promise.all([newOrg(h, 'power-plant'), newOrg(h, 'hospital')]);
});
afterAll(() => h.close());

const tokenOf = (path: string) => path.split('/').pop()!;
const invite = (org: Org, over: Partial<{ email: string; role: 'admin' | 'member'; approverRoles: string[] }> = {}, by: Session = org.session) =>
  members.invite(by, { name: 'Sunita Safety', email: over.email ?? uniqueEmail('sunita'), role: over.role ?? 'member', approverRoles: over.approverRoles ?? ['safety-officer'] });

describe('an invite link', () => {
  it('opens and joins only the company that sent it', async () => {
    const made = await invite(plant);
    const token = tokenOf(made.path);
    await expect(members.view(clinic.tenantId, token, anyIp())).rejects.toBeInstanceOf(NotFoundException);
    await expect(members.accept(clinic.tenantId, token, { password: PASSWORD }, anyIp())).rejects.toBeInstanceOf(NotFoundException);
    // The right company still takes it.
    const view = await members.view(plant.tenantId, token, anyIp());
    expect(view).toMatchObject({ name: 'Sunita Safety', role: 'member', hasAccount: false });
    expect(view.approverRoles.map((r) => r.id)).toEqual(['safety-officer']);
  });

  it('is stored only as a hash: the token in the link is nowhere in the database', async () => {
    const made = await invite(plant);
    const token = tokenOf(made.path);
    const { rows } = await h.owner.query<{ n: string }>(
      `select count(*)::text as n from invites where token_hash = $1 or token_hash like '%' || $1 || '%'`,
      [token],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('makes the person a member with the roles it named, once', async () => {
    const made = await invite(plant, { approverRoles: ['safety-officer', 'plant-head'] });
    const token = tokenOf(made.path);
    const auth = await members.accept(plant.tenantId, token, { password: PASSWORD, name: 'Sunita S' }, anyIp());
    expect(auth.user).toMatchObject({ name: 'Sunita S', role: 'member', tenantId: plant.tenantId, approverRoles: ['safety-officer', 'plant-head'] });
    expect((await members.list(plant.tenantId)).some((m) => m.id === auth.user.principalId)).toBe(true);
    await expect(members.accept(plant.tenantId, token, { password: PASSWORD }, anyIp())).rejects.toBeInstanceOf(NotFoundException);
    await expect(members.view(plant.tenantId, token, anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops working once withdrawn', async () => {
    const made = await invite(plant);
    await members.revokeInvite(plant.session, made.id);
    await expect(members.view(plant.tenantId, tokenOf(made.path), anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops working once expired', async () => {
    const made = await invite(plant);
    await h.owner.query(`update invites set expires_at = now() - interval '1 minute' where id = $1`, [made.id]);
    await expect(members.view(plant.tenantId, tokenOf(made.path), anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops working when the admin who sent it is removed', async () => {
    const adminInvite = await invite(plant, { role: 'admin', approverRoles: [] });
    const admin = await members.accept(plant.tenantId, tokenOf(adminInvite.path), { password: PASSWORD, name: 'Manoj Admin' }, anyIp());
    const adminSession: Session = { userId: admin.user.userId, principalId: admin.user.principalId, tenantId: plant.tenantId, role: 'admin' };
    const fromAdmin = await invite(plant, {}, adminSession);
    await members.remove(plant.session, admin.user.principalId);
    await expect(members.accept(plant.tenantId, tokenOf(fromAdmin.path), { password: PASSWORD }, anyIp())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('sending an invite', () => {
  it("refuses an approval role this kind of organization doesn't have", async () => {
    await expect(invite(plant, { approverRoles: ['credit-manager'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second open invite for the same email', async () => {
    const email = uniqueEmail('twice');
    await invite(plant, { email });
    await expect(invite(plant, { email })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses someone who is already in the company', async () => {
    await expect(invite(plant, { email: plant.email })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('someone who already has a login', () => {
  it('joins a second company with their own password, and sees both companies', async () => {
    const made = await invite(clinic, { email: plant.email, approverRoles: [] });
    const token = tokenOf(made.path);
    expect((await members.view(clinic.tenantId, token, anyIp())).hasAccount).toBe(true);
    await expect(members.accept(clinic.tenantId, token, { password: 'not the password' }, anyIp())).rejects.toBeInstanceOf(UnauthorizedException);
    const auth = await members.accept(clinic.tenantId, token, { password: PASSWORD }, anyIp());
    expect(auth.companies?.map((c) => c.id).sort()).toEqual([plant.tenantId, clinic.tenantId].sort());
  });
});
