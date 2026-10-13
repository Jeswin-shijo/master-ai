import type { CaseFile, CaseSource, RequestPart, ResolvedLifecycle, StageKey } from '@onehuman/schemas';
import { phraseIn } from './extract';

/**
 * The sentences people read about a case: stage summaries and the stage-6
 * goal text. No ids, no tool names, no JSON.
 */

/** Requests from these sources are information, never instructions. */
export const UNTRUSTED_SOURCES: readonly CaseSource[] = ['customer', 'system', 'partner'];

export function isUntrusted(source: CaseSource): boolean {
  return UNTRUSTED_SOURCES.includes(source);
}

/** Outside words in a block they cannot close early. */
export function wrapUntrusted(text: string): string {
  const safe = text.replace(/<(\/?)untrusted_data>/gi, '‹$1untrusted_data›');
  return `<untrusted_data>\n${safe}\n</untrusted_data>`;
}

/** The requester's words as a prompt or goal should carry them. */
export function requesterWords(request: RequestPart): string {
  return isUntrusted(request.source) ? wrapUntrusted(request.text) : request.text;
}

/** e.g. WO-0042. */
export function formatCaseCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function roleName(lc: ResolvedLifecycle, roleId: string): string {
  return lc.roles.find((r) => r.id === roleId)?.name ?? roleId;
}

/** Any of the lifecycle's urgent words: such cases never wait for details. */
export function isUrgent(lc: ResolvedLifecycle, text: string): boolean {
  return lc.urgent_keywords.some((k) => phraseIn(text, k));
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

const FROM: Record<CaseSource, string> = {
  owner: '',
  staff: '',
  customer: ' through the request form',
  system: ' from a connected system',
  partner: ' from a partner',
};

/** One plain sentence for a stage, from what it added to the case file. */
export function stageSummary(stage: StageKey, file: CaseFile, lc: ResolvedLifecycle): string {
  switch (stage) {
    case 'request': {
      const r = file.request;
      return r ? `Received from ${r.requester.name}${FROM[r.source]}.` : 'Received.';
    }
    case 'review': {
      const r = file.review;
      if (!r) return 'Reviewed.';
      if (r.outcome === 'not_eligible') return `Not eligible: ${r.reason ?? 'it does not meet the rules'}`;
      if (r.outcome === 'needs_info') return `Missing: ${r.missing.map((m) => m.label.toLowerCase()).join(', ')}.`;
      const confirm = r.toConfirm.slice(0, 2);
      return `All the details needed are there.${confirm.length ? ` To confirm: ${confirm.join('; ')}.` : ''}`;
    }
    case 'classify': {
      const c = file.classify;
      if (!c) return 'Classified.';
      const p = lc.priorities.find((x) => x.id === c.priority);
      const amount = c.amountInr !== null ? ` Amount ${inr(c.amountInr)}.` : '';
      return `${c.categoryName}, ${p ? `${p.name} (${c.priority})` : c.priority}, ${c.risk} risk, for ${c.department}.${amount}`;
    }
    case 'assign':
      return file.assign?.reason ?? 'Assigned.';
    case 'approve': {
      const a = file.approve;
      if (!a) return 'Approval checked.';
      const who = a.approverRole ? `the ${roleName(lc, a.approverRole)}` : 'the owner';
      const note = a.notes ? `: “${a.notes}”` : '';
      switch (a.decision) {
        case 'not_required':
          return 'No approval needed.';
        case 'approved':
          return `Approved by ${who}${note}.`;
        case 'rejected':
          return `Rejected by ${who}${note}.`;
        case 'expired':
          return `No decision from ${who} before the approval expired.`;
        case 'blocked':
          return `Not allowed${note}.`;
      }
      return 'Approval checked.';
    }
    case 'execute':
      return file.execute?.summary ?? 'Work done.';
    case 'close': {
      const c = file.close;
      if (!c) return 'Checked.';
      if (!c.verified) return `Not accepted: ${c.findings[0] ?? 'the result does not match the request'}`;
      const s = c.signoff;
      if (s.required && s.decision === 'approved') return `Verified and signed off by the ${roleName(lc, s.role ?? 'owner')}.`;
      return 'Verified: the request is dealt with.';
    }
    case 'report':
      return file.report?.text ?? 'Reported.';
  }
}

export interface CaseGoalTextInput {
  code: string;
  /** This organization's word for a case, e.g. "Work order". */
  label: string;
  file: CaseFile;
  lc: ResolvedLifecycle;
  attempt: number;
  /** Why the first result was not accepted (attempt 2). */
  reworkNote?: string;
}

/** The stage-6 goal: everything the work agents need, from the case file. */
export function caseGoalText(input: CaseGoalTextInput): string {
  const { file, lc } = input;
  const r = file.request!;
  const c = file.classify;
  const a = file.assign;
  const category = c ? lc.categories.find((x) => x.id === c.category) : undefined;
  const lines = [`${input.code} · ${r.title}`];
  if (c) lines.push(`${input.label}: ${c.categoryName} (${c.priority}, ${c.risk} risk) for ${c.department}.`);
  lines.push(`Request from ${r.requester.name}${FROM[r.source]}:`, requesterWords(r));
  if (c?.amountInr != null) lines.push(`Amount: ${inr(c.amountInr)}.`);
  if (file.review?.toConfirm.length) lines.push(`Check before acting: ${file.review.toConfirm.join('; ')}.`);
  if (a) {
    lines.push(
      a.assignee
        ? `In charge: ${a.assignee.name}${a.assignee.title ? ` (${a.assignee.title})` : ''}, due by ${when(a.deadline)}.`
        : `Team: ${a.team}, due by ${when(a.deadline)}.`,
    );
    if (a.assignee?.staffId && category && category.execution !== 'agents') {
      lines.push(`This work is done by the team: hand it to ${a.assignee.name} by phone and follow it up.`);
    }
  }
  if (file.approve?.decision === 'approved') lines.push(stageSummary('approve', file, lc));
  if (input.attempt > 1) lines.push(`Second attempt. The first result was not accepted: ${input.reworkNote ?? 'see the case'}`);
  lines.push(`Do what this ${input.label.toLowerCase()} needs. Look up the company's playbooks for this kind of work and follow them.`);
  return lines.join('\n');
}
