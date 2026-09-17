import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { RunRequestForm } from './run-request-form';

/**
 * The run request form (admin plan 0030, section 2), and every case that was
 * the runs page's start form before the form was extracted.
 *
 * The cases are the runs page's, moved: what the form hands up on submit is
 * what the page used to send, so each still asserts the request body. Two
 * things changed and both are refusals made visible. `REFRESH` cannot be
 * named, because backend plan `0086` deleted the mode. And a Mercadona walk
 * cannot be started without a price scope, because the spawn refuses one, so
 * the field appears exactly where it is required.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';
const NATIONAL = 'scope-national';
const CORDOBA = 'scope-4661';
const CORUNA = 'scope-4804';

/**
 * What the chain's scopes look like, which is what both scope controls read.
 *
 * `priority` is what the adapter's band is read against and `externalKey` is
 * the warehouse a walk fetches (backend plan 0108), so those are the two fields
 * every case here varies. The numbers are `DEFAULT_SCOPE_PRIORITY`'s.
 */
const SCOPES = [
  {
    id: NATIONAL,
    kind: 'NATIONAL',
    externalKey: null,
    label: null,
    priority: 1000,
  },
  {
    id: CORDOBA,
    kind: 'LOCAL_AREA',
    externalKey: '4661',
    label: null,
    priority: 200,
  },
  {
    id: CORUNA,
    kind: 'LOCAL_AREA',
    externalKey: '4804',
    label: { en: 'A Coruna' },
    priority: 200,
  },
];

/** What the chain picker finds, whatever is typed into it. */
const CHAINS = [
  { id: MERCADONA, title: 'Mercadona' },
  { id: DEZA, title: 'Deza' },
];

/** A checkbox change, as the template hands one to `toggleScope`. */
const ticked = (checked: boolean) =>
  ({ target: { checked } }) as unknown as Event;

/** Long enough for the picker's own 250 ms to settle. */
const SEARCH_SETTLE_MS = 320;

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/**
 * The adapter a chain is fetched with, overriding the seed.
 *
 * The form draws itself from what the adapter can tell us (backend plan 0103,
 * section 4), so a spec per capability row needs a chain per adapter. The seed
 * has two, and adding four more chains to it would be seeding a directory to
 * test a form.
 */
function sourceReader(
  adapters: Readonly<Record<string, string>> = {}
): HarvestServiceI {
  const memory = new HarvestMemory();

  return {
    readSource: async (id: string) => {
      const source = await memory.readSource(id);
      const adapterKey = adapters[id];
      return adapterKey === undefined
        ? source
        : { ...source, adapterKey: adapterKey as typeof source.adapterKey };
    },
  } as unknown as HarvestServiceI;
}

async function render(
  adapters: Readonly<Record<string, string>> = {},
  scopes: readonly string[] = SCOPES.map((scope) => scope.id)
) {
  const service = sourceReader(adapters);
  const scopeReads: unknown[] = [];

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunRequestForm, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The chain's scopes: the national one the single picker preselects,
        // and two warehouses a Mercadona walk chooses between.
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async (query: unknown) => {
              scopeReads.push(query);
              return { items: SCOPES, nextCursor: null };
            },
          }),
        },
      },
      {
        // The chains the picker offers, by name. The form points at one by
        // choosing it here now, so a lookup that answered nothing would leave
        // the whole start form unreachable.
        provide: ResourceReferences,
        useValue: {
          search: async () => CHAINS,
          // A chain by name, and a price scope only while it exists, which is
          // how the form tells a saved scope that is gone (admin plan 0030).
          resolve: async (resource: string, id: string) =>
            resource === 'price-scopes'
              ? scopes.includes(id)
                ? { id, title: id }
                : null
              : (CHAINS.find((chain) => chain.id === id) ?? null),
        },
      },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunRequestForm);
  const spawned: unknown[] = [];
  fixture.componentInstance.submitted.subscribe((request) =>
    spawned.push(request)
  );
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return {
    fixture: fixture as ComponentFixture<RunRequestForm>,
    spawned,
    scopeReads,
  };
}

/** The form, pointed at one chain and given time to read its source row. */
async function chain(fixture: ComponentFixture<RunRequestForm>, id: string) {
  fixture.componentInstance.chooseChain(id);
  await drain();
  fixture.detectChanges();
}

