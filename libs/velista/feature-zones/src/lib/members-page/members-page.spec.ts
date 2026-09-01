import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeMembershipService,
  fakeZoneStore,
  GatewayError,
  MembershipStore,
  provideFakeMembershipService,
  provideFakeSessionStore,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type FakeMembershipService,
  type FakeZoneStore,
} from '@portfolio/velista/data-access';
import type { Membership, MyZone, ZoneRole } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { MemberListRefresh } from '../member-list-refresh';
import { MembersPage } from './members-page';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const ME = 'u1';

function zone(myRole: ZoneRole = 'OWNER'): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: ME,
    myRole,
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: myRole === 'MEMBER' ? null : 1,
      firstPendingRequesterName: myRole === 'MEMBER' ? null : 'Ines',
    },
    lists: [],
  };
}

function member(
  id: string,
  username: string,
  role: ZoneRole,
  userId = `u-${id}`
): Membership {
  return {
    id,
    zoneId: ZONE_ID,
    userId,
    username,
    role,
    status: 'APPROVED',
  };
}

function waiting(id: string, username: string): Membership {
  return {
    id,
    zoneId: ZONE_ID,
    userId: `u-${id}`,
    username,
    role: 'MEMBER',
    status: 'PENDING',
  };
}

const SEED: readonly Membership[] = [
  member('m-me', 'Dani', 'OWNER', ME),
  member('m-toni', 'Toni', 'ADMIN'),
  member('m-marta', 'Marta', 'MEMBER'),
  waiting('m-ines', 'Ines'),
];

interface Options {
  readonly myRole?: ZoneRole;
  readonly members?: readonly Membership[];
  /** A cold deep link, where nothing put this group in the cache first. */
  readonly noZoneCached?: boolean;
  readonly rejectWith?: Parameters<
    typeof fakeMembershipService
  >[0] extends infer O
    ? O extends { rejectWith?: infer R }
      ? R
      : never
    : never;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<MembersPage>;
  zones: FakeZoneStore;
  members: FakeMembershipService;
  realtime: RealtimeMemory;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const zones = fakeZoneStore({
    zones:
      options.noZoneCached === true ? [] : [zone(options.myRole ?? 'OWNER')],
  });
  const members = fakeMembershipService({
    members: options.members ?? SEED,
    rejectWith: options.rejectWith,
  });
  const realtime = new RealtimeMemory();
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  const map = convertToParamMap({ zoneId: ZONE_ID });

