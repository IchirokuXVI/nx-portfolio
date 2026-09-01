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
  shoppingProfileFor,
  type FakeShoppingProfileOptions,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import type { ProfileLoad, Supermarket } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ProfilesPage, SCOPE_REQUIRED_PARAM } from './profiles-page';

const CHAINS: readonly Supermarket[] = [
  { id: 'c1', name: { en: 'Mercadona', es: 'Mercadona' } },
  { id: 'c2', name: { en: 'DIA', es: 'DIA' } },
];

interface Options extends FakeShoppingProfileOptions {
  /** Whether the catalog sent them here, which is the banner's first condition. */
  readonly sentByCatalog?: boolean;
  readonly state?: ProfileLoad;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ProfilesPage>;
  store: FakeShoppingProfileStore;
  router: { navigate: jest.Mock; navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeShoppingProfileStore({
    ...options,
    chains: options.chains ?? CHAINS,
  });
  const router = {
    navigate: jest.fn().mockResolvedValue(true),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  const queryParamMap = convertToParamMap(
    options.sentByCatalog === true ? { [SCOPE_REQUIRED_PARAM]: 'required' } : {}
  );
  const paramMap = convertToParamMap({});

  await TestBed.configureTestingModule({
    imports: [ProfilesPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      provideFakeShoppingProfileStore(store),
      { provide: Router, useValue: router },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: { paramMap, queryParamMap, parent: null, data: {} },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProfilesPage);
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();

  return { fixture, store, router };
}

function text(fixture: ComponentFixture<ProfilesPage>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function query<T extends HTMLElement>(
  fixture: ComponentFixture<ProfilesPage>,
  selector: string
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
}

function queryAll<T extends HTMLElement>(
  fixture: ComponentFixture<ProfilesPage>,
  selector: string
): T[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector)
  );
}

describe('ProfilesPage', () => {
  it('reads the profiles as soon as it is created', async () => {
    const { store } = await render();

    expect(store.calls.some((call) => call.method === 'load')).toBe(true);
  });

  describe('the first visit', () => {
    it('shows the one profile the server already made, by its localized default', async () => {
      // The list is never empty: the first read creates the default profile with a
      // null name, and the page is what turns null into a word (section 3.1).
      const { fixture } = await render();

      expect(text(fixture)).toContain('profiles.defaultName');
    });

    it('draws no trash at all, because the last profile cannot be deleted', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.destructive')).toBeNull();
    });

    it('does not open the selector, there being nothing to switch to', async () => {
      const { fixture } = await render();

      const current = query<HTMLButtonElement>(fixture, '.current');
      expect(current?.disabled).toBe(true);

      current?.click();
      fixture.detectChanges();

      expect(queryAll(fixture, '.option')).toHaveLength(0);
    });
  });

  describe('the selector', () => {
    it('opens with several profiles and swaps what is below', async () => {
      const { fixture, store } = await render({
        profiles: [
          shoppingProfileFor({ id: 'a', name: 'Home', isDefault: true }),
          shoppingProfileFor({
            id: 'b',
            name: 'The office',
            isDefault: false,
            addressText: 'Calle Mayor 12',
          }),
        ],
      });

      query<HTMLButtonElement>(fixture, '.current')?.click();
      fixture.detectChanges();

      const options = queryAll<HTMLButtonElement>(fixture, '.option');
      expect(options).toHaveLength(2);

      options[1].click();
      fixture.detectChanges();

      expect(store.selected()?.id).toBe('b');
      expect(query<HTMLInputElement>(fixture, '#profiles-address')?.value).toBe(
        'Calle Mayor 12'
      );
    });

    it('offers a trash once there is more than one profile', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({ id: 'a', isDefault: true }),
          shoppingProfileFor({ id: 'b', isDefault: false }),
        ],
      });

      expect(query(fixture, '.destructive')).not.toBeNull();
    });

    it('keeps the full name as the accessible name however long it is (R1)', async () => {
      const long = 'The flat in Valencia where we spend every single August';
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({ id: 'a', name: long, isDefault: true }),
          shoppingProfileFor({ id: 'b', name: 'Home', isDefault: false }),
        ],
      });

