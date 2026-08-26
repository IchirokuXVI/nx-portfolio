import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  SessionStore,
  ZONE_SERVICE,
  ZoneStore,
  type ZoneServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BRAND,
  type AppBrand,
  type MyZone,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { HomePage } from './home-page';

const brand: AppBrand = {
  name: 'Test Product',
  shortName: 'Test',
  wordmarkSrc: 'mark.svg',
  iconSrc: 'icon.svg',
};

function zone(overrides: Partial<MyZone> = {}): MyZone {
  return {
    id: 'z1',
    name: 'Flat 3B',
    joinCode: 'FLAT3B',
    status: 'ACTIVE',
    ownerUserId: 'u1',
    myRole: 'OWNER',
    myStatus: 'APPROVED',
    summary: {
      memberCount: 3,
      listCount: 1,
      pendingRequestCount: 0,
      firstPendingRequesterName: null,
      lists: [{ id: 'l1', name: 'Weekly shop', lineCount: 12, readyCount: 7 }],
    },
    ...overrides,
  };
}

interface Options {
  identity?: 'anonymous' | 'TEMPORARY' | 'REGISTERED';
  zones?: readonly MyZone[];
  fails?: boolean;
  storage?: Map<string, string>;
}

async function render(
  options: Options = {}
): Promise<ComponentFixture<HomePage>> {
  // Lets one test render twice, which the guest banner comparison needs.
  TestBed.resetTestingModule();

  const identity = options.identity ?? 'REGISTERED';
  const storage = options.storage ?? new Map<string, string>();

  const service: ZoneServiceI = {
    listMyZones: async () => {
      if (options.fails) {
        throw new Error('boom');
      }
      return { items: options.zones ?? [zone()], nextCursor: null };
    },
    createZone: async () => ({ state: 'created', zone: zone() }),
    joinZone: async () => ({
      state: 'joined',
      membership: {
        id: 'm1',
        zoneId: 'z1',
        userId: 'u1',
        username: 'You',
        role: 'MEMBER',
        status: 'PENDING',
      },
    }),
  };

  await TestBed.configureTestingModule({
    imports: [HomePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      { provide: APP_BRAND, useValue: brand },
      { provide: ZONE_SERVICE, useValue: service },
      {
        provide: BrowserFacade,
        useValue: {
          isBrowser: true,
          onLine: () => true,
          window: null,
          readStorage: (key: string) => storage.get(key) ?? null,
          writeStorage: (key: string, value: string) =>
            void storage.set(key, value),
          removeStorage: (key: string) => void storage.delete(key),
        },
      },
      {
        provide: SessionStore,
        useValue: {
          identity: () =>
            identity === 'anonymous'
              ? { kind: 'anonymous' }
              : { kind: identity, userId: 'u1' },
          isAuthenticated: () => identity !== 'anonymous',
          isGuest: () => identity === 'TEMPORARY',
          userId: () => (identity === 'anonymous' ? null : 'u1'),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(HomePage);
  fixture.detectChanges();

  // The store's load is a promise, so let it settle before asserting on anything
  // other than the loading state.
  await TestBed.inject(ZoneStore).load();
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
  describe('the anonymous state', () => {
    it('offers exactly four ways in', async () => {
      const fixture = await render({ identity: 'anonymous' });

      const buttons = queryAll(fixture, 'lib-auth-actions button');
      expect(buttons).toHaveLength(4);
    });

    it('shows the hero and the illustrative list, and no bottom bar', async () => {
      const fixture = await render({ identity: 'anonymous' });

      expect(query(fixture, 'lib-home-hero')).not.toBeNull();
      expect(query(fixture, 'lib-list-preview-card')).not.toBeNull();
      expect(query(fixture, 'lib-bottom-action-bar')).toBeNull();
    });

    it('shows the locale switch rather than the account button', async () => {
      // Somebody who has not signed in may well be on the wrong language, and has
      // nothing else to do in the header.
      const fixture = await render({ identity: 'anonymous' });

      expect(query(fixture, 'lib-app-bar .locale')).not.toBeNull();
      expect(query(fixture, 'lib-app-bar .avatar')).toBeNull();
    });

    it('hides the illustrative list from assistive technology', async () => {
      // Three invented groceries read out before the two buttons that matter is
      // noise; the hero already says what the product does in words.
      const fixture = await render({ identity: 'anonymous' });

      expect(
        query(fixture, 'lib-list-preview-card [aria-hidden="true"]')
      ).not.toBeNull();
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
            summary: {
              memberCount: 4,
              listCount: 0,
              pendingRequestCount: 3,
              firstPendingRequesterName: 'Ines',
              lists: [],
            },
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
            summary: {
              memberCount: 2,
              listCount: 0,
              pendingRequestCount: 1,
              firstPendingRequesterName: 'Ines',
              lists: [],
            },
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
      const fixture = await render({ identity: 'anonymous' });

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons.forEach((button) => button.click());

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'zones.create',
        'zones.join',
        'auth.google',
        'auth.login',
      ]);
    });
  });
});