  await TestBed.configureTestingModule({
    imports: [MembersPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(zones),
      provideFakeMembershipService(members),
      // The real store, not a double (plan 0018). It resolves the faked membership
      // service and the in-memory realtime client that are already here, so every test
      // below drives the page through the same rows the app uses, and a membership
      // event pushed at the fake reaches this screen the way it reaches the real one.
      MembershipStore,
      provideFakeSessionStore('REGISTERED', { userId: ME }),
      { provide: REALTIME_CLIENT, useValue: realtime },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: { paramMap: map, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MembersPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, zones, members, realtime, router };
}

function text(fixture: ComponentFixture<MembersPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function all(fixture: ComponentFixture<MembersPage>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  );
}

function failure(code: GatewayError['code'], status: number): GatewayError {
  return new GatewayError({ code, status, correlationId: 'ref-1' });
}

describe('MembersPage', () => {
  describe('what it asks for, and rule G2', () => {
    it('asks for the pending memberships as staff', async () => {
      const { members } = await render({ myRole: 'ADMIN' });

      expect(members.calls[0]).toMatchObject({
        method: 'listMembers',
        statuses: ['APPROVED', 'PENDING'],
      });
    });

    it('asks once, and not once per turn of its own effect', async () => {
      // Same regression as the group page's, and it reached this screen through the
      // same door: the load effect read the zone cache that `loadZone` writes, so
      // every answer scheduled the next request.
      const { fixture, zones, members } = await render({ myRole: 'ADMIN' });

      for (let round = 0; round < 5; round += 1) {
        fixture.detectChanges();
        await fixture.whenStable();
      }

      expect(zones.loadCount()).toBe(1);
      expect(
        members.calls.filter((call) => call.method === 'listMembers')
      ).toHaveLength(1);
    });

    it('asks only for the approved ones as an ordinary member', async () => {
      // Any status other than APPROVED is staff only, and asking for it as a member
      // is a `forbidden` rather than an empty page. The screen decides from `myRole`
      // instead of finding out by being refused (section 5.4).
      const { members } = await render({ myRole: 'MEMBER' });

      expect(members.calls[0]).toMatchObject({ statuses: ['APPROVED'] });
    });
  });

  describe('when a sheet over it changes a row', () => {
    it('re-lists when the token is bumped', async () => {
      // Rule E1 makes the action sheets children of this route, so this screen is
      // alive the whole time one is over it and has no arrival to re-read on. The
      // token is the only thing that tells it a row changed.
      const { fixture, members } = await render();
      const before = members.calls.filter(
        (call) => call.method === 'listMembers'
      ).length;

      TestBed.inject(MemberListRefresh).record();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        members.calls.filter((call) => call.method === 'listMembers')
      ).toHaveLength(before + 1);
    });

    it('asks for nothing while the token stands still', async () => {
      // Which is what a cancelled sheet leaves behind. The alternative this replaced,
      // an outlet's `deactivate`, could not tell the two apart and cost a page of
      // members on every dismissal.
      const { fixture, members } = await render();
      const before = members.calls.filter(
        (call) => call.method === 'listMembers'
      ).length;

      for (let round = 0; round < 3; round += 1) {
        fixture.detectChanges();
        await fixture.whenStable();
      }

      expect(
        members.calls.filter((call) => call.method === 'listMembers')
      ).toHaveLength(before);
    });
  });

  /**
   * Plan 0015, section 5.8. `member.usernameChanged` was absent from the realtime union
   * entirely, which made `MATCHING_ZONES` a propagation nothing could observe: the
   * server renamed the memberships and every open members screen kept the old name.
   */
  /**
   * Plan 0018. Six membership events change these rows and this screen used to apply
   * one of them. Every case here pushes the raw payload at the in-memory client, so it
   * goes through the same mapper and the same store a socket payload would.
   */
  describe('when the members change elsewhere', () => {
    /** How many pages of members have been asked for, to prove an event costs none. */
    const listCalls = (members: FakeMembershipService) =>
      members.calls.filter((call) => call.method === 'listMembers').length;

    async function settle(
      fixture: ComponentFixture<MembersPage>
    ): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('changes a renamed row in place, with no refetch', async () => {
      const { fixture, realtime, members } = await render();
      const before = listCalls(members);

      realtime.emit('member.usernameChanged', {
        ...member('m-marta', 'Mamá', 'MEMBER'),
      });
      await settle(fixture);

      expect(text(fixture)).toContain('Mamá');
      expect(text(fixture)).not.toContain('Marta');
      // The whole point: the event carries the new name in full, so a page of members
      // per rename would be a request storm for something already in hand.
      expect(listCalls(members)).toBe(before);
    });

    it('ignores a rename in another group', async () => {
      const { fixture, realtime } = await render();

      realtime.emit('member.usernameChanged', {
        ...member('m-marta', 'Mamá', 'MEMBER'),
        zoneId: 'some-other-zone',
      });
      await settle(fixture);

      expect(text(fixture)).toContain('Marta');
    });

    // The worst of the set before this plan: the row stayed, with a working actions
    // menu whose every entry failed against a membership the server had deleted.
    it('takes away a member who was kicked', async () => {
      const { fixture, realtime, members } = await render();
      const before = listCalls(members);

      realtime.emit('member.kicked', {
        ...member('m-marta', 'Marta', 'MEMBER'),
        status: 'KICKED',
      });
      await settle(fixture);

      expect(text(fixture)).not.toContain('Marta');
      expect(listCalls(members)).toBe(before);
    });

    it('takes away a member who was banned', async () => {
      const { fixture, realtime } = await render();

      realtime.emit('member.banned', {
        ...member('m-toni', 'Toni', 'ADMIN'),
        status: 'BANNED',
      });
      await settle(fixture);

      expect(text(fixture)).not.toContain('Toni');
    });

    it('moves a request into the members when another admin approves it', async () => {
      const { fixture, realtime } = await render();

      realtime.emit('member.approved', {
        ...waiting('m-ines', 'Ines'),
        status: 'APPROVED',
      });
      await settle(fixture);

      // Same row, different section: the payload is the membership in its new state,
      // and the sections are a filter over one list.
      const pending = fixture.nativeElement.querySelectorAll(
        'lib-pending-request-row'
      );
      expect(pending.length).toBe(0);
      expect(text(fixture)).toContain('Ines');
    });

    it('empties the queue when another admin rejects a request', async () => {
      const { fixture, realtime } = await render();

      // `{ id, userId }` and no zone, which is why the zone summary cannot use it. A
      // row can: an id is unique and is all a removal needs.
      realtime.emit('member.rejected', { id: 'm-ines', userId: 'u-m-ines' });
      await settle(fixture);

      expect(text(fixture)).not.toContain('Ines');
    });

    it('shows a new request the moment somebody asks to join', async () => {
      const { fixture, realtime } = await render();

      realtime.emit('member.joined', { ...waiting('m-new', 'Bruno') });
      await settle(fixture);

      expect(text(fixture)).toContain('Bruno');
    });

    it('keeps a pending arrival away from an ordinary member', async () => {
      // Rule G2: this screen asked for APPROVED alone, so an event about a status it
      // may not see is not an update to hide, it is a row that must never appear.
      const { fixture, realtime } = await render({ myRole: 'MEMBER' });

      realtime.emit('member.joined', { ...waiting('m-new', 'Bruno') });
      await settle(fixture);

      expect(text(fixture)).not.toContain('Bruno');
    });

    it('changes a role in place when somebody else changes it', async () => {
      const { fixture, realtime, members } = await render();
      const before = listCalls(members);

      realtime.emit('member.roleChanged', {
        ...member('m-marta', 'Marta', 'ADMIN'),
      });
      await settle(fixture);

      expect(listCalls(members)).toBe(before);
      expect(text(fixture)).toContain('Marta');
    });
  });

  describe('the screen around the rows', () => {
    it('opens with the app bar, like the group page it was opened from', async () => {
      const { fixture } = await render();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('lib-app-bar')
      ).not.toBeNull();
    });

    it('is titled before the rows are there', async () => {
      // The `h1` used to live inside the loaded branch, so the screen had no name at
      // all while it was loading and while it was failing.
      const { fixture } = await render();

      expect(text(fixture)).toContain('zone.members.title');
    });

    it('says plain Members when no group name is cached', async () => {
      // A cold deep link. "Members of " with a hole in it is worse than the label.
      const { fixture } = await render({ noZoneCached: true });

      expect(text(fixture)).toContain('zone.detail.members');
      expect(text(fixture)).not.toContain('zone.members.title');
    });

    it('shows the back control as a caret, not as the word Back', async () => {
      const { fixture } = await render();
      const back = (fixture.nativeElement as HTMLElement).querySelector(
        '.back'
      );

      expect(back?.getAttribute('aria-label')).toBe('zone.detail.back');
      expect(back?.querySelector('lib-chevron-left-icon')).not.toBeNull();
      expect(back?.textContent?.trim()).toBe('');
    });
  });

  describe('rule G3, the staff room', () => {
    it('joins it for an owner and for an admin', async () => {
      for (const role of ['OWNER', 'ADMIN'] as const) {
        const { realtime } = await render({ myRole: role });

        expect(realtime.rooms.has(`zone:${ZONE_ID}:staff`)).toBe(true);
      }
    });

    it('does not join it for a plain member', async () => {
      // The server refuses the room, a refusal feeds `staleZoneIds`, and `0003`
      // renders that as "this group is not live". Subscribing unconditionally would
      // put a permanent and untrue stale badge on every group where the caller is an
      // ordinary member (section 5.3).
      const { realtime } = await render({ myRole: 'MEMBER' });

      expect(realtime.rooms.has(`zone:${ZONE_ID}:staff`)).toBe(false);
      expect(realtime.refusedZones().size).toBe(0);
    });

    it('releases it when the screen is destroyed', async () => {
      const { fixture, realtime } = await render({ myRole: 'OWNER' });

      fixture.destroy();

      expect(realtime.rooms.has(`zone:${ZONE_ID}:staff`)).toBe(false);
    });
  });

  describe('the pending section', () => {
    it('lists whoever is waiting, above the members', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('Ines');
      expect(all(fixture, 'lib-pending-request-row')).toHaveLength(1);
    });

    it('is absent entirely when nobody is waiting', async () => {
      // Absent, not an empty state with a message (section 3.4).
      const { fixture } = await render({
        members: SEED.filter((row) => row.status !== 'PENDING'),
      });

      expect(all(fixture, 'lib-pending-request-row')).toHaveLength(0);
      expect(text(fixture)).not.toContain('zone.members.requests');
    });

    it('is absent for an ordinary member', async () => {
      const { fixture } = await render({ myRole: 'MEMBER' });

      expect(all(fixture, 'lib-pending-request-row')).toHaveLength(0);
    });
  });

  describe('answering a request', () => {
    it('approves and moves the member count without a reload', async () => {
      const { fixture, members, zones } = await render();

      await fixture.componentInstance.approve('m-ines');
      fixture.detectChanges();

      expect(members.calls).toContainEqual(
        expect.objectContaining({ method: 'approve', membershipId: 'm-ines' })
      );
      expect(zones.writes).toContainEqual({
        method: 'recordMembershipChange',
        zoneId: ZONE_ID,
        change: 'approved',
      });
      expect(all(fixture, 'lib-pending-request-row')).toHaveLength(0);
    });

    it('says nothing when somebody else answered first', async () => {
      // The row leaves, quietly. Two admins on the same queue is the normal case, and
      // the one who was half a second slower has done nothing wrong (section 5.6).
      const { fixture } = await render({
        rejectWith: { approve: failure('validation_failed', 400) },
      });

      await fixture.componentInstance.approve('m-ines');
      fixture.detectChanges();

      expect(fixture.componentInstance.errorKey()).toBeNull();
      expect(text(fixture)).not.toContain('zone.error');
    });

    it('does report a failure that is not somebody else winning', async () => {
      const { fixture } = await render({
        rejectWith: { approve: failure('forbidden', 403) },
      });

      await fixture.componentInstance.approve('m-ines');

      expect(fixture.componentInstance.errorKey()).toBe(
        'zone.error.roleChanged'
      );
    });

    it('announces the answer, so a row leaving is not silent', async () => {
      const { fixture } = await render();

      await fixture.componentInstance.approve('m-ines');

      expect(fixture.componentInstance.announcement()).toEqual({
        key: 'zone.members.approved',
        name: 'Ines',
      });
    });
  });

  describe('the row menus', () => {
    it('gives an owner a menu on everybody but shows no role control to an admin', async () => {
      const asAdmin = await render({ myRole: 'ADMIN' });

      expect(text(asAdmin.fixture)).not.toContain('zone.members.makeAdmin');
      expect(text(asAdmin.fixture)).not.toContain('zone.members.transfer');
    });

    it('changes a role in place, with no confirm in front of it', async () => {
      const { fixture, members, router } = await render();

      await fixture.componentInstance.act({
        action: 'makeAdmin',
        membershipId: 'm-marta',
      });

      expect(members.calls).toContainEqual(
        expect.objectContaining({ method: 'setRole', role: 'ADMIN' })
      );
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('opens a confirm route for the three that take something away', async () => {
      const { fixture, router } = await render();

      for (const action of ['remove', 'ban', 'transfer'] as const) {
        await fixture.componentInstance.act({
          action,
          membershipId: 'm-marta',
        });

        expect(router.navigate).toHaveBeenCalledWith(
          ['sheet', 'm-marta', 'confirm', action],
          expect.objectContaining({ state: { name: 'Marta' } })
        );
      }
    });
  });

  describe('when the caller loses the group while looking at it', () => {
    it('leaves for the dashboard', async () => {
      const { fixture, zones, router } = await render();

      zones.setDeparture({ zoneId: ZONE_ID, reason: 'banned' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
    });
  });
});
