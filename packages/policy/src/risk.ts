import type { DataClass, RiskFactor } from '@onehuman/schemas';
import type { ToolRisk } from '@onehuman/agent-kit';

export interface TrackRecord {
  /** Approval decisions on this agent's past requests. */
  approved: number;
  rejected: number;
  edited: number;
}

export interface RiskInput {
  risk: ToolRisk;
  amount: number | null;
  /** Data class of what the agent works with (from its model preferences). */
  dataClass: DataClass;
  trackRecord: TrackRecord;
}

const CATEGORY_POINTS: Record<ToolRisk['category'], number> = {
  read: 0,
  draft: 8,
  write: 20,
  external: 25,
  money: 30,
};

const SENSITIVITY_POINTS: Record<DataClass, number> = {
  public: 0,
  internal: 0,
  confidential: 5,
  restricted: 12,
};

function amountPoints(amount: number): number {
  if (amount <= 1_000) return 4;
  if (amount <= 5_000) return 10;
  if (amount <= 25_000) return 20;
  if (amount <= 100_000) return 28;
  return 35;
}

/**
 * Risk score 0–100 from action type, money, reversibility, external reach,
 * data sensitivity and the agent's track record. Every point is explained so
 * the owner can see why an action needed approval.
 */
export function scoreRisk(input: RiskInput): { score: number; factors: RiskFactor[] } {
  const { risk, amount, trackRecord } = input;
  const factors: RiskFactor[] = [];
  const add = (factor: string, points: number, detail: string) => {
    if (points > 0) factors.push({ factor, points, detail });
  };

  add('action type', CATEGORY_POINTS[risk.category], `${risk.category} action`);
  if (amount !== null && risk.movesMoney) {
    add('money', amountPoints(amount), `₹${amount.toLocaleString('en-IN')} ${risk.spendsMoney ? 'leaves' : 'requested by'} the company`);
  }
  if (risk.category !== 'read') {
    if (!risk.reversible) add('irreversible', 12, 'cannot be undone');
    if (risk.externalReach) add('external reach', 8, 'reaches people outside the company');
    const sensitivity = worst(risk.sensitivity, input.dataClass);
    add('data sensitivity', SENSITIVITY_POINTS[sensitivity], `${sensitivity} data`);

    const decided = trackRecord.approved + trackRecord.rejected + trackRecord.edited;
    if (decided < 3) {
      add('track record', 5, 'agent has little approval history');
    } else {
      const badRate = (trackRecord.rejected + trackRecord.edited * 0.5) / decided;
      add('track record', Math.round(20 * badRate), `${Math.round(badRate * 100)}% of past requests rejected or edited`);
    }
  }

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  return { score, factors };
}

const ORDER: DataClass[] = ['public', 'internal', 'confidential', 'restricted'];
function worst(a: DataClass, b: DataClass): DataClass {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

export interface RiskBands {
  level1Below: number;
  level2Below: number;
  level3Below: number;
}

export const DEFAULT_RISK_BANDS: RiskBands = { level1Below: 15, level2Below: 35, level3Below: 75 };

export function bandLevel(score: number, bands: RiskBands = DEFAULT_RISK_BANDS): 1 | 2 | 3 | 4 {
  if (score < bands.level1Below) return 1;
  if (score < bands.level2Below) return 2;
  if (score < bands.level3Below) return 3;
  return 4;
}
