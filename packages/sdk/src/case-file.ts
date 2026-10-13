import type { CaseFile, CaseSource, StageKey } from '@onehuman/schemas';

const FROM: Record<CaseSource, string> = {
  owner: 'raised by the owner',
  staff: 'raised by the team',
  customer: 'from a customer',
  system: 'from a connected system',
  partner: 'from a partner',
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const defaultWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const stripStop = (s: string) => s.replace(/[.\s]+$/, '');

export interface CaseFileWords {
  /** A lifecycle role id (or "owner") as people say it, e.g. "the safety officer". */
  roleName?: (id: string) => string;
  /** How a date and time reads. */
  when?: (iso: string) => string;
}

/**
 * Each stage's findings as plain sentences for the case page. People never
 * see the case file's keys, ids or JSON.
 */
export function caseFileLines(file: CaseFile, words: CaseFileWords = {}): Partial<Record<StageKey, string[]>> {
  const role = words.roleName ?? ((id: string) => (id === 'owner' ? 'the owner' : 'the right person'));
  const when = words.when ?? defaultWhen;
  const out: Partial<Record<StageKey, string[]>> = {};
  const { request, review, classify, assign, approve, execute, close, report } = file;

  if (request) {
    out.request = [
      `${request.requester.name}, ${FROM[request.source]}, on ${when(request.receivedAt)}.`,
      request.summary,
      ...(request.amountInr !== undefined ? [`Amount given: ${inr.format(request.amountInr)}.`] : []),
    ];
  }
  if (review) {
    const lines: string[] = [];
    if (review.outcome === 'complete') lines.push('Everything needed is there.');
    if (review.outcome === 'needs_info') lines.push(`Needs: ${review.missing.map((m) => m.label).join(', ')}.`);
    if (review.outcome === 'not_eligible') lines.push(`Not eligible: ${stripStop(review.reason ?? 'outside what this organization does')}.`);
    for (const c of review.checks) lines.push(`${c.ok ? 'Checked' : 'Not yet'}: ${c.name}${c.note ? ` (${c.note})` : ''}.`);
    if (review.toConfirm.length > 0) lines.push(`A person confirms: ${review.toConfirm.join(', ')}.`);
    out.review = lines;
  }
  if (classify) {
    out.classify = [
      `${classify.categoryName}, ${classify.priority}, ${classify.risk} risk, for ${classify.department}.`,
      `Respond by ${when(classify.respondBy)}; resolve by ${when(classify.resolveBy)}.`,
      ...(classify.amountInr !== null ? [`Amount: ${inr.format(classify.amountInr)}.`] : []),
      ...classify.reasons,
    ];
  }
  if (assign) {
    const who = assign.assignee ? `${assign.assignee.name}${assign.assignee.title ? `, ${assign.assignee.title}` : ''} (${assign.team})` : `the ${assign.team} team`;
    out.assign = [`Assigned to ${who}.`, `Due ${when(assign.deadline)}.`, assign.reason];
  }
  if (approve) {
    const who = approve.decidedBy ?? (approve.approverRole ? role(approve.approverRole) : 'a person');
    const decision = {
      not_required: 'No approval needed.',
      approved: `Approved by ${who}.`,
      rejected: `Rejected by ${who}.`,
      expired: 'Nobody decided in time, so it stopped.',
      blocked: 'Your rules do not allow this.',
    }[approve.decision];
    out.approve = [decision, ...(approve.notes ? [`Note: ${approve.notes}`] : [])];
  }
  if (execute) {
    out.execute = [execute.summary, ...execute.evidence, ...(execute.costInr > 0 ? [`AI cost: ${inr.format(execute.costInr)}.`] : [])];
  }
  if (close) {
    const s = close.signoff;
    const by = s.by ?? (s.role ? role(s.role) : 'a person');
    const signoff = !s.required
      ? []
      : s.decision === 'approved'
        ? [`Signed off by ${by}.`]
        : s.decision === 'rejected'
          ? [`Sign-off refused by ${by}.`]
          : s.decision === 'expired'
            ? ['Nobody signed off in time.']
            : [`Waiting for ${by} to sign off.`];
    out.close = [close.outcome === 'resolved' ? 'Checked and resolved.' : 'Checked: not resolved.', ...close.findings, ...signoff];
  }
  if (report) {
    out.report = [
      report.text,
      ...(report.slaMet === true ? ['Finished within the deadline.'] : report.slaMet === false ? ['Missed the deadline.'] : []),
      ...(report.recurring ? [report.recurring.note] : []),
    ];
  }
  return out;
}
