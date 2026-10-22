import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { escalationsFor, findEscalation, matchWords, parsePack, resolvePack, validatePackRefs, type EffectiveEscalation } from '../../src/index';

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

/**
 * Real messages through the real matcher. The shared sets reach every customer-facing desk and an
 * owner can't take a pack word out, so a word that fires on everyday messages stays for good.
 */
describe('shared escalation sets on real messages', () => {
  const shared: EffectiveEscalation[] = (registry.get('core-business')!.escalations ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    words: s.words,
    reply: s.reply ?? null,
    alert: s.alert,
    inherited: true,
    fromPack: true,
  }));
  const wordsOf = (id: string) => shared.find((s) => s.id === id)!.words;

  const MUST_ALARM: [string, string][] = [
    // Emergencies
    ['emergency', 'There is a fire in the kitchen, please help'],
    ['emergency', 'Our godown caught fire last night'],
    ['emergency', 'Fire! Please help'],
    ['emergency', "There's a fire at our shop"],
    ['emergency', 'the meter is on fire'],
    ['emergency', 'Smoke is coming from the electricity meter'],
    ['emergency', 'There is a burning smell from the switchboard'],
    ['emergency', 'gas  leak. in flat 3'],
    ['emergency', 'My father collapsed, please send an ambulance'],
    ['emergency', 'He is bleeding and unconscious'],
    ['emergency', 'A worker got injured at the site'],
    ['emergency', 'My brother met with an accident near the gate'],
    ['emergency', 'Accident near the gate, send help'],
    ['emergency', 'This is an emergency, please call me back'],
    ['emergency', 'medical emergency, need help now'],
    ['emergency', 'Please call 112, someone is hurt'],
    ['emergency', 'I have called 112 already'],
    ['emergency', '112 ko call karo jaldi'],
    ['emergency', 'emergency hai, jaldi aao'],
    ['emergency', 'ghar mein aag lagi hai'],
    ['emergency', 'fire lagi hai factory mein'],
    ['emergency', 'accident ho gaya hai, do log ghayal hain'],
    ['emergency', 'ghayalon ko hospital le jao'],
    ['emergency', 'bhai ko current laga hai'],
    ['emergency', 'current lag gaya bacche ko'],
    ['emergency', 'bahut khoon nikal raha hai'],
    ['emergency', 'papa ko seene mein dard ho raha hai'],
    ['emergency', 'घर में आग लगी है'],
    ['emergency', 'मीटर से धुआं निकल रहा है'],
    ['emergency', 'बच्चे को करंट लग गया'],
    ['emergency', 'करंट लगा है, जल्दी आओ'],
    ['emergency', 'घायलों को अस्पताल ले जाओ'],
    ['emergency', 'खून बह रहा है'],
    ['emergency', 'वह बेहोश हो गया है'],
    ['emergency', 'सड़क दुर्घटना में दो लोग घायल'],
    // Distress
    ['distress', 'I want to die'],
    ['distress', 'I feel suicidal'],
    ['distress', 'I am going to kill myself'],
    ['distress', 'there is no reason to live'],
    ['distress', 'ab jeena nahi chahta'],
    ['distress', 'main mar jaungi'],
    ['distress', 'khudkushi kar lunga'],
    ['distress', 'aatmhatya kar lunga'],
    ['distress', 'मैं आत्महत्या कर लूंगा'],
    ['distress', 'मैं आत्म\u200dहत्या कर लूंगा'],
    ['distress', 'मैं मर जाऊंगा'],
    // Anger or abuse
    ['anger', 'You people cheated me'],
    ['anger', 'you are cheating customers'],
    ['anger', 'I got scammed'],
    ['anger', 'This is a fraud company'],
    ['anger', 'worst service ever'],
    ['anger', 'aap log chor ho'],
    ['anger', 'unhone dhokhe se paise le liye'],
    ['anger', 'मेरे साथ धोखे से पैसे लिए गए'],
    ['anger', 'बकवास सर्विस है'],
    // Legal threats
    ['legal-threat', 'I will take you to court'],
    ['legal-threat', 'My lawyer will send you a legal notice'],
    ['legal-threat', 'I will contact a lawyer'],
    ["legal-threat", "I'll sue you"],
    ['legal-threat', 'I am going to sue your company'],
    ['legal-threat', 'I will file an FIR'],
    ['legal-threat', 'I have filed a police complaint'],
    ['legal-threat', 'I will take legal action'],
    ['legal-threat', 'I will complain to the consumer forum'],
    ['legal-threat', 'police mein FIR darj karunga'],
    ['legal-threat', 'consumer court mein case karunga'],
    ['legal-threat', 'vakil se notice bhejunga'],
    ['legal-threat', 'मैं कोर्ट में केस करूंगा'],
    ['legal-threat', 'मैं एफआईआर दर्ज कराऊंगा'],
    // OTPs, PINs or card numbers
    ['secrets', 'mera pin 1234'],
    ['secrets', 'mera pin hai 1234'],
    ['secrets', 'OTP 4821 hai'],
    ['secrets', 'OTP hai 4821'],
    ['secrets', 'my otp is 4821'],
    ['secrets', 'OTP: 482193'],
    ['secrets', 'my atm pin is 4321'],
    ['secrets', 'upi pin 123456 hai'],
    ['secrets', 'my password is Abc@123'],
    ['secrets', 'card number 4111 1111 1111 1111 cvv 123'],
    ['secrets', 'cvv is 456'],
    ['secrets', 'मेरा ओटीपी 4821 है'],
    ['secrets', 'मेरा पिन 1234 है'],
  ];

  const MUST_NOT_ALARM = [
    // From the final review
    'maine fir se call kiya, fir bhi koi jawab nahi',
    'Flat 3B, Silver Oak Court, Pune',
    'Is there a food court near the venue?',
    'Can I book the badminton court for Sunday?',
    'My daughter Sue will pick it up',
    'Please deliver to Flat 112, Sector 112, Gurugram',
    'The order total was Rs 112',
    'My emergency contact is my brother',
    'This is not an emergency, just a question',
    'बिजली का करंट नहीं आ रहा है',
    'I was fired last month and need to change my plan',
    'Can I get a smoked salmon platter?',
    'Need help with household chores twice a week',
    'Deliver to my address, pin is 560034',
    'mera pin code 400001 hai',
    // Addresses, names and amounts
    'Sector 112, Noida 201301',
    'Rs 112 only',
    'Room 112 please',
    'Turn left at Court Road',
    'Lawyers Colony, Agra',
    'Sue from accounts sent the invoice',
    'mera pin hai 400001, kab tak aayega',
    'My pin code is 560034',
    'PIN: 560034',
    'मेरा पिन कोड 400001 है',
    // Everyday Hinglish "fir" (again)
    'maine fir se call kiya',
    'fir se bhej do please',
    'file fir se upload karo',
    'kal fir aaunga',
    // Fire, smoke and accidents that aren't
    'Do you sell fire extinguishers?',
    'Need a fire NOC for my shop',
    'Is the Fire TV stick in stock?',
    'The webhook fires twice',
    'Our smoke test failed after the release',
    'The smoke detector is beeping',
    'Do you have rooms for smokers?',
    'I paid twice by accident',
    'Does the policy cover accident insurance?',
    // A power cut, a blood test, a surprise
    'bijli ka current kab aayega',
    'bill dekh ke shock laga',
    'khoon ki report kab milegi',
    'खून की जांच की रिपोर्ट कब मिलेगी',
    // Asking about a code is not sharing one
    "I didn't get my OTP",
    'mera otp nahi aaya',
    'OTP is not coming',
    'I forgot my UPI PIN',
    'UPI PIN galat dala, payment fail ho gaya',
    'What is CVV?',
    'my card number is not accepted',
    'mera password bhool gaya',
    // Professions and courts that aren't threats
    'I am a lawyer and need help with my GST return',
    'Advocate Sharma will visit tomorrow',
    'Please register our court marriage',
    'Please share the court order copy',
  ];

  it.each(MUST_ALARM)('%s catches: %s', (id, text) => {
    expect(matchWords(text, wordsOf(id)), text).not.toEqual([]);
  });

  it.each(MUST_NOT_ALARM)('nothing fires on: %s', (text) => {
    const hit = findEscalation(text, shared);
    expect(hit && `${hit.set.id}: ${hit.words.join(', ')}`, text).toBeNull();
  });
});

