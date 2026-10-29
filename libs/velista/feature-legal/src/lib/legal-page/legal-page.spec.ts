import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeOperatorSettingsStore,
  MEMORY_OPERATOR_SETTINGS,
  provideFakeOperatorSettingsStore,
  type FakeOperatorSettingsStore,
} from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { formatCalendarDate, LegalPage } from './legal-page';

interface Options {
  readonly document?: 'privacy' | 'terms';
  readonly locale?: string;
  /** Null for a store that has not answered. */
  readonly settings?: OperatorSettings | null;
  readonly url?: string;
}

async function render(options: Options = {}): Promise<{
  root: HTMLElement;
  store: FakeOperatorSettingsStore;
  back: jest.Mock;
  harness: RouterTestingHarness;
}> {
  TestBed.resetTestingModule();
  const store = fakeOperatorSettingsStore(
    options.settings === undefined ? MEMORY_OPERATOR_SETTINGS : options.settings
  );
  const back = jest.fn().mockResolvedValue(undefined);
  const document = options.document ?? 'privacy';

  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideRouter([
        {
          path: 'en/privacy',
          component: LegalPage,
          data: { document: 'privacy' },
        },
        { path: 'en/terms', component: LegalPage, data: { document: 'terms' } },
        { path: 'es/terms', component: LegalPage, data: { document: 'terms' } },
      ]),
      provideFakeOperatorSettingsStore(store),
      { provide: PageNavigation, useValue: { back } },
      {
        provide: RokuLocaleStore,
        useValue: { locale: signal(options.locale ?? 'en') },
      },
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    options.url ?? `/${options.locale ?? 'en'}/${document}`
  );
  await settle(harness);
  return {
    root: harness.routeNativeElement as HTMLElement,
    store,
    back,
    harness,
  };
}

/** The dynamic import of the document, then a render. */
async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
  }
}

function headings(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('h2.heading')).map(
    (element) => element.textContent?.trim() ?? ''
  );
}

