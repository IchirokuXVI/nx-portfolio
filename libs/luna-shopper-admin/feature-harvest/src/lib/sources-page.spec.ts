import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChainNames } from './chain-names';
import {
  applyControlBase,
  controlBaseProperties,
  controlBaseRule,
} from './control-base.testing';
import { SourcesPage } from './sources-page';

/**
 * The chain sources screen (admin plan 0006, section 8; plan 0018, sections 2
 * and 3).
 *
 * Two of the three things plan 0018 is about meet on this screen, and both were
 * invisible to a spec until this file existed. Its twelve keys were never
 * written, so every label on it drew its own key name; and it carries no control
 * styles of its own, so its `<select>` and its inputs were whatever the browser
 * drew next to a 44 pixel picker on the screen beside it.
 *
 * **The translator here resolves against the real catalogue**, unlike everywhere
 * else in this app's specs. The standard testing double answers every key with
 * the key, which is the right default for asserting *which* string a template
 * asked for, and is exactly why a screen with no strings at all looked fine in a
 * test and drew `harvest.sources.heading` in a browser.
 */

const CATALOGUE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'ui', 'assets', 'i18n', 'en.json'),
    'utf8'
  )
) as Record<string, unknown>;

const MERCADONA = '11111111-1111-4111-8111-111111111111';

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/**
 * The real strings, and the key itself when there is no string, which is what
 * i18next answers with and therefore what an operator reads.
 */
function catalogueTranslator(): RokuTranslatorService {
  const t = (key: string): string => {
    let at: unknown = CATALOGUE;

    for (const segment of key.split('.')) {
      if (typeof at !== 'object' || at === null) {
        return key;
      }

      at = (at as Record<string, unknown>)[segment];
    }

    return typeof at === 'string' ? at : key;
  };

  // The three members the pipe reads, and no more. The real service is not
  // subclassed because its constructor wants a translator that has loaded
  // something, and what is under test here is the catalogue, not the loader.
  return {
    t,
    locale: signal('en'),
    loaded: signal(true),
  } as unknown as RokuTranslatorService;
}

async function render() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SourcesPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: new HarvestMemory() },
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
      // The page asks this for the chain's name and shows the id where the
      // answer is null, so one resolvable chain is enough to prove the wiring.
      {
        provide: ChainNames,
        useValue: {
          nameOf: (id: string) => (id === MERCADONA ? 'Mercadona' : id),
          resolve: async () => undefined,
        },
      },
      // After the testing module, so this one wins.
      { provide: RokuTranslatorService, useValue: catalogueTranslator() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SourcesPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return fixture as ComponentFixture<SourcesPage>;
}

const text = (fixture: ComponentFixture<SourcesPage>): string =>
  fixture.nativeElement.textContent;

