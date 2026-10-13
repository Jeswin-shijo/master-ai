/**
 * What opening a gate does. A kill switch comes first: while the company,
 * workspace or Case coordinator is paused the policy engine answers Level 5,
 * and that must hold the case, not reject or escalate it.
 */
export function gateStep(paused: boolean, level: number): 'paused' | 'not_required' | 'approval' | 'blocked' {
  if (paused) return 'paused';
  if (level <= 3) return 'not_required';
  if (level === 5) return 'blocked';
  return 'approval';
}
