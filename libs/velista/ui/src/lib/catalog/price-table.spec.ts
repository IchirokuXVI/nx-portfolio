import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { PriceTable, type PriceTableRow } from './price-table';

/**
 * What each supermarket charges for one product (velista `0134`, section 5). The
 * order is the caller's, and a missing price is always words.
 */
function priced(
  supermarketId: string,
  chain: string,
  overrides: Partial<PriceTableRow> = {}
): PriceTableRow {
  return {
    supermarketId,
    chain,
    logo: { logoUrl: null, name: chain, store: false },
    kind: 'priced',
    price: { amount: '€1.09', per: null },
    unitPrice: { amount: '€1.09', per: '/ L' },
    cheapest: false,
    stale: false,
    ...overrides,
  };
}

const CHEAPEST = priced('s1', 'Carrefour', { cheapest: true });
const DEARER = priced('s2', 'Mercadona', {
  price: { amount: '€1.25', per: null },
  unitPrice: null,
});
const UNPRICED = priced('s3', 'Lidl', {
  kind: 'unpriced',
  price: null,
  unitPrice: null,
});
const NOT_SOLD = priced('s4', 'DIA', {
  kind: 'notSold',
  price: null,
  unitPrice: null,
});

const ROWS: readonly PriceTableRow[] = [CHEAPEST, DEARER, UNPRICED, NOT_SOLD];

async function render(
  rows: readonly PriceTableRow[] = ROWS
): Promise<ComponentFixture<PriceTable>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PriceTable, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(PriceTable);
  fixture.componentRef.setInput('rows', rows);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function rowsOf(fixture: ComponentFixture<PriceTable>): HTMLElement[] {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      'li.row'
    ),
  ];
}

function chains(fixture: ComponentFixture<PriceTable>): (string | null)[] {
  return rowsOf(fixture).map(
    (one) => one.querySelector('.chain')?.textContent ?? null
  );
}

describe('PriceTable', () => {
  it('draws one row for each chain, in the order given', async () => {
    const fixture = await render();

    expect(chains(fixture)).toEqual(['Carrefour', 'Mercadona', 'Lidl', 'DIA']);
  });

  it('does not sort: a dearer row given first stays first', async () => {
    const fixture = await render([NOT_SOLD, DEARER, CHEAPEST]);

    expect(chains(fixture)).toEqual(['DIA', 'Mercadona', 'Carrefour']);
  });

  it('draws nothing for no rows', async () => {
    const fixture = await render([]);

    expect(rowsOf(fixture)).toHaveLength(0);
  });

  it('draws the logo of each chain', async () => {
    const fixture = await render();

    for (const one of rowsOf(fixture)) {
      expect(
        one.querySelector('lib-chain-logo')?.classList.contains('is-sm')
      ).toBe(true);
    }
  });

  it('says CHEAPEST in words on the cheapest row, and on no other', async () => {
    const fixture = await render();

    expect(
      rowsOf(fixture).map(
        (one) => one.querySelector('.cheapest')?.textContent?.trim() ?? null
      )
    ).toEqual(['catalog.product.cheapest', null, null, null]);
  });

  it('draws the price, and the price per unit under it', async () => {
    const fixture = await render();

    const price = rowsOf(fixture)[0]?.querySelector('.price');
    expect(price?.querySelector('.amount')?.textContent).toBe('€1.09');
    expect(price?.querySelector('.unit')?.textContent).toBe('€1.09/ L');
    expect(price?.querySelector('.unit .per')?.textContent).toBe('/ L');
    expect(rowsOf(fixture)[0]?.querySelector('.absent')).toBeNull();
  });

  it('draws what a price is per after its number, apart from it (velista 0179)', async () => {
    const fixture = await render([
      priced('s1', 'Carrefour', {
        price: { amount: '13,42 €', per: '/ kg' },
        unitPrice: null,
      }),
    ]);

    const amount = rowsOf(fixture)[0]?.querySelector('.price .amount');
    expect(amount?.firstChild?.textContent).toBe('13,42 €');
    expect(amount?.querySelector('.per')?.textContent).toBe('/ kg');
  });

  it('draws the price alone when the source gave no price per unit', async () => {
    const fixture = await render();

    const price = rowsOf(fixture)[1]?.querySelector('.price');
    expect(price?.querySelector('.amount')?.textContent).toBe('€1.25');
    expect(price?.querySelector('.unit')).toBeNull();
  });

  it('says no price for a chain that stocks it with no price', async () => {
    const fixture = await render();

    const lidl = rowsOf(fixture)[2];
    expect(lidl?.querySelector('.absent')?.textContent).toContain(
      'catalog.row.noPrice'
    );
    expect(lidl?.querySelector('.price')).toBeNull();
    expect(lidl?.classList.contains('is-absent')).toBe(false);
  });

  it('says not sold here for a chain that does not sell it, and marks the row', async () => {
    const fixture = await render();

    const dia = rowsOf(fixture)[3];
    expect(dia?.querySelector('.absent')?.textContent).toContain(
      'catalog.product.notSold'
    );
    expect(dia?.querySelector('.price')).toBeNull();
    expect(dia?.classList.contains('is-absent')).toBe(true);
  });

  it('marks only the row that is not sold as absent', async () => {
    const fixture = await render();

    expect(
      rowsOf(fixture).map((one) => one.classList.contains('is-absent'))
    ).toEqual([false, false, false, true]);
  });

  it('draws a stale price as stale, with no badge beside it', async () => {
    const fixture = await render([
      priced('s1', 'Carrefour', { stale: true }),
      DEARER,
    ]);

    const stale = rowsOf(fixture)[0]?.querySelector('.price');
    expect(stale?.classList.contains('is-stale')).toBe(true);
    expect(stale?.children).toHaveLength(2);
    expect(
      rowsOf(fixture)[1]
        ?.querySelector('.price')
        ?.classList.contains('is-stale')
    ).toBe(false);
  });

  it('never draws a dash for a missing price', async () => {
    const fixture = await render();

    for (const one of rowsOf(fixture).slice(2)) {
      expect(one.textContent).not.toMatch(/[-–—]/);
    }
  });
});
