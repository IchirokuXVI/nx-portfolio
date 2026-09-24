import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { FranchiseButton } from '@portfolio/velista/models';
import type { ShopGroup, ShopRow } from './shop-list';
import { ShopPicker, type ShopPickerState } from './shop-picker';

function shop(id: string, outsideAreas = false): ShopRow {
  return {
    id,
    chain: 'Mercadona',
    name: null,
    where: 'Calle Mayor 3, Córdoba',
    postalCode: '14001',
    excluded: false,
    excludedChain: false,
    failed: false,
    outsideAreas,
  };
}

const CHAINS: readonly FranchiseButton[] = [
  {
    key: 'merca',
    name: { en: 'Mercadona', es: 'Mercadona' },
    locations: 2,
    excluded: 0,
    state: 'none',
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

async function render(options: {
  readonly openKey?: string | null;
  readonly query?: string;
  readonly matches?: readonly ShopGroup[];
  readonly matchCount?: number;
  readonly pickedId?: string | null;
  readonly state?: ShopPickerState;
}): Promise<ComponentFixture<ShopPicker>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShopPicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShopPicker);
  fixture.componentRef.setInput('chains', CHAINS);
  fixture.componentRef.setInput('openKey', options.openKey ?? null);
  fixture.componentRef.setInput('openName', 'Mercadona');
  fixture.componentRef.setInput('groups', GROUPS);
  fixture.componentRef.setInput('query', options.query ?? '');
  fixture.componentRef.setInput('matches', options.matches ?? []);
  fixture.componentRef.setInput('matchCount', options.matchCount ?? 0);
  fixture.componentRef.setInput('pickedId', options.pickedId ?? null);
  fixture.componentRef.setInput('state', options.state ?? 'ready');
  fixture.detectChanges();

  return fixture;
}

const element = (fixture: ComponentFixture<ShopPicker>) =>
  fixture.nativeElement as HTMLElement;

/**
 * The picker's body (velista `0102`), which the basket's filter sheet and the get a
 * list sheet both draw. It holds nothing: the container says what the shops are, and
 * this draws them and reports taps.
 */
describe('ShopPicker', () => {
  it('draws the search and the chain buttons, and no shops until a chain opens', async () => {
    const fixture = await render({});

    expect(element(fixture).querySelector('.search-input')).not.toBeNull();
    expect(
      element(fixture).querySelectorAll('lib-franchise-buttons .chip')
    ).toHaveLength(1);
    expect(element(fixture).querySelector('lib-shop-list')).toBeNull();
  });

  it('draws the open chain’s shops as radios, the chosen one checked', async () => {
    const fixture = await render({ openKey: 'merca', pickedId: 'loc-2' });

    const radios = [
      ...element(fixture).querySelectorAll<HTMLInputElement>('.checkbox'),
    ];
    expect(radios.map((radio) => radio.type)).toEqual(['radio', 'radio']);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it('says a shop outside the areas is outside them, and only that one', async () => {
    const fixture = await render({ openKey: 'merca' });

    const rows = [...element(fixture).querySelectorAll('.row')];
    expect(rows[0].querySelector('lib-outside-areas')).toBeNull();
    expect(rows[1].querySelector('lib-outside-areas')).not.toBeNull();
  });

  it('reports a pick, a chain and a word as three different outputs', async () => {
    const fixture = await render({ openKey: 'merca' });
    const picked: string[] = [];
    const chosen: string[] = [];
    const queried: string[] = [];
    fixture.componentInstance.picked.subscribe((id) => picked.push(id));
    fixture.componentInstance.chosen.subscribe((key) => chosen.push(key));
    fixture.componentInstance.queried.subscribe((word) => queried.push(word));

    element(fixture).querySelectorAll<HTMLInputElement>('.checkbox')[1].click();
    element(fixture)
      .querySelector<HTMLButtonElement>('lib-franchise-buttons .chip')
      ?.click();
    const field =
      element(fixture).querySelector<HTMLInputElement>('.search-input');
    if (field !== null) {
      field.value = 'Mayor';
      field.dispatchEvent(new Event('input'));
    }

    expect(picked).toEqual(['loc-2']);
    expect(chosen).toEqual(['merca']);
    expect(queried).toEqual(['Mayor']);
  });

  it('lists the matches flat while a word is searched, and says how many', async () => {
    const fixture = await render({
      openKey: 'merca',
      query: 'Mayor',
      matches: [
        { key: 'search', heading: '', code: null, shops: [shop('loc-1')] },
      ],
      matchCount: 1,
    });

    expect(element(fixture).querySelector('.result-count')).not.toBeNull();
    expect(element(fixture).querySelectorAll('.row')).toHaveLength(1);
    expect(element(fixture).querySelector('.heading')).toBeNull();
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
