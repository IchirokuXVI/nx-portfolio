import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakePresenceStore,
  fakeZoneStore,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakePresenceStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  type FakeLineStore,
  type FakeListStore,
  type FakePresenceOptions,
} from '@portfolio/velista/data-access';
import type {
  Line,
  LineRowVm,
  Membership,
  MyZone,
  ShoppingListSummary,
  ZoneRole,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import { LineList, ListHeader } from '@portfolio/velista/ui';
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

/** One approved membership, which is where a viewer's role comes from. */
function member(userId: string, username: string, role: ZoneRole): Membership {
  return {
    id: `m-${userId}`,
    zoneId: ZONE_ID,
    userId,
    username,
    role,
    status: 'APPROVED',
  };
}

function list(
  overrides: Partial<ShoppingListSummary> = {}
): ShoppingListSummary {
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
  /** Who the server says is here, which the header and the rows draw (plan 0022). */
  readonly presence?: FakePresenceOptions;
  /** User id to the name they go by in this zone, since presence carries ids alone. */
  readonly names?: Readonly<Record<string, string>>;
  /**
   * The zone's memberships, which is where a role comes from.
   *
   * Separate from `names` rather than folded into it, because the two arrive from
   * different requests in production and the header has to read well in the window
   * where a name has resolved and a role has not.
   */
  readonly members?: readonly Membership[];
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ListPage>;
  lines: FakeLineStore;
  lists: FakeListStore;
  realtime: RealtimeMemory;
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
  const realtime = new RealtimeMemory();
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
      provideFakeMemberNames(
        fakeMemberNames(
          { 'user-toni': 'Toni', ...options.names },
          options.members ?? []
        )
      ),
      // Plan 0022: the header's viewers and the editor on a row.
      provideFakePresenceStore(fakePresenceStore(options.presence)),
      provideFakeSessionStore('REGISTERED'),
      { provide: REALTIME_CLIENT, useValue: realtime },
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: route() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines, lists, realtime, storage, router };
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

      expect(fixture.nativeElement.textContent).toContain('list.gone.unshared');
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
      await fixture.componentInstance.act({
        action: 'comments',
        lineId: 'ln-1',
      });
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

      await fixture.componentInstance.act({
        action: 'restore',
        lineId: 'ln-1',
      });

      expect(lines.calls).toContainEqual({
        kind: 'approval',
        lineId: 'ln-1',
        status: 'APPROVED',
      });
    });
  });

  /**
   * Plan 0022, sections 2.1 and 3.4. The first test here is the one that matters: for
   * the whole of `0017` this page took the list room without announcing anybody in it,
   * so the server's viewer set was empty forever and no presence indicator anywhere in
   * the product could ever have something to draw.
   */
  describe('presence', () => {
    it('announces that somebody is looking at the list, and stops on the way out', async () => {
      const { fixture, realtime } = await render();

      expect(realtime.viewedLists.has(LIST_ID)).toBe(true);
      // The intent takes the room with it: the server refuses a presence intent from a
      // socket that is not in `list:{id}`, so the client holds both as one call.
      expect(realtime.rooms).toContain(`list:${LIST_ID}`);

      fixture.destroy();

      expect(realtime.viewedLists.has(LIST_ID)).toBe(false);
      expect(realtime.rooms).not.toContain(`list:${LIST_ID}`);
    });

    it('names the other people shopping it, in the header', async () => {
      const { fixture } = await render({
        presence: { viewers: { [LIST_ID]: ['u2'] } },
        names: { u2: 'Ana' },
      });

      expect(header(fixture).viewers).toEqual([
        { userId: 'u2', name: 'Ana', role: null, since: null },
      ]);
    });

    // The caller is in the server's viewers, because this page now puts them there.
    // A header that told them they were shopping would be wrong about the one thing
    // it says, so the sentence is where the reader is dropped.
    it('leaves the reader out of it, now that the reader is really in there', async () => {
      const { fixture } = await render({
        presence: { viewers: { [LIST_ID]: ['u1', 'u2'] } },
        names: { u1: 'Me', u2: 'Ana' },
      });

      expect(header(fixture).viewers.map((viewer) => viewer.name)).toEqual([
        'Ana',
      ]);
    });

    // The panel the header opens draws a role beside each name, and the only role the
    // client can know for somebody else is their role in the zone: a list role is not
    // broadcast and no endpoint answers it.
    it('carries each viewer role from the zone memberships', async () => {
      const { fixture } = await render({
        presence: { viewers: { [LIST_ID]: ['u2'] } },
        names: { u2: 'Ana' },
        members: [member('u2', 'Ana', 'ADMIN')],
      });

      expect(header(fixture).viewers).toEqual([
        { userId: 'u2', name: 'Ana', role: 'ADMIN', since: null },
      ]);
    });

    // The members request is a second round trip, so there is a real window where a
    // name has resolved and a role has not. Falling back to MEMBER would demote an
    // owner for the length of it; the panel draws no chip instead.
    it('leaves the role null rather than guessing while the members are in flight', async () => {
      const { fixture } = await render({
        presence: { viewers: { [LIST_ID]: ['u2'] } },
        names: { u2: 'Ana' },
        members: [],
      });

      expect(header(fixture).viewers[0]?.role).toBeNull();
    });

    // Nothing on the wire says when somebody opened the list, so the store's own first
    // sighting is the only instant available and it is null until there is one.
    it('carries when the client first saw each viewer', async () => {
      const at = Date.parse('2026-08-28T15:04:00.000Z');
      const { fixture } = await render({
        presence: {
          viewers: { [LIST_ID]: ['u2'] },
          since: { [LIST_ID]: { u2: at } },
        },
        names: { u2: 'Ana' },
      });

      expect(header(fixture).viewers[0]?.since).toEqual(new Date(at));
    });

    it('says nothing rather than showing an id it could not resolve', async () => {
      const { fixture } = await render({
        presence: { viewers: { [LIST_ID]: ['u2'] } },
        names: {},
      });

      expect(header(fixture).viewers).toEqual([]);
    });

    it('names whoever is editing a line, on that line', async () => {
      const { fixture } = await render({
        lines: [line('ln-1'), line('ln-2', { position: 2 })],
        presence: { editors: { [LIST_ID]: { u2: 'ln-1' } } },
        names: { u2: 'Ana' },
      });

      expect(rows(fixture).map((row) => row.editor)).toEqual(['Ana', null]);
    });

    // Editing is announced by the sheet, so the caller's own intent comes back to
    // them through the store. Telling somebody that they are editing a line is the
    // same mistake as telling them they are shopping the list.
    it('does not name the reader as the editor of their own line', async () => {
      const { fixture } = await render({
        presence: { editors: { [LIST_ID]: { u1: 'ln-1' } } },
        names: { u1: 'Me' },
      });

      expect(rows(fixture)[0]?.editor).toBeNull();
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

/** The header the page handed down, which is where its presence joins are observable. */
function header(fixture: ComponentFixture<ListPage>) {
  return fixture.debugElement
    .query(By.directive(ListHeader))
    .componentInstance.header();
}

/** The rows the page handed down, in the order it put them in. */
function rows(fixture: ComponentFixture<ListPage>) {
  return fixture.debugElement
    .query(By.directive(LineList))
    .componentInstance.lines() as readonly LineRowVm[];
}

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
