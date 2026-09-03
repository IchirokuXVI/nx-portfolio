import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeShoppingProfileStore,
  profilePostalCodeFor,
  provideFakeShoppingProfileStore,
  shoppingProfileFor,
  type FakeShoppingProfileOptions,
  type FakeShoppingProfileStore,
} from '@portfolio/velista/data-access';
import type { ProfileLoad, Supermarket } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ProfilesPage, SCOPE_REQUIRED_PARAM } from './profiles-page';

/**
 * Every field this page has a control for, and therefore the whole of what a save from
 * it may name (plan 0049, section 7).
 *
 * A closed set rather than a list of forbidden names, so a field added to
 * `WriteShoppingProfileRequest` later is refused here until somebody adds the control
 * that edits it. That is the direction that keeps the guarantee: the hazard is a body
 * carrying something nothing on screen decided.
 */
const EDITED_FIELDS = new Set(['name', 'minSavingCents', 'supermarkets']);

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
            postalCodes: [profilePostalCodeFor({ postalCode: '14004' })],
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
      // The chips below follow the selector: the address field that used to prove this
      // is gone (plan 0058, section 2), and the codes are what the screen is about.
      expect(
        queryAll<HTMLElement>(fixture, '.code').map((chip) =>
          chip.textContent?.trim()
        )
      ).toEqual(['14004']);
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
    /** Open the add form and submit one code, optionally ticking the nearby box. */
    async function addCode(
      fixture: ComponentFixture<ProfilesPage>,
      postalCode: string,
      alsoNearby = false
    ): Promise<void> {
      queryAll<HTMLButtonElement>(fixture, '.add')[0].click();
      fixture.detectChanges();

      const field = query<HTMLInputElement>(fixture, '#profiles-postal-code');
      if (field === null) {
        throw new Error('no postal code field');
      }
      field.value = postalCode;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      if (alsoNearby) {
        const box = query<HTMLInputElement>(fixture, '.nearby input');
        if (box === null) {
          throw new Error('no nearby checkbox');
        }
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        fixture.detectChanges();
      }

      query<HTMLFormElement>(fixture, '.form')?.dispatchEvent(
        new Event('submit')
      );
      await Promise.resolve();
      fixture.detectChanges();
    }

    it('adds one row rather than sending the whole list', async () => {
      // The replacement collection is gone: a profile's codes are no longer all the
      // user's, and echoing the list back would promote every derived row to theirs.
      const { fixture, store } = await render();

      await addCode(fixture, '14013');

      expect(
        store.calls.find((call) => call.method === 'addPostalCode')
      ).toEqual({
        method: 'addPostalCode',
        profileId: 'sp1',
        body: { postalCode: '14013', label: null, expandNearby: false },
      });
    });

    it('leaves the nearby box off for a typed code', async () => {
      // Somebody typing one specific code has usually named the place they mean
      // (plan 0058, section 5). The sheet's copy of this control starts on instead.
      const { fixture } = await render();

      queryAll<HTMLButtonElement>(fixture, '.add')[0].click();
      fixture.detectChanges();

      expect(query<HTMLInputElement>(fixture, '.nearby input')?.checked).toBe(
        false
      );
    });

    it('sends the nearby request when the box is ticked', async () => {
      const { fixture, store } = await render();

      await addCode(fixture, '14001', true);

      expect(
        store.calls.find((call) => call.method === 'addPostalCode')
      ).toMatchObject({ body: { expandNearby: true } });
    });

    it('says how many nearby codes arrived rather than letting the list grow silently', async () => {
      const { fixture } = await render({ nearby: { '14001': ['14002'] } });

      await addCode(fixture, '14001', true);

      expect(query(fixture, '.flags')?.textContent).toContain(
        'profiles.postal.nearbyAdded'
      );
    });

    it('says nothing when an add brought nothing with it', async () => {
      const { fixture } = await render();

      await addCode(fixture, '14001');

      expect(query(fixture, '.flags')?.textContent).not.toContain(
        'profiles.postal.nearbyAdded'
      );
    });

    it('removes by the code, because that is what the route takes', async () => {
      const { fixture, store } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [profilePostalCodeFor({ postalCode: '14013' })],
          }),
        ],
      });

      query<HTMLButtonElement>(fixture, '.remove')?.click();
      await Promise.resolve();

      expect(
        store.calls.find((call) => call.method === 'removePostalCode')
      ).toEqual({
        method: 'removePostalCode',
        profileId: 'a',
        postalCode: '14013',
      });
    });

    it('marks a derived code as ours and removes it like any other', async () => {
      // A derived row carries the same remove control at the same weight: two chips
      // that look alike must not behave differently (plan 0058, section 7).
      const { fixture, store } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              profilePostalCodeFor({ id: 'pc1', postalCode: '14002' }),
              profilePostalCodeFor({
                id: 'pc2',
                postalCode: '14003',
                position: 1,
                source: 'NEARBY',
              }),
            ],
          }),
        ],
      });

      const chips = queryAll<HTMLElement>(fixture, '.chip');
      expect(chips[0].classList.contains('derived')).toBe(false);
      expect(chips[1].classList.contains('derived')).toBe(true);
      expect(chips[1].textContent).toContain('profiles.postal.nearbySource');

      queryAll<HTMLButtonElement>(fixture, '.remove')[1].click();
      await Promise.resolve();

      expect(
        store.calls.find((call) => call.method === 'removePostalCode')
      ).toMatchObject({ postalCode: '14003' });
    });

    it('shows the code itself when a row has no label', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              profilePostalCodeFor({ postalCode: '14013', label: null }),
            ],
          }),
        ],
      });

      // One chip, and the four digits once: a label falling back to the code must not
      // draw the same string twice.
      expect(query(fixture, '.chip')?.textContent).toContain('14013');
      expect(query(fixture, '.chip-label')).toBeNull();
    });

    it('opens the location sheet rather than asking the device from here', async () => {
      // The permission prompt is raised inside the sheet, after what it is for has
      // been said (plan 0058, section 3.1). Nothing on this page touches geolocation,
      // which is why the reader is never resolved here at all.
      const { fixture, router } = await render();

      const buttons = queryAll<HTMLButtonElement>(fixture, '.add');
      expect(buttons[1].textContent).toContain('profiles.location.use');

      buttons[1].click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['sheet', 'location'],
        expect.anything()
      );
    });

    it('counts only the user’s own codes against the cap', async () => {
      // Derived rows do not occupy it, so a profile carrying five neighbours still
      // offers the add control to somebody who has typed one code.
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              profilePostalCodeFor({ id: 'pc1', postalCode: '14001' }),
              ...['14002', '14003', '14004', '14005', '14006'].map(
                (postalCode, at) =>
                  profilePostalCodeFor({
                    id: `pc-${postalCode}`,
                    postalCode,
                    position: at + 1,
                    source: 'NEARBY',
                  })
              ),
            ],
          }),
        ],
      });

      expect(queryAll(fixture, '.add').length).toBeGreaterThan(0);
    });

    it('keeps an uncovered code and explains it in words', async () => {
      const { fixture } = await render({
        profiles: [
          shoppingProfileFor({
            id: 'a',
            postalCodes: [
              profilePostalCodeFor({ id: 'pc1', postalCode: '05631' }),
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
              profilePostalCodeFor({ id: 'pc1', postalCode: '05631' }),
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

  /**
   * What a save is allowed to send (plan 0049, section 7).
   *
   * This is the spec that makes the generation scope safe to read at all, which is why
   * that plan calls it the one worth writing first. `PATCH` treats a **present**
   * collection as a full replacement and an absent one as "leave it alone", so a page
   * that sent a collection it does not edit would replace it with whatever this build
   * happened to hold. For `generationSources` that would be nothing, and somebody's
   * stored scope would be erased by an interaction that renamed their profile.
   *
   * The structural half of the guarantee is that `ShoppingProfile` does not carry the
   * field, so the page has nothing to send. This is the behavioural half: every save
   * sends exactly the one thing its control edits, and a future editor who spreads a
   * profile into a body fails here rather than in somebody's account.
   */
  describe('what a save sends', () => {
    /** Every field name any save on this page has ever put in a body. */
    async function keysSentBy(
      act: (fixture: ComponentFixture<ProfilesPage>) => void | Promise<void>,
      options: Options = {}
    ): Promise<string[][]> {
      const { fixture, store } = await render(options);

      await act(fixture);
      await Promise.resolve();

      return store.calls
        .filter((call) => call.method === 'save')
        .map((call) => Object.keys(call.body).sort());
    }

    it('sends only the name when the name is edited', async () => {
      const sent = await keysSentBy(
        (fixture) => {
          const field = query<HTMLInputElement>(fixture, '#profiles-name');
          if (field === null) {
            throw new Error('no name field');
          }
          field.value = 'Elsewhere';
          field.dispatchEvent(new Event('blur'));
        },
        { profiles: [shoppingProfileFor({ id: 'a', name: 'Home' })] }
      );

      expect(sent).toEqual([['name']]);
    });

    it('has no address field at all', async () => {
      // Plan 0058, section 2: the field was never geocoded and nothing read it, and a
      // field that asks somebody where they live and then ignores the answer invites
      // them to believe the app knows. The core column stays; this app cannot reach it.
      const { fixture } = await render();

      expect(query(fixture, '#profiles-address')).toBeNull();
    });

    it('sends only the threshold when the threshold is edited', async () => {
      const sent = await keysSentBy((fixture) => {
        const field = query<HTMLInputElement>(fixture, '#profiles-threshold');
        if (field === null) {
          throw new Error('no threshold field');
        }
        field.value = '2';
        field.dispatchEvent(new Event('blur'));
      });

      expect(sent).toEqual([['minSavingCents']]);
    });

    /**
     * The postal codes leave through their own route now (plan 0058), so what this
     * asserts is that adding one makes **no** `save` at all: a write body that could
     * carry the collection is a write body that can one day carry the server's own
     * derived rows back.
     */
    it('makes no profile save at all when a postal code is added', async () => {
      const sent = await keysSentBy(async (fixture) => {
        queryAll<HTMLButtonElement>(fixture, '.add')[0].click();
        fixture.detectChanges();

        const field = query<HTMLInputElement>(fixture, '#profiles-postal-code');
        if (field === null) {
          throw new Error('no postal code field');
        }
        field.value = '14001';
        field.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        query<HTMLFormElement>(fixture, '.form')?.dispatchEvent(
          new Event('submit')
        );
      });

      expect(sent).toEqual([]);
    });

    it('sends only the chains when one is excluded', async () => {
      const sent = await keysSentBy((fixture) => {
        queryAll<HTMLInputElement>(fixture, '.checkbox')[1].click();
      });

      expect(sent).toEqual([['supermarkets']]);
    });

    /**
     * Stated as a rule over every save this page can make, rather than as five
     * examples: a sixth control added later is caught by this without anybody
     * remembering to extend the list above.
     */
    it('never sends a collection this page does not edit', async () => {
      const { fixture, store } = await render();

      // Every control on the page, in one pass.
      const name = query<HTMLInputElement>(fixture, '#profiles-name');
      if (name !== null) {
        name.value = 'Elsewhere';
        name.dispatchEvent(new Event('blur'));
      }
      const threshold = query<HTMLInputElement>(fixture, '#profiles-threshold');
      if (threshold !== null) {
        threshold.value = '3';
        threshold.dispatchEvent(new Event('blur'));
      }
      queryAll<HTMLInputElement>(fixture, '.checkbox')[1].click();
      await Promise.resolve();

      const bodies = store.calls
        .filter((call) => call.method === 'save')
        .map((call) => call.body as Record<string, unknown>);

      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        // The two fields plan 0046 kept off the model, by name, because these are the
        // ones an empty replacement destroys silently.
        expect(body).not.toHaveProperty('generationScope');
        expect(body).not.toHaveProperty('generationSources');
        // And nothing at all beyond what this page renders, so the rule survives a
        // field being added to the write request later.
        expect(Object.keys(body).every((key) => EDITED_FIELDS.has(key))).toBe(
          true
        );
      }
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