describe('the chain sources screen, in English', () => {
  /**
   * The assertion that would have caught it. A key on the screen is a key in the
   * text, and there is no other way this screen can be wrong about its strings.
   */
  it('draws its heading and its lead as text, not as key names', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('Chain sources');
    expect(text(fixture)).not.toContain('harvest.sources.');
  });

  it('names the two settings that decide how hard a chain is fetched', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('Workers');
    expect(text(fixture)).toContain('Requests per second');
    expect(text(fixture)).not.toContain('harvest.');
  });

  it('says whether a chain may be fetched, in words', async () => {
    const fixture = await render();

    // Mercadona is seeded on and DEZA off, so both labels are on the screen.
    expect(text(fixture)).toContain('Enabled');
    expect(text(fixture)).toContain('Disabled');
  });

  /**
   * The second switch, and the one that writes to the catalog (backend plan
   * 0107, section 3.1).
   *
   * It carries a sentence rather than a bare label because it is the only
   * control in the harvester that lets a third party's data into the catalog
   * with nobody looking first, and "Trusted" on its own says none of that.
   */
  it('says whether a chain is trusted, and what trusting it means', async () => {
    const fixture = await render();

    // Every seeded chain is untrusted, which is what a row says until somebody
    // decides otherwise.
    expect(text(fixture)).toContain('Not trusted');
    expect(text(fixture)).toContain('go straight into the catalog');
    expect(text(fixture)).toContain('still waits in the places queue');
  });

  it('turns the trust switch on without touching the fetching settings', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;
    const before = page
      .sources()
      .filter((source) => source.supermarketId === MERCADONA)[0];

    await page.toggleTrust(before);
    fixture.detectChanges();

    const after = page
      .sources()
      .filter((source) => source.supermarketId === MERCADONA)[0];
    expect(after.autoImportPlaces).toBe(true);
    // The row's own values went back, not the edit form's: the form may be
    // closed, or open on another chain.
    expect(after.adapterKey).toBe(before.adapterKey);
    expect(after.workers).toBe(before.workers);
    expect(after.maxRequestsPerSecond).toBe(before.maxRequestsPerSecond);
    expect(after.config).toEqual(before.config);
    // And fetching is a different decision, so it did not move either.
    expect(after.enabled).toBe(before.enabled);
  });

  /**
   * The row is per chain and the chain's name belongs to catalog, so the page
   * resolves it through {@link ChainNames} and a uuid on the screen means the
   * lookup was never asked. A chain the lookup cannot name still shows its id,
   * which is what the seeded rows this double does not know keep doing.
   */
  it('names the chain rather than printing its id', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('Mercadona');
    expect(text(fixture)).not.toContain(MERCADONA);
  });
});

describe('the chain sources screen, creating a row', () => {
  const NEW_CHAIN = '99999999-9999-4999-8999-999999999999';

  it('offers a create button, and the button opens the panel', async () => {
    const fixture = await render();

    const open: HTMLButtonElement =
      fixture.nativeElement.querySelector('button.new');
    expect(open).not.toBeNull();
    expect(open.textContent).toContain('Add a chain source');

    open.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('lib-reference-picker')
    ).not.toBeNull();
    expect(text(fixture)).toContain('Create the source');
  });

  it('creates the row for the chosen chain and puts it first, disabled', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.startCreate();
    page.newChainId.set(NEW_CHAIN);
    await page.create();
    await drain();
    fixture.detectChanges();

    const [first] = page.sources();
    expect(first.supermarketId).toBe(NEW_CHAIN);
    // Created disabled, by the backend and on purpose: describing a chain and
    // starting to fetch it are two decisions.
    expect(first.enabled).toBe(false);
    expect(page.creating()).toBe(false);
  });

  /**
   * The backend route is an upsert, so a "create" for a chain that already has
   * a row would silently rewrite it. The panel refuses instead: the button is
   * disabled, the sentence says why, and calling through anyway writes nothing.
   */
  it('refuses a chain that already has a row', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;
    const before = page.sources();

    page.startCreate();
    page.newChainId.set(MERCADONA);
    fixture.detectChanges();

    expect(text(fixture)).toContain('already has a source row');
    const create: HTMLButtonElement =
      fixture.nativeElement.querySelector('.controls .primary');
    expect(create.disabled).toBe(true);

    await page.create();
    expect(page.sources()).toEqual(before);
  });
});

/**
 * The adapter picker, against the document rather than against a second list.
 *
 * The screen used to carry its own array of four adapter keys, and it fell
 * behind twice without anything going red: `lidl-api` (backend plan 0089) and
 * `carrefour-web` (backend plan 0090) reached the contract, the gateway and the
 * generated types while the picker still offered `mercadona-api`, `deza-web`,
 * `osm-places` and `manual`. Both chains shipped with a runner an operator could
 * not describe a source for, because the only screen that writes `adapterKey`
 * would not offer the value.
 *
 * So the expectation is read out of `wire-types.ts`, which is generated from the
 * gateway's OpenAPI document and is the admin's own account of what the route
 * accepts. A seventh adapter fails this file on the commit that generates it,
 * rather than on the day somebody looks for it in the dropdown.
 */
