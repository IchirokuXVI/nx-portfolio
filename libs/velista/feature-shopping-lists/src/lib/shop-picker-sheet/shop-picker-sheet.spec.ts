import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, BasketViewStore } from '@portfolio/velista/data-access';
import type { BasketPriceScope } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { ShopPickerSheet } from './shop-picker-sheet';

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

/** One shop of a scope, with the five fields the search looks in. */
function shop(
  id: string,
  name: string | null,
  address: string,
  city: string,
  postalCode: string
) {
  return {
    id,
    label: name === null ? null : { en: name, es: name },
    address,
    city,
    postalCode,
  };
}

function scope(
  priceScopeId: string,
  chain: string,
  locations: ReturnType<typeof shop>[] = []
): BasketPriceScope {
  return {
    priceScopeId,
    supermarketName: { en: chain, es: chain },
    locations,
  };
}

/** An owner's basket: two chains, three shops, two postal codes at Mercadona. */
const OWNER_SCOPES = [
  scope('s-merca', 'Mercadona', [
    shop(
      'loc-tejares',
      'Ronda de los Tejares',
      'Ronda de los Tejares 32',
      'Córdoba',
      '14008'
    ),
    shop('loc-barcelona', null, 'Avenida de Barcelona 4', 'Córdoba', '14001'),
  ]),
  scope('s-dia', 'Dia', [
    shop('loc-victoria', null, 'Paseo de la Victoria 21', 'Córdoba', '14004'),
  ]),
];

/** A guest's: the same chains with every address withheld (`0066`, section 5). */
const GUEST_SCOPES = [scope('s-merca', 'Mercadona'), scope('s-dia', 'Dia')];

