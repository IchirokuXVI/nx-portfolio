import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ASSISTANT_SERVICE,
  AssistantMemory,
  CATALOG_SERVICE,
  CatalogMemory,
  DUE_LINE_SERVICE,
  DueLineStore,
  fakeItemNames,
  fakeLineStore,
  fakeListStore,
  fakeMemberNames,
  fakePresenceStore,
  fakeShoppingProfileStore,
  fakeZoneStore,
  GatewayError,
  ListViewStore,
  provideFakeItemNames,
  provideFakeLineStore,
  provideFakeListStore,
  provideFakeMemberNames,
  provideFakePresenceStore,
  provideFakeSessionStore,
  provideFakeShoppingProfileStore,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  TRIP_SERVICE,
  TripStore,
  type AssistantServiceI,
  type DueLineServiceI,
  type FakeItemNames,
  type FakeLineStore,
  type FakeListStore,
  type FakePresenceOptions,
  type FakeShoppingProfileStore,
  type TripServiceI,
} from '@portfolio/velista/data-access';
import type {
  CatalogItem,
  CatalogSuggestion,
  DueLine,
  Line,
  LineRowVm,
  ListPermission,
  Membership,
  MyZone,
  ShoppingListSummary,
  Trip,
  TripPage,
  TripRow,
  ZoneRole,
} from '@portfolio/velista/models';
import {
  NavChrome,
  NOTIFICATION_TONE,
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
import {
  DueLineRow,
  LineComposer,
  LineList,
  ListHeader,
  ListTools,
  ToBuyHeading,
  TripGroup,
} from '@portfolio/velista/ui';
import { BehaviorSubject, of } from 'rxjs';
import { ListPage } from './list-page';

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
/** `provideFakeSessionStore` answers as this user, so the caller is the list's creator. */
const ME = 'user-1';

/** The permission sets plan 0030 section 4 tabulates, named as the plan names them. */
const READ_ONLY: readonly ListPermission[] = ['READ'];
const WRITER: readonly ListPermission[] = ['READ', 'WRITE'];
const DECIDER: readonly ListPermission[] = ['READ', 'DECIDE'];
const ADMIN: readonly ListPermission[] = ['READ', 'WRITE', 'DECIDE', 'MANAGE'];

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
    autoApproveLines: false,
    lineCount: 12,
    wantedCount: 7,
    // Everything, so a spec that is not about permissions reads as it did before plan
    // 0030. One that is says so by passing `permissions`.
    myPermissions: ADMIN,
    ...overrides,
  };
}

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    listId: LIST_ID,
    content: 'Sourdough loaf',
    quantity: 1,
    itemIds: [],
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
  /**
   * What the server says this caller may do on the list (plan 0030, section 3).
   *
   * It replaces `role` as the input every permission question on this page turns on.
   * `role` survives for the one thing it is still about, which is the group, and no
   * longer decides anything here: group staff arrive holding all four.
   */
  readonly permissions?: readonly ListPermission[];
  readonly autoApproveLines?: boolean;
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
  /** `?line=`, which a link in an assistant reply carries (plan 0032, section 8). */
  readonly line?: string;
  /** The products the catalog can name, for the category view (velista `0082`). */
  readonly items?: readonly CatalogItem[];
  /** The first page of trips, or a failure (velista `0088`). None by default. */
  readonly trips?: TripPage | 'fail';
  /** Each trip's rows, by trip id. */
  readonly tripRows?: Readonly<Record<string, readonly TripRow[]>>;
  /** What the list suggests, or a failure (velista `0089`). Nothing by default. */
  readonly due?: readonly DueLine[] | 'fail';
  /** `?search=1`, the open search (velista `0109`). */
  readonly search?: boolean;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ListPage>;
  lines: FakeLineStore;
  lists: FakeListStore;
  realtime: RealtimeMemory;
  storage: Map<string, string>;
  router: {
    navigate: jest.Mock;
    navigateByUrl: jest.Mock;
    createUrlTree: jest.Mock;
    serializeUrl: jest.Mock;
  };
  /** The route the page was given, whose query a spec can move as the router would. */
  activatedRoute: ReturnType<typeof route>;
  tone: { play: jest.Mock };
  chrome: { setComposing: jest.Mock };
  profiles: FakeShoppingProfileStore;
  itemNames: FakeItemNames;
  view: ListViewStore;
  trips: TripStore;
  tripCalls: { heads: number; rows: string[] };
  dueCalls: { reads: number };
}> {
  TestBed.resetTestingModule();

  const tone = { play: jest.fn() };

  const zones = fakeZoneStore({ zones: [zone(options.role ?? 'MEMBER')] });
  const lists = fakeListStore({
    lists: options.lists ?? [
      list({
        myPermissions: options.permissions ?? ADMIN,
        autoApproveLines: options.autoApproveLines ?? false,
      }),
    ],
    state: options.listsState ?? 'loaded',
  });
  const lines = fakeLineStore({
    lines: options.lines ?? [line('ln-1')],
    state: options.linesState ?? 'loaded',
    complete: options.complete ?? true,
  });
  const realtime = new RealtimeMemory();
  const itemNames = fakeItemNames({ items: options.items ?? [] });
  const profiles = fakeShoppingProfileStore();
  const storage = options.storage ?? new Map<string, string>();
  const tripCalls = { heads: 0, rows: [] as string[] };
  const tripService: TripServiceI = {
    listTrips: async () => {
      tripCalls.heads += 1;
      if (options.trips === 'fail') {
        throw new Error('offline');
      }
      return options.trips ?? { live: [], items: [], nextCursor: null };
    },
    listTripRows: async (_listId, _kind, tripId) => {
      tripCalls.rows.push(tripId);
      return { items: options.tripRows?.[tripId] ?? [], nextCursor: null };
    },
  };
  const dueCalls = { reads: 0 };
  const dueService: DueLineServiceI = {
    listDueLines: async () => {
      dueCalls.reads += 1;
      if (options.due === 'fail') {
        throw new Error('offline');
      }
      return options.due ?? [];
    },
  };
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
    // What `ListSearchNavigation.close` builds its fallback with (velista `0109`).
    // The URL itself is `list-search.spec.ts`'s subject, against a real router.
    createUrlTree: jest.fn((commands: unknown, extras: unknown) => ({
      commands,
      extras,
    })),
    serializeUrl: jest.fn(() => '/velista/en/zones/z/lists/l'),
  };
  const activatedRoute = route(
    options.line,
    options.search === true ? { search: '1' } : {}
  );
  // The bottom bar's owner, as a double (velista `0117`): the router here is a
  // fake with no state to read, and what matters is what the page tells it.
  const chrome = { setComposing: jest.fn() };

  await TestBed.configureTestingModule({
    imports: [ListPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(storage),
      provideFakeZoneStore(zones),
      provideFakeListStore(lists),
      provideFakeLineStore(lines),
      // What the route provides beside the page (velista `0082`), real, over the
      // fakes above, so a spec asserts what the page draws of a real view.
      ListViewStore,
      // Beside it on the route (velista `0088`), real, over a service the spec answers.
      TripStore,
      { provide: TRIP_SERVICE, useValue: tripService },
      // The page provides `DueLineStore` itself (velista `0089`); the service is the
      // app's, answered here by the spec.
      { provide: DUE_LINE_SERVICE, useValue: dueService },
      provideFakeItemNames(itemNames),
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
      { provide: NavChrome, useValue: chrome },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      { provide: ActivatedRoute, useValue: activatedRoute },
      // The composer's microphone posts through this (plan 0038). Every test in
      // this file is about the typed path, so it is the in-memory service rather
      // than a stub: a real implementation that never gets called is cheaper to
      // keep true than a hand written one that drifts.
      { provide: ASSISTANT_SERVICE, useClass: AssistantMemory },
      // The composer's suggestions (plan 0043, section 6). In memory rather than a
      // stub for the reason the assistant above it is: every spec here is about the
      // typed path, and a real implementation nobody calls is cheaper to keep honest
      // than a mock that has to be re-taught what a suggestion looks like.
      { provide: CATALOG_SERVICE, useClass: CatalogMemory },
      // The scope those suggestions are narrowed to (plan 0047, section 3): the
      // composer passes the active profile's id, so the store has to be here even
      // for the specs that never open the dropdown.
      provideFakeShoppingProfileStore(profiles),
      // The blip that says a recording left the device. A fake, so a spec can ask
      // whether it was played without a browser and without making a noise.
      { provide: NOTIFICATION_TONE, useValue: tone },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ListPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return {
    fixture,
    lines,
    lists,
    realtime,
    storage,
    router,
    activatedRoute,
    tone,
    chrome,
    profiles,
    itemNames,
    view: TestBed.inject(ListViewStore),
    trips: TestBed.inject(TripStore),
    tripCalls,
    dueCalls,
  };
}

/**
 * The shape `route-params.ts` reads: real `paramMap` and `queryParamMap` observables
 * plus a snapshot of each.
 *
 * The query half arrived with plan 0032: a chat reply links to a line as `?line=`,
 * because none of this page's three line sheets simply shows a line and all three do
 * something to one.
 */
function route(line?: string, extra: Record<string, string> = {}) {
  const map = convertToParamMap({ zoneId: ZONE_ID, listId: LIST_ID });
  const queryOf = (params: Record<string, string>) =>
    convertToParamMap(line === undefined ? params : { line, ...params });
  const queryParamMap = new BehaviorSubject(queryOf(extra));
  const snapshot = {
    paramMap: map,
    queryParamMap: queryParamMap.value,
    parent: null,
  };

  return {
    paramMap: of(map),
    queryParamMap,
    snapshot,
    parent: null,
    /**
     * The URL's query changing under the page, as a navigation or the phone's back
     * button changes it (velista `0109`). `?line=` is kept, as the router keeps it.
     */
    setQuery(params: Record<string, string>): void {
      snapshot.queryParamMap = queryOf(params);
      queryParamMap.next(snapshot.queryParamMap);
    },
  };
}

function query(fixture: ComponentFixture<ListPage>, selector: string) {
  return fixture.nativeElement.querySelector(selector) as HTMLElement | null;
}

describe('ListPage', () => {
  /**
   * Plan 0038 section 5 shipped this strip's markup with no stylesheet and no way to
   * tell its two kinds of message apart, so a failure and a confirmation drew as the
   * same run of unstyled text floating above a pinned composer.
   *
   * jsdom has no layout, so the sharing of one surface is asserted as the structure
   * that produces it: the strip and the composer are in the same pinned container.
   */
  describe('the voice strip shares the composer container', () => {
    it('puts the strip and the field in one dock', async () => {
      const { fixture } = await render();
      fixture.componentInstance.onRecordingFailed();
      fixture.detectChanges();

      const dock = query(fixture, '.composer-dock');
      const strip = query(fixture, '.voice-strip');

      expect(dock).not.toBeNull();
      expect(strip).not.toBeNull();
      expect(dock?.contains(strip)).toBe(true);
      expect(dock?.querySelector('lib-line-composer')).not.toBeNull();
      // On top of the field, which is what "above the composer" means in markup.
      const composer = dock?.querySelector('lib-line-composer') as Node;
      const relation = strip?.compareDocumentPosition(composer) ?? 0;

      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    });

    it('colours a failure, so it is not read as a confirmation', async () => {
      const { fixture } = await render();
      fixture.componentInstance.onRecordingFailed();
      fixture.detectChanges();

      expect(fixture.componentInstance.voiceStrip()?.failed).toBe(true);
      expect(query(fixture, '.voice-strip')?.classList).toContain('failed');
    });

    it('plays a sound the moment a recording leaves the device', async () => {
      // The eyes are the sense that is busy: somebody holding a fridge door open is
      // looking into it, and the microphone no longer closes to mark the moment.
      const { fixture, tone } = await render();

      expect(tone.play).not.toHaveBeenCalled();

      await fixture.componentInstance.addAloud({
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationSeconds: 3,
      });

      expect(tone.play).toHaveBeenCalledTimes(1);
    });

    it('says why the assistant could not answer, rather than only that it did not', async () => {
      // A cluster with no model provider answers 501 for ever. The strip used to say
      // "That did not send", which describes a network and not a deployment.
      const { fixture } = await render();
      jest
        .spyOn(TestBed.inject(ASSISTANT_SERVICE), 'askAboutList')
        .mockRejectedValue(
          new GatewayError({
            code: 'not_configured',
            status: 501,
            correlationId: 'cid-1',
          })
        );

      await fixture.componentInstance.addAloud({
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationSeconds: 3,
      });

      expect(fixture.componentInstance.voiceStrip()).toMatchObject({
        messageKey: 'list.add.voiceUnavailable',
        failed: true,
      });
    });

    it('does not claim nothing was added when it cannot know', async () => {
      // The duplicate. A proxy gives up on a turn that is still running, the assistant
      // finishes and writes the lines seconds later, and somebody who was told nothing
      // happened says it again.
      const { fixture } = await render();
      jest
        .spyOn(TestBed.inject(ASSISTANT_SERVICE), 'askAboutList')
        .mockRejectedValue(
          new GatewayError({
            code: 'internal',
            status: 504,
            correlationId: 'cid-1',
          })
        );

      await fixture.componentInstance.addAloud({
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationSeconds: 3,
      });

      expect(fixture.componentInstance.voiceStrip()).toMatchObject({
        messageKey: 'list.add.voiceUnsure',
        failed: true,
      });
    });

    it('leaves a confirmation quiet', async () => {
      // The other half of the same rule: a confirmation that shouts is one people
      // learn to dismiss unread.
      const { fixture } = await render();
      fixture.componentInstance.voiceStrip.set({
        heard: 'add olives',
        reply: 'Added olives.',
        messageKey: null,
        failed: false,
      });
      fixture.detectChanges();

      expect(query(fixture, '.voice-strip')?.classList).not.toContain('failed');
    });
  });

  /**
   * Velista `0079`, sections 5 and 7: a recording takes seconds to work out, and the
   * screen says so and holds the composer for all of them.
   */
  describe('while the assistant works out a recording', () => {
    type Reply = Awaited<ReturnType<AssistantServiceI['askAboutList']>>;

    const RECORDING = {
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      durationSeconds: 3,
    };

    /** Hold the assistant's answer until the test hands it over. */
    function holdTheAnswer(): (reply: Reply) => void {
      let answer: (reply: Reply) => void = () => undefined;
      jest
        .spyOn(TestBed.inject(ASSISTANT_SERVICE), 'askAboutList')
        .mockReturnValue(
          new Promise<Reply>((resolve) => {
            answer = resolve;
          })
        );
      return (reply) => answer(reply);
    }

    const HEARD = { heard: 'add olives', text: 'Added olives.' } as Reply;

    it('says it is working until the reply lands, then shows the reply', async () => {
      const { fixture } = await render();
      const answer = holdTheAnswer();

      const sent = fixture.componentInstance.addAloud(RECORDING);
      fixture.detectChanges();

      expect(fixture.componentInstance.voiceStrip()).toMatchObject({
        messageKey: 'list.add.working',
        failed: false,
        working: true,
      });
      const working = query(fixture, '.voice-strip .voice-working');
      expect(working?.textContent).toContain('list.add.working');
      expect(working?.querySelector('lib-spinner-icon')).not.toBeNull();
      // Inside the strip's own polite region, so the reply replacing it is announced.
      expect(query(fixture, '.voice-strip')?.getAttribute('aria-live')).toBe(
        'polite'
      );

      answer(HEARD);
      await sent;
      fixture.detectChanges();

      expect(query(fixture, '.voice-working')).toBeNull();
      expect(query(fixture, '.voice-reply')?.textContent).toContain(
        'Added olives.'
      );
    });

    it('stays busy when a typed add lands while a recording is still out', async () => {
      const { fixture } = await render();
      const page = fixture.componentInstance;
      const answer = holdTheAnswer();

      const spoken = page.addAloud(RECORDING);
      await page.add({ content: 'Olives', quantity: 1 });
      fixture.detectChanges();

      expect(page.composerBusy()).toBe(true);
      expect(
        fixture.debugElement
          .query(By.directive(LineComposer))
          .componentInstance.busy()
      ).toBe(true);

      answer(HEARD);
      await spoken;

      expect(page.composerBusy()).toBe(false);
    });
  });

  describe('rule L2: the lines never wait for the name', () => {
    it('issues both requests without ordering between them', async () => {
      // Two independent calls. `GET /v1/lists/:id/lines` needs only the list id, while
      // naming the list means paging the zone's lists. Sequencing them would make
      // somebody in an aisle wait for a heading before seeing what to buy.
      const { lines, lists } = await render({ lists: [] });

      expect(lines.loadCount()).toBeGreaterThan(0);
      // Either kind of read: this page loads a cold zone and refreshes a warm one, and
      // which one it chose is not what this test is about.
      expect(lists.readCount()).toBeGreaterThan(0);
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

  /**
   * The reel's write, which replaced ticking off (velista plan 0043, section 4.1).
   *
   * What is asserted is the **delta**, because that is what the page is responsible
   * for passing on: the reel has already snapped, already waited out its idle beat and
   * already collapsed however many drags happened inside it into one number. A page
   * that sent two increments where the gesture produced one settled adjustment is a
   * defect a recorded end state would hide.
   */
  describe('moving a quantity', () => {
    it('sends the delta it was handed, once', async () => {
      const { fixture, lines } = await render({
        lines: [line('ln-1', { quantity: 2 })],
      });

      await fixture.componentInstance.changeQuantity({
        lineId: 'ln-1',
        delta: 3,
      });

      expect(lines.calls).toContainEqual({
        kind: 'quantity',
        lineId: 'ln-1',
        delta: 3,
      });
    });

    it('sends a negative delta the same way', async () => {
      const { fixture, lines } = await render({
        lines: [line('ln-1', { quantity: 4 })],
      });

      await fixture.componentInstance.changeQuantity({
        lineId: 'ln-1',
        delta: -4,
      });

      expect(lines.calls).toContainEqual({
        kind: 'quantity',
        lineId: 'ln-1',
        delta: -4,
      });
    });

    it('announces the settled result once, rather than per step', async () => {
      // Section 7. The drag is a pointer gesture, so nothing else says out loud that
      // the number moved; what must not happen is a run of announcements as it moves.
      const { fixture } = await render({
        lines: [line('ln-1', { quantity: 2 })],
      });

      await fixture.componentInstance.changeQuantity({
        lineId: 'ln-1',
        delta: 3,
      });

      expect(fixture.componentInstance.announcement()).toContain(
        'list.line.quantityChanged'
      );
    });

    it('opens the line rather than repeating a write that failed', async () => {
      // The failed write was a delta this page no longer holds, and re-sending a
      // guessed one would move the number by an amount nobody asked for a second time.
      const { fixture, router } = await render();

      fixture.componentInstance.retry('ln-1');

      // The sheet, relative to the list page, exactly as every other sheet is opened.
      expect(router.navigate).toHaveBeenCalledWith(
        ['sheet', 'lines', 'ln-1', 'detail'],
        expect.anything()
      );
    });
  });

  // Plan 0030, section 5, and acceptance item 7. Rule L3 became the server's: a line is
  // created APPROVED when its author holds DECIDE (backend plan 0037, section 2), so the
  // work here is subtraction, and what is left to assert is that nothing follows the add.
  describe('adding a line', () => {
    it('adds, and never approves afterwards, for somebody who decides', async () => {
      const { fixture, lines } = await render({ permissions: ADMIN });

      await fixture.componentInstance.add({ content: 'Milk', quantity: 2 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 2 },
      ]);
    });

    it('does not approve a writer’s line either', async () => {
      const { fixture, lines } = await render({ permissions: WRITER });

      await fixture.componentInstance.add({ content: 'Milk', quantity: 1 });

      expect(lines.calls).toEqual([
        { kind: 'add', content: 'Milk', quantity: 1 },
      ]);
    });

    it('never approves anything on any frame, whatever came back', async () => {
      // The defect this removes is one frame wide: a row that arrived PENDING grew two
      // decision buttons and lost them again. There is no client-side approve left to
      // fire, whatever the response says.
      const { fixture, lines } = await render({ permissions: ADMIN });
      lines.setAddedApproval('PENDING');

      await fixture.componentInstance.add({ content: 'Milk', quantity: 1 });

      expect(lines.calls.some((call) => call.kind === 'approval')).toBe(false);
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

      // Replacing rather than pushing, because nothing of ours is behind this page in
      // the spec's history and the walk to the group stands in for it. See
      // `page-navigation.spec.ts`, where a push put the list back one press away.
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        `/velista/en/zones/${ZONE_ID}`,
        { replaceUrl: true }
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

  /**
   * Plan 0030, section 3.2, and acceptance items 1, 2 and 5.
   *
   * Every one of these is drawn on arrival now, from `myPermissions`, rather than after
   * a control has failed. The old versions of the first three each began by refusing a
   * write, which was the only way the client could learn anything.
   */
  describe('what the page draws, from certainty', () => {
    it('draws the composer for a writer', async () => {
      const { fixture } = await render({ permissions: WRITER });

      expect(query(fixture, 'lib-line-composer')).not.toBeNull();
    });

    it('draws no composer for a read-only caller, and says why on arrival', async () => {
      const { fixture } = await render({ permissions: READ_ONLY });

      expect(query(fixture, 'lib-line-composer')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain(
        'list.readOnly.banner'
      );
    });

    it('gives a read-only caller a row that opens and a number that does not move', async () => {
      const { fixture } = await render({ permissions: READ_ONLY });

      expect(rows(fixture)[0]).toMatchObject({
        // The tap opens the detail sheet, and knowing is not a permission (section
        // 5.1). It followed `DECIDE` while the tap was the tick.
        interactive: true,
        adjustable: false,
        decidable: false,
      });
      // Everything on the list is still there to be read, which is the whole of READ.
      expect(fixture.nativeElement.textContent).toContain('Sourdough loaf');
    });

    it('draws no composer for somebody who only decides', async () => {
      const { fixture } = await render({ permissions: DECIDER });

      expect(query(fixture, 'lib-line-composer')).toBeNull();
    });

    it('tells a writer who does the buying, rather than looking broken', async () => {
      // A screen that takes a new line and then ignores a drag on it needs a sentence
      // naming whose job that is, and it is not an apology (section 7).
      const { fixture } = await render({ permissions: WRITER });

      expect(fixture.nativeElement.textContent).toContain(
        'list.buying.notMine'
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'list.readOnly.banner'
      );
    });

    it('says neither thing to somebody who can do both', async () => {
      const { fixture } = await render({ permissions: ADMIN });

      expect(query(fixture, 'lib-list-notice')).toBeNull();
    });

    it('gives a list admin the settings sheet, and a writer none', async () => {
      // Acceptance item 5, and its mirror. The overflow that opens the sheet is drawn
      // from `canManage` alone.
      const admin = await render({ permissions: ADMIN });
      expect(
        admin.fixture.debugElement
          .query(By.directive(ListHeader))
          .componentInstance.hasMenu()
      ).toBe(true);

      const writer = await render({ permissions: WRITER });
      expect(
        writer.fixture.debugElement
          .query(By.directive(ListHeader))
          .componentInstance.hasMenu()
      ).toBe(false);
    });

    it('does not move a quantity for somebody who may not decide', async () => {
      // The reel is read only for them, and the guard behind it is silent belt on
      // braces: the sentence explaining it is already on screen.
      const { fixture, lines } = await render({ permissions: WRITER });

      await fixture.componentInstance.changeQuantity({
        lineId: 'ln-1',
        delta: 1,
      });

      expect(lines.calls).toHaveLength(0);
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

      fixture.componentInstance.openLine('ln-1');
      fixture.componentInstance.openSettings();

      const paths = router.navigate.mock.calls.map((call) => call[0]);
      // Every one under the `sheet` marker, which `_openSheet` adds so the callers
      // cannot each be the one that forgets it. Edit, comments and delete are not
      // here: they open from the detail sheet since velista plan 0083.
      expect(paths).toEqual([
        ['sheet', 'lines', 'ln-1', 'detail'],
        ['sheet', 'settings'],
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

  describe('a line a chat reply linked to (plan 0032, section 8)', () => {
    it('scrolls the row into view and marks it', async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      const { fixture } = await render({
        line: 'ln-2',
        lines: [line('ln-1'), line('ln-2')],
      });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.markedLine()).toBe('ln-2');
      expect(query(fixture, '.line.marked')?.getAttribute('data-line-id')).toBe(
        'ln-2'
      );
    });

    it('opens no sheet, which is the whole reason it is a query parameter', async () => {
      // All three of this page's line sheets **do** something to a line. A link in a
      // chat message that opened an edit form would have changed what the app is doing
      // because somebody wanted to look at something.
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      const { fixture, router } = await render({
        line: 'ln-1',
        lines: [line('ln-1')],
      });

      expect(router.navigate).not.toHaveBeenCalled();
      expect(query(fixture, 'router-outlet')).not.toBeNull();
    });

    it('ignores an id that names no row it can see, and renders normally', async () => {
      // Deleted, or on a list this caller no longer sees: both look the same from
      // here, and a stale link should be inert rather than an error.
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      const { fixture } = await render({
        line: 'ln-not-here',
        lines: [line('ln-1')],
      });

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(fixture.componentInstance.markedLine()).toBeNull();
      expect(query(fixture, '.line.marked')).toBeNull();
      // The page is otherwise exactly the page.
      expect(rows(fixture)).toHaveLength(1);
    });

    it('marks nothing at all on an ordinary arrival', async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      const { fixture } = await render({ lines: [line('ln-1')] });

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(fixture.componentInstance.markedLine()).toBeNull();
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

/**
 * Velista `0082`: the zone list can be searched, put in A to Z order, and narrowed to
 * one category at a time.
 */
describe('ListPage: searching and viewing one category', () => {
  function product(id: string, category: CatalogItem['category']): CatalogItem {
    return {
      id,
      name: { es: id, en: id },
      brand: null,
      size: null,
      unit: 'UNIT',
      productGroupId: null,
      category,
      offer: null,
    };
  }

  const ITEMS = [product('milk', 'DAIRY'), product('carrot', 'PRODUCE')];

  const LINES = [
    line('ln-milk', { content: 'Leche', position: 1, itemIds: ['milk'] }),
    line('ln-carrot', {
      content: 'Zanahorias',
      position: 2,
      itemIds: ['carrot'],
    }),
    line('ln-bags', { content: 'Bolsas', position: 3 }),
  ];

  function tools(fixture: ComponentFixture<ListPage>) {
    const found = fixture.debugElement.query(By.directive(ListTools));
    return found === null ? null : (found.componentInstance as ListTools);
  }

  function toBuyHeading(fixture: ComponentFixture<ListPage>) {
    return fixture.debugElement.query(By.directive(ToBuyHeading))
      .componentInstance as ToBuyHeading;
  }

  it('draws the tools row above the lines, with no chip row, and not in reorder mode', async () => {
    const { fixture } = await render({ lines: LINES, items: ITEMS });

    expect(tools(fixture)).not.toBeNull();
    expect(query(fixture, 'lib-chip-row')).toBeNull();

    fixture.componentInstance.startReorder();
    fixture.detectChanges();

    expect(tools(fixture)).toBeNull();
  });

  it('asks for the products of the loaded lines, and for new ones as lines arrive', async () => {
    const { fixture, lines, itemNames } = await render({
      lines: LINES,
      items: ITEMS,
    });

    expect(itemNames.asked.flat()).toEqual(
      expect.arrayContaining(['milk', 'carrot'])
    );

    // A line arriving, which is the same signal a socket event writes.
    await lines.addLine(LIST_ID, 'Pan', 1, ME, {}, ['bread']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(itemNames.asked[itemNames.asked.length - 1]).toContain('bread');
  });

  it('counts A to Z and a picked category on the filter badge', async () => {
    const { fixture, view } = await render({ lines: LINES, items: ITEMS });

    view.setOrder('alpha');
    fixture.detectChanges();
    expect(tools(fixture)?.activeCount()).toBe(1);

    view.setView('category');
    fixture.detectChanges();
    expect(tools(fixture)?.activeCount()).toBe(1);

    view.pickCategory('DAIRY');
    fixture.detectChanges();
    expect(tools(fixture)?.activeCount()).toBe(2);
  });

  it('draws only the picked category, under an h2 naming it', async () => {
    const { fixture, view } = await render({ lines: LINES, items: ITEMS });

    view.pickCategory('PRODUCE');
    fixture.detectChanges();

    expect(rows(fixture).map((row) => row.id)).toEqual(['ln-carrot']);
    const heading = query(fixture, 'h2.category-heading');
    expect(heading?.textContent?.trim()).toBe('basket.category.PRODUCE');
  });

  it('puts a line with no products under No category', async () => {
    const { fixture, view } = await render({ lines: LINES, items: ITEMS });

    view.pickCategory('NONE');
    fixture.detectChanges();

    expect(rows(fixture).map((row) => row.id)).toEqual(['ln-bags']);
    expect(query(fixture, 'h2.category-heading')?.textContent?.trim()).toBe(
      'list.view.noCategory'
    );
  });

  /**
   * Velista `0117`: the composer's field is the list's only search. Typing draws the
   * lines that match, then from the third character the catalog, in place of the
   * list, and the phone's back button empties the field through the entry the first
   * character pushed (rule F2).
   */
  describe('one field finds and adds (velista 0117)', () => {
    function field(fixture: ComponentFixture<ListPage>): HTMLInputElement {
      return query(
        fixture,
        'lib-line-composer input.field'
      ) as HTMLInputElement;
    }

    function typeInto(fixture: ComponentFixture<ListPage>, text: string): void {
      const input = field(fixture);
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('sets the store’s query and pushes search=1 on the first keystroke', async () => {
      const { fixture, router, activatedRoute, view } = await render({
        lines: LINES,
        items: ITEMS,
      });

      typeInto(fixture, 'l');

      expect(view.query()).toBe('l');
      expect(router.navigate).toHaveBeenCalledWith([], {
        relativeTo: activatedRoute,
        queryParams: { search: '1' },
        queryParamsHandling: 'merge',
      });
      // A push: nothing asked the router to replace the entry.
      expect(router.navigate.mock.calls[0][1]).not.toHaveProperty('replaceUrl');

      typeInto(fixture, 'le');
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });

    it('draws the lines and no catalog for two characters, and both from three, lines first', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });

      typeInto(fixture, 'le');

      expect(query(fixture, '.results-heading')?.textContent).toContain(
        'list.add.resultsOnList'
      );
      expect(rows(fixture).map((row) => row.id)).toEqual(['ln-milk']);
      expect(query(fixture, '.catalog')).toBeNull();

      typeInto(fixture, 'lec');

      const results = query(fixture, '.results') as HTMLElement;
      const headings = [...results.querySelectorAll('.results-heading')].map(
        (one) => one.textContent?.trim() ?? ''
      );
      expect(headings[0]).toContain('list.add.resultsOnList');
      expect(headings[1]).toBe('list.add.resultsCatalog');
      expect(query(fixture, '.catalog lib-suggestion-list')).not.toBeNull();
    });

    it('says so when nothing on the list matches', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });

      typeInto(fixture, 'zz');

      expect(query(fixture, '.results-heading')?.textContent?.trim()).toBe(
        'list.add.resultsNone'
      );
      expect(query(fixture, '.results lib-line-list')).toBeNull();
    });

    it('hides the tools row while the results show, and draws it again after', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });

      typeInto(fixture, 'le');
      expect(query(fixture, 'lib-list-tools')).toBeNull();

      typeInto(fixture, '');
      expect(query(fixture, 'lib-list-tools')).not.toBeNull();
    });

    it('draws no search of its own in the tools row', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });

      expect(tools(fixture)).not.toBeNull();
      expect(
        query(fixture, 'lib-list-tools [aria-label="basket.search.open"]')
      ).toBeNull();
    });

    it('empties the field and shows the list when back takes search=1 off', async () => {
      const { fixture, view, activatedRoute } = await render({
        lines: LINES,
        items: ITEMS,
      });
      typeInto(fixture, 'leche');
      // The push lands.
      activatedRoute.setQuery({ search: '1' });
      fixture.detectChanges();
      await fixture.whenStable();

      // The phone's back button: a popstate onto the entry without the parameter.
      activatedRoute.setQuery({});
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(field(fixture).value).toBe('');
      expect(view.query()).toBe('');
      expect(query(fixture, '.results')).toBeNull();
      expect(rows(fixture)).toHaveLength(LINES.length);
    });

    it('takes search=1 off through PageNavigation.back when the field is emptied', async () => {
      const { fixture, router, activatedRoute } = await render({
        lines: LINES,
        items: ITEMS,
      });
      typeInto(fixture, 'le');
      activatedRoute.setQuery({ search: '1' });
      fixture.detectChanges();
      await fixture.whenStable();

      typeInto(fixture, '');
      await fixture.whenStable();

      expect(router.createUrlTree).toHaveBeenCalledWith(
        ['.'],
        expect.objectContaining({
          queryParams: { search: null },
          queryParamsHandling: 'merge',
        })
      );
      // Nothing of this app is behind a spec's first entry, so the fallback
      // replaces, and never leaves the app.
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/velista/en/zones/z/lists/l',
        { replaceUrl: true }
      );
    });

    it('empties the field on Escape, which takes the entry off the same way', async () => {
      const { fixture, router, activatedRoute } = await render({
        lines: LINES,
        items: ITEMS,
      });
      typeInto(fixture, 'le');
      activatedRoute.setQuery({ search: '1' });
      fixture.detectChanges();
      await fixture.whenStable();

      field(fixture).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape' })
      );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(field(fixture).value).toBe('');
      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/velista/en/zones/z/lists/l',
        { replaceUrl: true }
      );
    });

    it('replaces search=1 away on a cold load with an empty field', async () => {
      const { router } = await render({
        lines: LINES,
        items: ITEMS,
        search: true,
      });

      expect(router.navigateByUrl).toHaveBeenCalledWith(
        '/velista/en/zones/z/lists/l',
        { replaceUrl: true }
      );
    });

    it('gives the bar’s room to the page while the field has focus or holds words', async () => {
      const { fixture, chrome } = await render({ lines: LINES, items: ITEMS });
      const last = () => chrome.setComposing.mock.calls.at(-1)?.[0];

      field(fixture).dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(last()).toBe(true);

      typeInto(fixture, 'le');
      field(fixture).dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      await fixture.whenStable();
      // Still true: the field holds words.
      expect(last()).toBe(true);

      typeInto(fixture, '');
      await fixture.whenStable();
      expect(last()).toBe(false);
    });

    it('clears the field, drops the results and keeps focus after an add', async () => {
      const { fixture, lines } = await render({ lines: LINES, items: ITEMS });
      field(fixture).focus();
      typeInto(fixture, 'Pan');

      (
        query(fixture, 'lib-line-composer form.composer') as HTMLFormElement
      ).dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(lines.linesIn(LIST_ID).map((one) => one.content)).toContain('Pan');
      expect(field(fixture).value).toBe('');
      expect(document.activeElement).toBe(field(fixture));
      expect(query(fixture, '.results')).toBeNull();
    });

    it('keeps the keyboard up: a press in the results does not take focus', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });
      typeInto(fixture, 'le');
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      query(fixture, '.results lib-line-list')?.dispatchEvent(press);

      expect(press.defaultPrevented).toBe(true);
    });

    it('makes the field a search box that controls the results', async () => {
      const { fixture } = await render({ lines: LINES, items: ITEMS });

      expect(field(fixture).getAttribute('role')).toBe('searchbox');
      expect(field(fixture).getAttribute('aria-controls')).toBe('list-results');
      typeInto(fixture, 'le');
      expect(query(fixture, '#list-results')).not.toBeNull();
    });

    it('keeps search=1 on the filter sheet, so closing it comes back to the words', async () => {
      const { fixture, router, activatedRoute } = await render({
        lines: LINES,
        items: ITEMS,
        search: true,
      });

      fixture.componentInstance.openFilter();

      expect(router.navigate).toHaveBeenCalledWith(['sheet', 'filter'], {
        relativeTo: activatedRoute,
        queryParams: { search: '1' },
      });
    });
  });

  it('orders A to Z and hands the search down for the mark', async () => {
    const { fixture, view } = await render({ lines: LINES, items: ITEMS });

    view.setOrder('alpha');
    view.search('LECHE');
    fixture.detectChanges();

    expect(rows(fixture).map((row) => row.id)).toEqual(['ln-milk']);
    expect(
      fixture.debugElement
        .query(By.directive(LineList))
        .componentInstance.highlight()
    ).toBe('leche');
  });

  it('says so and offers Reset when the view leaves nothing to draw', async () => {
    const { fixture, view } = await render({
      lines: [LINES[0]],
      items: ITEMS,
    });

    view.pickCategory('PRODUCE');
    fixture.detectChanges();

    expect(query(fixture, 'lib-line-list')).toBeNull();
    expect(query(fixture, '.state-title')?.textContent?.trim()).toBe(
      'list.view.none'
    );

    (query(fixture, '.state-action') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(rows(fixture).map((row) => row.id)).toEqual(['ln-milk']);
  });

  describe('reorder waits for the list order (section 7)', () => {
    it('holds the action under A to Z, a picked category, and a search', async () => {
      const { fixture, view } = await render({ lines: LINES, items: ITEMS });
      expect(toBuyHeading(fixture).reorderHeld()).toBe(false);

      view.setOrder('alpha');
      fixture.detectChanges();
      expect(toBuyHeading(fixture).reorderHeld()).toBe(true);
      view.setOrder('list');

      view.pickCategory('DAIRY');
      fixture.detectChanges();
      expect(toBuyHeading(fixture).reorderHeld()).toBe(true);
      view.reset();

      // A search flattens the page, so there is no To buy heading to hold at all
      // (velista `0088`, section 6). The hold itself still stands.
      view.search('leche');
      fixture.detectChanges();
      expect(fixture.componentInstance.reorderHeld()).toBe(true);
      expect(query(fixture, 'lib-to-buy-heading')).toBeNull();

      view.search('');
      fixture.detectChanges();
      expect(toBuyHeading(fixture).reorderHeld()).toBe(false);
    });

    it('moves nothing when the held action is pressed, and says why', async () => {
      const { fixture, view } = await render({ lines: LINES, items: ITEMS });
      view.setOrder('alpha');
      fixture.detectChanges();

      const button = Array.from(
        fixture.nativeElement.querySelectorAll('lib-to-buy-heading .action')
      ).find((element) =>
        (element as HTMLElement).textContent?.includes('list.reorder.enter')
      ) as HTMLButtonElement;
      expect(button.getAttribute('aria-disabled')).toBe('true');

      button.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.reordering()).toBe(false);
      expect(query(fixture, '.held-message')?.textContent).toContain(
        'list.reorder.unavailable'
      );
    });
  });

  it('opens the filter sheet under the sheet marker', async () => {
    const { fixture, router } = await render({ lines: LINES, items: ITEMS });

    fixture.componentInstance.openFilter();

    expect(router.navigate).toHaveBeenCalledWith(
      ['sheet', 'filter'],
      expect.anything()
    );
  });

  it('gives the view store back when the page is left', async () => {
    const { fixture, view } = await render({ lines: LINES, items: ITEMS });
    view.search('leche');
    view.pickCategory('DAIRY');

    fixture.destroy();

    expect(view.query()).toBe('');
    expect(view.picked()).toBeNull();
  });
});

/** Velista `0088`: the zone list grouped by trip. */
describe('ListPage: the zone list grouped by trip', () => {
  function trip(id: string, overrides: Partial<Trip> = {}): Trip {
    return {
      id,
      kind: 'BASKET',
      name: null,
      live: false,
      startedAt: new Date('2026-09-12T10:00:00.000Z'),
      lineCount: 1,
      boughtLineCount: 1,
      ...overrides,
    };
  }

  function tripRow(lineId: string, overrides: Partial<TripRow> = {}): TripRow {
    return {
      lineId,
      asked: 1,
      bought: 0,
      left: 1,
      outcome: 'NOT_BOUGHT',
      settledByUserId: null,
      ...overrides,
    };
  }

  async function settle(fixture: ComponentFixture<ListPage>): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  function groups(fixture: ComponentFixture<ListPage>) {
    return fixture.debugElement
      .queryAll(By.directive(TripGroup))
      .map((found) => (found.componentInstance as TripGroup).group());
  }

  const LIVE = trip('b-live', { live: true, name: 'Thursday shop' });
  const PAST = trip('b-past', { name: 'Weekend shop' });

  const LINES = [
    line('bread', { content: 'Bread', position: 1, quantity: 2 }),
    line('rice', {
      content: 'Rice',
      position: 2,
      quantity: 1,
      claimed: true,
      claimedByUserId: 'user-toni',
    }),
    line('milk', {
      content: 'Milk',
      position: 3,
      quantity: 0,
      boughtCount: 4,
    }),
    line('saffron', {
      content: 'Saffron',
      position: 4,
      quantity: 0,
      boughtCount: 0,
    }),
    line('eggs', { content: 'Eggs', position: 5, quantity: 3 }),
  ];

  async function grouped() {
    const rendered = await render({
      lines: LINES,
      trips: { live: [LIVE], items: [PAST], nextCursor: null },
      tripRows: {
        'b-live': [tripRow('rice')],
        'b-past': [tripRow('milk', { outcome: 'BOUGHT', bought: 2, left: 0 })],
      },
    });
    await settle(rendered.fixture);
    return rendered;
  }

  it('costs one heads read and one rows read on arrival, the newest live trip open', async () => {
    const { fixture, tripCalls } = await grouped();

    expect(tripCalls.heads).toBe(1);
    expect(tripCalls.rows).toEqual(['b-live']);
    expect(groups(fixture).map((group) => [group.key, group.open])).toEqual([
      ['BASKET:b-live', true],
      ['BASKET:b-past', false],
    ]);
  });

  it('draws To buy first, a claimed line in its live trip, and a zero line never bought last', async () => {
    const { fixture } = await grouped();

    expect(rows(fixture).map((row) => row.id)).toEqual([
      'bread',
      'eggs',
      'saffron',
    ]);
    const [live] = groups(fixture);
    expect(live.rows?.map((row) => [row.lineId, row.mark])).toEqual([
      ['rice', 'claimed'],
    ]);
    expect(live.liveBy).toBe('Toni');
  });

  it("asks for a past trip's rows when it opens, and not again on a second opening", async () => {
    const { fixture, tripCalls } = await grouped();

    fixture.componentInstance.toggleTrip('BASKET:b-past');
    await settle(fixture);
    fixture.componentInstance.toggleTrip('BASKET:b-past');
    fixture.componentInstance.toggleTrip('BASKET:b-past');
    await settle(fixture);

    expect(tripCalls.rows).toEqual(['b-live', 'b-past']);
    expect(groups(fixture)[1].rows?.map((row) => row.lineId)).toEqual(['milk']);
  });

  it('opens the line when a trip row is tapped', async () => {
    const { fixture, router } = await grouped();

    fixture.debugElement
      .query(By.directive(TripGroup))
      .triggerEventHandler('opened', 'rice');

    expect(router.navigate).toHaveBeenCalledWith(
      ['sheet', 'lines', 'rice', 'detail'],
      expect.anything()
    );
  });

  it('flattens the page while searching, and puts the groups back as they were (test 10)', async () => {
    const { fixture, view } = await grouped();
    fixture.componentInstance.toggleTrip('BASKET:b-past');
    await settle(fixture);

    view.search('milk');
    fixture.detectChanges();

    expect(groups(fixture)).toEqual([]);
    expect(query(fixture, 'lib-to-buy-heading')).toBeNull();
    // A line at zero that lives only in an old trip is found, with its reel.
    expect(rows(fixture).map((row) => row.id)).toEqual(['milk']);

    view.search('');
    fixture.detectChanges();

    expect(groups(fixture).map((group) => group.open)).toEqual([true, true]);
  });

  it('shows To buy alone in reorder mode, and keeps every unseen line in its slot (test 12)', async () => {
    const { fixture, lines } = await grouped();

    fixture.componentInstance.startReorder();
    fixture.detectChanges();

    expect(groups(fixture)).toEqual([]);
    expect(rows(fixture).map((row) => row.id)).toEqual(['bread', 'eggs']);

    await fixture.componentInstance.moveTo({ lineId: 'eggs', to: 0 });

    expect(lines.calls).toContainEqual({
      kind: 'reorder',
      orderedLineIds: ['eggs', 'rice', 'milk', 'saffron', 'bread'],
    });
  });

  it('keeps the lines usable when the trips fail, and offers a retry (test 13)', async () => {
    const { fixture, tripCalls } = await render({
      lines: LINES,
      trips: 'fail',
    });
    await settle(fixture);

    expect(rows(fixture).length).toBeGreaterThan(0);
    expect(query(fixture, '.trips-failed')?.textContent).toContain(
      'list.trips.failed'
    );

    (
      query(fixture, '.trips-failed .state-action') as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(tripCalls.heads).toBe(2);
  });

  it('draws nothing under To buy when the list has no history', async () => {
    const { fixture } = await render({ lines: LINES });
    await settle(fixture);

    expect(query(fixture, 'lib-to-buy-heading')).not.toBeNull();
    expect(groups(fixture)).toEqual([]);
    expect(query(fixture, '.trips-older')).toBeNull();
  });

  it('gives the trips back when the page is left', async () => {
    const { fixture, trips } = await grouped();

    fixture.destroy();

    expect(trips.state()).toBe('idle');
    expect(trips.live()).toEqual([]);
  });
});

describe('ListPage: the lines the list suggests (velista 0089)', () => {
  async function settle(fixture: ComponentFixture<ListPage>): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  function due(lineId: string, overrides: Partial<DueLine> = {}): DueLine {
    return {
      lineId,
      reason: 'PERIOD',
      periodDays: 7,
      daysSinceBought: 5,
      tripsWith: null,
      tripsSeen: null,
      quantity: 2,
      ...overrides,
    };
  }

  const bought = { quantity: 0, boughtCount: 4 };

  const LINES = [
    line('bread', { content: 'Bread', position: 1, quantity: 2 }),
    line('eggs', { content: 'Eggs', position: 2, ...bought }),
    line('coffee', { content: 'Coffee', position: 3, ...bought }),
    line('saffron', {
      content: 'Saffron',
      position: 4,
      quantity: 0,
      boughtCount: 0,
    }),
    line('yogurt', { content: 'Yogurt', position: 5, ...bought }),
    line('butter', { content: 'Butter', position: 6, ...bought }),
    line('rice', { content: 'Rice', position: 7, ...bought }),
  ];

  const DUE = [
    due('coffee'),
    due('eggs', { quantity: 1 }),
    due('yogurt'),
    due('butter'),
    due('rice'),
  ];

  async function suggested(options: Options = {}) {
    const rendered = await render({ lines: LINES, due: DUE, ...options });
    await settle(rendered.fixture);
    return rendered;
  }

  function dueRows(fixture: ComponentFixture<ListPage>) {
    return fixture.debugElement
      .queryAll(By.directive(DueLineRow))
      .map((found) => (found.componentInstance as DueLineRow).row());
  }

  function lists(fixture: ComponentFixture<ListPage>) {
    return fixture.debugElement
      .queryAll(By.directive(LineList))
      .map((found) =>
        (found.componentInstance as LineList).lines().map((row) => row.id)
      );
  }

  function addButton(fixture: ComponentFixture<ListPage>, lineId: string) {
    const found = query(fixture, `[data-due-line-id="${lineId}"] .add`);
    if (found === null) {
      throw new Error(`no add button for ${lineId}`);
    }
    return found as HTMLButtonElement;
  }

  function plus(fixture: ComponentFixture<ListPage>, lineId: string) {
    return fixture.nativeElement.querySelectorAll(
      `[data-due-line-id="${lineId}"] lib-quantity-stepper .step`
    )[1] as HTMLButtonElement;
  }

  it('reads the due lines once the lines are in, and draws three between the wanted lines and the zero lines', async () => {
    const { fixture, dueCalls } = await suggested();

    expect(dueCalls.reads).toBe(1);
    expect(query(fixture, '.due-label')?.tagName).toBe('H3');
    expect(dueRows(fixture).map((row) => row.lineId)).toEqual([
      'coffee',
      'eggs',
      'yogurt',
    ]);
    expect(lists(fixture)).toEqual([['bread'], ['saffron']]);

    const section = query(fixture, 'section.due') as HTMLElement;
    const [wanted, rest] = Array.from(
      fixture.nativeElement.querySelectorAll('lib-line-list')
    ) as HTMLElement[];
    expect(
      wanted.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows every due line after "Show more suggestions", and focuses the first new one', async () => {
    const { fixture } = await suggested();
    const more = query(fixture, '.due-more') as HTMLButtonElement;
    expect(more.textContent).toContain('list.due.more');

    more.click();
    await settle(fixture);

    expect(dueRows(fixture).map((row) => row.lineId)).toEqual([
      'coffee',
      'eggs',
      'yogurt',
      'butter',
      'rice',
    ]);
    expect(query(fixture, '.due-more')).toBeNull();
    expect(document.activeElement).toBe(addButton(fixture, 'butter'));
  });

  it('has no "Show more suggestions" at three or fewer', async () => {
    const { fixture } = await suggested({ due: DUE.slice(0, 3) });

    expect(dueRows(fixture)).toHaveLength(3);
    expect(query(fixture, '.due-more')).toBeNull();
  });

  it('gives a reader and a writer who may not decide no section (test 2)', async () => {
    for (const permissions of [READ_ONLY, WRITER]) {
      const { fixture } = await suggested({ permissions });

      expect(query(fixture, 'section.due')).toBeNull();
      expect(dueRows(fixture)).toEqual([]);
    }

    const { fixture } = await suggested({ permissions: DECIDER });
    expect(dueRows(fixture)).toHaveLength(3);
  });

  it('draws no section in reorder mode, during a search, or when nothing is due (test 4)', async () => {
    const { fixture, view } = await suggested();

    fixture.componentInstance.startReorder();
    fixture.detectChanges();
    expect(query(fixture, 'section.due')).toBeNull();
    fixture.componentInstance.endReorder();
    fixture.detectChanges();
    expect(query(fixture, 'section.due')).not.toBeNull();

    view.search('coffee');
    fixture.detectChanges();
    expect(query(fixture, 'section.due')).toBeNull();

    const empty = await suggested({ due: [] });
    expect(query(empty.fixture, 'section.due')).toBeNull();
    expect(lists(empty.fixture)).toHaveLength(1);
  });

  it('says nothing when the read fails, and the lines still draw (section 3)', async () => {
    const { fixture } = await suggested({ due: 'fail' });

    expect(query(fixture, 'section.due')).toBeNull();
    // This list has no trip, so its bought lines at zero stay last in To buy rather
    // than on neither side (velista 0095, section 5).
    expect(rows(fixture).map((row) => row.id)).toEqual([
      'bread',
      'saffron',
      'eggs',
      'coffee',
      'yogurt',
      'butter',
      'rice',
    ]);
  });

  it('adds the suggested amount through the reel write, and the row goes at once (test 6)', async () => {
    const { fixture, lines } = await suggested();

    addButton(fixture, 'eggs').click();
    await settle(fixture);

    expect(lines.calls).toContainEqual({
      kind: 'quantity',
      lineId: 'eggs',
      delta: 1,
    });
    expect(dueRows(fixture).map((row) => row.lineId)).toEqual([
      'coffee',
      'yogurt',
      'butter',
    ]);
    // Now a wanted line, at its list position.
    expect(lists(fixture)[0]).toEqual(['bread', 'eggs']);
    expect(fixture.componentInstance.announcement()).toBe('list.due.added');
    expect(document.activeElement).toBe(addButton(fixture, 'yogurt'));
  });

  it('adds the amount chosen on the stepper', async () => {
    const { fixture, lines } = await suggested();

    plus(fixture, 'coffee').click();
    plus(fixture, 'coffee').click();
    fixture.detectChanges();
    addButton(fixture, 'coffee').click();
    await settle(fixture);

    expect(lines.calls).toContainEqual({
      kind: 'quantity',
      lineId: 'coffee',
      delta: 4,
    });
  });

  it('does not add by itself when the amount changes, while the switch is off', async () => {
    const { fixture, lines } = await suggested();

    jest.useFakeTimers();
    try {
      plus(fixture, 'coffee').click();
      fixture.detectChanges();
      jest.advanceTimersByTime(10_000);
    } finally {
      jest.useRealTimers();
    }

    expect(fixture.componentInstance.dueAddsOnStep).toBe(false);
    expect(lines.calls.filter((call) => call.kind === 'quantity')).toEqual([]);
  });

  it('brings the row back when the write fails (test 6)', async () => {
    const { fixture, lines } = await suggested();
    lines.setWriteOutcome('failed');

    addButton(fixture, 'eggs').click();
    await settle(fixture);

    expect(lines.calls).toContainEqual({
      kind: 'quantity',
      lineId: 'eggs',
      delta: 1,
    });
    expect(dueRows(fixture).map((row) => row.lineId)).toContain('eggs');
    expect(fixture.componentInstance.announcement()).not.toBe('list.due.added');
  });

  it('opens the line when a due row name is tapped', async () => {
    const { fixture, router } = await suggested();

    (
      query(fixture, '[data-due-line-id="coffee"] .body') as HTMLButtonElement
    ).click();

    expect(router.navigate).toHaveBeenCalledWith(
      ['sheet', 'lines', 'coffee', 'detail'],
      expect.anything()
    );
  });

  it('reads again on the shared signal, once per burst (test 8)', async () => {
    const { fixture, realtime, dueCalls } = await suggested();

    jest.useFakeTimers();
    try {
      realtime.emit('list.tripsChanged', { listId: LIST_ID });
      realtime.emit('list.tripsChanged', { listId: LIST_ID });
      jest.advanceTimersByTime(1000);
    } finally {
      jest.useRealTimers();
    }
    await settle(fixture);

    expect(dueCalls.reads).toBe(2);
  });

  it('gives the due lines back when the page is left', async () => {
    const { fixture } = await suggested();
    const store = fixture.debugElement.injector.get(DueLineStore);
    expect(store.lines()).toHaveLength(5);

    fixture.destroy();

    expect(store.lines()).toEqual([]);
    expect(store.listId()).toBeNull();
  });
});

/**
 * The words an answer is for (velista `0108`, target 1): what lets the composer
 * tell a finished search that found nothing from one still on its way.
 */
describe('ListPage: the words the suggestions answer (velista 0108)', () => {
  it('records them when the answer lands, and forgets them under three characters', async () => {
    const { fixture } = await render({ permissions: DECIDER });
    const page = fixture.componentInstance;

    expect(page.suggestedFor()).toBeNull();

    page.onComposerQuery('zzzz ');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(page.suggestions()).toEqual([]);
    expect(page.suggesting()).toBe(false);
    expect(page.suggestedFor()).toBe('zzzz');

    page.onComposerQuery('zz');
    fixture.detectChanges();

    expect(page.suggestedFor()).toBeNull();
  });
});

/**
 * The lines a suggestion card names (velista `0101`, section 4): a join over the
 * lines this page already holds, and the reel's own write when one is stepped.
 */
describe('ListPage: the lines a suggestion card names (velista 0101)', () => {
  const OAT: CatalogSuggestion = {
    kind: 'item',
    item: {
      id: 'item-oat',
      name: { es: 'Bebida de avena', en: 'Oat drink' },
      brand: 'Oatly',
      size: 1,
      unit: 'LITER',
      productGroupId: null,
      category: 'OTHER',
      offer: null,
      chainPrices: [],
      imageUrl: null,
      packCount: null,
      unitBasis: null,
    },
  };
  const MILK: CatalogSuggestion = {
    kind: 'group',
    group: { id: 'group-milk', name: { es: 'Leche', en: 'Milk' } },
    itemIds: ['item-milk-1l'],
    offer: null,
    members: [],
    synonyms: { en: [], es: [] },
  };

  it('names the lines holding a product, and the lines following a group', async () => {
    const { fixture } = await render({
      permissions: DECIDER,
      lines: [
        line('ln-oat', {
          content: 'Avena',
          quantity: 2,
          itemIds: ['item-oat'],
        }),
        line('ln-milk', { content: 'Leche', productGroupId: 'group-milk' }),
        line('ln-bread'),
      ],
    });
    const holdingsOf = fixture.componentInstance.holdingsOf();

    expect(holdingsOf(OAT)).toEqual([
      {
        key: 'ln-oat',
        lineId: 'ln-oat',
        text: 'Avena',
        listName: null,
        quantity: 2,
        editable: true,
      },
    ]);
    expect(holdingsOf(MILK).map((held) => held.lineId)).toEqual(['ln-milk']);
  });

  it('lets only somebody who decides quantities step one', async () => {
    const { fixture } = await render({
      permissions: WRITER,
      lines: [line('ln-oat', { itemIds: ['item-oat'] })],
    });

    expect(fixture.componentInstance.holdingsOf()(OAT)[0]?.editable).toBe(
      false
    );
  });

  it('steps a line through the reel’s own write, as a delta', async () => {
    const { fixture, lines } = await render({
      permissions: DECIDER,
      lines: [line('ln-oat', { quantity: 2, itemIds: ['item-oat'] })],
    });
    const [holding] = fixture.componentInstance.holdingsOf()(OAT);
    if (holding === undefined) {
      throw new Error('no holding');
    }

    await fixture.componentInstance.changeHolding({ holding, from: 2, to: 3 });

    expect(lines.calls).toContainEqual({
      kind: 'quantity',
      lineId: 'ln-oat',
      delta: 1,
    });
  });

  it('links a card to the product sheet over this list (velista 0107)', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.productLink()('item-oat')).toMatch(
      new RegExp(`/zones/${ZONE_ID}/lists/${LIST_ID}/sheet/products/item-oat$`)
    );
  });
});
