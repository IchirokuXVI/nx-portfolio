import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