/**
 * The chain, chosen the way an operator chooses it: type, wait, click the name.
 *
 * Through the DOM rather than through the component, because the defect this
 * covers was in the binding and not in the method it called.
 */
async function chooseChainByName(
  fixture: ComponentFixture<RunRequestForm>,
  title: string
) {
  const picker: HTMLElement = fixture.nativeElement.querySelector(
    'lib-reference-picker'
  );
  const input: HTMLInputElement = picker.querySelector('input')!;
  input.value = title;
  input.dispatchEvent(new Event('input'));

  await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
  await drain();
  fixture.detectChanges();

  const option = Array.from(
    picker.querySelectorAll<HTMLButtonElement>('ul button')
  ).find((button) => button.textContent?.trim() === title);
  option!.click();

  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<RunRequestForm>): string =>
  fixture.nativeElement.textContent;

describe('the run form, the modes it offers', () => {
  it('offers three, and cannot name a refresh or a leaflet import', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.modes).toEqual([
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);
    expect(text(fixture)).not.toContain('harvest.mode.REFRESH');
    expect(text(fixture)).not.toContain('harvest.mode.LEAFLET_IMPORT');
  });

  /**
   * An import needs a document, and a document is a file, a preview and a
   * validation failure that names the product it is about. None of that fits
   * three text inputs, so the form offers the way to the screen that does.
   */
  it('sends a file import to the upload screen rather than starting it', async () => {
    const { fixture } = await render();

    fixture.componentInstance.mode.set('FILE_IMPORT');
    fixture.detectChanges();

    expect(fixture.componentInstance.uploading()).toBe(true);
    expect(fixture.componentInstance.uploadLink()).toEqual([
      '/',
      'harvest',
      'imports',
      'upload',
    ]);
  });
});