describe('LegalPage (velista 0172, target 5)', () => {
  it('draws the privacy policy filled with the operator values', async () => {
    const { root } = await render();

    expect(root.querySelector('lib-page-header h1')?.textContent).toContain(
      'legal.privacy.title'
    );
    expect(headings(root)[0]).toBe('Who we are');
    expect(root.textContent).toContain('Example Controller');
    expect(root.textContent).not.toMatch(/\{\{|\[\[/);
  });

  it('leaves out the section of a feature the operator turned off', async () => {
    const on = await render();
    expect(headings(on.root)).toContain('Voice');

    const off = await render({
      settings: {
        ...MEMORY_OPERATOR_SETTINGS,
        features: {
          ...MEMORY_OPERATOR_SETTINGS.features,
          transcription: false,
        },
      },
    });
    expect(headings(off.root)).not.toContain('Voice');
  });

  it('makes the contact address a mail link', async () => {
    const { root } = await render();

    const mail = root.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(mail?.getAttribute('href')).toBe('mailto:privacy@example.org');
    expect(mail?.textContent).toBe('privacy@example.org');
  });

  it('draws an operator value holding markup as text, never as markup', async () => {
    const { root } = await render({
      settings: {
        ...MEMORY_OPERATOR_SETTINGS,
        controllerName: '<b>Example</b>',
      },
    });

    expect(root.querySelector('.text b')).toBeNull();
    expect(root.textContent).toContain('<b>Example</b>');
  });

  it('links the other document by its title', async () => {
    const { root } = await render({ document: 'terms' });

    const link = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a.inline-link')
    ).find((anchor) => anchor.getAttribute('href') === '/en/privacy');
    expect(link?.textContent).toBe('legal.privacy.title');
  });

  it('draws the Spanish terms at /es/terms', async () => {
    const { root } = await render({ document: 'terms', locale: 'es' });

    expect(headings(root)[0]).toBe('Quién presta el servicio');
  });

  it('draws the date line on the terms, and none when the date is unknown', async () => {
    const dated = await render({ document: 'terms' });
    expect(dated.root.querySelector('.meta')?.textContent?.trim()).toBe(
      'legal.terms.meta'
    );

    const undated = await render({
      document: 'terms',
      settings: {
        ...MEMORY_OPERATOR_SETTINGS,
        terms: { ...MEMORY_OPERATOR_SETTINGS.terms, updatedOn: null },
      },
    });
    expect(undated.root.querySelector('.meta')).toBeNull();
  });

  it('names the terms version only when it is not the plain date', async () => {
    // The template's version is its date, so the line says the date once.
    const plain = await render({ document: 'terms' });
    expect(MEMORY_OPERATOR_SETTINGS.terms.version).toBe(
      MEMORY_OPERATOR_SETTINGS.terms.updatedOn
    );
    expect(plain.root.querySelector('.meta')?.textContent?.trim()).toBe(
      'legal.terms.meta'
    );

    // An operator's revision appends its own date, and the version says which text.
    const revised = await render({
      document: 'terms',
      settings: {
        ...MEMORY_OPERATOR_SETTINGS,
        terms: {
          ...MEMORY_OPERATOR_SETTINGS.terms,
          version: '2026-10-29+2026-11-05',
          updatedOn: '2026-11-05',
        },
      },
    });
    expect(revised.root.querySelector('.meta')?.textContent?.trim()).toBe(
      'legal.terms.metaVersion'
    );

    // The policy has no version.
    const policy = await render();
    expect(policy.root.querySelector('.meta')?.textContent?.trim()).toBe(
      'legal.privacy.meta'
    );
  });

  it('draws one sentence and no document when the operator published nothing', async () => {
    const { root } = await render({
      settings: {
        ...MEMORY_OPERATOR_SETTINGS,
        published: false,
        controllerName: null,
        contactEmail: null,
      },
    });

    expect(root.querySelector('.unpublished')?.textContent).toContain(
      'legal.privacy.unpublished'
    );
    expect(headings(root)).toEqual([]);
  });

  it('draws the spinner while the settings are on their way', async () => {
    const { root, store, harness } = await render({ settings: null });

    expect(root.querySelector('lib-spinner-icon')).not.toBeNull();
    expect(headings(root)).toEqual([]);

    store.land(MEMORY_OPERATOR_SETTINGS);
    await settle(harness);
    expect(headings(root).length).toBeGreaterThan(0);
  });

  it('draws one sentence and a retry when the read failed', async () => {
    const { root, store, harness } = await render({ settings: null });
    store.fail();
    harness.detectChanges();

    expect(root.querySelector('.failed')?.textContent).toContain(
      'legal.failed'
    );
    root.querySelector<HTMLButtonElement>('.failed button')?.click();

    expect(store.reloads()).toBe(1);
  });

  it('goes back with the front door as its fallback', async () => {
    const { root, back } = await render();

    root.querySelector<HTMLButtonElement>('lib-page-header button')?.click();

    expect(back).toHaveBeenCalledWith('/en');
  });

  it('lists the drawn sections in its contents, each with an address of its own', async () => {
    const { root } = await render();

    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('.contents-link')
    );
    expect(links.map((link) => link.textContent?.trim())).toEqual(
      headings(root)
    );
    expect(links[0].getAttribute('href')).toBe('/en/privacy#who');
  });
});

describe('formatCalendarDate', () => {
  it('draws a calendar date in the reader language, with no time zone shift', () => {
    expect(formatCalendarDate('2026-10-29', 'en')).toBe('October 29, 2026');
    expect(formatCalendarDate('2026-01-01', 'es')).toBe('1 de enero de 2026');
  });

  it('is null for no date or one it cannot read', () => {
    expect(formatCalendarDate(null, 'en')).toBeNull();
    expect(formatCalendarDate('29/10/2026', 'en')).toBeNull();
  });
});
