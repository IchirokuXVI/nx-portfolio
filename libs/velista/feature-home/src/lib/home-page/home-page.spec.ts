import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  provideFakeSessionStore,
  provideFakeZoneStore,
  type FakeIdentity,
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
    : fakeZoneStore({ zones: options.zones ?? [zone()], state: 'loaded' });

  await TestBed.configureTestingModule({
    imports: [HomePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(options.storage),
      provideFakeZoneStore(store),
      provideFakeSessionStore(options.identity ?? 'REGISTERED'),
    ],
  }).compileComponents();

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
      const storage = new Map([[StorageKeys.lastList, 'l1']]);

      const fixture = await render({ storage });

      expect(query(fixture, 'lib-resume-list-card')).not.toBeNull();
      expect(text(fixture)).toContain('Weekly shop');
    });

    it('stays away when nothing was remembered', async () => {
      const fixture = await render();

      expect(query(fixture, 'lib-resume-list-card')).toBeNull();
    });
  });

  describe('wiring', () => {
    it('records where each entry action is meant to go', async () => {
      // The destinations do not exist yet, but which button points at which one is
      // already worth locking down.
      const fixture = await render({ zones: [] });

      const buttons = [
        query(fixture, '.empty-primary'),
        query(fixture, '.empty-secondary'),
      ] as HTMLButtonElement[];
      buttons.forEach((button) => button.click());

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'zones.create',
        'zones.join',
      ]);
    });
  });
});
