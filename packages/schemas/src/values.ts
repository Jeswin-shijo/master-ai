/**
 * Plain values with no zod: what the browser and the phone need at run time.
 * `@onehuman/schemas/plain` exports these (with the event summaries and the
 * approval signing message) so apps don't download zod and every schema.
 */

/**
 * One scale is used for both agents and actions.
 *
 * - An action's level is what the policy engine decided for one proposed tool call.
 * - An agent's `autonomy` is its clearance: the highest level it may run without
 *   approval. Anything above its clearance is escalated to Level 4.
 */
export const AUTONOMY_LEVELS = {
  1: { name: 'Observe', description: 'Read-only actions.', runsWithoutApproval: true },
  2: {
    name: 'Draft & recommend',
    description: 'Drafts and internal notes. Nothing leaves the company.',
    runsWithoutApproval: true,
  },
  3: {
    name: 'Act within limits',
    description: 'Reversible writes and low-risk actions, inside budgets.',
    runsWithoutApproval: true,
  },
  4: { name: 'Act with approval', description: 'A human must approve first.', runsWithoutApproval: false },
  5: { name: 'Forbidden', description: 'Blocked and logged.', runsWithoutApproval: false },
} as const;

export const STAGE_KEYS = ['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report'] as const;

export const SECTOR_IDS = [
  'energy-heavy-industry',
  'trade-logistics-tourism',
  'finance-development',
  'technology-innovation',
  'public-services',
] as const;
type SectorId = (typeof SECTOR_IDS)[number];

/** The five sectors shown at signup, in order. */
export const SECTORS: readonly { id: SectorId; name: string; examples: string }[] = [
  { id: 'energy-heavy-industry', name: 'Energy & Heavy Industry', examples: 'Power plants, manufacturing, construction' },
  { id: 'trade-logistics-tourism', name: 'Trade, Logistics & Tourism', examples: 'Logistics, wholesale & retail, travel' },
  { id: 'finance-development', name: 'Finance & Development', examples: 'Lenders, accounting firms, NGOs' },
  { id: 'technology-innovation', name: 'Technology & Innovation', examples: 'Software, IT services, digital agencies' },
  { id: 'public-services', name: 'Essential Public & Service', examples: 'Hospitals, schools, citizen services' },
];

/** The ready-made organization types offered at signup, three per sector. Each has a pack with the same id. */
export const ORG_TYPES: readonly { id: string; name: string; sector: SectorId }[] = [
  { id: 'power-plant', name: 'Power plant & utilities', sector: 'energy-heavy-industry' },
  { id: 'manufacturing-plant', name: 'Manufacturing plant', sector: 'energy-heavy-industry' },
  { id: 'construction', name: 'Construction & infrastructure', sector: 'energy-heavy-industry' },
  { id: 'logistics', name: 'Logistics & transport', sector: 'trade-logistics-tourism' },
  { id: 'wholesale-retail', name: 'Wholesale & retail trade', sector: 'trade-logistics-tourism' },
  { id: 'travel-agency', name: 'Travel agency & tour operator', sector: 'trade-logistics-tourism' },
  { id: 'lender', name: 'Lender (NBFC, microfinance, co-op bank)', sector: 'finance-development' },
  { id: 'accounting-firm', name: 'Accounting & tax firm', sector: 'finance-development' },
  { id: 'ngo', name: 'NGO & development programme', sector: 'finance-development' },
  { id: 'software-saas', name: 'Software & SaaS company', sector: 'technology-innovation' },
  { id: 'it-services', name: 'IT services & support', sector: 'technology-innovation' },
  { id: 'digital-agency', name: 'Digital agency', sector: 'technology-innovation' },
  { id: 'hospital', name: 'Hospital & clinic', sector: 'public-services' },
  { id: 'education', name: 'School, college & coaching', sector: 'public-services' },
  { id: 'municipal', name: 'Municipal & citizen services', sector: 'public-services' },
];

export const PRIORITY_IDS = ['P1', 'P2', 'P3', 'P4'] as const;
