import { describe, expect, it } from 'vitest';
import { describeAction, toApproval, toCase, toTenant } from '../../../src/common/mappers';

describe('approval summaries', () => {
  it('reads money actions plainly', () => {
    expect(describeAction('refund.issue', { amount: 12000, recipient: 'Asha Menon', reason: 'trip cancelled' })).toBe(
      'Refund ₹12,000 to Asha Menon (trip cancelled)',
    );
  });

  it('turns pack tools into verb + object with the record title', () => {
    expect(describeAction('booking.cancel', { entity: 'Booking', id: 'b1' }, { label: 'Booking', title: 'Rahul Nair' })).toBe(
      'Cancel booking for Rahul Nair',
    );
    expect(describeAction('enquiry.mark_contacted', { entity: 'Enquiry', id: 'e1' }, { label: 'Enquiry' })).toBe('Mark contacted enquiry');
  });

  it('uses sector labels for generic updates', () => {
    expect(describeAction('records.update', { entity: 'Booking', id: 'b1', patch: { status: 'confirmed' } }, { label: 'Appointment', title: 'Priya' })).toBe(
      'Update appointment for Priya → confirmed',
    );
  });
});

describe('mapping cases and gates', () => {
  const at = new Date('2026-10-13T04:30:00Z');

  it('maps a gate approval with no goal', () => {
    const view = toApproval(
      {
        id: 'a1', tenantId: 't1', kind: 'case_gate', goalId: null, taskId: null, toolCallId: null, caseId: 'c1', stage: 'approve',
        agentId: 'ag1', tool: 'case.proceed', args: { caseId: 'c1' }, summary: 'Approve WO-0042', rationale: '',
        decision: { level: 4, riskScore: 40, factors: [], reasons: ['Hot work needs the safety officer'], approver: 'safety-officer', policyVersion: 1 },
        evidence: [], costSoFarInr: 0, approver: 'safety-officer', status: 'pending', expiresAt: at, decidedBy: null, decidedAt: null,
        decisionNotes: null, editedArgs: null, signature: null, signingKeyId: null, signedAt: null, createdAt: at,
      },
      'Case coordinator',
    );
    expect(view).toMatchObject({ kind: 'case_gate', goalId: null, toolCallId: null, caseId: 'c1', stage: 'approve', approver: 'safety-officer' });
  });

  it('gives older companies the default needs-info wait and no sector', () => {
    const tenant = toTenant({
      id: 't1', name: 'Kerala Trails', industry: 'Travel', sector: null, orgType: null, status: 'active', onboarded: true,
      settings: { redactPii: true, riskBands: { level1Below: 15, level2Below: 35, level3Below: 75 }, approvalTtlHours: 72 } as never,
      createdAt: at,
    });
    expect(tenant.sector).toBeNull();
    expect(tenant.settings.needsInfoDays).toBe(7);
  });

  it('maps a case row to its view', () => {
    const view = toCase({
      id: 'c1', tenantId: 't1', workspaceId: 'w1', number: 42, code: 'WO-0042', title: 'Boiler feed pump B vibration', source: 'staff',
      requester: { name: 'Ravi' }, externalRef: null, category: 'breakdown', categoryName: 'Breakdown', priority: 'P2', risk: 'medium',
      department: 'Maintenance', amountInr: null, assignee: { name: 'Suresh', title: 'Maintenance lead' }, respondBy: at, resolveBy: null,
      stage: 'execute', status: 'in_progress', outcome: null, file: {}, goalId: 'g1', workflowId: 'case-c1', createdBy: 'p1',
      createdAt: at, updatedAt: at, closedAt: null,
    });
    expect(view).toMatchObject({ code: 'WO-0042', status: 'in_progress', respondBy: '2026-10-13T04:30:00.000Z', resolveBy: null, closedAt: null });
  });
});
