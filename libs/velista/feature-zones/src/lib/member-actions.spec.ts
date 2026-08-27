import type { ZoneRole } from '@portfolio/velista/models';
import { canSeePendingRequests, memberActionsFor } from './member-actions';

/**
 * Plan 0010 section 5.4, as a test.
 *
 * Every row here was read from core rather than inferred, and three of them are more
 * restrictive than a designer would assume. Those three are the reason this file
 * exists: each is a rule that looks like an oversight the first time somebody meets it,
 * and each would be "fixed" by a well meaning change without a test saying otherwise.
 */
describe('memberActionsFor', () => {
  const me = 'user-me';

  function actions(
    myRole: ZoneRole,
    member: { userId?: string; role: ZoneRole }
  ) {
    return memberActionsFor({
      myRole,
      myUserId: me,
      member: { userId: member.userId ?? 'user-other', role: member.role },
    });
  }

  describe('your own row', () => {
    it('offers renaming yourself, whatever your role', () => {
      for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
        expect(actions(role, { userId: me, role })).toEqual(['rename']);
      }
    });

    it('offers no way out of the group, because there is none', () => {
      // Section 5.8 item 1: no route, no message pattern, nothing. The only exit is
      // for staff to remove you. Anything here that looked like leaving would be a
      // control that cannot work.
      expect(actions('MEMBER', { userId: me, role: 'MEMBER' })).not.toContain(
        'remove'
      );
    });
  });

  describe('an owner', () => {
    it('can promote, demote, hand over, rename, remove and ban', () => {
      expect(actions('OWNER', { role: 'MEMBER' })).toEqual([
        'makeAdmin',
        'transfer',
        'rename',
        'remove',
        'ban',
      ]);
    });

    it('offers demotion rather than promotion for somebody already an admin', () => {
      expect(actions('OWNER', { role: 'ADMIN' })).toContain('makeMember');
      expect(actions('OWNER', { role: 'ADMIN' })).not.toContain('makeAdmin');
    });
  });

  describe('an admin', () => {
    it('cannot promote anybody, because setRole is owner only', () => {
      const menu = actions('ADMIN', { role: 'MEMBER' });

      expect(menu).not.toContain('makeAdmin');
      expect(menu).not.toContain('makeMember');
      expect(menu).not.toContain('transfer');
    });

    it('can still rename, remove and ban an ordinary member', () => {
      expect(actions('ADMIN', { role: 'MEMBER' })).toEqual([
        'rename',
        'remove',
        'ban',
      ]);
    });

    it('sees no menu at all on the owner, not a disabled one', () => {
      // An empty list is what makes the trigger absent. A disabled control would say
      // "you could do this, later", about something that will never be permitted.
      expect(actions('ADMIN', { role: 'OWNER' })).toEqual([]);
    });
  });

  describe('a plain member', () => {
    it('sees no menu on anybody else', () => {
      for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
        expect(actions('MEMBER', { role })).toEqual([]);
      }
    });
  });

  it('never offers an action against the owner to anyone but the owner', () => {
    // The acceptance criterion, stated once over every viewer.
    for (const viewer of ['ADMIN', 'MEMBER'] as const) {
      expect(actions(viewer, { role: 'OWNER' })).toEqual([]);
    }

    expect(actions('OWNER', { userId: me, role: 'OWNER' })).toEqual(['rename']);
  });
});

describe('canSeePendingRequests', () => {
  it('is true for staff and false for a member', () => {
    // Rule G3, and the reason the members screen does not ask for PENDING as an
    // ordinary member: the server answers `forbidden`, not an empty page.
    expect(canSeePendingRequests('OWNER')).toBe(true);
    expect(canSeePendingRequests('ADMIN')).toBe(true);
    expect(canSeePendingRequests('MEMBER')).toBe(false);
  });
});
