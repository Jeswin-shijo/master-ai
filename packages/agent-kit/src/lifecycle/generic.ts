import type { ResolvedLifecycle } from '@onehuman/schemas';

/**
 * The root layer of every lifecycle: the product owner's generic stage names,
 * P1–P4 defaults, the owner role and a catch-all category. Sector and
 * organization packs rename stages and add categories on top.
 */
export const GENERIC_LIFECYCLE: ResolvedLifecycle = {
  case: { label: 'Case', plural: 'Cases', prefix: 'CS' },
  stages: [
    { key: 'request', name: 'Request / Event Created', description: 'Takes in a request from a user, customer, employee, system alert or external partner.', checks: [] },
    { key: 'review', name: 'Admin Review & Validation', description: 'Checks the details, documents, eligibility and completeness.', checks: [] },
    { key: 'classify', name: 'Classification & Priority', description: 'Sets the category, urgency, risk, response time and department.', checks: [] },
    { key: 'assign', name: 'Assignment', description: 'Names the person or team in charge and the deadline.', checks: [] },
    { key: 'approve', name: 'Approval Gate', description: 'An authorised person approves when the rules require it.', checks: [] },
    { key: 'execute', name: 'Execution & Monitoring', description: 'Does the work and tracks progress, cost, evidence and deadlines.', checks: [] },
    { key: 'close', name: 'Verification & Closure', description: 'Confirms the outcome and gets the final sign-off when required.', checks: [] },
    { key: 'report', name: 'Reporting & Continuous Improvement', description: 'Reports the result, the time taken and any problem that keeps coming back.', checks: [] },
  ],
  priorities: [
    { id: 'P1', name: 'Critical', respond_within_hours: 1, resolve_within_hours: 4 },
    { id: 'P2', name: 'High', respond_within_hours: 4, resolve_within_hours: 24 },
    { id: 'P3', name: 'Normal', respond_within_hours: 24, resolve_within_hours: 72 },
    { id: 'P4', name: 'Low', respond_within_hours: 72, resolve_within_hours: 168 },
  ],
  roles: [{ id: 'owner', name: 'Owner', approves: 'Anything the rules send to the owner' }],
  urgent_keywords: ['emergency', 'fire', 'injury', 'injured', 'accident', 'explosion', 'gas leak', 'outage', 'theft', 'fraud'],
  categories: [
    {
      id: 'general',
      name: 'General request',
      // Deliberately rare: unmatched requests reach this category as the fallback, so common
      // words here would steal requests from real categories.
      keywords: ['general request'],
      priority: 'P3',
      risk: 'low',
      department: 'Operations',
      required_details: [],
      required_checks: [],
      not_eligible: [],
      approval: { required: 'never' },
      signoff: { required: false },
      execution: 'agents',
    },
  ],
  fallback_category: 'general',
  examples: [],
};
