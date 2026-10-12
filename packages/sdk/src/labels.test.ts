import { describe, expect, it } from 'vitest';
import type { ResolvedPack } from '@onehuman/schemas';
import { clearanceLabel, connectorName, ruleText, toolLabel } from './labels';

const pack = {
  entities: [
    { name: 'Enquiry', label: 'Enquiry', plural_label: 'Enquiries', fields: [{ name: 'status', label: 'Status', type: 'enum', required: true }] },
    { name: 'Booking', label: 'Booking', fields: [{ name: 'status', label: 'Status', type: 'enum', required: true }] },
  ],
  tools: [
    { name: 'enquiry.mark_contacted', description: 'Mark an enquiry as contacted.', uses: 'records.update', with: { entity: 'Enquiry', patch: { status: 'contacted' } } },
    { name: 'booking.cancel', description: 'Cancel a booking.', uses: 'records.update', with: { entity: 'Booking', patch: { status: 'cancelled' } } },
  ],
  agents: [{ role: 'follow-up-agent', name: 'Follow-up agent' }],
} as unknown as ResolvedPack;

describe('everyday labels', () => {
  it('names tools as things a person does', () => {
    expect(toolLabel('knowledge.search')).toBe('Search company notes');
    expect(toolLabel('staff.delegate')).toBe('Phone your team');
    expect(toolLabel('enquiry.mark_contacted', pack)).toBe('Mark enquiries as contacted');
    expect(toolLabel('booking.cancel', pack)).toBe('Mark bookings as cancelled');
  });

  it('reads rules as sentences', () => {
    expect(ruleText({ action: 'refund.issue', forbid_above: { amount: 200000, currency: 'INR' }, approver: 'owner' }, pack)).toBe(
      'Refunds above ₹2,00,000 are never done by the AI',
    );
    expect(ruleText({ action: 'payment.request', require_approval_above: { amount: 25000, currency: 'INR' }, approver: 'owner' }, pack)).toBe(
      'Payment requests above ₹25,000 need your OK first',
    );
    expect(ruleText({ action: 'message.send', agent: 'follow-up-agent', require_approval: true, approver: 'owner' }, pack)).toBe(
      'Messages to customers by the Follow-up agent need your OK first',
    );
    expect(ruleText({ action: 'booking.cancel', require_approval: true, approver: 'owner' }, pack)).toBe('Marking bookings as cancelled needs your OK first');
    expect(ruleText({ action: '*', forbid: true, approver: 'owner' }, pack)).toBe('The AI may not act at all');
    expect(ruleText({ action: '*', require_approval: true, approver: 'owner' }, pack)).toBe('Every action needs your OK first');
  });

  it('describes clearance and connections plainly', () => {
    expect(clearanceLabel(2).short).toBe('Drafts only');
    expect(clearanceLabel(4).long).toMatch(/wait for your OK/);
    expect(connectorName('whatsapp-business')).toBe('WhatsApp Business');
    expect(connectorName('site-camera')).toBe('Site Camera');
  });
});
