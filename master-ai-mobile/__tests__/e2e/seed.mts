/**
 * A fresh power plant for the phone: the owner, a safety officer, a plain
 * member, and two jobs waiting at their approval gates, one for the safety
 * officer and one routed to the owner (nobody holds the plant head role).
 * Run it directly to print the logins: `node master-ai-mobile/__tests__/e2e/seed.mts`.
 */
import { randomBytes } from 'node:crypto';
import { createClient } from '@onehuman/sdk';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';
/** A run-together word, so the phone has to wrap or clamp the title (Review Focus 1). */
export const LONG_WORD = 'ChuteLinerPlateWeldingConveyorThreeBTransferHouseUnitTwoBoilerSideWork';

const email = (who: string) => `${who}+${randomBytes(4).toString('hex')}@example.com`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Seeded {
  COMPANY: string;
  OWNER_EMAIL: string;
  SUNITA_EMAIL: string;
  MANOJ_EMAIL: string;
  HOT_WORK_CODE: string;
  HOT_WORK_ID: string;
  OVERHAUL_CODE: string;
}

export async function seed(): Promise<Seeded> {
  let token: string | null = null;
  const owner = createClient({ baseUrl: API_URL, getToken: () => token });
  const ownerEmail = email('owner');
  const auth = await owner.auth.signup({
    companyName: `Phone Plant ${randomBytes(2).toString('hex')}`,
    ownerName: 'Asha Owner',
    email: ownerEmail,
    password: PASSWORD,
    sector: 'energy-heavy-industry',
    orgType: 'power-plant',
  });
  token = auth.token;
  await owner.onboarding.install({ draftId: (await owner.onboarding.preview()).id, sampleData: true });

  const member = async (name: string, approverRoles: string[]) => {
    const address = email(name.split(' ')[0]!.toLowerCase());
    const invite = await owner.invites.create({ name, email: address, approverRoles });
    await createClient({ baseUrl: API_URL }).invites.accept(auth.tenant.id, invite.path.split('/').pop()!, { password: PASSWORD });
    return address;
  };
  const sunita = await member('Sunita Safety', ['safety-officer']);
  const manoj = await member('Manoj Member', []);

  const atGate = async (text: string) => {
    const created = await owner.cases.create({ text });
    for (let i = 0; i < 120; i++) {
      const d = await owner.cases.get(created.id);
      if (d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve')) return d.case;
      await sleep(1000);
    }
    throw new Error(`${created.code} never reached its approval`);
  };
  const hotWork = await atGate(`Hot work permit for ${LONG_WORD} tomorrow 10 am, 4 welders and 1 helper. Please arrange the permit.`);
  const overhaul = await atGate("Plan Unit-1 annual overhaul from 1 Dec for 20 days. It is in this year's outage plan. Get SLDC clearance and tell me.");
  return {
    COMPANY: auth.tenant.name,
    OWNER_EMAIL: ownerEmail,
    SUNITA_EMAIL: sunita,
    MANOJ_EMAIL: manoj,
    HOT_WORK_CODE: hotWork.code,
    HOT_WORK_ID: hotWork.id,
    OVERHAUL_CODE: overhaul.code,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ ...(await seed()), PASSWORD }, null, 2));
}
