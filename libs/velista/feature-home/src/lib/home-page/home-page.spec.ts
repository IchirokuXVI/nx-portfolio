import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeGeneratedListStore,
  fakeMemberNames,
  fakePresenceStore,
  fakeZoneStore,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeGeneratedListStore,
  provideFakeMemberNames,
  provideFakePresenceStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  REALTIME_CLIENT,
  VERIFY_RESEND_AVAILABLE,
  ZoneStore,
  type FakeGeneratedListStore,
  type FakeIdentity,
  type FakePresenceOptions,
  type FakeZoneStore,
  type RealtimeMemory,
  type ZoneEntry,
} from '@portfolio/velista/data-access';
import type {
  GeneratedListSummary,
  MyZone,
} from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { ShoppingListCard, ZoneCard } from '@portfolio/velista/ui';
import { HomePage } from './home-page';

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    counts: {
      memberCount: 3,
      listCount: 1,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
    },
    lists: [{ id: 'l1', name: 'Weekly shop', lineCount: 12, wantedCount: 7 }],
    ...overrides,
  };
}

interface Options {
  identity?: FakeIdentity;
  zones?: readonly MyZone[];
  fails?: boolean;
  storage?: Map<string, string>;
  /** The way in the person has just come through (plan 0008, section 3.3). */
  lastEntry?: ZoneEntry | null;
  /** What just happened to the account, which this page reports once (plan 0009). */
  accountNotice?: { kind: 'registered' | 'upgraded'; email: string };
  /** Who the server says is present, which the zone cards render (plan 0017). */
  presence?: FakePresenceOptions;
  /** The caller's generated shopping lists, for the dashboard card (plan 0045). */
  generated?: FakeGeneratedListStore;
  /** User id to the name they go by in the zone, since presence carries ids alone. */
  names?: Readonly<Record<string, string>>;
}

/**
 * Renders the page in one of `0003`'s states.
 *
 * The page is given a `ZoneStore` that is **already** in the state under test, rather
 * than a data layer wired up to arrive there. That is what makes every test below a
 * page test: it changes one thing about the world and asserts on the DOM.
 *
 * This used to build a whole `ZoneServiceI`, a whole `SessionStore` and then call
 * `TestBed.inject(ZoneStore).load()` to get a promise it could await, because
 * `HomePage`'s constructor starts the load itself and discards the promise. That meant
 * every render fetched twice, and the thing being awaited was not the load the page
 * was waiting on. Neither problem exists here: the store needs no loading, so there is
 * nothing to await and nothing to fetch twice.
 */
/**
 * The `MemberNames` double of the current render.
 *
 * Held outside `render` because what a spec wants from it is the record of which zones
 * it was asked about, and that is a fact about a render rather than about a fixture.
 */
let namesDouble = fakeMemberNames();

async function render(
  options: Options = {}
): Promise<ComponentFixture<HomePage>> {
  // Lets one test render twice, which the guest banner comparison needs.
  TestBed.resetTestingModule();

  // Rebuilt per render so its record of who was asked for belongs to this one.
  namesDouble = fakeMemberNames(options.names);

  const store = options.fails
    ? fakeZoneStore({ state: 'failed', error: new Error('boom') })
    : fakeZoneStore({
        zones: options.zones ?? [zone()],
        state: 'loaded',
        lastEntry: options.lastEntry ?? null,
      });

  await TestBed.configureTestingModule({
    imports: [HomePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(options.storage),
      provideFakeZoneStore(store),
      // Plan 0045: the dashboard's shopping list card reads the listing. A double, so
      // a spec states "there is one active basket" rather than driving a request.
      provideFakeGeneratedListStore(options.generated ?? fakeGeneratedListStore()),
      provideFakeSessionStore(options.identity ?? 'REGISTERED'),
      // Both arrived with plan 0009: the page reports what just happened to the
      // account, and offers another confirmation email once there is an endpoint.
      provideAccountNotice(),
      provideFakeAuthService(),
      // Plan 0017: the resume card's presence row. Both are doubles for the same
      // reason the store is, so a presence test changes one fact about the world.
      provideFakePresenceStore(fakePresenceStore(options.presence)),
      provideFakeMemberNames(namesDouble),
    ],
  }).compileComponents();

  if (options.accountNotice !== undefined) {
    TestBed.inject(AccountNotice).set(
      options.accountNotice.kind,
      options.accountNotice.email
    );
  }

  const fixture = TestBed.createComponent(HomePage);
  fixture.detectChanges();

  return fixture;
}