describe('the chain sources screen, and the adapters it offers', () => {
  const WIRE_TYPES = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'models',
      'src',
      'lib',
      'wire',
      'wire-types.ts'
    ),
    'utf8'
  );

  /** Every member of the generated `EnumsAdapterKey` union, in its own order. */
  const declared = (): readonly string[] => {
    const union = /export type EnumsAdapterKey =([^;]+);/.exec(WIRE_TYPES);
    if (union === null) {
      throw new Error('wire-types.ts declares no EnumsAdapterKey union');
    }

    return [...union[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  };

  const options = (fixture: ComponentFixture<SourcesPage>): readonly string[] =>
    [
      ...(fixture.nativeElement.querySelectorAll(
        'select[name="adapterKey"] option'
      ) as NodeListOf<HTMLOptionElement>),
    ].map((option) => option.value);

  it('reads a union of more than the four the screen used to name', () => {
    // A guard on the guard: a regex that matched nothing useful would make the
    // two tests below pass against an empty list.
    expect(declared()).toContain('lidl-api');
    expect(declared()).toContain('carrefour-web');
    expect(declared().length).toBeGreaterThan(4);
  });

  it('offers every adapter the document declares, when creating a row', async () => {
    const fixture = await render();

    fixture.componentInstance.startCreate();
    fixture.detectChanges();

    expect([...options(fixture)].sort()).toEqual([...declared()].sort());
  });

  it('offers every one of them when editing a row too', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.edit(
      page.sources().filter((source) => source.supermarketId === MERCADONA)[0]
    );
    fixture.detectChanges();

    expect([...options(fixture)].sort()).toEqual([...declared()].sort());
  });
});

describe('the chain sources screen, and its controls', () => {
  let remove: () => void;

  beforeEach(() => {
    remove = applyControlBase();
  });

  afterEach(() => remove());

  /**
   * The screen writes no control styles at all, which is the point: it gets them
   * from the app's stylesheet, and this is the test that the stylesheet is where
   * they come from. `min-block-size` is the declaration that survives the trip,
   * so it is the one that proves the rule reached the element: it carries a
   * literal, unlike the five that carry a token, and it is not a longhand behind
   * a shorthand, unlike `font-size`.
   */
  it('draws a select an operator can hit, at the size the pickers are', async () => {
    const fixture = await render();

    fixture.componentInstance.edit(
      fixture.componentInstance
        .sources()
        .filter((source) => source.supermarketId === MERCADONA)[0]
    );
    fixture.detectChanges();

    const select: HTMLSelectElement =
      fixture.nativeElement.querySelector('select');
    expect(select).not.toBeNull();
    expect(getComputedStyle(select).getPropertyValue('min-block-size')).toBe(
      '2.75rem'
    );
  });

  it('draws its buttons from the same rule', async () => {
    const fixture = await render();
    // The edit button and not the toggle, which sets a width of its own and
    // would answer this whether or not the base ever reached it.
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button:not(.toggle)'
    );

    expect(button).not.toBeNull();
    expect(getComputedStyle(button).getPropertyValue('min-block-size')).toBe(
      '2.75rem'
    );
  });

  /**
   * The other seven, read out of the file rather than off the element.
   *
   * Five carry a token and jsdom leaves a `var()` unresolved. `font-size` is the
   * sixth, and it is worse than unresolved: jsdom lets the `font` shorthand
   * before it win, so a computed style says `medium` for a rule a browser reads
   * as `1rem`. Asserting the order is the honest version of that check, and the
   * order is the whole point of the pair: `font: inherit` takes the app's face,
   * then `font-size` puts it back at 1rem so iOS Safari does not zoom the
   * viewport on focus.
   */
  it('takes the whole base, not the one a spec can measure', () => {
    expect(controlBaseProperties()).toEqual([
      'min-block-size',
      'padding',
      'border',
      'border-radius',
      'background',
      'font',
      'font-size',
      'color',
    ]);

    expect(controlBaseRule().body).toContain('font-size: 1rem');
  });

  /**
   * The measurements above are worth having only if the screen has nothing of
   * its own to answer them with, which is the state the plan put it in: the
   * height of every control here comes from a file this component does not
   * mention.
   */
  it('measures nothing at all without the rule', async () => {
    remove();

    const fixture = await render();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button:not(.toggle)'
    );

    expect(getComputedStyle(button).getPropertyValue('min-block-size')).toBe(
      ''
    );
  });
});

