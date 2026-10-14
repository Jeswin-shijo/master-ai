import type { CaseDetail, CaseStageStatus, StageKey } from '@onehuman/schemas';
import { caseFileLines, SOURCE_WORDS, type CaseFileWords } from './case-file';
import { statusWords } from './case-view';

/**
 * A case's full report, the one people open, print and share: what was asked,
 * every stage, who decided, what was done and how it ended. Built from the
 * case detail in words only: no ids, no tool names, and never the agent's own
 * instructions (the stage-6 goal text).
 */
export interface CaseReportView {
  code: string;
  title: string;
  /** The organization's word for a case, e.g. "Job". */
  label: string;
  status: string;
  dates: string;
  onTime: boolean | null;
  summary: string[];
  details: { label: string; value: string }[];
  stages: { n: number; name: string; status: string; took: string | null; found: string[] }[];
  decisions: string[];
  work: { done: string[]; pending: string[]; attention: string[]; people: string[] } | null;
}

const STAGE_STATUS: Record<CaseStageStatus, string> = {
  pending: 'Not started',
  running: 'In progress',
  needs_info: 'Waiting for details',
  waiting_approval: 'Waiting for a decision',
  done: 'Done',
  skipped: 'Skipped',
  failed: "Didn't pass",
};

const DECIDED: Record<string, string> = { approved: 'approved', rejected: 'turned down', expired: 'not decided in time', blocked: 'blocked by the rules' };

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const defaultWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How long a stage took, in words. Skipped and unstarted stages took no time worth saying. */
function took(minutes: number | null, status: CaseStageStatus): string | null {
  if (minutes === null || status === 'skipped' || status === 'pending') return null;
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${Math.round(minutes % 60)} min`;
  return `${Math.round(hours / 24)} days`;
}

export function caseReportView(d: CaseDetail, words: CaseFileWords = {}): CaseReportView {
  const c = d.case;
  const when = words.when ?? defaultWhen;
  const role = words.roleName ?? ((id: string) => (id === 'owner' ? 'the owner' : 'the right person'));
  const found = caseFileLines(d.file, { ...words, when });

  const details: { label: string; value: string }[] = [
    { label: 'Requested by', value: `${c.requester.name}, ${SOURCE_WORDS[c.source]}` },
    ...(c.categoryName ? [{ label: 'Kind of request', value: c.categoryName }] : []),
    ...(c.priority ? [{ label: 'Priority', value: [c.priority, words.priorityName?.(c.priority)].filter(Boolean).join(' · ') }] : []),
    ...(c.risk ? [{ label: 'Risk', value: capital(c.risk) }] : []),
    ...(c.department ? [{ label: 'Department', value: c.department }] : []),
    ...(c.amountInr !== null && c.amountInr !== undefined ? [{ label: 'Amount', value: inr.format(c.amountInr) }] : []),
    ...(c.assignee ? [{ label: 'In charge', value: c.assignee.title ? `${c.assignee.name} (${c.assignee.title})` : c.assignee.name }] : []),
  ];

  const stages = d.report.stages.map((s, i) => ({
    n: i + 1,
    name: s.name,
    status: STAGE_STATUS[s.status] ?? capital(s.status),
    took: took(s.minutes, s.status),
    found: found[s.stage as StageKey]?.length ? found[s.stage as StageKey]! : s.summary ? [s.summary] : [],
  }));

  // Stage 5 and the stage 7 sign-off, from the case file (names) and the approvals (times).
  const gateAt = (stage: 'approve' | 'close') => d.approvals.find((a) => a.kind === 'case_gate' && a.stage === stage && a.decidedAt)?.decidedAt ?? null;
  const decision = (what: string, roleId: string | undefined, decided: string | undefined, by: string | undefined, at: string | null, notes?: string | null) => {
    const who = by ? `${by} (${role(roleId ?? 'owner')})` : role(roleId ?? 'owner');
    if (!decided) return `${what}: waiting for ${role(roleId ?? 'owner')}.`;
    return `${what}: ${DECIDED[decided] ?? decided} by ${who}${at ? `, ${when(at)}` : ''}.${notes ? ` Note: “${notes}”` : ''}`;
  };
  const decisions: string[] = [];
  const approve = d.file.approve;
  if (approve?.required) decisions.push(decision('Approval', approve.approverRole, approve.decision === 'not_required' ? undefined : approve.decision, approve.decidedBy, gateAt('approve'), approve.notes));
  const signoff = d.file.close?.signoff;
  if (signoff?.required) {
    const note = d.approvals.find((a) => a.kind === 'case_gate' && a.stage === 'close' && a.decidedAt)?.decisionNotes;
    decisions.push(decision('Sign-off', signoff.role, signoff.decision === 'not_required' ? undefined : signoff.decision, signoff.by, gateAt('close'), note));
  }

  const r = d.report;
  return {
    code: c.code,
    title: c.title,
    label: d.label.label,
    status: statusWords(c.status),
    dates: `Raised ${when(c.createdAt)}${c.closedAt ? ` · finished ${when(c.closedAt)}` : ''}`,
    onTime: r.slaMet,
    summary: [r.text, r.outcome, r.recurring?.note].filter((s): s is string => !!s),
    details,
    stages,
    decisions,
    work: r.work ? { done: r.work.done, pending: r.work.pending, attention: r.work.attention, people: r.work.people } : null,
  };
}

/** The report as plain text, for WhatsApp, email or a printout. */
export function caseReportText(v: CaseReportView, company?: string): string {
  const section = (title: string, lines: string[]) => (lines.length ? ['', title, ...lines] : []);
  const timing = v.onTime === null ? '' : v.onTime ? ' · on time' : ' · late';
  return [
    `${company ? `${company} · ` : ''}${v.label} report`,
    `${v.code} · ${v.title}`,
    `${v.status} · ${v.dates}${timing}`,
    ...(v.summary.length ? ['', ...v.summary] : []),
    ...section(
      'Details',
      v.details.map((d) => `- ${d.label}: ${d.value}`),
    ),
    ...section(
      'Stages',
      v.stages.flatMap((s) => [`${s.n}. ${s.name} · ${s.status}${s.took ? ` · ${s.took}` : ''}`, ...s.found.map((f) => `   ${f}`)]),
    ),
    ...section(
      'Decisions',
      v.decisions.map((d) => `- ${d}`),
    ),
    ...section('What was done', (v.work?.done ?? []).map((l) => `✓ ${l}`)),
    ...section('Still in progress', (v.work?.pending ?? []).map((l) => `… ${l}`)),
    ...section('Needs attention', (v.work?.attention ?? []).map((l) => `! ${l}`)),
    ...section('People involved', (v.work?.people ?? []).map((l) => `- ${l}`)),
  ].join('\n');
}

/**
 * A goal's title for people. The work of a case (stage 6) has a goal text written for the agents;
 * its first line is the case's code and title. A goal someone typed is shown as they typed it.
 */
export function goalTitle(goal: { caseId: string | null; text: string }): string {
  return goal.caseId ? goal.text.split('\n')[0]!.trim() : goal.text;
}
