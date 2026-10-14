import { ConflictException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { LoginInputSchema, SignupInputSchema } from '@onehuman/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readToken } from '../../src/common/auth';
import { IdentityService } from '../../src/identity/identity.service';
import { MembersService } from '../../src/members/members.service';
import { anyIp, boot, newOrg, PASSWORD, uniqueEmail, type Harness, type Org } from './harness';

let h: Harness;
let identity: IdentityService;
let plant: Org;

beforeAll(async () => {
  h = await boot();
  identity = h.get(IdentityService);
  plant = await newOrg(h, 'power-plant');
});
afterAll(() => h.close());

const login = (email: string, password: string, ip = anyIp(), tenantId?: string) => identity.login(LoginInputSchema.parse({ email, password, tenantId }), ip);
const status = (err: unknown) => (err instanceof HttpException ? err.getStatus() : err);

describe('signing up', () => {
  it('creates the company, its owner and the first audit line in one go', async () => {
    const email = uniqueEmail('new');
    const auth = await identity.signup(
      SignupInputSchema.parse({ companyName: 'Kochi Thermal', ownerName: 'Asha', email, password: PASSWORD, sector: 'energy-heavy-industry', orgType: 'power-plant' }),
      anyIp(),
    );
    expect(auth.user).toMatchObject({ role: 'owner', name: 'Asha', email });
    expect(auth.tenant).toMatchObject({ name: 'Kochi Thermal', orgType: 'power-plant', onboarded: false });
    expect(readToken(auth.token)).toMatchObject({ tenantId: auth.tenant.id, role: 'owner' });
    const { rows } = await h.owner.query<{ type: string; seq: string }>(`select type, seq::text from audit_events where tenant_id = $1 order by seq`, [auth.tenant.id]);
    expect(rows).toEqual([{ type: 'tenant.created', seq: '1' }]);
  });

  it('keeps one login per email, whatever its case', async () => {
    const input = SignupInputSchema.parse({ companyName: 'Second Co', ownerName: 'Asha', email: plant.email.toUpperCase(), password: PASSWORD, sector: 'public-services', orgType: 'hospital' });
    await expect(identity.signup(input, anyIp())).rejects.toBeInstanceOf(ConflictException);
  });

  it('never stores the password itself', async () => {
    const { rows } = await h.owner.query<{ hash: string }>(`select password_hash as hash from users where email = $1`, [plant.email]);
    expect(rows[0]!.hash).toMatch(/^scrypt\$16384\$/);
    expect(rows[0]!.hash).not.toContain(PASSWORD);
  });
});

describe('signing in', () => {
  it('opens the company with the right password, whatever the email’s case', async () => {
    const auth = await login(plant.email.toUpperCase(), PASSWORD);
    expect(auth.tenant.id).toBe(plant.tenantId);
    expect(readToken(auth.token)?.principalId).toBe(plant.session.principalId);
  });

  it('says the same thing for a wrong password and an unknown email', async () => {
    const wrong = await login(plant.email, 'not the password').catch((e: Error) => e);
    const unknown = await login(uniqueEmail('nobody'), PASSWORD).catch((e: Error) => e);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect((wrong as Error).message).toBe((unknown as Error).message);
  });

  it('stops after 10 wrong passwords for one email, from any address, even with the right one', async () => {
    const org = await newOrg(h, 'logistics');
    for (let i = 0; i < 10; i++) expect(status(await login(org.email, `wrong-${i}`).catch((e) => e))).toBe(401);
    expect(status(await login(org.email, PASSWORD).catch((e) => e))).toBe(429);
    // Other people are not affected.
    expect((await login(plant.email, PASSWORD)).tenant.id).toBe(plant.tenantId);
  });

  it('lets someone in several companies pick one, and only theirs', async () => {
    const other = await newOrg(h, 'hospital');
    const made = await h.get(MembersService).invite(other.session, { name: 'Asha', email: plant.email, role: 'member', approverRoles: [] });
    await h.get(MembersService).accept(other.tenantId, made.path.split('/').pop()!, { password: PASSWORD }, anyIp());

    const there = await login(plant.email, PASSWORD, anyIp(), other.tenantId);
    expect(there.tenant.id).toBe(other.tenantId);
    expect(there.user.role).toBe('member');
    expect(there.companies?.map((c) => c.id).sort()).toEqual([plant.tenantId, other.tenantId].sort());

    const back = await identity.switchCompany(plant.session, other.tenantId);
    expect(back.tenant.id).toBe(other.tenantId);
    const stranger = await newOrg(h, 'ngo');
    await expect(identity.switchCompany(plant.session, stranger.tenantId)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