function text(fixture: ComponentFixture<HomePage>): string {
  return fixture.nativeElement.textContent ?? '';
}

function query(fixture: ComponentFixture<HomePage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function queryAll(fixture: ComponentFixture<HomePage>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  );
}

/**
 * Plan 0003's states, rendered.
 *
 * This is the half rule D1 buys: every one of these drives the page into a state by
 * changing an input, with no HTTP mocking and no fake socket, because the components
 * below the container take values rather than fetching them (plan 0004, section 2.2).
 */
describe('HomePage', () => {
  // The anonymous cases moved to `landing-page.spec.ts` with the screen itself
  // (plan 0007). Who reaches this page at all is `authenticatedGuard`'s job, and
  // `auth-guards.spec.ts` in `feature-shell` is where that is asserted.
  describe('the header', () => {
    it('shows the account button rather than the locale switch', async () => {
      // The dashboard's half of the header is search and account. Where a signed in
      // user changes language is a settings screen question (plan 0007, O4).
      const fixture = await render();

      expect(query(fixture, 'lib-app-bar .avatar')).not.toBeNull();
      expect(query(fixture, 'lib-app-bar .locale')).toBeNull();
    });
  });

  describe('the populated state', () => {
    it('renders a card per group', async () => {
      const fixture = await render({
        zones: [zone(), zone({ id: 'z2', name: "Mum and Dad's" })],
      });

      expect(queryAll(fixture, 'lib-zone-card')).toHaveLength(2);
    });

    it('renders the group name and its counts', async () => {
      const fixture = await render();

      expect(text(fixture)).toContain('Flat 3B');
      expect(text(fixture)).toContain('3');
    });

    it('shows the bottom action bar', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-bottom-action-bar')).not.toBeNull();
    });

    it('renders no card as a nested button, which would be invalid', async () => {
      // Plan 0003 section 7: the card and its list rows are siblings, never nested
      // interactive elements.
      const fixture = await render();

      const nested = queryAll(fixture, 'button button');
      expect(nested).toHaveLength(0);
    });
  });

  describe('the pending state', () => {
    it('renders the group without list content and without a tap target', async () => {
      const fixture = await render({
        zones: [zone({ myStatus: 'PENDING' })],
      });

      expect(query(fixture, 'lib-zone-card .head-button')).toBeNull();
      expect(query(fixture, 'lib-zone-card .list-row')).toBeNull();
      expect(query(fixture, 'lib-zone-card .inert')).not.toBeNull();
    });
  });

  describe('a group being torn down', () => {
    it('renders without crashing and cannot be opened', async () => {
      // Plan 0003 open question 2 asks only for this much.
      const fixture = await render({
        zones: [zone({ status: 'MARKED_FOR_DELETION' })],
      });

      expect(query(fixture, 'lib-zone-card')).not.toBeNull();
      expect(query(fixture, 'lib-zone-card .head-button')).toBeNull();
    });
  });

  describe('the join request row', () => {
    it('renders the row with a review action, using the plural key', async () => {
      // The translator returns keys in tests, so this asserts *which* phrasing was
      // chosen. That the count excludes the named person, and that the name is the
      // oldest requester, are asserted against the view model in
      // select-home-state.spec, which is the cheaper and more precise place for it.
      const fixture = await render({
        zones: [
          zone({
            counts: {
              memberCount: 4,
              listCount: 0,
              pendingRequestCount: 3,
              firstPendingRequesterName: 'Ines',
            },
            lists: [],
          }),
        ],
      });

      expect(query(fixture, 'lib-zone-card .review')).not.toBeNull();
      expect(text(fixture)).toContain('home.request.wantsToJoin.many');
    });

    it('uses the singular key for one request', async () => {
      const fixture = await render({
        zones: [
          zone({
            counts: {
              memberCount: 2,
              listCount: 0,
              pendingRequestCount: 1,
              firstPendingRequesterName: 'Ines',
            },
            lists: [],
          }),
        ],
      });

      expect(text(fixture)).toContain('home.request.wantsToJoin.one');
      expect(text(fixture)).not.toContain('home.request.wantsToJoin.many');
    });
  });

  describe('the empty state', () => {
    it('promotes both entry actions', async () => {
      const fixture = await render({ zones: [] });

      expect(query(fixture, 'lib-empty-state')).not.toBeNull();
      expect(query(fixture, '.empty-primary')).not.toBeNull();
      expect(query(fixture, '.empty-secondary')).not.toBeNull();
    });
  });

  describe('the guest state', () => {
    it('shows the banner for a temporary user only', async () => {
      const asGuest = await render({ identity: 'TEMPORARY' });
      expect(query(asGuest, 'lib-guest-upgrade-banner')).not.toBeNull();

      const asRegistered = await render({ identity: 'REGISTERED' });
      expect(query(asRegistered, 'lib-guest-upgrade-banner')).toBeNull();
    });

    it('hides the banner once dismissed, and does not bring it back', async () => {
      const fixture = await render({ identity: 'TEMPORARY' });

      fixture.componentInstance.dismissGuestBanner();
      fixture.detectChanges();

      expect(query(fixture, 'lib-guest-upgrade-banner')).toBeNull();
    });

    it('offers no dismiss X, only the two named actions', async () => {
      const fixture = await render({ identity: 'TEMPORARY' });

      const buttons = queryAll(fixture, 'lib-guest-upgrade-banner button');
      expect(buttons).toHaveLength(2);
    });

    /**
     * **Rule C2, from the one control that could get it wrong** (plan 0009, section
     * 5.3). Register creates a new user row, so a guest who followed the banner there
     * would fill in a valid form, land on an empty dashboard, and have no way back to
     * groups now owned by an account whose only credential was the token that call
     * replaced. Nothing would warn them, which is why this is a test and not a comment.
     */
    it('sends the banner action to upgrade, and never to register', async () => {
      const fixture = await render({ identity: 'TEMPORARY' });
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      (
        queryAll(
          fixture,
          'lib-guest-upgrade-banner button'
        )[0] as HTMLButtonElement
      ).click();

      // Out of `home` first, because the credential screens are its siblings rather
      // than its children, and relative so neither the locale nor the mount is
      // written down here (extraction contract, item 5).
      expect(navigate).toHaveBeenCalledWith(
        ['..', 'auth', 'upgrade'],
        expect.anything()
      );
      expect(navigate.mock.calls[0]?.[0]).not.toContain('register');
    });
  });

  /**
   * What just happened to the account, reported once (plan 0009). The address is known
   * only on the navigation that follows the form: the token pair carries none and
   * `GET /v1/account/me` is out of scope for this plan.
   */
  describe('after a credential flow', () => {
    it('nudges a new account to confirm its address, and names it', async () => {
      const fixture = await render({
        accountNotice: { kind: 'registered', email: 'marta@example.com' },
      });

      expect(query(fixture, 'lib-confirm-email-nudge')).not.toBeNull();
      expect(text(fixture)).toContain('auth.nudge.body');
    });

    it('lets the nudge be dismissed, because confirming is optional', async () => {
      // `register()` sends the confirmation outside the transaction and `login()`
      // never reads `emailVerifiedAt`, so a blocking step would be a barrier this
      // product does not have (section 5.2).
      const fixture = await render({
        accountNotice: { kind: 'registered', email: 'marta@example.com' },
      });

      (
        query(fixture, 'lib-confirm-email-nudge button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(query(fixture, 'lib-confirm-email-nudge')).toBeNull();
    });

    it('does not offer another send until there is an endpoint behind it', async () => {
      // Section 5.8: the nudge without its last sentence is the screen plan 0009
      // would have shipped anyway.
      const fixture = await render({
        accountNotice: { kind: 'registered', email: 'marta@example.com' },
      });

      expect(fixture.componentInstance.resendOffered).toBe(
        VERIFY_RESEND_AVAILABLE
      );
      if (!VERIFY_RESEND_AVAILABLE) {
        expect(query(fixture, 'lib-resend-sentence')).toBeNull();
      }
    });

    it('confirms an upgrade with one line, and no nudge', async () => {
      const fixture = await render({
        accountNotice: { kind: 'upgraded', email: 'marta@example.com' },
      });

      expect(query(fixture, 'lib-success-note')).not.toBeNull();
      expect(text(fixture)).toContain('auth.upgrade.done');
      expect(query(fixture, 'lib-confirm-email-nudge')).toBeNull();
    });

    it('says nothing at all on an ordinary visit', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-confirm-email-nudge')).toBeNull();
      expect(query(fixture, 'lib-success-note')).toBeNull();
    });

    it('clears the notice when the page goes, so it is not said twice', async () => {
      // News, not state. Coming back to this URL tomorrow is a different visit.
      const fixture = await render({
        accountNotice: { kind: 'upgraded', email: 'marta@example.com' },
      });
      const notice = TestBed.inject(AccountNotice);

      expect(notice.notice()).not.toBeNull();
      fixture.destroy();

      expect(notice.notice()).toBeNull();
    });
  });

  describe('the error state', () => {
    it('offers a retry and a copyable reference', async () => {
      const fixture = await render({ fails: true });

      expect(query(fixture, 'lib-error-state')).not.toBeNull();
      expect(text(fixture)).toContain('home.error.title');
    });
  });

  // Plan 0045. The resume card is gone and this is what took its place. The block is
  // rewritten rather than added beside it, because the dashboard has one card in that
  // slot and it now comes from the server rather than from what the device remembered.
  //
  // The old block's whole "who is shopping it" section is gone with it and has no
  // replacement here: `generatedList.listMine` answers summaries, which carry no
  // participants, so there is no presence on this card to test. `0044`'s basket screen
  // is where the people on a basket are drawn.
  describe('the shopping list card', () => {
    const basket = (
      overrides: Partial<GeneratedListSummary> = {}
    ): GeneratedListSummary => ({
      id: 'gl1',
      name: 'Saturday big shop',
      status: 'ACTIVE',
      generatedAt: new Date('2026-08-21T10:00:00.000Z'),
      lineCount: 12,
      settledLineCount: 4,
      ...overrides,
    });

    it('appears for an active basket, and names it', async () => {
      const fixture = await render({
        generated: fakeGeneratedListStore([basket()]),
      });

      expect(query(fixture, 'lib-shopping-list-card')).not.toBeNull();
      expect(text(fixture)).toContain('Saturday big shop');
    });

    // Absent entirely: no header, no empty card, no gap (section 3.1). A person who has
    // never generated one is not shown a slot where one would go, because the bottom
    // bar's primary action already says the feature is there.
    it('stays away when there is no active basket, leaving no empty section', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-shopping-list-card')).toBeNull();
      expect(text(fixture)).not.toContain('home.section.shoppingList');
    });

    // A finished trip is history, not something to pick back up, so it belongs on the
    // history page and not on the dashboard.
    it('stays away for a basket that is no longer active', async () => {
      const fixture = await render({
        generated: fakeGeneratedListStore([basket({ status: 'COMPLETED' })]),
      });

      expect(query(fixture, 'lib-shopping-list-card')).toBeNull();
    });

    it('asks the store for the listing when the page is created', async () => {
      const store = fakeGeneratedListStore([basket()]);

      await render({ generated: store });

      expect(store.calls).toContain('load');
    });

    // Generating one on a laptop puts the card on a phone with no reload, which is what
    // the owner's own realtime room is for. Driven through the store here, since the
    // container's job is to render whatever the store holds at the time.
    it('appears without a reload when one arrives while the page is open', async () => {
      const store = fakeGeneratedListStore([]);
      const fixture = await render({ generated: store });

      expect(query(fixture, 'lib-shopping-list-card')).toBeNull();

      store.set([basket()]);
      fixture.detectChanges();

      expect(query(fixture, 'lib-shopping-list-card')).not.toBeNull();
    });

    /**
     * Read off the card's input rather than out of the DOM, for the reason the resume
     * card's presence row was: the testing translator returns the key without
     * interpolating it, so a rendered count never reaches the markup. The input is the
     * boundary that matters anyway.
     */
    const card = (fixture: ComponentFixture<HomePage>) =>
      fixture.debugElement.query(By.directive(ShoppingListCard))
        ?.componentInstance;

    it('shows the newest and counts the others rather than guessing between them', async () => {
      const fixture = await render({
        generated: fakeGeneratedListStore([
          basket({ id: 'gl1' }),
          basket({ id: 'gl2', name: 'Corner shop' }),
        ]),
      });

      expect(card(fixture).list().id).toBe('gl1');
      expect(card(fixture).list().otherActiveCount).toBe(1);
    });

    // An unnamed basket is titled with its date, resolved by the container because it
    // needs a locale and cannot be computed from one basket in isolation.
    it('titles an unnamed basket with its generation date', async () => {
      const fixture = await render({
        generated: fakeGeneratedListStore([basket({ name: null })]),
      });

      expect(card(fixture).list().name).not.toBe('');
      expect(card(fixture).list().name).not.toBe('gl1');
    });
  });

  // Plan 0022, sections 3.1 and 3.3. The card's own rendering is `ZoneCard`'s and is
  // tested where it lives; what is observable here is the container's three joins and
  // the request it declines to make.
  describe('presence on a group card', () => {
    const card = (fixture: ComponentFixture<HomePage>) =>
      fixture.debugElement
        .query(By.directive(ZoneCard))
        ?.componentInstance.zone();

    it('names the other people in the group', async () => {
      const fixture = await render({
        presence: { online: { z1: ['u2'] } },
        names: { u2: 'Ana' },
      });

      expect(card(fixture).online).toEqual(['Ana']);
    });

    // The reader holds the zone room too, so the server counts them. A card that told
    // somebody they were here would be wrong about the only thing it says.
    it('leaves the reader out of it', async () => {
      const fixture = await render({
        presence: { online: { z1: ['u1', 'u2'] } },
        names: { u1: 'Me', u2: 'Ana' },
      });

      expect(card(fixture).online).toEqual(['Ana']);
    });

    it('says nothing rather than showing an id it could not resolve', async () => {
      const fixture = await render({
        presence: { online: { z1: ['u2'] } },
        names: {},
      });

      expect(card(fixture).online).toEqual([]);
    });

    it('lights the row of a list somebody has open', async () => {
      const fixture = await render({
        presence: { viewers: { l1: ['u2'] } },
        names: { u2: 'Ana' },
      });

      expect(card(fixture).lists).toMatchObject([{ viewers: ['Ana'] }]);
    });

    // A request per card, on every load, to name people who are usually not there is
    // what would make an advisory row expensive. Nobody online, nobody to name.
    it('does not ask who the members are until somebody is actually here', async () => {
      await render();
      expect(namesDouble.asked).toEqual([]);

      await render({ presence: { online: { z1: ['u2'] } } });
      expect(namesDouble.asked).toEqual(['z1']);
    });

    // Backend `0032` sends list presence for lists this page never opened, and somebody
    // deep linked to a list holds no zone subscription, so they are in that zone's list
    // presence and in no zone's own presence at all. Asking only about `onlineIn` left
    // the names for this card unresolved forever, and `presenceNames` drops a name it
    // cannot resolve, so the row above did not draw while its data sat in the store.
    //
    // Not caught by that row's own test, which is worth saying: `fakeMemberNames`
    // answers `nameOf` from a record rather than from what was asked for, so a screen
    // that never calls `ensure` still renders names there. The call is the assertion.
    it('asks who the members are for a group whose only presence is on a list', async () => {
      await render({ presence: { viewers: { l1: ['u2'] } } });

      expect(namesDouble.asked).toEqual(['z1']);
    });

    it('still asks nothing when the only viewer of a list is the reader', async () => {
      await render({ presence: { viewers: { l1: ['u1'] } } });

      expect(namesDouble.asked).toEqual([]);
    });
  });

  describe('after a way in', () => {
    it('leads with the code to share, because a group of one is useless', async () => {
      const fixture = await render({
        zones: [zone({ id: 'z-new', name: 'Flat 3B', joinCode: 'HK7M2QPD' })],
        lastEntry: { kind: 'created', zoneId: 'z-new' },
      });

      expect(query(fixture, 'lib-invite-card')?.textContent).toContain(
        'HK7M2QPD'
      );
      expect(query(fixture, 'lib-asked-notice')).toBeNull();
    });

    it('says the ask has gone in, and names the group the reload brought back', async () => {
      // `MembershipView` carries no name, so this sentence is only sayable after the
      // reload (plan 0008, section 5.6).
      const fixture = await render({
        zones: [zone({ id: 'z9', name: 'Casa Ferrer', myStatus: 'PENDING' })],
        lastEntry: { kind: 'joined', zoneId: 'z9' },
      });

      expect(query(fixture, 'lib-asked-notice')).not.toBeNull();
      expect(query(fixture, 'lib-invite-card')).toBeNull();
    });

    it('says nothing until the group it is about is actually there', async () => {
      // A panel that names a group renders a blank name if it draws too early, which
      // is worse than drawing a moment later.
      const fixture = await render({
        zones: [zone()],
        lastEntry: { kind: 'joined', zoneId: 'not-loaded-yet' },
      });

      expect(query(fixture, 'lib-asked-notice')).toBeNull();
    });

    it('says nothing at all on an ordinary visit', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-invite-card')).toBeNull();
      expect(query(fixture, 'lib-asked-notice')).toBeNull();
    });

    it('forgets the arrival when the page goes away, so it is shown once', async () => {
      const fixture = await render({
        zones: [zone({ id: 'z-new' })],
        lastEntry: { kind: 'created', zoneId: 'z-new' },
      });
      const store = TestBed.inject(ZoneStore) as unknown as FakeZoneStore;

      fixture.destroy();

      expect(store.lastEntry()).toBeNull();
    });
  });

  describe('wiring', () => {
    it('sends each entry action to its sheet, as a sibling route', async () => {
      // What this used to assert was a recorded string, because the destinations did
      // not exist. Plan 0008 built them, so it asserts the navigation itself. The
      // paths are relative on purpose: neither the locale segment nor the app's mount
      // may appear in a page (extraction contract, item 5).
      const fixture = await render({ zones: [] });
      const router = TestBed.inject(Router);
      const navigate = jest
        .spyOn(router, 'navigate')
        .mockResolvedValue(true as never);

      (query(fixture, '.empty-primary') as HTMLButtonElement).click();
      (query(fixture, '.empty-secondary') as HTMLButtonElement).click();

      expect(navigate.mock.calls.map(([commands]) => commands)).toEqual([
        ['zones', 'new'],
        ['zones', 'join'],
      ]);
      expect(navigate.mock.calls[0]?.[1]?.relativeTo).toBe(
        TestBed.inject(ActivatedRoute)
      );
    });

    it('has an outlet for the sheet to render into', async () => {
      // Rule E1: the sheets are child routes, so the page beneath stays mounted and
      // keeps its scroll. Without an outlet the route would match and draw nothing.
      const fixture = await render({ zones: [] });

      expect(query(fixture, 'router-outlet')).not.toBeNull();
    });
  });

  describe('the group card, once plan 0010 gave it somewhere to go', () => {
    /** Spies on `navigate` and hands back the calls it recorded. */
    function watchNavigation(): jest.SpyInstance {
      return jest
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true as never);
    }

    it('opens the group as a sibling route', async () => {
      // Every card on this page used to be a dead end, recorded in `pendingRoutes`.
      // `['..', 'zones', id]` because this page's own path is `home`, so the group
      // page is its sibling; neither the locale nor the mount is written down
      // (extraction contract, item 5).
      const fixture = await render({ zones: [zone({ id: 'z1' })] });
      const navigate = watchNavigation();

      fixture.componentInstance.openZone('z1');

      expect(navigate).toHaveBeenCalledWith(
        ['..', 'zones', 'z1'],
        expect.objectContaining({ relativeTo: TestBed.inject(ActivatedRoute) })
      );
    });

    it('sends Review to the members screen', async () => {
      // The deepest dead end in the product until now: `0008` could produce a
      // pending membership and nothing anywhere could resolve one.
      const fixture = await render({ zones: [zone({ id: 'z1' })] });
      const navigate = watchNavigation();

      fixture.componentInstance.reviewRequests('z1');

      expect(navigate).toHaveBeenCalledWith(
        ['..', 'zones', 'z1', 'members'],
        expect.objectContaining({ relativeTo: TestBed.inject(ActivatedRoute) })
      );
    });

    it('records nothing as unbuilt for either of them any more', async () => {
      const fixture = await render({ zones: [zone({ id: 'z1' })] });
      watchNavigation();

      fixture.componentInstance.openZone('z1');
      fixture.componentInstance.reviewRequests('z1');

      expect(fixture.componentInstance.pendingRoutes()).toEqual([]);
    });

    it('opens the account, which the app bar has pointed at since 0003', async () => {
      // Recorded in `pendingRoutes` until plan 0015 built the screen behind it. A
      // sibling like the group page, for the same reason: this page's path is `home`.
      const fixture = await render();
      const navigate = watchNavigation();

      fixture.componentInstance.account();

      expect(navigate).toHaveBeenCalledWith(
        ['..', 'account'],
        expect.objectContaining({ relativeTo: TestBed.inject(ActivatedRoute) })
      );
      expect(fixture.componentInstance.pendingRoutes()).toEqual([]);
    });

    // This recorded the list screen as unbuilt until plan 0012 built it. The
    // navigation carries the **zone** as well as the list: the route is
    // `zones/:zoneId/lists/:listId` and there is no `GET /v1/lists/:id`, so an id on
    // its own resolves nothing (plan 0012, rule L1).
    it('opens a list by zone and list id', async () => {
      const fixture = await render({ zones: [zone({ id: 'z1' })] });
      const navigate = watchNavigation();

      fixture.componentInstance.openList({ zoneId: 'z1', listId: 'list-1' });

      expect(navigate).toHaveBeenCalledWith(
        ['..', 'zones', 'z1', 'lists', 'list-1'],
        expect.objectContaining({ relativeTo: TestBed.inject(ActivatedRoute) })
      );
    });
  });
});