describe('the run form, the price scope a walk writes to', () => {
  /**
   * A Mercadona walk covers the warehouses it is given, and a warehouse is a
   * scope's own key (backend plan 0108). So the chain that used to ask for one
   * scope asks for a list, and the single picker is drawn for the adapter that
   * still takes one.
   */
  it('asks for warehouses, not for one scope, for a chain that prices by warehouse', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('mercadona-api');
    expect(page.needsScope()).toBe(false);
    expect(page.needsScopeList()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScopes');
  });

  it('offers every scope and refuses the ones this walk may not write', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    // Shown and disabled rather than hidden, so an operator looking for the
    // chain's national scope can see that it exists and that a crawl of one
    // warehouse may not claim it.
    expect(fixture.componentInstance.scopeChoices()).toEqual([
      expect.objectContaining({ id: NATIONAL, walkable: false }),
      expect.objectContaining({ id: CORDOBA, walkable: true, title: '4661' }),
      expect.objectContaining({
        id: CORUNA,
        walkable: true,
        // The key first: a harvested scope usually has no label, and the key is
        // the number the chain publishes.
        title: '4804 — A Coruna',
      }),
    ]);
  });

  it('will not start a walk that covers no warehouse', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.priceScopeIds()).toEqual([]);
    expect(page.ready()).toBe(false);
    page.submit();
    await drain();

    expect(spawned).toEqual([]);
  });

  it('sends every warehouse ticked, in the order they were ticked', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    expect(page.ready()).toBe(true);
    page.submit();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORUNA, CORDOBA],
      // Sent whenever the groups are shown (admin plan 0029, section 4).
      writes: 'PRICES_AND_AVAILABILITY',
      details: 'NEW',
    });
  });

  it('takes a warehouse back out again', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORDOBA, ticked(true));
    page.toggleScope(CORDOBA, ticked(false));

    expect(page.priceScopeIds()).toEqual([]);
    expect(page.ready()).toBe(false);
  });

  /** Most walks that take one scope price nationally, so it is preselected. */
  it('preselects the chain national scope for a walk that takes one', async () => {
    const { fixture } = await render({ [DEZA]: 'carrefour-web' });
    await chain(fixture, DEZA);

    expect(fixture.componentInstance.priceScopeId()).toBe(NATIONAL);
    expect(fixture.componentInstance.ready()).toBe(true);
  });

  it('will not start the walk with the scope emptied', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    page.priceScopeId.set('');
    fixture.detectChanges();

    expect(page.ready()).toBe(false);
    page.submit();
    await drain();

    expect(spawned).toEqual([]);
  });

  it('sends the scope with the walk', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, DEZA);

    fixture.componentInstance.submit();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
      priceScopeId: NATIONAL,
      writes: 'PRICES_AND_AVAILABILITY',
    });
  });

  /**
   * DEZA's site prints no price, so its walk writes none and the spawn accepts
   * a scope and ignores it. A field that does nothing is a lie in a form.
   */
  it('asks for no scope for a chain whose site prints none', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('deza-web');
    expect(page.needsScope()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.priceScope');
    expect(page.ready()).toBe(true);

    page.submit();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
      // A site that prints no price has only availability to write.
      writes: 'AVAILABILITY',
    });
  });

  /**
   * The defect of admin plan 0025, section 1, as a test.
   *
   * The spawn required a scope for `carrefour-web` as well as for
   * `mercadona-api`, and this form named only the second. So a Carrefour walk
   * drew no picker, sent an empty scope, and was refused with a message about a
   * field the operator was never shown. Both sides read one table now.
   */
  it('asks for a scope for a chain behind a browser that prices', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.needsScope()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScope');

    page.submit();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
      priceScopeId: NATIONAL,
      writes: 'PRICES_AND_AVAILABILITY',
    });
  });

  /**
   * The opposite half of the same table. LIDL publishes a price for each of its
   * 59 regions and every price names the region it is for, so the run needs no
   * default and a picker would offer a field that catches nothing.
   */
  it('asks for no scope for a chain that names the scope of every price', async () => {
    const { fixture } = await render({ [DEZA]: 'lidl-api' });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.capabilities().writesPrices).toBe(true);
    expect(page.needsScope()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.priceScope');
    expect(page.ready()).toBe(true);
  });

  /**
   * A back office one release behind a backend that added an adapter draws a
   * plain form rather than a broken one, and the spawn is still the thing that
   * refuses a bad request.
   */
  it('draws a plain form for an adapter it has never heard of', async () => {
    const { fixture } = await render({ [DEZA]: 'aldi-web' });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.needsScope()).toBe(false);
    expect(page.offersBackfill()).toBe(false);
    expect(page.needsScopeList()).toBe(false);
    expect(page.capabilities()).toEqual({
      writesPrices: false,
      scopesItsOwn: false,
      listsItsOwnStores: false,
      hasProductPages: false,
      skipsKnownDetails: false,
      // Null and not a band: an adapter this build has never heard of is given
      // no scopes to write, like every other answer here.
      walkablePriorities: null,
    });
  });

  /**
   * A store discovery finds shops and writes no price at all, so the field has
   * nothing to be about whatever the chain's adapter is.
   */
  it('asks for no scope on a store discovery', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();

    expect(page.needsScope()).toBe(false);
  });

  /**
   * The other two rules that used to name an adapter and now read the table
   * (admin plan 0025, section 2).
   */
  it('asks where to look for shops, unless the chain names its own', async () => {
    // Mercadona names its own shops since backend plan 0106, so the chain that
    // still needs a centre here is the one whose site publishes an assortment
    // and no store list.
    const { fixture } = await render({ [DEZA]: 'deza-web' });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();
    expect(page.needsCentre()).toBe(true);
    expect(page.offersPostalCodes()).toBe(false);
    expect(text(fixture)).toContain('harvest.runs.start.postalCode');

    await chain(fixture, MERCADONA);
    fixture.detectChanges();
    expect(page.needsCentre()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.country');
  });

  /**
   * The other half of the same fact (backend plan 0106, section 4): a chain
   * that names its own shops takes no centre and a filter instead, matched
   * against each shop's own code rather than as a radius.
   */
  it('offers the postal code filter only where the chain names its shops', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'deza-web',
    });
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();
    expect(page.offersPostalCodes()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.postalCodes');

    page.postalCodes.set(['15006', '  ', ' 14013 ,15006'].join('\n'));
    page.submit();

    // Blanks and duplicates are dropped, and a comma separates as a newline
    // does, because a list of codes is pasted as often as it is typed.
    expect(spawned[0]).toMatchObject({
      mode: 'STORE_DISCOVERY',
      postalCodes: ['15006', '14013'],
    });

    await chain(fixture, DEZA);
    fixture.detectChanges();
    expect(page.offersPostalCodes()).toBe(false);
  });

  it('sends no filter at all when none was typed', async () => {
    // An empty filter is every shop, which is what an absent field already
    // means, so an empty array in the body would say nothing new.
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();
    page.submit();

    expect(spawned[0]).not.toHaveProperty('postalCodes');
  });

  it('offers the EAN backfill only where there are product pages to read', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.offersBackfill()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.detailBackfill');

    await chain(fixture, DEZA);
    expect(page.offersBackfill()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.detailBackfill');

    // A backfill reads pages for the EAN and writes no price, so the scope the
    // same chain's walk would be asked for is not asked for here.
    page.detailBackfill.set(true);
    fixture.detectChanges();
    expect(page.needsScope()).toBe(false);

    page.submit();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
      detailBackfill: true,
    });
  });

  /** A scope of the previous chain is not a scope of this one. */
  it('drops the scope when the chain changes', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    fixture.componentInstance.chooseChain(DEZA);

    expect(fixture.componentInstance.priceScopeId()).toBe('');
  });

  /**
   * The defect this screen was reported with: choosing Mercadona drew no scope
   * field, and choosing a second chain afterwards drew it.
   *
   * The chain was a text input with `[(ngModel)]` and an `(ngModelChange)`
   * beside it. Both listeners answer the same output and they fire in the order
   * the template names them, so the handler read the signal one write behind and
   * asked the source route about the previous chain. Driven through the DOM,
   * because a spec that called the handler itself passed throughout.
   */
  it('asks about the chain just chosen and not the one before it', async () => {
    const { fixture } = await render();

    await chooseChainByName(fixture, 'Mercadona');
    const page = fixture.componentInstance;

    expect(page.supermarketId()).toBe(MERCADONA);
    expect(page.adapterKey()).toBe('mercadona-api');
    expect(page.needsScopeList()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScopes');
  });
});

