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
  it('draws its columns as text, not as key names', async () => {
    const fixture = await render();

    // The Setup page above this part draws the header and names the part, so
    // what this screen says first is its own columns (admin plan 0044).
    expect(text(fixture)).toContain('Fetched as');
    expect(text(fixture)).toContain('Last good run');
    expect(text(fixture)).not.toContain('harvest.sources.');
    expect(fixture.nativeElement.querySelector('lib-page-header')).toBeNull();
  });

  it('names the two settings that decide how hard a chain is fetched', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain('Workers');
    expect(text(fixture)).toContain('Requests a second');
    expect(text(fixture)).not.toContain('harvest.');
  });

  const switches = (
    fixture: ComponentFixture<SourcesPage>,
    name: 'enabled' | 'trusted'
  ): HTMLButtonElement[] => [
    ...(fixture.nativeElement.querySelectorAll(
      `button.toggle[role="switch"][data-switch="${name}"]`
    ) as NodeListOf<HTMLButtonElement>),
  ];

  /**
   * A switch says its state as `aria-checked`, so that color and the place of
   * the knob are not the only signs, and it is named after its chain.
   */
  it('says whether a chain may be fetched, as the state of a switch', async () => {
    const fixture = await render();
    const sources = fixture.componentInstance.sources();

    expect(text(fixture)).toContain('May be fetched');
    // One switch per row, each saying what its row says. The seed holds a
    // chain that is on and one that is off, so both states are on the screen.
    expect(
      switches(fixture, 'enabled').map((button) =>
        button.getAttribute('aria-checked')
      )
    ).toEqual(sources.map((source) => String(source.enabled)));
    expect(sources.some((source) => source.enabled)).toBe(true);
    expect(sources.some((source) => !source.enabled)).toBe(true);
    for (const button of switches(fixture, 'enabled')) {
      expect(button.getAttribute('aria-label')).toContain('may be fetched');
    }
  });

  it('turns a chain on and off from its switch', async () => {
    const fixture = await render();
    const before = fixture.componentInstance.sources()[0];

    switches(fixture, 'enabled')[0].click();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.sources()[0].enabled).toBe(
      !before.enabled
    );
    expect(switches(fixture, 'enabled')[0].getAttribute('aria-checked')).toBe(
      String(!before.enabled)
    );
  });

  /**
   * The second switch, and the one that writes to the catalog (backend plan
   * 0107, section 3.1).
   *
   * What trusting a chain means is behind the column's info button and no
   * longer a sentence on every row (admin plan 0044, target 6). It is the only
   * control in the harvester that lets a third party's data into the catalog
   * with nobody looking first, and the panel's last point says so.
   */
  it('says whether a chain is trusted, and what trusting it means', async () => {
    const fixture = await render();
    const translate = TestBed.inject(RokuTranslatorService);
    const info = fixture.componentInstance.trustedInfo;

    // Every seeded chain is untrusted, which is what a row says until somebody
    // decides otherwise.
    expect(
      switches(fixture, 'trusted').map((button) =>
        button.getAttribute('aria-checked')
      )
    ).toEqual(fixture.componentInstance.sources().map(() => 'false'));

    const points = info.points.map((key) => translate.t(key));
    expect(translate.t(info.title)).toBe('Trusted');
    expect(points.join(' ')).toContain('with nobody looking first');
    expect(points.join(' ')).toContain('still waits in the Places queue');
    expect(points.join(' ')).toContain('without a review');
  });

  /** Target 6: each of the two switch columns has its own info button. */
  it('gives each switch column an info button of its own', async () => {
    const fixture = await render();
    const translate = TestBed.inject(RokuTranslatorService);
    const page = fixture.componentInstance;

    expect(
      fixture.nativeElement.querySelectorAll('.head-info lib-info-button')
        .length
    ).toBe(2);
    for (const info of [page.enabledInfo, page.trustedInfo]) {
      for (const key of [info.title, ...info.points]) {
        // A key the catalogue does not hold comes back as itself.
        expect(translate.t(key)).not.toBe(key);
      }
    }
    expect(translate.t(page.enabledInfo.title)).toBe('May be fetched');
  });

  /**
   * A row opens the record page of its source, and "Change" opens it with
   * its form (admin plan 0059). This page holds no form of its own.
   */
  it('links each row to its record, and "Change" to the form of it', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    const open = host.querySelector<HTMLAnchorElement>('[data-open]');
    expect(open?.getAttribute('href')).toBe(`/${MERCADONA}`);

    const change = host.querySelector<HTMLAnchorElement>('[data-change]');
    expect(change?.textContent).toContain('Change');
    expect(change?.getAttribute('href')).toBe(`/${MERCADONA}?edit=1`);

    expect(host.querySelector('select, textarea, lib-caution-line')).toBeNull();
    expect(host.querySelector('.danger')).toBeNull();
  });

  it('links to the page that adds a source', async () => {
    const fixture = await render();
    const add: HTMLAnchorElement =
      fixture.nativeElement.querySelector('[data-add]');

    expect(add.textContent).toContain('Add a source');
    expect(add.getAttribute('href')).toBe('/new');
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

  it('says OpenStreetMap is always asked, as a line and not a row', async () => {
    const fixture = await render();

    expect(text(fixture)).toContain(
      'OpenStreetMap is always asked for every postal code'
    );
    expect(fixture.nativeElement.querySelector('.always button')).toBeNull();
    // One line under the list, and never a row of it.
    const always: HTMLElement = fixture.nativeElement.querySelector('.always');
    const table: HTMLElement = fixture.nativeElement.querySelector('.table');
    expect(table.contains(always)).toBe(false);
    expect(
      table.compareDocumentPosition(always) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
