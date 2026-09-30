import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { FranchiseButton } from '@portfolio/velista/models';
import type { ShopGroup, ShopRow } from './shop-list';
import {
  ShopPicker,
  type ShopPickerAny,
  type ShopPickerNear,
  type ShopPickerState,
} from './shop-picker';

function shop(id: string, outsideAreas = false): ShopRow {
  return {
    id,
    chain: 'Mercadona',
    name: null,
    where: 'Calle Mayor 3, Córdoba',
    street: 'Calle Mayor 3',
    town: 'Córdoba',
    postalCode: '14001',
    excluded: false,
    excludedChain: false,
    failed: false,
    outsideAreas,
    logo: { logoUrl: null, name: 'Mercadona', store: false },
    sections: [],
  };
}

const CHAINS: readonly FranchiseButton[] = [
  {
    key: 'merca',
    name: { en: 'Mercadona', es: 'Mercadona' },
    locations: 2,
    excluded: 0,
    state: 'none',
    logoUrl: null,
  },
  {
    key: 'dia',
    name: { en: 'Dia', es: 'Dia' },
    locations: 1,
    excluded: 0,
    state: 'none',
    logoUrl: null,
  },
];

const GROUPS: readonly ShopGroup[] = [
  {
    key: '14001',
    heading: '14001',
    code: null,
    shops: [shop('loc-1'), shop('loc-2', true)],
  },
];

const ANY: ShopPickerAny = {
  title: 'All supermarkets',
  detail: 'Every product from every chain',
  logo: { logoUrl: null, name: '', store: true },
  checked: true,
};

async function render(options: {
  readonly openKey?: string | null;
  readonly query?: string;
  readonly matches?: readonly ShopGroup[];
  readonly matchCount?: number;
  readonly pickedId?: string | null;
  readonly pickedChain?: string | null;
  readonly state?: ShopPickerState;
  readonly anyRow?: ShopPickerAny | null;
  readonly searchPending?: boolean;
}): Promise<ComponentFixture<ShopPicker>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShopPicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShopPicker);
  fixture.componentRef.setInput('chains', CHAINS);
  fixture.componentRef.setInput('openKey', options.openKey ?? null);
  fixture.componentRef.setInput('groups', GROUPS);
  fixture.componentRef.setInput('query', options.query ?? '');
  fixture.componentRef.setInput('matches', options.matches ?? []);
  fixture.componentRef.setInput('matchCount', options.matchCount ?? 0);
  fixture.componentRef.setInput('pickedId', options.pickedId ?? null);
  fixture.componentRef.setInput('pickedChain', options.pickedChain ?? null);
  fixture.componentRef.setInput('state', options.state ?? 'ready');
  fixture.componentRef.setInput('anyRow', options.anyRow ?? null);
  fixture.componentRef.setInput(
    'searchPending',
    options.searchPending ?? false
  );
  fixture.detectChanges();

  return fixture;
}

const element = (fixture: ComponentFixture<ShopPicker>) =>
  fixture.nativeElement as HTMLElement;

/**
 * The picker's body (velista `0102`, `0124`), which the catalog's page and the
 * three shop sheets all draw. It holds nothing: the container says what the shops
 * are, and this draws them and reports taps.
 */
