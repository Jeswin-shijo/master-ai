import type { Pack, SectorId } from '@onehuman/schemas';
import { PackError } from './pack';

/**
 * Turn an owner's free-text industry ("we run 3 dental clinics in Kochi") into
 * a pack: first try the registry, otherwise compose one from base packs.
 */

const STOPWORDS = new Set(
  'a an and the in at of for to we our my run running own business company firm small medium shop based services service india pvt ltd limited private llp co'.split(
    ' ',
  ),
);

export function normalizeIndustry(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalizeIndustry(text)
    .split(/[\s-]+/)
    // Single digits count ("Section 8"); other one-letter tokens are noise.
    .filter((t) => (t.length > 1 || /^\d$/.test(t)) && !STOPWORDS.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const h = ` ${tokens(haystack).join(' ')} `;
  const p = tokens(phrase).join(' ');
  return p.length > 0 && h.includes(` ${p} `);
}

export interface PackMatch {
  pack: Pack;
  score: number;
  matchedKeyword: string | null;
}

/** Best industry pack for the text, or null when nothing fits well enough. */
export function matchIndustry(text: string, packs: Pack[], threshold = 0.6): PackMatch | null {
  const inputTokens = new Set(tokens(text));
  if (inputTokens.size === 0) return null;
  let best: PackMatch | null = null;

  for (const pack of packs) {
    if (pack.kind !== 'industry') continue;
    const keywords = [pack.name, pack.id.replace(/-/g, ' '), ...(pack.match?.keywords ?? [])];
    let score = 0;
    let matchedKeyword: string | null = null;
    for (const kw of keywords) {
      const kwTokens = tokens(kw);
      if (kwTokens.length === 0) continue;
      let s: number;
      if (containsPhrase(text, kw)) {
        // A full phrase match is strong; longer phrases are more specific.
        s = Math.min(1, 0.75 + 0.1 * kwTokens.length);
      } else {
        const overlap = kwTokens.filter((t) => inputTokens.has(t)).length;
        s = (overlap / kwTokens.length) * (overlap / Math.max(inputTokens.size, kwTokens.length)) * 0.8;
      }
      if (s > score) {
        score = s;
        matchedKeyword = kw;
      }
    }
    if (!best || score > best.score) best = { pack, score: round(score), matchedKeyword };
  }
  return best && best.score >= threshold ? best : null;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Families the offline composer knows. Each maps to base packs and sector vocabulary. */
interface Family {
  id: 'bookings' | 'education' | 'orders' | 'projects' | 'general';
  keywords: string[];
  extends: string[];
  defaultLabels: Record<string, string>;
}

const FAMILIES: Family[] = [
  {
    id: 'education',
    keywords: [
      'school', 'college', 'coaching', 'tuition', 'academy', 'institute', 'training', 'university',
      'class', 'tutor', 'preschool', 'kindergarten', 'education', 'learning', 'course',
    ],
    extends: ['bookings-base'],
    defaultLabels: { Customer: 'Student', Booking: 'Enrollment', Service: 'Course', Enquiry: 'Admission enquiry' },
  },
  {
    id: 'bookings',
    keywords: [
      'travel', 'tour', 'hotel', 'resort', 'homestay', 'hostel', 'salon', 'spa', 'clinic', 'dental', 'dentist',
      'doctor', 'hospital', 'physio', 'physiotherapy', 'gym', 'fitness', 'studio', 'yoga', 'event', 'wedding',
      'venue', 'rental', 'photography', 'photographer', 'repair', 'beauty', 'parlour', 'diagnostic', 'lab',
      'veterinary', 'vet', 'laundry', 'cleaning', 'pest', 'garage', 'workshop', 'turf', 'court',
    ],
    extends: ['bookings-base'],
    defaultLabels: {},
  },
  {
    id: 'orders',
    keywords: [
      'store', 'retail', 'ecommerce', 'commerce', 'online', 'restaurant', 'cafe', 'bakery', 'catering',
      'cloud kitchen', 'kitchen', 'grocery', 'pharmacy', 'distributor', 'distribution', 'wholesale', 'trader',
      'trading', 'manufacturer', 'manufacturing', 'factory', 'boutique', 'garment', 'textile', 'jewellery',
      'jewelry', 'electronics', 'furniture', 'hardware', 'supermarket', 'dairy', 'printing', 'export', 'import',
    ],
    extends: ['orders-base'],
    defaultLabels: {},
  },
  {
    id: 'projects',
    keywords: [
      'agency', 'consulting', 'consultancy', 'consultant', 'law', 'legal', 'lawyer', 'advocate', 'accounting',
      'accountant', 'chartered', 'audit', 'tax', 'architecture', 'architect', 'construction', 'builder',
      'contractor', 'interior', 'software', 'marketing', 'design', 'studio', 'real estate', 'developer',
      'engineering', 'recruitment', 'staffing', 'media', 'production',
    ],
    extends: ['projects-base'],
    defaultLabels: {},
  },
];

/** Sector-specific words for shared entities, picked from the industry text. */
const LABEL_HINTS: { keywords: string[]; labels: Record<string, string> }[] = [
  { keywords: ['clinic', 'dental', 'dentist', 'doctor', 'hospital', 'physio', 'diagnostic', 'lab'], labels: { Customer: 'Patient', Booking: 'Appointment', Service: 'Treatment' } },
  { keywords: ['veterinary', 'vet'], labels: { Customer: 'Pet owner', Booking: 'Appointment', Service: 'Treatment' } },
  { keywords: ['salon', 'spa', 'beauty', 'parlour'], labels: { Customer: 'Client', Booking: 'Appointment' } },
  { keywords: ['hotel', 'resort', 'homestay', 'hostel'], labels: { Customer: 'Guest', Booking: 'Reservation', Service: 'Room type' } },
  { keywords: ['gym', 'fitness', 'yoga'], labels: { Customer: 'Member', Booking: 'Session', Service: 'Plan' } },
  { keywords: ['event', 'wedding', 'venue'], labels: { Customer: 'Client', Booking: 'Event booking', Service: 'Package' } },
  { keywords: ['travel', 'tour'], labels: { Customer: 'Traveller', Service: 'Package' } },
  { keywords: ['restaurant', 'cafe', 'bakery', 'catering', 'kitchen'], labels: { Product: 'Menu item' } },
  { keywords: ['law', 'legal', 'lawyer', 'advocate'], labels: { Customer: 'Client', Project: 'Matter' } },
  { keywords: ['accounting', 'accountant', 'chartered', 'audit', 'tax'], labels: { Customer: 'Client', Project: 'Engagement' } },
  { keywords: ['construction', 'builder', 'contractor', 'interior', 'architect', 'architecture'], labels: { Customer: 'Client', Milestone: 'Stage' } },
  { keywords: ['real estate'], labels: { Customer: 'Buyer', Enquiry: 'Property enquiry' } },
  { keywords: ['agency', 'consulting', 'consultancy', 'marketing', 'software'], labels: { Customer: 'Client' } },
  { keywords: ['distributor', 'wholesale', 'trader', 'trading', 'manufacturer', 'manufacturing', 'factory'], labels: { Customer: 'Buyer' } },
];

export function detectFamily(text: string): Family['id'] {
  const scores = FAMILIES.map((f) => ({
    id: f.id,
    score: f.keywords.filter((kw) => containsPhrase(text, kw)).length,
  }));
  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.id : 'general';
}

/**
 * Offline pack composer: no model needed. Picks base packs by family and
 * renames shared entities for the sector. The LLM generator does the same job
 * with richer, sector-specific entities, agents and rules.
 */
export function composeOfflinePack(industry: string): Pack {
  const family = detectFamily(industry);
  const familyDef = FAMILIES.find((f) => f.id === family);
  const labels: Record<string, string> = { ...(familyDef?.defaultLabels ?? {}) };
  for (const hint of LABEL_HINTS) {
    if (hint.keywords.some((kw) => containsPhrase(industry, kw))) {
      for (const [k, v] of Object.entries(hint.labels)) labels[k] ??= v;
    }
  }
  const title = titleCase(normalizeIndustry(industry)) || 'Business';
  const slug = normalizeIndustry(industry).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'business';

  return {
    id: /^[a-z]/.test(slug) ? `${slug}-pack` : `pack-${slug}`,
    version: '0.1.0',
    name: title,
    description: `Everyday operations for ${industry.trim()}: the AI team, records and rules most businesses like yours need.`,
    kind: 'industry',
    match: { keywords: [industry.trim()] },
    extends: familyDef?.extends ?? ['crm-base'],
    labels,
    entities: [],
    agents: [],
    tools: [],
    workflows: [],
    routines: [],
    policies: [],
    kpis: [],
    connectors: [],
    playbooks: [],
    other_org_types: [],
  };
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to']);

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function industryPacksInSector(packs: Pack[], sector: SectorId): Pack[] {
  return packs.filter((p) => p.kind === 'industry' && p.sector === sector);
}

export interface SectorComposition {
  pack: Pack;
  /** The pack it builds on: a ready-made type or the sector base pack. */
  basedOn: string;
  via: 'ready-made' | 'similar' | 'sector';
}

/**
 * Offline setup for an organization type typed in after choosing a sector:
 * build on a ready-made type of that sector when the words match one, else on
 * the closest one the sector lists as similar, else on the sector base pack.
 * Other sectors are never considered: the owner chose this one.
 */
export function composeForSector(industry: string, sector: SectorId, packs: Pack[]): SectorComposition {
  const baseId = `sector-${sector}`;
  const base = packs.find((p) => p.id === baseId);
  if (!base) throw new PackError(`No base pack for sector ${sector}`);
  const inSector = industryPacksInSector(packs, sector);
  const available = new Set(inSector.map((p) => p.id));

  let basedOn = baseId;
  let via: SectorComposition['via'] = 'sector';
  const direct = matchIndustry(industry, inSector);
  if (direct) {
    basedOn = direct.pack.id;
    via = 'ready-made';
  } else {
    let best: { closest: string; score: number } | null = null;
    for (const t of base.other_org_types) {
      if (!available.has(t.closest)) continue;
      const score = Math.max(0, ...t.keywords.filter((k) => containsPhrase(industry, k)).map((k) => tokens(k).length));
      if (score > 0 && (!best || score > best.score)) best = { closest: t.closest, score };
    }
    if (best) {
      basedOn = best.closest;
      via = 'similar';
    }
  }
  return { pack: { ...composeOfflinePack(industry), sector, extends: [basedOn] }, basedOn, via };
}
