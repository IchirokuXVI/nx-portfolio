import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeShoppingProfileStore,
  provideFakeShoppingProfileStore,
  SHOP_SERVICE,
  ShopMemory,
  shoppingProfileFor,
  type FakeShoppingProfileStore,
  type ShopServiceI,
} from '@portfolio/velista/data-access';
import {
  OSM_ATTRIBUTION,
  type ProfileLoad,
  type ShoppingProfile,
} from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { SupermarketsPage } from './supermarkets-page';

/**
 * The screen that picks the shops (plan 0059).
 *
 * Rendered over the **real** `ShopStore` and the in memory shop service, rather than
 * over a double of the store: everything worth asserting here is a consequence of the
 * two talking to each other. The bucketing of keyless chains into OTHER, the three
 * franchise states, the grouping by postal code and the optimistic toggle are all store
 * behaviour, and a page level double would have to restate them, which is exactly the
 * thing that goes on passing after the behaviour changes.
 *
 * `ShoppingProfileStore` **is** doubled, because what this page needs from it is a fact
 * to be stated: this profile holds these postal codes.
 *
 * The testing translator answers with the **key**, so every assertion about copy names a
 * key rather than a sentence. Anything asserted as words here is data, which is the
 * shop names and addresses the fake holds.
 */

const PROFILE_ID = 'sp1';

/** A profile with two codes, one named and one not, which is what the grouping is for. */
function profileWithCodes(): ShoppingProfile {
  return shoppingProfileFor({
    id: PROFILE_ID,
    postalCodes: [
      { id: 'pc1', postalCode: '14001', label: 'home', position: 0 },
      { id: 'pc2', postalCode: '14012', label: null, position: 1 },
    ],
  });
}

/** A shop service that knows nothing, for the second empty state. */
const NO_SHOPS: ShopServiceI = {
  summarizeChains: async () => [],
  searchShops: async () => ({ items: [], nextCursor: null }),
  setLocationPreferences: async () => undefined,
};

interface Options {
  readonly profiles?: readonly ShoppingProfile[];
  readonly state?: ProfileLoad;
  /** A profile id in the URL that is not among the profiles, for the stale link case. */
  readonly profileId?: string;
  readonly service?: ShopServiceI;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<SupermarketsPage>;
  shops: ShopMemory;
  store: FakeShoppingProfileStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
  pages: { back: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeShoppingProfileStore({
    profiles: options.profiles ?? [profileWithCodes()],
    state: options.state ?? 'loaded',
  });
  const shops = new ShopMemory();
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };
  const pages = { back: jest.fn().mockResolvedValue(undefined) };

  const paramMap = convertToParamMap({
    profileId: options.profileId ?? PROFILE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [SupermarketsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      provideFakeShoppingProfileStore(store),
      { provide: SHOP_SERVICE, useValue: options.service ?? shops },
      { provide: Router, useValue: router },
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: {
            paramMap,
            queryParamMap: convertToParamMap({}),
            parent: null,
            data: {},
          },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SupermarketsPage);
  await settle(fixture);

  return { fixture, shops, store, router, pages };
}

/**
 * Draw, let every promise in flight resolve, and draw again.
 *
 * Microtasks drained by hand rather than `whenStable`: these specs are zoneless, so
 * there is no zone to become stable and `whenStable` never resolves.
 */
async function settle(
  fixture: ComponentFixture<SupermarketsPage>,
  rounds = 5
): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
  }
  fixture.detectChanges();
}

/** Type into the search field and wait out the debounce, which is a real timer. */
async function search(
  fixture: ComponentFixture<SupermarketsPage>,
  typed: string
): Promise<void> {
  const field = query<HTMLInputElement>(fixture, '#shops-search');
  if (field === null) {
    throw new Error('the search field is not on screen');
  }

  field.value = typed;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();

  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle(fixture);
}

function text(fixture: ComponentFixture<SupermarketsPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function query<T extends HTMLElement>(
  fixture: ComponentFixture<SupermarketsPage>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

function queryAll<T extends HTMLElement>(
  fixture: ComponentFixture<SupermarketsPage>,
  selector: string
): T[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector)
  );
}

/** The franchise buttons, by the name each one draws. */
function franchises(fixture: ComponentFixture<SupermarketsPage>): string[] {
  return queryAll(fixture, 'lib-franchise-buttons .chip').map(
    (chip) => chip.querySelector('.name')?.textContent?.trim() ?? ''
  );
}

/** Press the franchise button whose text contains the given word. */
async function open(
  fixture: ComponentFixture<SupermarketsPage>,
  name: string
): Promise<void> {
  const chip = queryAll<HTMLButtonElement>(
    fixture,
    'lib-franchise-buttons .chip'
  ).find((button) => (button.textContent ?? '').includes(name));

  if (chip === undefined) {
    throw new Error(`no franchise button named ${name}`);
  }

  chip.click();
  await settle(fixture);
}

