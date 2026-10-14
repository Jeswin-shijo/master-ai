import { describe, expect, it } from 'vitest';
import { checkAccess } from '../../../src/common/access';

describe('access on every request', () => {
  it('turns a removed person away at once', () => {
    expect(checkAccess({ role: 'member', status: 'retired' }, false)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(null, false)).toMatchObject({ ok: false, status: 401 });
  });

  it('uses the role from the database, not the token', () => {
    // The token may still say "admin"; the database says "member" now.
    expect(checkAccess({ role: 'member', status: 'active' }, false)).toEqual({ ok: true, role: 'member' });
  });

  it('keeps owner and admin routes for the owner and admins', () => {
    expect(checkAccess({ role: 'member', status: 'active' }, true)).toMatchObject({ ok: false, status: 403 });
    expect(checkAccess({ role: 'admin', status: 'active' }, true)).toEqual({ ok: true, role: 'admin' });
    expect(checkAccess({ role: 'owner', status: 'active' }, true)).toEqual({ ok: true, role: 'owner' });
  });
});