describe('agent plant-safety sets', () => {
  const sets = ['power-plant', 'manufacturing-plant'].flatMap((id) =>
    registry.get(id)!.agents.flatMap((a) => (a.job?.escalate ?? []).filter((s) => s.id === 'plant-safety').map((s) => [`${id}/${a.role}`, s.words] as const)),
  );

  it('are on both plants', () => {
    expect(sets.map(([where]) => where)).toEqual([
      'power-plant/maintenance-planner',
      'power-plant/safety-desk',
      'manufacturing-plant/maintenance-planner',
      'manufacturing-plant/safety-desk',
    ]);
  });

  it.each(sets)('%s catches a person caught in a machine, and not everyday "stuck"', (_where, words) => {
    for (const text of ['worker ka haath machine mein fas gaya', 'ek mazdoor andar fas gaya hai', 'मजदूर का हाथ मशीन में फंस गया', 'boiler mein dhamaka hua', 'worker trapped under the beam']) {
      expect(matchWords(text, words), text).not.toEqual([]);
    }
    for (const text of ['traffic mein fas gaya, late aaunga', 'payment fas gaya hai', 'kapda roller mein fas gaya', 'मैं ट्रैफिक में फंस गया']) {
      expect(matchWords(text, words), text).toEqual([]);
    }
  });
});
