import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakeZoneStore,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakeSessionStore,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type FakeLineStore,
  type FakeListStore,
} from '@portfolio/velista/data-access';
import type {
  Line,
  MyZone,
  ShoppingListSummary,
  ZoneRole,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ListPage } from './list-page';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
/** `provideFakeSessionStore` answers as this user, so the caller is the list's creator. */
const ME = 'user-1';

function zone(role: ZoneRole = 'MEMBER'): MyZone {
  return {
    id: ZONE_ID,
    name: 'Flat 3B',
    joinCode: 'HK7M2QPD',
    status: 'ACTIVE',
    ownerUserId: 'u-owner',
    myRole: role,
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 2,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [],
  };
}

function list(overrides: Partial<ShoppingListSummary> = {}): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Weekly shop',
    createdByUserId: ME,
    lineCount: 12,
    readyCount: 7,
    ...overrides,
  };
}

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId: LIST_ID,
    content: 'Sourdough loaf',
    quantity: 1,
    itemId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    status: 'PENDING',
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

interface Options {
  readonly role?: ZoneRole;
  readonly lists?: readonly ShoppingListSummary[];
  /** Defaults to `loaded`: a list opened from the group page, already cached. */
  readonly listsState?: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly lines?: readonly Line[];
  readonly linesState?: 'idle' | 'loading' | 'loaded' | 'failed';
  readonly complete?: boolean;
  readonly storage?: Map<string, string>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ListPage>;
  lines: FakeLineStore;
  lists: FakeListStore;
  storage: Map<string, string>;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const zones = fakeZoneStore({ zones: [zone(options.role ?? 'MEMBER')] });
  const lists = fakeListStore({
    lists: options.lists ?? [list()],
    state: options.listsState ?? 'loaded',
  });
  const lines = fakeLineStore({
    lines: options.lines ?? [line('ln-1')],
    state: options.linesState ?? 'loaded',
    complete: options.complete ?? true,
  });
  const storage = options.storage ?? new Map<string, string>();
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  await TestBed.configureTestingModule({
    imports: [ListPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(storage),
      provideFakeZoneStore(zones),
      provideFakeListStore(lists),
      provideFakeLineStore(lines),
      provideFakeMemberNames(fakeMemberNames({ 'user-toni': 'Toni' })),
      provideFakeSessionStore('REGISTERED'),
      { provide: REALTIME_CLIENT, useValue: new RealtimeMemory() },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: route() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines, lists, storage, router };
}

/** The shape `route-params.ts` reads: a real `paramMap` observable plus a snapshot. */
function route() {
  const map = convertToParamMap({ zoneId: ZONE_ID, listId: LIST_ID });

  return {
    paramMap: of(map),
    snapshot: { paramMap: map, parent: null },
    parent: null,
  };
}

function query(fixture: ComponentFixture<ListPage>, selector: string) {
  return fixture.nativeElement.querySelector(selector) as HTMLElement | null;
}

describe('ListPage', () => {
  describe('rule L2: the lines never wait for the name', () => {
    it('issues both requests without ordering between them', async () => {
      // Two independent calls. `GET /v1/lists/:id/lines` needs only the list id, while
      // naming the list means paging the zone's lists. Sequencing them would make
      // somebody in an aisle wait for a heading before seeing what to buy.
      const { lines, lists } = await render({ lists: [] });

      expect(lines.loadCount()).toBeGreaterThan(0);
      expect(lists.loadCount()).toBeGreaterThan(0);
    });

    it('renders the lines on a cold arrival, before the name exists', async () => {
      // A cold arrival is a zone whose lists have not arrived yet, which is not the
      // same as a zone whose lists arrived without this one in them. The second is
      // access being withdrawn and is asserted below.
      const { fixture } = await render({ lists: [], listsState: 'idle' });

      expect(query(fixture, 'lib-line-list')).not.toBeNull();
    });

    it('does not call the page gone before it has read the zone’s lists', async () => {
      // The cache is not evidence until this visit refreshed it: absence from a stale
      // cache and absence because access was withdrawn look identical.
      const { fixture } = await render({ lists: [], listsState: 'idle' });

      expect(fixture.nativeElement.textContent).not.toContain('list.gone');
    });

    it('calls the page gone once the lists came back without it', async () => {
      const { fixture } = await render({ lists: [], listsState: 'loaded' });

      expect(fixture.nativeElement.textContent).toContain(
        'list.gone.unshared'
      );
    });

    it('shows the name on the first frame when it was cached', async () => {
      const { fixture } = await render();

      expect(fixture.nativeElement.textContent).toContain('Weekly shop');
    });
  });

  describe('ticking a line off', () => {
    it('sends the status, and moves the row without waiting', async () => {
      const { fixture, lines } = await render({
        lines: [line('ln-1', { status: 'PENDING' })],
      });

      await fixture.componentInstance.toggle('ln-1');

      expect(lines.calls).toContainEqual({
        kind: 'status',
        lineId: 'ln-1',
        status: 'READY',
      });
    });

    it('puts a ready line back on a second tap', async () => {
      const { fixture, lines } = await render({
        lines: [line('ln-1', { status: 'READY' })],
      });

      await fixture.componentInstance.toggle('ln-1');

      expect(lines.calls).toContainEqual({
        kind: 'status',
        lineId: 'ln-1',
        status: 'PENDING',
      });
    });
  });

  describe('rule L3: staff approve their own line as they add it', () => {
    it('follows a staff add with an approval of the id that came back', async () => {
      const { fixture, lines } = await render({ role: 'OWNER' });

      await fixture.componentInstance.add({ content: 'Milk', quantity: 2 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 2 },
        { kind: 'approval', lineId: 'server-id', status: 'APPROVED' },
      ]);
    });

    it('does not approve a plain member’s line', async () => {
      // The rule is aimed at somebody else: it exists so a flatmate or a child can put
      // something on the list and have it confirmed.
      const { fixture, lines } = await render({ role: 'MEMBER' });

      await fixture.componentInstance.add({ content: 'Milk', quantity: 1 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 1 },
      ]);
    });

    it('skips the second call when the line already came back approved', async () => {
      // The backend is adding a zone option that auto approves a staff member's own
      // line. When it lands the response is already APPROVED and this stops happening
      // on its own, with no edit to this page.
      const { fixture, lines } = await render({ role: 'ADMIN' });
      lines.setAddedApproval('APPROVED');

      await fixture.componentInstance.add({ content: 'Milk', quantity: 1 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 1 },
      ]);
    });

    it('says nothing when the add itself fails', async () => {
      const { fixture, lines } = await render({ role: 'OWNER' });
      lines.setWriteOutcome('failed');

      await fixture.componentInstance.add({ content: 'Milk', quantity: 1 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 1 },
      ]);
    });
  });

  describe('rule L4: reorder is a mode', () => {
    it('is off to begin with', async () => {
      const { fixture } = await render();

      expect(fixture.componentInstance.reordering()).toBe(false);
    });

    it('back ends the mode rather than leaving the page', async () => {
      const { fixture, router } = await render();
      fixture.componentInstance.startReorder();

      await fixture.componentInstance.back();

      expect(fixture.componentInstance.reordering()).toBe(false);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('leaves the page once the mode is off', async () => {
      const { fixture, router } = await render();

      await fixture.componentInstance.back();

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}`
      );
    });

    it('sends the whole order when a row is moved by keyboard', async () => {
      const { fixture, lines } = await render({
        lines: [
          line('a', { position: 1 }),
          line('b', { position: 2 }),
          line('c', { position: 3 }),
        ],
      });

      await fixture.componentInstance.act({ action: 'moveDown', lineId: 'a' });

      expect(lines.calls).toContainEqual({
        kind: 'reorder',
        orderedLineIds: ['b', 'a', 'c'],
      });
    });

    it('does not move the first row up, or the last row down', async () => {
      const { fixture, lines } = await render({
        lines: [line('a', { position: 1 }), line('b', { position: 2 })],
      });

      await fixture.componentInstance.act({ action: 'moveUp', lineId: 'a' });
      await fixture.componentInstance.act({ action: 'moveDown', lineId: 'b' });

      expect(lines.calls).toHaveLength(0);
    });
  });

  describe('the read only state (section 3.2)', () => {
    it('draws the composer for a caller not known to be a reader', async () => {
      // Optimistic. There is no `GET /v1/lists/:id/access` and `ListView` carries no
      // role for the caller, so hiding it until a write proved the permission would
      // take the screen away from the people who use it.
      const { fixture } = await render();

      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
    });

    it('takes the composer away once a write is refused, in place', async () => {
      const { fixture, lines } = await render();
      lines.setWriteOutcome('failed');
      lines.setState('loaded', forbidden());

      await fixture.componentInstance.toggle('ln-1');
      fixture.detectChanges();

      expect(query(fixture, 'lib-line-composer')).toBeNull();
      expect(query(fixture, 'lib-list-notice')).not.toBeNull();
    });

    it('shows the reader notice once, on a tap, and not before', async () => {
      const { fixture, lines } = await render();
      expect(query(fixture, 'lib-list-notice')).toBeNull();

      lines.setWriteOutcome('failed');
      lines.setState('loaded', forbidden());
      await fixture.componentInstance.toggle('ln-1');
      fixture.detectChanges();

      expect(query(fixture, 'lib-list-notice')).not.toBeNull();
    });
  });

  describe('what it remembers', () => {
    it('stores the zone and the list, not the list alone', async () => {
      // The list route needs both, and there is no `GET /v1/lists/:id` for an id on its
      // own to be resolved through (rule L1).
      const { storage } = await render();

      expect(storage.get(StorageKeys.lastList)).toBe(`${ZONE_ID}/${LIST_ID}`);
    });
  });

  describe('the sheets', () => {
    it('opens each one as a route relative to this page', async () => {
      const { fixture, router } = await render();

      await fixture.componentInstance.act({ action: 'edit', lineId: 'ln-1' });
      await fixture.componentInstance.act({ action: 'comments', lineId: 'ln-1' });
      await fixture.componentInstance.act({ action: 'delete', lineId: 'ln-1' });
      fixture.componentInstance.openSettings();

      const paths = router.navigate.mock.calls.map((call) => call[0]);
      expect(paths).toEqual([
        ['lines', 'ln-1', 'edit'],
        ['lines', 'ln-1', 'comments'],
        ['lines', 'ln-1', 'confirm', 'delete'],
        ['settings'],
      ]);
    });
  });

  describe('deciding a line', () => {
    it('sends the status rather than a boolean', async () => {
      // `SetApprovalDto` takes `approvalStatus`, so a boolean body is refused by the
      // whitelist before core sees it.
      const { fixture, lines } = await render({ role: 'OWNER' });

      await fixture.componentInstance.act({ action: 'reject', lineId: 'ln-1' });

      expect(lines.calls).toContainEqual({
        kind: 'approval',
        lineId: 'ln-1',
        status: 'REJECTED',
      });
    });

    it('puts a turned down line back with the same call', async () => {
      const { fixture, lines } = await render({ role: 'OWNER' });

      await fixture.componentInstance.act({ action: 'restore', lineId: 'ln-1' });

      expect(lines.calls).toContainEqual({
        kind: 'approval',
        lineId: 'ln-1',
        status: 'APPROVED',
      });
    });
  });

  describe('the empty list', () => {
    it('says so, and offers the composer with focus', async () => {
      const { fixture } = await render({ lines: [] });

      expect(fixture.nativeElement.textContent).toContain('list.empty.title');
      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
    });
  });
});

/** A gateway `forbidden`, which is how a reader is discovered today. */
function forbidden(): unknown {
  // Built through the real class so `listErrorEffect` recognises it, which is the whole
  // mechanism being asserted.
  const { GatewayError } = jest.requireActual<
    typeof import('@portfolio/velista/data-access')
  >('@portfolio/velista/data-access');

  return new GatewayError({
    code: 'forbidden',
    status: 403,
    correlationId: 'ref-1',
  });
}
