import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueStreamTicket, issueToken, readStreamTicket, readToken, type Session } from '../../../src/common/auth';

const session: Session = { userId: 'u1', principalId: 'p1', tenantId: 't1', role: 'owner' };

describe('stream tickets', () => {
  afterEach(() => vi.useRealTimers());

  it('opens a live stream for the person who asked for it', () => {
    expect(readStreamTicket(issueStreamTicket(session))).toEqual(session);
  });

  it('is not a session: a ticket seen in a log cannot call the API', () => {
    expect(readToken(issueStreamTicket(session))).toBeNull();
  });

  it('is not opened by a session token, so the long-lived token never goes in a URL', () => {
    expect(readStreamTicket(issueToken(session))).toBeNull();
  });

  it('lasts one minute', () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T10:00:00Z') });
    const ticket = issueStreamTicket(session);
    vi.setSystemTime(new Date('2026-10-14T10:00:59Z'));
    expect(readStreamTicket(ticket)).not.toBeNull();
    vi.setSystemTime(new Date('2026-10-14T10:01:01Z'));
    expect(readStreamTicket(ticket)).toBeNull();
  });
});