describe('SupermarketsPage', () => {
  describe('the franchise buttons', () => {
    it('draws one per chain in the profile’s codes', async () => {
      const { fixture } = await render();

      expect(franchises(fixture)).toEqual(
        expect.arrayContaining(['Mercadona', 'DIA'])
      );
    });

    it('buckets the chains with no brand key into OTHER, and lists them', async () => {
      // 35 of the 75 places in one city radius were independents, so this is the largest
      // button on the screen for many people rather than a rounding error.
      const { fixture } = await render();

      expect(franchises(fixture)).toContain('shops.other');

      await open(fixture, 'shops.other');

      expect(text(fixture)).toContain('Frutería Paco');
      expect(text(fixture)).toContain('Panadería La Espiga');
    });

    it('draws a chain excluded differently from one with some shops off', async () => {
      const { fixture } = await render();

      await open(fixture, 'Mercadona');
      // One shop off by hand: "some", which lets a shop opening next month arrive on.
      queryAll<HTMLInputElement>(fixture, 'lib-shop-list .checkbox')[0].click();
      await settle(fixture);

      const chip = queryAll(fixture, 'lib-franchise-buttons .chip').find(
        (button) => (button.textContent ?? '').includes('Mercadona')
      );

      expect(chip?.classList.contains('excluded-some')).toBe(true);
      expect(chip?.classList.contains('excluded-chain')).toBe(false);
      // In words as well as in a class, because the two states are different promises.
      expect(chip?.textContent).toContain('shops.state.some');
    });

    it('excludes the brand when the franchise control is pressed', async () => {
      // Deselect all writes the **chain** exclusion, which is a different promise from
      // switching off every row: it covers shops the brand has not opened yet.
      const { fixture, store } = await render();

      await open(fixture, 'Mercadona');
      queryAll<HTMLButtonElement>(fixture, '.franchise-head .quiet')[0].click();
      await settle(fixture);

      expect(store.calls).toContainEqual(
        expect.objectContaining({
          method: 'save',
          field: 'chains',
          body: {
            supermarkets: [{ supermarketId: 'sm-mercadona', excluded: true }],
          },
        })
      );

      const chip = queryAll(fixture, 'lib-franchise-buttons .chip').find(
        (button) => (button.textContent ?? '').includes('Mercadona')
      );

      expect(chip?.classList.contains('excluded-chain')).toBe(true);
      expect(chip?.textContent).toContain('shops.state.chain');
    });
  });

  describe('the search bar', () => {
    it('is there before a franchise is chosen', async () => {
      const { fixture } = await render();

      expect(query(fixture, '#shops-search')).not.toBeNull();
      expect(query(fixture, 'lib-shop-list')).toBeNull();
    });

    it('is still there after one is chosen', async () => {
      const { fixture } = await render();

      await open(fixture, 'Mercadona');

      expect(query(fixture, '#shops-search')).not.toBeNull();
    });

    // One spec per field the server matches on (backend plan 0068, section 5). Written
    // out rather than looped, so a failure names the field that stopped matching.
    it('matches a shop name', async () => {
      const { fixture } = await render();

      await search(fixture, 'Ronda de los Tejares');

      expect(text(fixture)).toContain('Ronda de los Tejares');
    });

    it('matches a chain name', async () => {
      const { fixture } = await render();

      await search(fixture, 'DIA');

      expect(text(fixture)).toContain('Cruz Conde');
    });

    it('matches an address', async () => {
      const { fixture } = await render();

      await search(fixture, 'Cruz Conde');

      expect(queryAll(fixture, 'lib-shop-list .row')).toHaveLength(1);
    });

    it('matches a city', async () => {
      const { fixture } = await render();

      await search(fixture, 'Córdoba');

      expect(queryAll(fixture, 'lib-shop-list .row').length).toBeGreaterThan(1);
    });

    it('matches a postal code', async () => {
      const { fixture } = await render();

      await search(fixture, '14012');

      expect(queryAll(fixture, 'lib-shop-list .row')).toHaveLength(2);
    });

    it('searches across franchises rather than within the open one', async () => {
      const { fixture } = await render();

      await open(fixture, 'Mercadona');
      await search(fixture, 'Frutería');

      expect(text(fixture)).toContain('Frutería Paco');
    });

    it('names the chain on every result', async () => {
      // "Ronda de los Tejares" does not identify a shop on its own.
      const { fixture } = await render();

      await search(fixture, 'Tejares');

      expect(query(fixture, 'lib-shop-list .chain')?.textContent).toContain(
        'Mercadona'
      );
    });

    it('announces the result count', async () => {
      // A search that silently empties the screen is indistinguishable from one that
      // broke. The number itself is not asserted here: the testing translator answers
      // with the key and interpolates nothing.
      const { fixture } = await render();

      await search(fixture, 'Tejares');

      expect(query(fixture, '.result-count')?.getAttribute('aria-live')).toBe(
        'polite'
      );
      expect(query(fixture, '.result-count')?.textContent).toContain(
        'shops.search.results'
      );
    });

    it('puts the open franchise back when the field is cleared', async () => {
      const { fixture } = await render();

      await open(fixture, 'Mercadona');
      await search(fixture, 'Frutería');
      await search(fixture, '');

      expect(queryAll(fixture, 'lib-shop-list .row')).toHaveLength(2);
      expect(text(fixture)).not.toContain('Frutería Paco');
    });
  });

  describe('the shops of one franchise', () => {
    it('groups them by postal code, headed by the profile’s label', async () => {
      const { fixture } = await render();

      await open(fixture, 'Mercadona');
      const headings = queryAll(fixture, 'lib-shop-list .heading').map(
        (heading) => heading.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      );

      // The label where the profile gave one, the code itself where it did not, which is
      // the rule `0058` applies to the code list.
      expect(headings[0]).toContain('home');
      expect(headings[0]).toContain('14001');
      expect(headings[1]).toBe('14012');
    });

    it('draws no heading over a search, which crosses codes', async () => {
      const { fixture } = await render();

      await search(fixture, 'Córdoba');

      expect(queryAll(fixture, 'lib-shop-list .heading')).toHaveLength(0);
    });

    it('switches one shop off and leaves the rest alone', async () => {
      const { fixture, shops } = await render();

      await open(fixture, 'Mercadona');
      queryAll<HTMLInputElement>(fixture, 'lib-shop-list .checkbox')[0].click();
      await settle(fixture);

      expect(
        shops.calls.some((call) => call.method === 'setLocationPreferences')
      ).toBe(true);
      expect(queryAll(fixture, 'lib-shop-list .row.excluded')).toHaveLength(1);
    });

    it('leaves a row under an excluded brand inert', async () => {
      // The finer axis never re-admits what the coarser one refused, so a tick here would
      // be a control that appears to work and changes nothing.
      const { fixture } = await render();

      await open(fixture, 'Mercadona');
      queryAll<HTMLButtonElement>(fixture, '.franchise-head .quiet')[0].click();
      await settle(fixture);

      const boxes = queryAll<HTMLInputElement>(
        fixture,
        'lib-shop-list .checkbox'
      );

      expect(boxes.every((box) => box.disabled)).toBe(true);
      expect(text(fixture)).toContain('shops.row.chainExcluded');
    });
  });

  describe('the empty states', () => {
    it('offers the way to add a postal code when the profile has none', async () => {
      // The only one with an action: the screen cannot be drawn at all, and the way to
      // fix it is the profiles page.
      const { fixture, router } = await render({
        profiles: [shoppingProfileFor({ id: PROFILE_ID })],
      });

      expect(text(fixture)).toContain('shops.empty.noCodes.title');
      expect(query(fixture, '#shops-search')).toBeNull();

      query<HTMLButtonElement>(fixture, '.empty .primary')?.click();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/account/profiles');
    });

    it('says we have no shops for the code yet, and offers nothing', async () => {
      const { fixture } = await render({ service: NO_SHOPS });

      expect(text(fixture)).toContain('shops.empty.noShops');
      expect(query(fixture, '.empty .primary')).toBeNull();
      // Distinct from the first: the search bar is still there, because the profile does
      // say where it shops.
      expect(query(fixture, '#shops-search')).not.toBeNull();
    });

    it('says nothing matched, separately from having no shops at all', async () => {
      // Somebody who cannot find Lidl needs to know whether Lidl is missing or their
      // spelling is.
      const { fixture } = await render();

      await search(fixture, 'Lidl');

      expect(text(fixture)).toContain('shops.empty.noMatch');
      expect(text(fixture)).not.toContain('shops.empty.noShops');
      expect(query(fixture, '.empty .primary')).toBeNull();
    });
  });

  describe('what it owes the data', () => {
    it('renders the OpenStreetMap credit from the constant', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain(OSM_ATTRIBUTION);
    });

    it('credits GeoNames only once a derived code is on screen', async () => {
      const { fixture } = await render();

      expect(text(fixture)).not.toContain('GeoNames');

      // One of Mercadona's two shops carries a code filled in from a centroid.
      await open(fixture, 'Mercadona');

      expect(text(fixture)).toContain('GeoNames');
    });
  });

  it('goes back to the profiles page, which is the fallback a deep link needs', async () => {
    const { fixture, pages } = await render();

    query<HTMLButtonElement>(fixture, '.back')?.click();
    await settle(fixture);

    expect(pages.back).toHaveBeenCalledWith('/en/account/profiles');
  });

  it('says a profile it cannot find is not there, rather than drawing an empty screen', async () => {
    const { fixture } = await render({ profileId: 'sp-gone' });

    expect(text(fixture)).toContain('shops.empty.missing');
  });
});