describe('ShopPicker', () => {
  it('draws the search and one big button per chain at the root, and no shops', async () => {
    const fixture = await render({});

    expect(element(fixture).querySelector('.search-input')).not.toBeNull();
    const buttons = element(fixture).querySelectorAll(
      'lib-franchise-buttons .chip'
    );
    expect(buttons).toHaveLength(2);
    // Each button leads with the chain's logo, the initial until one is set.
    expect(buttons[0].querySelector('lib-chain-logo')?.textContent).toContain(
      'M'
    );
    expect(element(fixture).querySelector('lib-shop-list')).toBeNull();
  });

  it('ticks the chain of the current choice and no other', async () => {
    const fixture = await render({ pickedChain: 'dia' });

    const buttons = [
      ...element(fixture).querySelectorAll('lib-franchise-buttons .chip'),
    ];
    expect(
      buttons.map((button) => button.getAttribute('aria-pressed'))
    ).toEqual(['false', 'true']);
    expect(buttons[1].querySelector('.tick')).not.toBeNull();
    expect(buttons[0].querySelector('.tick')).toBeNull();
  });

  it('replaces the whole root with the open chain’s shops, as radios', async () => {
    const fixture = await render({ openKey: 'merca', pickedId: 'loc-2' });

    expect(element(fixture).querySelector('.search-input')).toBeNull();
    expect(element(fixture).querySelector('lib-franchise-buttons')).toBeNull();
    const radios = [
      ...element(fixture).querySelectorAll<HTMLInputElement>('.checkbox'),
    ];
    expect(radios.map((radio) => radio.type)).toEqual(['radio', 'radio']);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    // Inside one chain the head carries the logo, so the rows do not.
    expect(element(fixture).querySelector('.pick lib-chain-logo')).toBeNull();
  });

  it('says a shop outside the areas is outside them, and only that one', async () => {
    const fixture = await render({ openKey: 'merca' });

    const rows = [...element(fixture).querySelectorAll('.row')];
    expect(rows[0].querySelector('lib-outside-areas')).toBeNull();
    expect(rows[1].querySelector('lib-outside-areas')).not.toBeNull();
  });

  it('reports a pick, a chain and a word as three different outputs', async () => {
    const chainScreen = await render({ openKey: 'merca' });
    const picked: string[] = [];
    chainScreen.componentInstance.picked.subscribe((id) => picked.push(id));
    element(chainScreen)
      .querySelectorAll<HTMLInputElement>('.checkbox')[1]
      .click();
    expect(picked).toEqual(['loc-2']);

    const root = await render({});
    const chosen: string[] = [];
    const queried: string[] = [];
    root.componentInstance.chosen.subscribe((key) => chosen.push(key));
    root.componentInstance.queried.subscribe((word) => queried.push(word));
    element(root)
      .querySelector<HTMLButtonElement>('lib-franchise-buttons .chip')
      ?.click();
    const field =
      element(root).querySelector<HTMLInputElement>('.search-input');
    if (field !== null) {
      field.value = 'Mayor';
      field.dispatchEvent(new Event('input'));
    }

    expect(chosen).toEqual(['merca']);
    expect(queried).toEqual(['Mayor']);
  });

  it('hides the chain buttons while a word is searched, and lists the matches in their place', async () => {
    const fixture = await render({
      query: 'Mayor',
      matches: [
        { key: 'search', heading: '', code: null, shops: [shop('loc-1')] },
      ],
      matchCount: 1,
      anyRow: ANY,
    });

    expect(element(fixture).querySelector('lib-franchise-buttons')).toBeNull();
    expect(element(fixture).querySelector('.any')).toBeNull();
    expect(element(fixture).querySelector('.result-count')).not.toBeNull();
    expect(element(fixture).querySelectorAll('.row')).toHaveLength(1);
    expect(element(fixture).querySelector('.heading')).toBeNull();
    // A search crosses chains, so its rows lead with their logos.
    expect(
      element(fixture).querySelector('.pick lib-chain-logo')
    ).not.toBeNull();
  });

  it('says nothing about the matches while the answer for the typed text is pending', async () => {
    const fixture = await render({
      query: 'Mayor',
      matchCount: 0,
      searchPending: true,
    });

    // The buttons have gone, but neither "0 results" nor "no match" is drawn or
    // announced: the search for this text has not answered yet.
    expect(element(fixture).querySelector('lib-franchise-buttons')).toBeNull();
    const count = element(fixture).querySelector('.result-count');
    expect(count).not.toBeNull();
    expect(count?.textContent?.trim()).toBe('');
    expect(element(fixture).querySelector('.empty')).toBeNull();

    // The answer lands: now the count is heard, and the empty line drawn.
    fixture.componentRef.setInput('searchPending', false);
    fixture.detectChanges();
    expect(
      element(fixture).querySelector('.result-count')?.textContent?.trim()
    ).toBe('shops.search.results');
    expect(element(fixture).querySelector('.empty')).not.toBeNull();
  });

  it('brings the buttons back once the field is emptied', async () => {
    const fixture = await render({ query: '   ' });

    expect(
      element(fixture).querySelector('lib-franchise-buttons')
    ).not.toBeNull();
  });

  it('says it is loading, or that it failed, in one line where the buttons would be', async () => {
    const loading = await render({ state: 'loading' });
    expect(element(loading).querySelector('.note')?.textContent).toContain(
      'shops.loading'
    );
    expect(element(loading).querySelector('lib-franchise-buttons')).toBeNull();

    const failed = await render({ state: 'failed' });
    expect(element(failed).querySelector('.note')?.textContent).toContain(
      'shops.error.load'
    );
  });
});

