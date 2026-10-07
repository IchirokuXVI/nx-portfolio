import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  ServerReachability,
  SESSION_SERVICE,
  SessionStorage,
  SessionStore,
  type SessionServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { BrandSuggestionsPage } from '@portfolio/luna-shopper-admin/feature-brands';
import {
  EntriesQueuePage,
  HarvestReviewPage,
  HarvestSetupPage,
  ImportUploadPage,
  NewRunPage,
  PlacesQueuePage,
  PostalCodeAddPage,
  PostalCodeDetailPage,
  RunPage,
  RunsPage,
  ShopsQueuePage,
  SourcesTab,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  provideSections,
  RecordPage,
  ResourceListPage,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  UNKNOWN_ENVIRONMENT,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { appRoutes } from './app.routes';
import { ADMIN_SECTIONS } from './sections';

/**
 * The two branches and the guards that pair them (plan 0002, then 0004).
 *
 * Nothing renders without a session, and an operator who has one has no business
 * on the login screen. The second half is the one worth a spec: a guard that
 * redirects to the URL it is guarding loops forever with **no error at all** —
 * a white tab in a browser and a hang in jest — and this is precisely the pair
 * of routes where that mistake is available.
 *
 * Since `0004` the guarded branch is the chrome and the resources under it, and
 * since admin plan `0016` a signed in operator asking for `/` stays on `/`,
 * which is the dashboard. It used to redirect to the first resource, because
 * `0004` refused an empty landing page; the screen that answers the questions
 * six screens otherwise answer is what replaced that redirect. The guard is on
 * the branch and not on its children, which is what keeps an unknown URL from a
 * signed out operator going to the login screen rather than to a "no such
 * screen" page they could not act on anyway.
 */

/**
 * Where `/` settles for a signed in operator: nowhere, because `/` is the
 * dashboard.
 *
 * A constant rather than the literal at three call sites, so the day this app
 * opens somewhere else the change is one line here.
 */
const HOME = '/';

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const service: SessionServiceI = {
  signIn: async () => session,
  refresh: async () => session,
  signInForDevelopment: async () => session,
  readMe: async () => ({
    admin: {
      adminId: 'adm_1',
      username: 'ops',
      displayName: null,
      lastLoginAt: null,
    },
    deployment: 'development',
  }),
};

/** The component of every route on the way down to where the router rests. */
function componentsAt(router: Router): unknown[] {
  const found: unknown[] = [];
  let route = router.routerState.snapshot.root.firstChild;

  while (route !== null) {
    if (route.component !== null) {
      found.push(route.component);
    }
    route = route.firstChild;
  }

  return found;
}

async function boot(signedIn: boolean) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter(appRoutes),
      provideLocationMocks(),
      // What `app.config.ts` provides. A redirect under a zone asks the
      // registry where a list or a shopping list is, and the registry reads
      // the sections from here: without them every one lands on `/`.
      provideSections(...ADMIN_SECTIONS),
      { provide: SESSION_SERVICE, useValue: service },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: { read: async () => UNKNOWN_ENVIRONMENT },
      },
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const sessions = TestBed.inject(SessionStore);
  if (signedIn) {
    await sessions.signIn('ops', 'pw');
  }

  return { router: TestBed.inject(Router), sessions };
}