      // The drawing truncates in CSS; the name a screen reader is handed does not.
      expect(
        query<HTMLButtonElement>(fixture, '.current')?.getAttribute(
          'aria-label'
        )
      ).toBe(long);
    });

    it('announces itself as a listbox trigger', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({ id: 'a', isDefault: true }),
          shoppingProfileFor({ id: 'b', isDefault: false }),
        ],
      });

      expect(
        query<HTMLButtonElement>(fixture, '.current')?.getAttribute(
          'aria-haspopup'
        )
      ).toBe('listbox');
    });
  });

  describe('adding', () => {
    it('creates a profile at once, selects it and asks for no name first', async () => {
      const { fixture, store } = await render();

      queryAll<HTMLButtonElement>(fixture, '.action')[0].click();
      await Promise.resolve();
      fixture.detectChanges();

      expect(store.calls.some((call) => call.method === 'create')).toBe(true);
      expect(store.profiles()).toHaveLength(2);
      expect(store.selected()?.name).toBeNull();
    });
  });

  describe('the fields', () => {
    it('saves the name on blur, and sends null for an emptied one', async () => {
      const { fixture, store } = await render({
        profiles: [shoppingProfileFor({ id: 'a', name: 'Home' })],
      });

      const field = query<HTMLInputElement>(fixture, '#profiles-name');
      if (field === null) {
        throw new Error('no name field');
      }

      field.value = '   ';
      field.dispatchEvent(new Event('blur'));
      await Promise.resolve();

      const saved = store.calls.find((call) => call.method === 'save');
      expect(saved).toEqual(
        expect.objectContaining({ field: 'name', body: { name: null } })
      );
    });

    it('sends the threshold in cents', async () => {
      const { fixture, store } = await render({
        profiles: [shoppingProfileFor({ id: 'a', minSavingCents: 0 })],
      });

      const field = query<HTMLInputElement>(fixture, '#profiles-threshold');
      if (field === null) {
        throw new Error('no threshold field');
      }

      field.value = '2';
      field.dispatchEvent(new Event('blur'));
      await Promise.resolve();

      expect(store.calls.find((call) => call.method === 'save')).toEqual(
        expect.objectContaining({
          field: 'minSavingCents',
          body: { minSavingCents: 200 },
        })
      );
    });

    it('leaves the threshold alone when the field says nothing readable', async () => {
      // A field somebody has half typed into is not a decision that a second stop
      // must save nothing.
      const { fixture, store } = await render();

      const field = query<HTMLInputElement>(fixture, '#profiles-threshold');
      if (field === null) {
        throw new Error('no threshold field');
      }

      field.value = 'abc';
      field.dispatchEvent(new Event('blur'));
      await Promise.resolve();

      expect(store.calls.some((call) => call.method === 'save')).toBe(false);
    });

    it('draws the failed treatment on the control that failed', async () => {
      const { fixture, store } = await render({
        profiles: [shoppingProfileFor({ id: 'a', name: 'Home' })],
        failing: ['name'],
      });

      const field = query<HTMLInputElement>(fixture, '#profiles-name');
      if (field === null) {
        throw new Error('no name field');
      }

      field.value = 'Elsewhere';
      field.dispatchEvent(new Event('blur'));
      await Promise.resolve();
      fixture.detectChanges();

      expect(store.saveState('a', 'name')).toBe('failed');
      expect(query(fixture, '.field-error')?.textContent).toContain(
        'profiles.error.save'
      );
    });
  });

  describe('postal codes', () => {
    it('adds one, sending the whole list because the wire replaces it', async () => {
      const { fixture, store } = await render();

      query<HTMLButtonElement>(fixture, '.add')?.click();
      fixture.detectChanges();

      const field = query<HTMLInputElement>(fixture, '#profiles-postal-code');
      if (field === null) {
        throw new Error('no postal code field');
      }
      field.value = '14013';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      query<HTMLFormElement>(fixture, '.form')?.dispatchEvent(
        new Event('submit')
      );
      await Promise.resolve();

      expect(store.calls.find((call) => call.method === 'save')).toEqual(
        expect.objectContaining({
          field: 'postalCodes',
          body: { postalCodes: [{ postalCode: '14013', label: null }] },
        })
      );
    });

    it('keeps an uncovered code and explains it in words', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              { id: 'pc1', postalCode: '05631', label: null, position: 0 },
            ],
          }),
        ],
        unserved: ['05631'],
      });

      expect(queryAll(fixture, '.chip')).toHaveLength(1);
      expect(query(fixture, '.flags')?.textContent).toContain(
        'profiles.postal.uncovered'
      );
    });

    it('announces the flag rather than only drawing it', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              { id: 'pc1', postalCode: '05631', label: null, position: 0 },
            ],
          }),
        ],
        unserved: ['05631'],
      });

      const region = query(fixture, '.flags');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(region?.getAttribute('role')).toBe('status');
    });
  });

  describe('supermarkets', () => {
    it('draws every chain in the catalog, not only the ones with a preference', async () => {
      const { fixture } = await render();

      expect(queryAll(fixture, '.row')).toHaveLength(CHAINS.length);
    });

    it('leaves an excluded chain visible, struck through, and says the word', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            chains: [{ id: 'x', supermarketId: 'c2', excluded: true }],
          }),
        ],
      });

      const rows = queryAll(fixture, '.row');
      expect(rows).toHaveLength(2);
      expect(rows[1].classList.contains('excluded')).toBe(true);
      expect(rows[1].textContent).toContain('profiles.chains.excluded');
    });

    it('un-excludes by dropping the row rather than by flipping it back', async () => {
      // An included chain and a chain nobody has an opinion about are the same thing
      // to the resolver, so the undone decision leaves no trace.
      const { fixture, store } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            chains: [{ id: 'x', supermarketId: 'c2', excluded: true }],
          }),
        ],
      });

      queryAll<HTMLInputElement>(fixture, '.checkbox')[1].click();
      await Promise.resolve();

      expect(store.calls.find((call) => call.method === 'save')).toEqual(
        expect.objectContaining({
          field: 'chains',
          body: { supermarkets: [] },
        })
      );
    });
  });

  describe('the scope banner', () => {
    it('is drawn for somebody the catalog sent here with nothing on their profile', async () => {
      const { fixture } = await render({ sentByCatalog: true });

      expect(query(fixture, '.banner')?.textContent).toContain(
        'profiles.scope.banner'
      );
    });

    it('is not drawn for somebody who simply opened the page', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.banner')).toBeNull();
    });

    it('clears once either field is filled in', async () => {
      const { fixture } = await render({
        sentByCatalog: true,
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              { id: 'pc1', postalCode: '14013', label: null, position: 0 },
            ],
          }),
        ],
      });

      expect(query(fixture, '.banner')).toBeNull();
    });

    it('stays for a profile holding only exclusions', async () => {
      // "not DIA" is not a place, which is the server's own rule.
      const { fixture } = await render({
        sentByCatalog: true,
        profiles: [
          shoppingProfileFor({
            id: 'a',
            chains: [{ id: 'x', supermarketId: 'c2', excluded: true }],
          }),
        ],
      });

      expect(query(fixture, '.banner')).not.toBeNull();
    });
  });

  describe('loading and failing', () => {
    it('skeletons the form rather than spinning', async () => {
      const { fixture } = await render({ state: 'loading' });

      expect(query(fixture, '.skeleton')).not.toBeNull();
      expect(query(fixture, '#profiles-name')).toBeNull();
    });

    it('offers a retry on a failed read', async () => {
      const { fixture, store } = await render({ state: 'failed' });
      const before = store.calls.filter(
        (call) => call.method === 'load'
      ).length;

      query<HTMLButtonElement>(fixture, '.quiet')?.click();

      expect(
        store.calls.filter((call) => call.method === 'load').length
      ).toBeGreaterThan(before);
    });
  });

  describe('deleting', () => {
    it('opens the confirm rather than destroying on one tap', async () => {
      const { fixture, router } = await render({
        profiles: [
          shoppingProfileFor({ id: 'a', isDefault: true }),
          shoppingProfileFor({ id: 'b', isDefault: false }),
        ],
      });

      query<HTMLButtonElement>(fixture, '.destructive')?.click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['sheet', 'confirm', 'delete'],
        expect.anything()
      );
    });
  });
});