/**
 * The walk list, which reads no shop scopes (admin plan 0029, section 2).
 *
 * Every shop has a scope since backend plan 0116, and five pages of a hundred
 * would run out before a chain with about 1,675 of them reached its warehouses.
 */
describe('the run form, the scopes the walk list reads', () => {
  it('asks for every kind but a shop scope', async () => {
    const { fixture, scopeReads } = await render();
    await chain(fixture, MERCADONA);

    expect(scopeReads).toEqual([
      expect.objectContaining({
        filters: {
          supermarketId: MERCADONA,
          kind: ['LOCAL_AREA', 'REGION', 'NATIONAL'],
        },
      }),
    ]);
  });
});

/** Where a walked scope is copied to (admin plan 0029, section 3). */
describe('the run form, the scopes a walk is copied to', () => {
  const REGION = 'scope-region-galicia';
  const SHOP = 'scope-store-15006';
  const OTHER_SHOP = 'scope-store-14013';

  it('sends each walked scope with its targets, in the order both were chosen', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.toggleScope(CORDOBA, ticked(true));
    page.changeCopies(CORDOBA, [OTHER_SHOP]);
    page.changeCopies(CORUNA, [REGION]);
    page.changeCopies(CORUNA, [REGION, SHOP]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelectorAll('lib-scope-copies')
    ).toHaveLength(2);
    page.submit();
    await drain();

    expect(spawned[0]).toMatchObject({
      priceScopeIds: [CORUNA, CORDOBA],
      scopeCopies: [
        { from: CORUNA, to: [REGION, SHOP] },
        { from: CORDOBA, to: [OTHER_SHOP] },
      ],
    });
  });

  it('sends nothing for a walked scope whose list is empty', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.changeCopies(CORUNA, [SHOP]);
    page.changeCopies(CORUNA, []);
    page.submit();
    await drain();

    expect(spawned[0]).not.toHaveProperty('scopeCopies');
  });

  it('refuses a walked scope as a target, inline and before any request', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.toggleScope(CORDOBA, ticked(true));
    page.changeCopies(CORUNA, [CORDOBA]);
    fixture.detectChanges();

    expect(page.copiesOf(CORUNA)).toEqual([]);
    expect(page.refusalOf(CORUNA)).toEqual({
      key: 'harvest.runs.start.copies.walked',
    });
    expect(text(fixture)).toContain('harvest.runs.start.copies.walked');
    expect(spawned).toEqual([]);
  });

  it('refuses a target already copied from another walked scope', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.toggleScope(CORDOBA, ticked(true));
    page.changeCopies(CORUNA, [SHOP]);
    page.changeCopies(CORDOBA, [SHOP]);
    fixture.detectChanges();

    expect(page.copiesOf(CORDOBA)).toEqual([]);
    expect(page.refusalOf(CORDOBA)).toEqual({
      key: 'harvest.runs.start.copies.alreadyCopied',
      args: { scope: '4804 — A Coruna' },
    });
    expect(text(fixture)).toContain('harvest.runs.start.copies.alreadyCopied');

    // The next accepted change clears the message.
    page.changeCopies(CORDOBA, [OTHER_SHOP]);
    expect(page.refusalOf(CORDOBA)).toBeNull();
  });

  it('holds start while a ticked scope is also a target, until one goes', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.changeCopies(CORUNA, [CORDOBA]);
    page.toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    expect(page.conflictsOf(CORUNA)).toEqual(['4661']);
    expect(page.isCopyTarget(CORDOBA)).toBe(true);
    expect(page.ready()).toBe(false);
    const start: HTMLButtonElement =
      fixture.nativeElement.querySelector('button.primary');
    expect(start.disabled).toBe(true);
    page.submit();
    expect(spawned).toEqual([]);

    page.changeCopies(CORUNA, []);
    fixture.detectChanges();
    expect(page.ready()).toBe(true);
  });

  it('drops the copies of a scope that is unticked, and says so', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.toggleScope(CORDOBA, ticked(true));
    page.changeCopies(CORUNA, [SHOP]);
    page.toggleScope(CORUNA, ticked(false));
    fixture.detectChanges();

    expect(page.copiesOf(CORUNA)).toEqual([]);
    expect(page.droppedCopies()).toEqual([CORUNA]);
    expect(text(fixture)).toContain('harvest.runs.start.copies.dropped');

    // Ticked again, the notice goes and the list is empty.
    page.toggleScope(CORUNA, ticked(true));
    expect(page.droppedCopies()).toEqual([]);
    page.toggleScope(CORUNA, ticked(false));
    page.toggleScope(CORUNA, ticked(true));
    page.submit();
    await drain();
    expect(spawned[0]).not.toHaveProperty('scopeCopies');
  });

  it('draws one list under the scope picker for a walk of one scope', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(
      fixture.nativeElement.querySelectorAll('lib-scope-copies')
    ).toHaveLength(1);
    page.changeCopies(page.singleScope, [NATIONAL]);
    expect(page.refusalOf(page.singleScope)?.key).toBe(
      'harvest.runs.start.copies.walked'
    );
    page.changeCopies(page.singleScope, [SHOP]);
    page.submit();
    await drain();

    expect(spawned[0]).toMatchObject({
      priceScopeId: NATIONAL,
      scopeCopies: [{ from: NATIONAL, to: [SHOP] }],
    });
  });

  it('forgets every copy when the chain changes', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORUNA, ticked(true));
    page.changeCopies(CORUNA, [SHOP]);
    await chain(fixture, DEZA);

    expect(page.copies().size).toBe(0);
  });
});