/** A person and a zone of the in-memory rows, by the ids the fixture gives. */
const ROSA = '11111111-1111-4111-8111-111111111111';
const KITCHEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('appRoutes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('sends an operator with no session to the login screen', async () => {
    const { router } = await boot(false);

    await router.navigateByUrl('/');

    expect(router.url).toBe('/sign-in');
  });

  it('sends an unknown URL from a signed out operator to the login screen', async () => {
    const { router } = await boot(false);

    await router.navigateByUrl('/nowhere');

    expect(router.url).toBe('/sign-in');
  });

  it('lets an operator with a session reach the screen the app opens to', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/');

    expect(router.url).toBe(HOME);
  });

  /**
   * The other side of the second test. The same URL is a login redirect for
   * somebody with no session and a not found page for somebody with one, and
   * only the second of those is a URL they can do anything about.
   */
  it('keeps an unknown URL from a signed in operator where it is', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/nowhere');

    expect(router.url).toBe('/nowhere');
  });

  /**
   * Every screen reachable before admin plan 0022 is reachable after it, at the
   * path section 1 of that plan gives. The whole list rather than a sample,
   * because a URL that quietly stopped resolving would draw the not found page
   * from inside the chrome and look like a screen that had not loaded yet.
   */
  it.each([
    ['/', 'the overview'],
    // A chain holds its shops (admin plan 0042).
    ['/chains', 'the chains'],
    ['/chains/new', 'the form of a new chain'],
    ['/chains/sm_mercadona/shops', 'the shops of a chain'],
    ['/chains/sm_mercadona/shops/new', 'the form of a new shop'],
    ['/chains/sm_mercadona/shops/loc_cordoba_centro/details', 'a shop'],
    [
      '/chains/sm_mercadona/shops/loc_cordoba_centro/sections',
      'the order a shop walks its sections in',
    ],
    [
      '/chains/sm_mercadona/shops/loc_cordoba_centro/products',
      'the products in a shop',
    ],
    [
      '/chains/sm_mercadona/shops/loc_cordoba_centro/products/new',
      'the form of a new shop product',
    ],
    ['/chains/sm_mercadona/sections', 'the sections of a chain'],
    ['/chains/sm_mercadona/sections/new', 'the form of a new section'],
    ['/chains/sm_mercadona/scopes', 'the price scopes of a chain'],
    ['/chains/sm_mercadona/scopes/new', 'the form of a new price scope'],
    ['/chains/sm_mercadona/details', 'the form of a chain'],
    // A product and its prices (admin plan 0043).
    ['/products', 'the products'],
    ['/products/new', 'the form of a new product'],
    ['/products/groups', 'the product groups'],
    ['/products/groups/new', 'the form of a new group'],
    ['/products/groups/pg_whole_milk', 'a product group'],
    ['/products/categories', 'the category tree'],
    ['/products/categories/new', 'the form of a new category'],
    ['/products/price-rules', 'the price rules'],
    ['/products/price-rules/ADMIN', 'a price rule, its form open'],
    ['/products/it_milk_1l/details', 'the form of a product'],
    ['/products/it_milk_1l/prices', 'the prices of a product'],
    ['/products/it_milk_1l/prices/new', 'the form of a new price'],
    ['/products/it_milk_1l/where', 'where a product is'],
    ['/products/it_milk_1l/sources', 'the source rows of a product'],
    // A zone holds its members and its lists (admin plan 0045).
    ['/shoppers/people', 'the people'],
    [`/shoppers/people/${ROSA}/details`, 'the account of a person'],
    [`/shoppers/people/${ROSA}/zones`, 'the zones of a person'],
    [`/shoppers/people/${ROSA}/shopping-lists`, 'what a person owns'],
    [`/shoppers/people/${ROSA}/shopping-lists/b-saturday`, 'a shopping list'],
    ['/shoppers/zones', 'the zones'],
    [`/shoppers/zones/${KITCHEN}/members`, 'the members of a zone'],
    [
      `/shoppers/zones/${KITCHEN}/members/${KITCHEN}~m-kitchen-marc`,
      'the form of a member',
    ],
    [`/shoppers/zones/${KITCHEN}/lists`, 'the lists of a zone'],
    [`/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly`, 'a list'],
    [
      `/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly/lines/l-kitchen-weekly~line-milk`,
      'the form of a line',
    ],
    [
      `/shoppers/zones/${KITCHEN}/shopping-lists`,
      'the shopping lists drawn from a zone',
    ],
    [`/shoppers/zones/${KITCHEN}/details`, 'the facts of a zone'],
    // The harvester in three tabs (admin plan 0044).
    ['/harvest/review/products', 'the queue of source products'],
    ['/harvest/review/shops', 'the queue of source shops'],
    ['/harvest/review/places', 'the queue of discovered places'],
    ['/harvest/review/brands', 'the queue of suggested brands'],
    ['/harvest/runs', 'the runs'],
    ['/harvest/runs/new', 'the form of a new run'],
    ['/harvest/runs/import', 'the file import'],
    ['/harvest/runs/run-catalog-running', 'one run'],
    ['/harvest/setup/sources', 'the chain sources'],
    ['/harvest/setup/sources/new', 'the form of a new chain source'],
    [
      '/harvest/setup/sources/11111111-1111-4111-8111-111111111111',
      'a chain source',
    ],
    ['/harvest/setup/brands', 'the registered brands'],
    ['/harvest/setup/brands/new', 'the form of a new brand'],
    ['/harvest/setup/brands/br_1', 'a registered brand'],
    ['/harvest/setup/postal-codes', 'the postal codes'],
    ['/harvest/setup/postal-codes/new', 'the form that adds postal codes'],
    ['/harvest/setup/postal-codes/14001', 'a postal code'],
    ['/admins/accounts', 'the accounts of the admins'],
    ['/admins/failed-sign-ins', 'the failed sign ins of the admins'],
  ])('draws %s at its own URL', async (url) => {
    const { router } = await boot(true);

    await router.navigateByUrl(url);

    expect(router.url).toBe(url);
  });

  /**
   * The form of a brand was a page of its own. It is the record page now
   * (admin plan 0054), and the old address still leads to the form.
   */
  it('sends the old address of the form of a brand to the record, with its form open', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/harvest/setup/brands/br_1/edit');

    expect(router.url).toBe('/harvest/setup/brands/br_1?edit=1');
  });

  /**
   * The same for a person and a zone (admin plan 0057). Each has tabs, so the
   * record opens on its first one, and the page then moves to Details.
   */
  it.each([
    [
      `/shoppers/people/${ROSA}/edit`,
      `/shoppers/people/${ROSA}/details?edit=1`,
    ],
    [
      `/shoppers/zones/${KITCHEN}/edit`,
      `/shoppers/zones/${KITCHEN}/members?edit=1`,
    ],
    // A list has no tabs (admin plan 0058), so the record is the address.
    [
      `/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly/edit`,
      `/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly?edit=1`,
    ],
  ])(
    'sends the old address %s to the record, with its form open',
    async (old, record) => {
      const { router } = await boot(true);

      await router.navigateByUrl(old);

      expect(router.url).toBe(record);
    }
  );

  /**
   * The three tabs of the harvester, each drawn by its own page, and what
   * the switch of Review and of Setup opens inside it (admin plan 0044,
   * targets 4 to 6). A form of a Setup resource is a page of its own, beside
   * the Setup page and not inside it.
   */
  it.each([
    ['/harvest/review/products', [HarvestReviewPage, EntriesQueuePage]],
    ['/harvest/review/shops', [HarvestReviewPage, ShopsQueuePage]],
    ['/harvest/review/places', [HarvestReviewPage, PlacesQueuePage]],
    ['/harvest/review/brands', [HarvestReviewPage, BrandSuggestionsPage]],
    ['/harvest/runs', [RunsPage]],
    ['/harvest/runs/new', [NewRunPage]],
    ['/harvest/runs/import', [ImportUploadPage]],
    ['/harvest/runs/run-1', [RunPage]],
    ['/harvest/setup/sources', [HarvestSetupPage, SourcesTab]],
    [
      '/harvest/setup/sources/11111111-1111-4111-8111-111111111111',
      [RecordPage],
    ],
    ['/harvest/setup/brands', [HarvestSetupPage, ResourceListPage]],
    ['/harvest/setup/postal-codes', [HarvestSetupPage, ResourceListPage]],
    ['/harvest/setup/brands/br_1', [RecordPage]],
    ['/harvest/setup/postal-codes/new', [PostalCodeAddPage]],
    ['/harvest/setup/postal-codes/14001', [PostalCodeDetailPage]],
  ])('draws %s with its own pages', async (url, pages) => {
    const { router } = await boot(true);

    await router.navigateByUrl(url);

    expect(router.url).toBe(url);
    // Inside the chrome, which is the first component on the way down.
    expect(componentsAt(router).slice(1)).toEqual(pages);
  });

  /** The section, and each tab that holds a switch, opens on its first entry. */
  it.each([
    ['/harvest', '/harvest/review/products'],
    ['/harvest/review', '/harvest/review/products'],
    ['/harvest/setup', '/harvest/setup/sources'],
    // Admins opens on its accounts (admin plan 0046, target 6).
    ['/admins', '/admins/accounts'],
    // The chain the four queues share rides along.
    [
      '/harvest?chain=sm_mercadona',
      '/harvest/review/products?chain=sm_mercadona',
    ],
    [
      '/harvest/review?chain=sm_mercadona',
      '/harvest/review/products?chain=sm_mercadona',
    ],
  ])('opens %s on %s', async (url, lands) => {
    const { router } = await boot(true);

    await router.navigateByUrl(url);

    expect(router.url).toBe(lands);
  });

  /**
   * A chain, a shop and a product each open on their first tab. So do the
   * Shoppers section, a person and a zone (admin plan 0045, targets 1, 3 and
   * 5).
   */
  it.each([
    ['/chains/sm_mercadona', '/chains/sm_mercadona/shops'],
    [
      '/chains/sm_mercadona/shops/loc_cordoba_centro',
      '/chains/sm_mercadona/shops/loc_cordoba_centro/details',
    ],
    ['/products/it_milk_1l', '/products/it_milk_1l/details'],
    ['/shoppers', '/shoppers/people'],
    [`/shoppers/people/${ROSA}`, `/shoppers/people/${ROSA}/details`],
    [`/shoppers/zones/${KITCHEN}`, `/shoppers/zones/${KITCHEN}/members`],
  ])('opens %s on its first tab', async (url, tab) => {
    const { router } = await boot(true);

    await router.navigateByUrl(url);

    expect(router.url).toBe(tab);
  });

  /**
   * Two addresses under a zone are no screen of their own (admin plan 0045),
   * against the app's own sections.
   */
  it.each([
    // A row of a zone's Shopping lists tab opens under its owner.
    [
      `/shoppers/zones/${KITCHEN}/shopping-lists/b-saturday`,
      `/shoppers/people/${ROSA}/shopping-lists/b-saturday`,
    ],
    // A line's form goes back one segment, which is the list it is on.
    [
      `/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly/lines`,
      `/shoppers/zones/${KITCHEN}/lists/l-kitchen-weekly`,
    ],
  ])('sends %s to %s', async (from, to) => {
    const { router } = await boot(true);

    await router.navigateByUrl(from);

    expect(router.url).toBe(to);
  });

  /**
   * The paths moved, and this is the half of that which is worth asserting: the
   * old flat URL is not silently a second way in. `0022` section 12 rules out
   * redirects from them, so each is an ordinary unknown URL now.
   */
  it.each(['/items', '/users', '/prices', '/shopping-lists'])(
    'has no screen left at %s',
    async (url) => {
      const { router } = await boot(true);

      await router.navigateByUrl(url);

      // The not found page, which is a route inside the chrome rather than a
      // redirect, so the URL stays where the operator typed it rather than
      // bouncing anywhere. What proves it is not a screen is that the same URL
      // is absent from the list above.
      expect(router.url).toBe(url);
    }
  );

  /**
   * The loop guard. A reload onto the login screen with a session held must land
   * on the dashboard and *stop*, rather than bounce between the two.
   */
  it('sends an operator who already has a session away from the login screen', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/sign-in');

    expect(router.url).toBe(HOME);
  });

  /**
   * A reload after the session is gone, which is what a 401 leaves behind: the
   * interceptor cleared it, and the next cold start finds nothing in storage.
   *
   * It is asserted across two boots rather than by signing out inside one,
   * because a guard only runs on a navigation: an operator standing on a screen
   * when the session ends stays there until they move. That is not a gap, it is
   * why `0003`'s overlay exists.
   */
  it('sends the operator back to the login screen once the session is gone', async () => {
    const signedIn = await boot(true);
    await signedIn.router.navigateByUrl('/');
    expect(signedIn.router.url).toBe(HOME);

    signedIn.sessions.signOut();

    const afterReload = await boot(false);
    await afterReload.router.navigateByUrl('/');

    expect(afterReload.router.url).toBe('/sign-in');
  });
});