function render(scopes: readonly BasketPriceScope[]) {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const held = signal(
    new Map(scopes.map((entry) => [entry.priceScopeId, entry]))
  );
  const store = {
    lines: signal([]),
    products: signal(new Map()),
    lastAdded: signal(null),
    me: signal(null),
    basket: computed(() => ({ sources: [], scopes: held() })),
    listNames: signal(new Map<string, string>()),
  };

  const paramMap = convertToParamMap({ generatedListId: BASKET_ID });
  TestBed.configureTestingModule({
    imports: [ShopPickerSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '' }),
      { provide: BasketStore, useValue: store },
      BasketViewStore,
      provideFakeBrowserFacade(new Map()),
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: { navigate: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap, parent: null },
          paramMap: { subscribe: () => ({ unsubscribe: () => undefined }) },
          parent: null,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(ShopPickerSheet);
  fixture.detectChanges();

  return { fixture, sheets, view: TestBed.inject(BasketViewStore) };
}

type Fixture = ReturnType<typeof render>['fixture'];

function chains(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-franchise-buttons .chip'))
    .map((node) => (node.nativeElement as HTMLElement).textContent ?? '');
}

function tapChain(fixture: Fixture, index: number): void {
  fixture.debugElement
    .queryAll(By.css('lib-franchise-buttons .chip'))
    [index].nativeElement.click();
  fixture.detectChanges();
}

function rows(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-shop-list .row'))
    .map((node) => (node.nativeElement as HTMLElement).textContent ?? '');
}

function headings(fixture: Fixture): readonly string[] {
  return fixture.debugElement
    .queryAll(By.css('lib-shop-list .heading'))
    .map(
      (node) => (node.nativeElement as HTMLElement).textContent?.trim() ?? ''
    );
}

function type(fixture: Fixture, query: string): void {
  const field = fixture.debugElement.query(By.css('.search-input'))
    .nativeElement as HTMLInputElement;
  field.value = query;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

/**
 * Choosing which shop the prices come from (velista `0078`, section 4).
 *
 * The supermarkets page's own pieces over a **basket's** scopes: the search across
 * every chain, the chain buttons, and the shops under their postal codes. What these
 * assert is the two things that make it a picker rather than that page. A row picks
 * the **scope**, because the price belongs to the scope and not to the door; and a
 * reader the server sent no addresses to picks a chain, because there is nothing
 * finer for them to pick.
 */
describe('ShopPickerSheet', () => {
  it('draws one button per chain, with the count of its shops', () => {
    const { fixture } = render(OWNER_SCOPES);

    expect(chains(fixture)).toHaveLength(2);
    expect(chains(fixture)[0]).toContain('Mercadona');
    // Two shops at Mercadona, one at Dia. `shops.chain.count` takes the number.
    expect(chains(fixture)[0]).toContain('shops.chain.count');
    expect(chains(fixture)[1]).toContain('Dia');
  });

  it('opens a chain onto its shops, grouped by postal code', () => {
    const { fixture } = render(OWNER_SCOPES);

    expect(rows(fixture)).toHaveLength(0);

    tapChain(fixture, 0);

    expect(rows(fixture)).toHaveLength(2);
    // The code itself heads the group: a basket's shops carry a postal code and
    // not the profile's own word for it (`0059`, section 3.3's fallback).
    expect(headings(fixture)).toEqual(['14008', '14001']);
  });

  it('writes the scope, not the shop, and goes back to the filter sheet', () => {
    const { fixture, sheets, view } = render(OWNER_SCOPES);
    tapChain(fixture, 0);

    fixture.debugElement
      .queryAll(By.css('lib-shop-list .checkbox'))[1]
      .nativeElement.click();
    fixture.detectChanges();

    // The second shop of the first scope: both rows pick that one scope.
    expect(view.shop()).toBe('s-merca');
    // A pop, because the filter sheet pushed this one: the filter sheet's URL is
    // only the fallback for a cold load on this sheet's own address.
    expect(sheets.dismiss).toHaveBeenCalledWith(
      `/en/shopping-lists/${BASKET_ID}/sheet/filter`
    );
    expect(sheets.leaveTo).not.toHaveBeenCalled();
  });

  it('checks the scope’s first shop when it is already the chosen one', () => {
    const { fixture, view } = render(OWNER_SCOPES);
    view.setShop('s-merca');
    fixture.detectChanges();
    tapChain(fixture, 0);

    const radios = fixture.debugElement
      .queryAll(By.css('lib-shop-list .checkbox'))
      .map((node) => node.nativeElement as HTMLInputElement);
    // A radio group has one checked control and a scope holds two shops that
    // charge the same, so the first stands for the scope, which is the shop the
    // filter sheet names under the chain.
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
  });

  describe('the search', () => {
    it.each([
      ['Tejares', 'the shop’s own name'],
      ['mercadona', 'the chain'],
      ['Avenida de Barcelona', 'the street'],
      ['cordoba', 'the town, folded'],
      ['14004', 'the postal code'],
    ])('matches %s, which is %s', (query) => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, query);

      expect(rows(fixture).length).toBeGreaterThan(0);
    });

    it('lists the matches flat, across every chain', () => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, 'Córdoba');

      // Every shop is in Córdoba: three rows, no headings, and the chain buttons
      // still above them, which is what the supermarkets page does.
      expect(rows(fixture)).toHaveLength(3);
      expect(headings(fixture)).toHaveLength(0);
      expect(chains(fixture)).toHaveLength(2);
    });

    it('says how many matched, and says so when none did', () => {
      const { fixture } = render(OWNER_SCOPES);

      type(fixture, 'Sevilla');

      expect(
        fixture.debugElement.query(By.css('.result-count'))
      ).not.toBeNull();
      expect(rows(fixture)).toHaveLength(0);
      expect(
        fixture.debugElement.query(By.css('.empty')).nativeElement.textContent
      ).toContain('shops.empty.noMatch');
    });

    it('clears itself when a chain is tapped', () => {
      const { fixture } = render(OWNER_SCOPES);
      type(fixture, 'Córdoba');

      tapChain(fixture, 1);

      // The buttons and the flat matches are two answers to the same question,
      // and leaving the query behind would draw one over the other.
      expect(fixture.debugElement.query(By.css('.result-count'))).toBeNull();
      expect(rows(fixture)).toHaveLength(1);
    });
  });

  describe('a reader with no addresses', () => {
    it('draws the chain buttons and no shops at all', () => {
      const { fixture } = render(GUEST_SCOPES);

      expect(chains(fixture)).toHaveLength(2);
      expect(rows(fixture)).toHaveLength(0);
    });

    it('picks that chain’s scope when a button is tapped', () => {
      const { fixture, sheets, view } = render(GUEST_SCOPES);

      tapChain(fixture, 1);

      expect(view.shop()).toBe('s-dia');
      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/en/shopping-lists/${BASKET_ID}/sheet/filter`
      );
    });
  });
});