/**
 * The any row (velista `0124`): only the catalog asks for one, with its own words,
 * at the top of the root and at the top of a chain.
 */
describe('ShopPicker, the any row', () => {
  it('draws none unless the host asks', async () => {
    const fixture = await render({});

    expect(element(fixture).querySelector('.any')).toBeNull();
  });

  it('draws the host’s words above the search at the root, checked when it is the choice', async () => {
    const fixture = await render({ anyRow: ANY });

    const any = element(fixture).querySelector('.any') as HTMLElement;
    expect(any.textContent).toContain('All supermarkets');
    expect(any.textContent).toContain('Every product from every chain');
    expect(any.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    const search = element(fixture).querySelector('.search') as HTMLElement;
    expect(
      any.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('draws it above a chain’s shops and reports a choice of it', async () => {
    const fixture = await render({
      openKey: 'merca',
      anyRow: { ...ANY, title: 'Any Mercadona shop', checked: false },
    });
    let chosen = 0;
    fixture.componentInstance.anyChosen.subscribe(() => (chosen += 1));

    const any = element(fixture).querySelector('.any') as HTMLElement;
    expect(any.textContent).toContain('Any Mercadona shop');
    any.querySelector<HTMLInputElement>('input')?.click();

    expect(chosen).toBe(1);
  });
});

/**
 * "Near me" and the recent shops (velista `0103`). The container works out what
 * the device and the server said and hands it over as `near`; the body draws the
 * candidates nearest first, one line per reason, and one line per failure.
 */
describe('ShopPicker, near me and recent shops', () => {
  async function renderNear(
    near: ShopPickerNear,
    recent: readonly ShopRow[] = [],
    anyRow: ShopPickerAny | null = null
  ): Promise<ComponentFixture<ShopPicker>> {
    const fixture = await render({ anyRow });
    fixture.componentRef.setInput('near', near);
    fixture.componentRef.setInput('recent', recent);
    fixture.detectChanges();
    return fixture;
  }

  function candidate(id: string, distance: string, outsideAreas = false) {
    return {
      ...shop(id, outsideAreas),
      aside: { text: distance, kind: 'distance' as const },
    };
  }

  const nearSection = (fixture: ComponentFixture<ShopPicker>) =>
    element(fixture).querySelector('.near-region') as HTMLElement;

  it('draws nothing above the search until somebody presses', async () => {
    const fixture = await renderNear({ state: 'idle' });

    expect(nearSection(fixture).textContent?.trim()).toBe('');
    expect(element(fixture).querySelector('.section')).toBeNull();
  });

  it('says it is finding you, over two placeholder rows, while it works', async () => {
    const fixture = await renderNear({ state: 'locating' });

    const section = nearSection(fixture).querySelector('.section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect(section?.textContent).toContain('basket.view.shop.near.heading');
    expect(section?.querySelectorAll('.skeleton-row')).toHaveLength(2);
    // The rest of the picker still works while it waits.
    expect(
      element(fixture).querySelector('lib-franchise-buttons')
    ).not.toBeNull();
  });

  it.each([
    ['AMBIGUOUS', 3],
    ['LOW_ACCURACY', 2],
    ['OUTSIDE_PROFILE', 1],
  ] as const)(
    'draws the candidates nearest first under one line for %s',
    async (reason, count) => {
      const candidates = [
        candidate('near-1', '140 m', reason === 'OUTSIDE_PROFILE'),
        candidate('near-2', '230 m'),
        candidate('near-3', '610 m'),
      ].slice(0, count);
      const fixture = await renderNear({
        state: 'answered',
        reason,
        candidates,
      });

      const region = nearSection(fixture);
      expect(region.querySelector('.line')?.textContent).toContain(
        `basket.view.shop.near.reason.${reason}`
      );
      const rows = [...region.querySelectorAll('.row')];
      expect(rows).toHaveLength(count);
      // In the order the server gave, each with its distance at the end.
      expect(
        rows.map((row) => row.querySelector('.aside')?.textContent?.trim())
      ).toEqual(candidates.map((row) => row.aside.text));
      // The candidates are their own radio group, apart from the chain's shops.
      expect(region.querySelector('input')?.getAttribute('name')).toBe(
        'shop-pick-near'
      );
      if (reason === 'OUTSIDE_PROFILE') {
        // The one clear shop is a candidate with the warning, never the pick.
        expect(rows[0].querySelector('lib-outside-areas')).not.toBeNull();
      }
    }
  );

  it('draws the candidates above the any row', async () => {
    const fixture = await renderNear(
      {
        state: 'answered',
        reason: 'AMBIGUOUS',
        candidates: [candidate('n', '1 m')],
      },
      [],
      ANY
    );

    const any = element(fixture).querySelector('.any') as HTMLElement;
    expect(
      nearSection(fixture).compareDocumentPosition(any) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('says there is no shop within the radius in one line, with no empty box', async () => {
    const fixture = await renderNear({
      state: 'answered',
      reason: 'NONE_NEARBY',
      candidates: [],
    });

    const region = nearSection(fixture);
    expect(region.querySelector('.line')?.textContent).toContain(
      'basket.view.shop.near.reason.NONE_NEARBY'
    );
    expect(region.querySelector('lib-shop-list')).toBeNull();
  });

  it('reports a candidate chosen by hand, like any other shop', async () => {
    const fixture = await renderNear({
      state: 'answered',
      reason: 'AMBIGUOUS',
      candidates: [candidate('near-1', '180 m'), candidate('near-2', '230 m')],
    });
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((id) => picked.push(id));

    const radios = nearSection(fixture).querySelectorAll('input');
    (radios[1] as HTMLInputElement).click();

    expect(picked).toEqual(['near-2']);
  });

  it.each([
    ['denied', 'basket.view.shop.near.denied'],
    ['timed-out', 'basket.view.shop.near.timedOut'],
    ['failed', 'basket.view.shop.near.failed'],
  ] as const)(
    'draws one line for %s and leaves the rest of the picker working',
    async (state, key) => {
      const fixture = await renderNear({ state });

      const region = nearSection(fixture);
      expect(region.querySelectorAll('.line')).toHaveLength(1);
      expect(region.querySelector('.line')?.textContent).toContain(key);
      expect(region.querySelector('.section')).toBeNull();
      expect(element(fixture).querySelector('.search-input')).not.toBeNull();
      expect(
        element(fixture).querySelector('lib-franchise-buttons')
      ).not.toBeNull();
    }
  );

  it('draws the recent shops first, newest first as given, with their day', async () => {
    const recent = [
      { ...shop('recent-1'), aside: { text: 'Today', kind: 'when' as const } },
      {
        ...shop('recent-2'),
        aside: { text: 'Tuesday', kind: 'when' as const },
      },
    ];
    const fixture = await renderNear({ state: 'idle' }, recent);

    const sections = element(fixture).querySelectorAll('.section');
    expect(sections).toHaveLength(1);
    expect(sections[0].textContent).toContain(
      'basket.view.shop.recent.heading'
    );
    expect(
      [...sections[0].querySelectorAll('.aside')].map((aside) =>
        aside.textContent?.trim()
      )
    ).toEqual(['Today', 'Tuesday']);
    // Above the search, which is what makes them the first thing to tap.
    const search = element(fixture).querySelector('.search') as HTMLElement;
    expect(
      sections[0].compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('draws no recent section when there are none, which is also every guest', async () => {
    const fixture = await renderNear({ state: 'idle' }, []);

    expect(element(fixture).textContent).not.toContain(
      'basket.view.shop.recent.heading'
    );
  });
});