/**
 * The two things a row could not do: change every one of its settings, and stop
 * existing.
 *
 * The screen could already change the adapter, the workers and the rate. What
 * it could not touch was `config`, where an adapter's own settings live, and
 * there was no way at all to take a row back: the row is keyed on the chain, so
 * a source described against the wrong chain cannot be moved and the upsert
 * would only write a second row beside it.
 */
describe('the chain sources screen, editing and deleting a row', () => {
  const row = (fixture: ComponentFixture<SourcesPage>) =>
    fixture.componentInstance
      .sources()
      .filter((source) => source.supermarketId === MERCADONA)[0];

  it('opens the settings of the row being edited, as readable JSON', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.edit(row(fixture));
    fixture.detectChanges();

    expect(page.configText()).toBe(
      JSON.stringify(row(fixture).config, null, 2)
    );
    expect(
      fixture.nativeElement.querySelector('textarea[name="config"]')
    ).not.toBeNull();
  });

  it('saves the settings that were typed', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.edit(row(fixture));
    page.configText.set('{ "warehouse": "4661" }');
    await page.save(row(fixture));
    await drain();
    fixture.detectChanges();

    expect(row(fixture).config).toEqual({ warehouse: '4661' });
    expect(page.editing()).toBeNull();
  });

  it('refuses settings that are not a JSON object and saves nothing', async () => {
    // The column is read when a run starts, so a broken value would be found by
    // a crawl rather than by the person who typed it.
    const fixture = await render();
    const page = fixture.componentInstance;
    const before = row(fixture).config;

    page.edit(row(fixture));
    page.configText.set('{ warehouse: 4661');
    await page.save(row(fixture));
    await drain();
    fixture.detectChanges();

    expect(page.formErrorKey()).toBe('harvest.sources.config.invalid');
    expect(row(fixture).config).toEqual(before);
    // Still open, because the operator has something to fix in it.
    expect(page.editing()).toBe(MERCADONA);
    expect(text(fixture)).toContain('That is not a JSON object');
  });

  it('reads an empty box as no settings at all', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.edit(row(fixture));
    page.configText.set('   ');
    await page.save(row(fixture));
    await drain();
    fixture.detectChanges();

    expect(row(fixture).config).toEqual({});
    expect(page.formErrorKey()).toBeNull();
  });

  it('asks before it deletes, and names the chain in the question', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;

    page.askDelete(row(fixture));
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('lib-confirm-dialog')
    ).not.toBeNull();
    expect(text(fixture)).toContain("Delete this chain's source?");
    expect(text(fixture)).toContain('will have no source row');
    // The name itself is an interpolation, and the translator this file builds
    // answers keys rather than filling arguments, so what is asserted here is
    // that the row being asked about is the one that was clicked.
    expect(page.pendingDelete()?.supermarketId).toBe(MERCADONA);
  });

  it('takes the row away once the question is answered', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;
    const target = row(fixture);

    page.askDelete(target);
    await page.confirmDelete(target);
    await drain();
    fixture.detectChanges();

    expect(
      page.sources().some((source) => source.supermarketId === MERCADONA)
    ).toBe(false);
    expect(page.pendingDelete()).toBeNull();
  });

  it('keeps the row and the question when the delete is refused', async () => {
    // The backend refuses while a run of that chain is in flight. A dialog that
    // closed on a refusal would read as a delete that worked.
    const fixture = await render();
    const page = fixture.componentInstance;
    const target = row(fixture);
    jest
      .spyOn(TestBed.inject(HARVEST_SERVICE), 'deleteSource')
      .mockRejectedValue({ status: 409, error: { code: 'conflict' } });

    page.askDelete(target);
    await page.confirmDelete(target);
    await drain();
    fixture.detectChanges();

    expect(
      page.sources().some((source) => source.supermarketId === MERCADONA)
    ).toBe(true);
    expect(page.pendingDelete()).not.toBeNull();
    expect(page.errorKey()).toBe('resource.error.conflict');
  });
});