/** What a walk writes and which details it fetches (admin plan 0029, section 4). */
describe('the run form, what a walk writes and fetches', () => {
  it('offers all three writes and both details for a chain that has both', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.writeOptions()).toEqual([
      'PRICES_AND_AVAILABILITY',
      'PRICES',
      'AVAILABILITY',
    ]);
    expect(page.offersDetails()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.details.help');
  });

  it('sends what was chosen', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.toggleScope(CORDOBA, ticked(true));
    const radios = fixture.nativeElement.querySelectorAll(
      'input[type="radio"]'
    ) as NodeListOf<HTMLInputElement>;
    Array.from(radios)
      .find((radio) => radio.value === 'PRICES')!
      .dispatchEvent(new Event('change'));
    Array.from(radios)
      .find((radio) => radio.value === 'ALL')!
      .dispatchEvent(new Event('change'));
    page.submit();
    await drain();

    expect(spawned[0]).toMatchObject({ writes: 'PRICES', details: 'ALL' });
  });

  it('hides details for an adapter with no detail phase to skip', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'carrefour-web',
    });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.offersDetails()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.details.label');
    page.submit();
    await drain();
    expect(spawned[0]).not.toHaveProperty('details');
  });

  it('offers no prices only for an adapter that writes no price', async () => {
    const { fixture } = await render();
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.writeOptions()).toEqual(['AVAILABILITY']);
    expect(text(fixture)).not.toContain('harvest.runs.start.writes.PRICES');
  });

  it('asks nothing of a backfill or of an adapter it does not know', async () => {
    const { fixture, spawned } = await render({
      [DEZA]: 'aldi-web',
    });
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.offersWrites()).toBe(false);
    page.submit();
    await drain();
    expect(spawned[0]).not.toHaveProperty('writes');

    await chain(fixture, MERCADONA);
    page.detailBackfill.set(true);
    expect(page.offersWrites()).toBe(false);
    expect(page.offersDetails()).toBe(false);
  });
});

