import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeListStore,
  fakeZoneStore,
  provideFakeListStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  type FakeListStore,
  type FakeZoneStore,
} from '@portfolio/velista/data-access';
import type { MyZone, ShoppingListSummary } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { GroupPage } from './group-page';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 3,
      firstPendingRequesterName: 'Ines',
    },
    lists: [],
    ...overrides,
  };
}

function list(id: string, name: string): ShoppingListSummary {
  return {
    id,
    zoneId: ZONE_ID,
    name,
    createdByUserId: 'u1',
    lineCount: 12,
    readyCount: 7,
  };
}

interface Options {
  readonly zone?: MyZone;
  readonly lists?: readonly ShoppingListSummary[];
  /** Defaults to `loaded`, which is a group already opened once this session. */
  readonly listsState?: 'idle' | 'loading' | 'loaded' | 'failed';
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<GroupPage>;
  zones: FakeZoneStore;
  lists: FakeListStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const seeded = options.zone ?? zone();
  const zones = fakeZoneStore({ zones: [seeded] });
  const lists = fakeListStore({
    lists: options.lists ?? [],
    state: options.listsState ?? 'loaded',
  });
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  await TestBed.configureTestingModule({
    imports: [GroupPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(zones),
      provideFakeListStore(lists),
      provideFakeSessionStore('REGISTERED'),
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: routeWith(ZONE_ID) },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(GroupPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, zones, lists, router };
}

/**
 * The shape `route-params.ts` reads: a real `paramMap` observable plus a snapshot.
 *
 * A real `Observable` rather than an object with a `subscribe` method, because
 * `toSignal` subscribes through rxjs and a hand-rolled stand-in fails inside it rather
 * than in the spec. `convertToParamMap` is the router's own, so the fake route answers
 * exactly as the real one does.
 */
function routeWith(zoneId: string) {
  const map = convertToParamMap({ zoneId });

  return {
    paramMap: of(map),
    snapshot: { paramMap: map, parent: null, data: {} },
    parent: null,
  };
}

function text(fixture: ComponentFixture<GroupPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function query(fixture: ComponentFixture<GroupPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('GroupPage', () => {
  it('shows the group name immediately, from the cache', async () => {
    // The acceptance criterion for arriving from the dashboard: a named group at
    // once, with a skeleton for the rows alone rather than for the whole screen.
    const { fixture } = await render({
      lists: [list('list-1', 'Weekly shop')],
    });

    expect(text(fixture)).toContain('Flat 3B');
    expect(text(fixture)).toContain('Weekly shop');
  });

  it('asks for the lists it has not loaded yet', async () => {
    const { lists } = await render({ listsState: 'idle' });

    expect(lists.loadCount()).toBe(1);
  });

  it('does not ask again for lists it already holds', async () => {
    // `ListStore` survives navigation, so coming back to a group must not refetch
    // rows that are already correct (plan 0004, section 7.1).
    const { lists } = await render({
      lists: [list('list-1', 'Weekly shop')],
    });

    expect(lists.loadCount()).toBe(0);
  });

  describe('a membership that is still waiting', () => {
    it('sends no request for the lists', async () => {
      // The acceptance criterion, and it is asserted on the service double rather
      // than by inspection: core answers `forbidden` to a caller who is not APPROVED,
      // and being refused is how somebody ends up reading an error panel about a
      // situation that is not an error (section 3.3).
      const { lists } = await render({
        zone: zone({ myStatus: 'PENDING', myRole: 'MEMBER' }),
      });

      expect(lists.loadCount()).toBe(0);
    });

    it('explains itself rather than rendering an error', async () => {
      const { fixture } = await render({
        zone: zone({ myStatus: 'PENDING', myRole: 'MEMBER' }),
      });

      expect(text(fixture)).toContain('zone.detail.pending.title');
      expect(text(fixture)).not.toContain('zone.error');
    });

    it('does not offer the join code to somebody not yet let in', async () => {
      const { fixture } = await render({
        zone: zone({ myStatus: 'PENDING', myRole: 'MEMBER' }),
      });

      expect(query(fixture, 'lib-invite-card')).toBeNull();
    });
  });

  describe('an ownerless group', () => {
    it('asks for no lists, since none can be read', async () => {
      const { lists } = await render({
        zone: zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'ADMIN',
        }),
      });

      expect(lists.loadCount()).toBe(0);
    });

    it('offers the claim to an admin and nothing to a member', async () => {
      const asAdmin = await render({
        zone: zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'ADMIN',
        }),
      });
      expect(text(asAdmin.fixture)).toContain('zone.ownerless.claim');

      const asMember = await render({
        zone: zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'MEMBER',
        }),
      });
      expect(text(asMember.fixture)).toContain('zone.ownerless.askAdmin');
      expect(text(asMember.fixture)).not.toContain('zone.ownerless.claim');
    });

    it('claims through the store and then reads the lists it can now see', async () => {
      const { fixture, zones, lists } = await render({
        zone: zone({
          status: 'MARKED_FOR_DELETION',
          ownerUserId: null,
          myRole: 'ADMIN',
        }),
      });

      await fixture.componentInstance.claim();

      expect(zones.writes).toContainEqual({
        method: 'claimOwnership',
        zoneId: ZONE_ID,
      });
      expect(lists.loadCount()).toBe(1);
    });
  });

  describe('the two empties', () => {
    it('invites the first list in a group of one', async () => {
      const { fixture } = await render({
        zone: zone({ counts: { ...zone().counts, memberCount: 1 } }),
      });

      expect(text(fixture)).toContain('zone.detail.empty.title');
    });

    it('says nothing is shared yet in a group of several', async () => {
      const { fixture } = await render({
        zone: zone({
          myRole: 'MEMBER',
          counts: { ...zone().counts, memberCount: 4 },
        }),
      });

      expect(text(fixture)).toContain('zone.detail.noAccess.title');
      expect(text(fixture)).not.toContain('zone.detail.empty.title');
    });

    it('offers the new list primary to a plain member on both', async () => {
      // `ListService.create` requires only an approved membership, so the button is
      // honest for everybody in the group (section 5.5).
      const { fixture } = await render({
        zone: zone({
          myRole: 'MEMBER',
          counts: { ...zone().counts, memberCount: 4 },
        }),
      });

      expect(query(fixture, '.primary')).not.toBeNull();
    });
  });

  describe('the governance row, and rule G2', () => {
    it('offers settings to staff', async () => {
      const { fixture } = await render({
        zone: zone({ myRole: 'ADMIN' }),
        lists: [list('list-1', 'Weekly shop')],
      });

      expect(text(fixture)).toContain('zone.detail.settings');
    });

    it('hides settings from a plain member holding a stale non-null count', async () => {
      // The count says staff and the role does not. The role wins for controls,
      // which is the whole of rule G2 (section 4.3).
      const { fixture } = await render({
        zone: zone({
          myRole: 'MEMBER',
          counts: { ...zone().counts, pendingRequestCount: 3 },
        }),
        lists: [list('list-1', 'Weekly shop')],
      });

      expect(text(fixture)).not.toContain('zone.detail.settings');
    });

    it('still renders the waiting number, which the count does decide', async () => {
      const { fixture } = await render({
        zone: zone({ myRole: 'OWNER' }),
        lists: [list('list-1', 'Weekly shop')],
      });

      expect(query(fixture, '.pip')?.textContent?.trim()).toBe('3');
    });
  });

  describe('when the caller loses the group while looking at it', () => {
    it('leaves for the dashboard after a removal', async () => {
      const { fixture, zones, router } = await render();

      zones.setDeparture({ zoneId: ZONE_ID, reason: 'kicked' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/velista/home');
    });

    it('ignores a departure from a different group', async () => {
      const { fixture, zones, router } = await render();

      zones.setDeparture({ zoneId: 'zone-other', reason: 'deleted' });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('does not navigate when only the role changed', async () => {
      // `member.roleChanged` records no departure, so the governance row appears or
      // disappears in place and the page stays put (section 3.5).
      const { fixture, zones, router } = await render({
        zone: zone({ myRole: 'ADMIN' }),
        lists: [list('list-1', 'Weekly shop')],
      });

      zones.set([zone({ myRole: 'MEMBER' })]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(text(fixture)).not.toContain('zone.detail.settings');
    });
  });

  describe('the ways out', () => {
    it('opens the members screen as a child route', async () => {
      const { fixture, router } = await render();

      fixture.componentInstance.openMembers();

      expect(router.navigate).toHaveBeenCalledWith(
        ['members'],
        expect.objectContaining({ relativeTo: expect.anything() })
      );
    });

    it('opens the new list sheet over this page (rule E1)', async () => {
      const { fixture, router } = await render();

      fixture.componentInstance.newList();

      expect(router.navigate).toHaveBeenCalledWith(
        ['lists', 'new'],
        expect.objectContaining({ relativeTo: expect.anything() })
      );
    });

    it('records the list screen as unbuilt rather than leaving it dead', async () => {
      const { fixture } = await render({
        lists: [list('list-1', 'Weekly shop')],
      });

      fixture.componentInstance.openList('list-1');

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'lists/list-1',
      ]);
    });
  });
});
