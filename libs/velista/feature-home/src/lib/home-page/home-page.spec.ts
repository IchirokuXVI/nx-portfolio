import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  fakeZoneStore,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeSessionStore,
  provideFakeZoneStore,
  VERIFY_RESEND_AVAILABLE,
  ZoneStore,
  type FakeIdentity,
  type FakeZoneStore,
  type ZoneEntry,
} from '@portfolio/velista/data-access';
import type { MyZone } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  StorageKeys,
} from '@portfolio/velista/platform';
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
    lists: [{ id: 'l1', name: 'Weekly shop', lineCount: 12, readyCount: 7 }],
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
async function render(
  options: Options = {}
): Promise<ComponentFixture<HomePage>> {
  // Lets one test render twice, which the guest banner comparison needs.
  TestBed.resetTestingModule();

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
      provideFakeSessionStore(options.identity ?? 'REGISTERED'),
      // Both arrived with plan 0009: the page reports what just happened to the
      // account, and offers another confirmation email once there is an endpoint.
      provideAccountNotice(),
      provideFakeAuthService(),
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

  describe('the resume card', () => {
    it('appears for a list this device remembered', async () => {
      // `zoneId/listId` since plan 0012: the list route needs both, and there is no
      // `GET /v1/lists/:id` for an id on its own to be resolved through (rule L1).
      const storage = new Map([[StorageKeys.lastList, 'z1/l1']]);

      const fixture = await render({ storage });

      expect(query(fixture, 'lib-resume-list-card')).not.toBeNull();
      expect(text(fixture)).toContain('Weekly shop');
    });

    it('stays away when nothing was remembered', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-resume-list-card')).toBeNull();
    });

    // A device that last opened a list before plan 0012 holds a bare id. It is read as
    // a list with no zone and the card does not render, which costs one missing card
    // on one device rather than a navigation to a route that cannot resolve.
    it('stays away for a value stored before the zone was part of it', async () => {
      const storage = new Map([[StorageKeys.lastList, 'l1']]);

      const fixture = await render({ storage });

      expect(query(fixture, 'lib-resume-list-card')).toBeNull();
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