/**
 * A form given a saved request (admin plan 0030, section 2): the chain's
 * adapter and scopes are read first, then the fields applied, so a preset's
 * walked scopes appear ticked and its copies filled.
 */
describe('the run form, given a request to start from', () => {
  const SHOP = 'scope-store-15006';
  const GONE = 'scope-deleted';

  async function given(
    fixture: ComponentFixture<RunRequestForm>,
    value: unknown
  ) {
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    for (let round = 0; round < 5; round++) {
      await drain();
      fixture.detectChanges();
    }
  }

  it('shows the walked scopes, copies, writes and details it names', async () => {
    const { fixture, spawned } = await render({}, [
      ...SCOPES.map((scope) => scope.id),
      SHOP,
    ]);
    const form = fixture.componentInstance;

    await given(fixture, {
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORUNA, CORDOBA],
      scopeCopies: [{ from: CORUNA, to: [SHOP] }],
      writes: 'PRICES',
      details: 'ALL',
    });

    expect(form.adapterKey()).toBe('mercadona-api');
    expect(form.scopeChoices()).toEqual([
      expect.objectContaining({ id: NATIONAL, chosen: false }),
      expect.objectContaining({ id: CORDOBA, chosen: true }),
      expect.objectContaining({ id: CORUNA, chosen: true }),
    ]);
    expect(form.copiesOf(CORUNA)).toEqual([SHOP]);
    expect(form.chosenWrites()).toBe('PRICES');
    expect(form.details()).toBe('ALL');
    expect(form.missingScopes()).toEqual([]);

    // Submitted untouched, it is the request it was given.
    form.submit();
    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORUNA, CORDOBA],
      scopeCopies: [{ from: CORUNA, to: [SHOP] }],
      writes: 'PRICES',
      details: 'ALL',
    });
  });

  it('hands every change up, for saving as a preset', async () => {
    const { fixture } = await render();
    const changes: unknown[] = [];
    fixture.componentInstance.changed.subscribe((request) =>
      changes.push(request)
    );

    await given(fixture, {
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORDOBA],
    });

    expect(changes.at(-1)).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORDOBA],
      writes: 'PRICES_AND_AVAILABILITY',
      details: 'NEW',
    });
  });

  it('blocks submit on a saved scope that is gone, until it is removed', async () => {
    const { fixture, spawned } = await render();
    const form = fixture.componentInstance;

    await given(fixture, {
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeIds: [CORDOBA, GONE],
      scopeCopies: [{ from: CORDOBA, to: [GONE, NATIONAL] }],
    });

    expect(form.missingScopes()).toEqual([GONE]);
    expect(form.ready()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(GONE);
    expect(fixture.nativeElement.textContent).toContain(
      'harvest.runs.start.missingScope'
    );
    form.submit();
    expect(spawned).toEqual([]);

    form.removeMissing(GONE);
    fixture.detectChanges();

    expect(form.priceScopeIds()).toEqual([CORDOBA]);
    expect(form.copiesOf(CORDOBA)).toEqual([NATIONAL]);
    expect(form.ready()).toBe(true);
  });

  it('offers no file import where the screen says so, and no chain picker when locked', async () => {
    const { fixture } = await render();
    fixture.componentRef.setInput('offersImport', false);
    fixture.componentRef.setInput('chainLocked', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.modeOptions()).toEqual([
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
    ]);
    expect(
      fixture.nativeElement.querySelector('lib-reference-picker')
    ).toBeNull();
  });
});
