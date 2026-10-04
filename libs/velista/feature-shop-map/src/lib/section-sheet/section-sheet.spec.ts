import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ShopDetailStore, ShopMapStore } from '@portfolio/velista/data-access';
import type { Basket, BasketRow } from '@portfolio/velista/models';
import {
  settle,
  shopMapTesting,
  type ShopMapHarnessOptions,
} from '../shop-map.testing';
import { SectionSheet } from './section-sheet';

function row(rowKey: string, state: BasketRow['state'], asked = 1): BasketRow {
  return {
    rowKey,
    content: rowKey,
    left: 1,
    bought: 0,
    asked,
    boughtElsewhere: 0,
    state,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: ['i-eggs'],
    touchedBy: null,
    touchedAt: null,
    entries: [],
    usual: null,
  };
}

function basket(rows: BasketRow[]): Basket {
  return {
    rows,
    products: new Map([
      ['i-eggs', { id: 'i-eggs', sectionIds: ['sec-mercadona-eggs'] }],
    ]),
  } as unknown as Basket;
}

async function render(
  options: ShopMapHarnessOptions & { readonly sectionId?: string }
) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    ...options,
    params: {
      locationId: 'loc-tejares',
      sectionId: options.sectionId ?? 'sec-mercadona-eggs',
    },
  });
  await TestBed.configureTestingModule({
    imports: [SectionSheet, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  // The map page opens the map and the shop; the sheet reads what they hold.
  const basketRef = options.query?.['basket'] ?? null;
  await TestBed.inject(ShopMapStore).open('loc-tejares', basketRef);
  await TestBed.inject(ShopDetailStore).ensure('loc-tejares');
  const fixture = TestBed.createComponent(SectionSheet);
  fixture.detectChanges();
  await settle(() => fixture.detectChanges());
  return { fixture, ...harness };
}

function text(
  fixture: ComponentFixture<SectionSheet>,
  selector: string
): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.trim() ?? '');
}

/** Velista `0121`, target 4: one section of the map. */
describe('SectionSheet', () => {
  it('names the section as the chain names it', async () => {
    const { fixture } = await render({});

    expect(text(fixture, '.title')).toEqual(['Eggs']);
  });

  it('says where it falls on the way round and how many are left', async () => {
    const { fixture } = await render({
      query: { basket: 'live' },
      basket: basket([row('eggs', 'WANTED', 6), row('cream', 'DONE')]),
    });

    expect(text(fixture, '.detail')).toEqual([
      'shopMap.section.position · shopMap.section.left',
    ]);
    expect(text(fixture, '.content')).toEqual(['eggs', 'cream']);
    expect(text(fixture, '.quantity')).toEqual(['6', '1']);
  });

  it('draws a settled line with a filled circle and says so', async () => {
    const { fixture } = await render({
      query: { basket: 'live' },
      basket: basket([row('eggs', 'WANTED'), row('cream', 'NOT_AVAILABLE')]),
    });
    const circles = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.settle'
    );

    expect(circles[0]?.classList.contains('is-settled')).toBe(false);
    expect(circles[0]?.getAttribute('aria-label')).toBe(
      'shopMap.section.toGet'
    );
    expect(circles[1]?.classList.contains('is-settled')).toBe(true);
    expect(circles[1]?.getAttribute('aria-label')).toBe('shopMap.section.got');
  });

  it('says everything here is got once every line is', async () => {
    const { fixture } = await render({
      query: { basket: 'live' },
      basket: basket([row('eggs', 'DONE')]),
    });

    expect(text(fixture, '.detail')).toEqual([
      'shopMap.section.position · shopMap.section.allGot',
    ]);
  });

  it('draws only the position with no basket', async () => {
    const { fixture } = await render({});

    expect(text(fixture, '.detail')).toEqual(['shopMap.section.position']);
    expect(text(fixture, '.line')).toEqual([]);
  });

  it('shows the note the mapper left beside the section', async () => {
    const { fixture } = await render({});

    expect(text(fixture, '.note-text span')).toEqual([
      'shopMap.section.note',
      'Free range eggs are on the bottom shelf.',
    ]);
  });

  it('draws no note for a section with none beside it', async () => {
    const { fixture } = await render({ sectionId: 'sec-mercadona-pantry' });

    expect(text(fixture, '.title')).toEqual(['Despensa']);
    expect(text(fixture, '.note')).toEqual([]);
  });

  it('dismisses to the map it covers, keeping the basket', async () => {
    const { fixture, sheets } = await render({
      query: { basket: 'live' },
      basket: basket([]),
    });

    await fixture.componentInstance.dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith(
      '/en/shops/loc-tejares/map?basket=live'
    );
  });
});
