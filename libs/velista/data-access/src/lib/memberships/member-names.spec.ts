import { TestBed } from '@angular/core/testing';
import type { Membership } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import {
  fakeMembershipService,
  provideFakeMembershipService,
  provideFakeSessionStore,
} from '../testing/store-doubles';
import { MemberNames } from './member-names';

/**
 * Names have to keep up with the group (plan 0026).
 *
 * `ensure` is once per session, which left somebody who joined **after** it ran with
 * no name for the rest of that session. Every surface built on a name then dropped
 * them without saying so, because `presenceNames` leaves out whoever it cannot name:
 * the report was an owner who accepted a join request and could not then see the new
 * member's presence indicator.
 */
const ZONE = 'zone-1';

function member(id: string, overrides: Partial<Membership> = {}): Membership {
  return {
    id,
    zoneId: ZONE,
    userId: `u-${id}`,
    username: id.toUpperCase(),
    role: 'MEMBER',
    status: 'APPROVED',
    ...overrides,
  };
}

function setup(seed: readonly Membership[] = [member('a')]) {
  TestBed.resetTestingModule();

  const service = fakeMembershipService({ members: seed });

  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      provideFakeMembershipService(service),
      provideFakeSessionStore('REGISTERED'),
      RealtimeMemory,
      MemberNames,
    ],
  });

  return {
    names: TestBed.inject(MemberNames),
    realtime: TestBed.inject(REALTIME_CLIENT) as RealtimeMemory,
    service,
  };
}

describe('MemberNames', () => {
  it('names a member who arrives after the zone was loaded', async () => {
    const { names, realtime } = setup();
    await names.ensure(ZONE);

    expect(names.nameOf(ZONE, 'u-b')).toBeNull();

    realtime.emit('member.approved', member('b'));

    expect(names.nameOf(ZONE, 'u-b')).toBe('B');
  });

  it('costs no request to do it', async () => {
    // The event carries the whole membership, username included, so keeping up is
    // free. Re-fetching the zone on every membership change would put a request
    // behind an indicator that is only ever advisory.
    const { names, realtime, service } = setup();
    await names.ensure(ZONE);
    const before = service.calls.listMembers;

    realtime.emit('member.approved', member('b'));

    expect(service.calls.listMembers).toBe(before);
  });

  it('follows a rename rather than keeping the name it first saw', async () => {
    const { names, realtime } = setup();
    await names.ensure(ZONE);

    realtime.emit('member.usernameChanged', member('a', { username: 'Ana' }));

    expect(names.nameOf(ZONE, 'u-a')).toBe('Ana');
    // One row, not two: `membersOf` feeds the share sheet, and a rename that appended
    // would give it the same person twice under two names.
    expect(names.membersOf(ZONE).map((row) => row.id)).toEqual(['a']);
  });

  it('keeps a departed member named, because a comment outlives a membership', () => {
    const { names, realtime } = setup();
    void names.ensure(ZONE);

    realtime.emit('member.kicked', member('a', { status: 'KICKED' }));

    expect(names.nameOf(ZONE, 'u-a')).toBe('A');
  });

  // The list header's presence panel draws a role beside each name. It comes off the
  // same cached rows the name does, so the two cannot disagree about one person.
  it('answers what somebody is in the zone, from the same rows as the name', async () => {
    const { names } = setup([member('a', { role: 'ADMIN' })]);
    await names.ensure(ZONE);

    expect(names.roleOf(ZONE, 'u-a')).toBe('ADMIN');
  });

  it('follows a promotion, as the name follows a rename', async () => {
    const { names, realtime } = setup();
    await names.ensure(ZONE);

    realtime.emit('member.roleChanged', member('a', { role: 'OWNER' }));

    expect(names.roleOf(ZONE, 'u-a')).toBe('OWNER');
  });

  // Null rather than the enum's MEMBER fallback, which exists to read an unrecognised
  // value off the wire safely. Using it here would demote an owner for as long as the
  // members request is in flight, and the panel draws no chip at all instead.
  it('has no role for somebody it has no name for', () => {
    const { names } = setup();

    expect(names.roleOf(ZONE, 'u-nobody')).toBeNull();
  });

  it('starts no cache for a zone nobody has asked for', () => {
    // `membersOf` would otherwise hand the share sheet one row and look complete
    // rather than empty.
    const { names, realtime } = setup();

    realtime.emit('member.approved', member('b'));

    expect(names.nameOf(ZONE, 'u-b')).toBeNull();
    expect(names.membersOf(ZONE)).toEqual([]);
  });
});
