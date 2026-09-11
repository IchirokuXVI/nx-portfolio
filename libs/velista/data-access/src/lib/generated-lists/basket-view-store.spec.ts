import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketLine,
  BasketParticipant,
  BasketProduct,
} from '@portfolio/velista/models';
import { BasketStore } from './basket-store';
import { BasketViewStore } from './basket-view-store';

/**
 * What the basket page draws, as opposed to what the basket holds (velista
 * `0074`, section 4.3).
 *
 * The one idea worth a test of its own: **the search hides rows and does nothing
 * else.** It never reorders, it never reaches the server, and it never survives the
 * screen. Everything below is one of those four sentences.
 */

function line(
  id: string,
  content: string,
  pickId: string | null = null,
  createdBy = 'p-guest'
): BasketLine {
  return {
    id,
    content,
    quantity: 1,
    settled: 0,
    pickId,
    optionIds: [],
    position: 0,
    createdBy,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
  };
}

function product(
  id: string,
  en: string,
  es: string,
  brand: string | null = null
): BasketProduct {
  return { id, name: { en, es }, brand, size: null, unit: null, offer: null };
}

const ME: BasketParticipant = {
  id: 'p-me',
  kind: 'OWNER',
  displayName: null,
  username: 'Dani',
  guestNumber: null,
  userId: 'u-1',
  joinedAt: null,
  lastSeenAt: null,
  shareLinkId: null,
};

interface Harness {
  readonly view: BasketViewStore;
  readonly lines: WritableSignal<readonly BasketLine[]>;
  readonly lastAdded: WritableSignal<BasketLine | null>;
  readonly locale: WritableSignal<string>;
}

function harness(
  lines: readonly BasketLine[],
  products: ReadonlyMap<string, BasketProduct> = new Map()
): Harness {
  TestBed.resetTestingModule();

  const held = signal(lines);
  const lastAdded = signal<BasketLine | null>(null);
  const locale = signal('en');

  TestBed.configureTestingModule({
    providers: [
      { provide: RokuLocaleStore, useValue: { locale } },
      {
        provide: BasketStore,
        useValue: {
          lines: held,
          products: signal(products),
          lastAdded,
          me: signal<BasketParticipant | null>(ME),
        },
      },
      BasketViewStore,
    ],
  });

  return {
    view: TestBed.inject(BasketViewStore),
    lines: held,
    lastAdded,
    locale,
  };
}

const contents = (lines: readonly BasketLine[]) =>
  lines.map((row) => row.content);

describe('BasketViewStore', () => {
  const basket: readonly BasketLine[] = [
    line('l-1', 'Milk', 'item-milk'),
    line('l-2', 'Sourdough loaf'),
    line('l-3', 'Plátano'),
  ];

  const products = new Map([
    [
      'item-milk',
      product('item-milk', 'Whole milk', 'Leche entera', 'Hacendado'),
    ],
  ]);

  it('draws the whole basket, by identity, until somebody searches', () => {
    const { view, lines } = harness(basket);

    // The same array and not a copy of it, so an untouched basket costs nothing.
    expect(view.visibleLines()).toBe(lines());
    expect(view.searching()).toBe(false);
  });

  it('narrows to what matches, in the order the basket already held', () => {
    const { view } = harness(basket);
    view.search('o');

    // Both matches, and the loaf is still before the plátano: the search hides
    // rows and never reorders, which is what `0075` goes on to decide.
    expect(contents(view.visibleLines())).toEqual([
      'Sourdough loaf',
      'Plátano',
    ]);
  });

  it("matches a line through its pick's name and brand", () => {
    const { view } = harness(basket, products);

    view.search('hacendado');
    expect(contents(view.visibleLines())).toEqual(['Milk']);

    view.search('whole');
    expect(contents(view.visibleLines())).toEqual(['Milk']);
  });

  it('re-reads the names when the reader changes language', () => {
    const { view, locale } = harness(basket, products);
    view.search('leche');

    expect(view.visibleLines()).toHaveLength(0);

    locale.set('es');
    expect(contents(view.visibleLines())).toEqual(['Milk']);
  });

  it('folds the query once, for the row to draw its mark from', () => {
    const { view } = harness(basket);
    view.search('  PLÁTANO ');

    expect(view.folded()).toBe('platano');
  });

  it("clears itself when the reader's own line lands", () => {
    const { view, lastAdded } = harness(basket);
    view.search('yogurt');

    lastAdded.set(line('l-4', 'Yogurt', null, ME.id));
    // Effects are scheduled, not synchronous, so the arrival has to be flushed
    // before the query can have answered it.
    TestBed.tick();

    // The thing somebody searched for and did not find is very often the next line
    // they add, and a row that arrived hidden by the failed search is a row
    // somebody types a second time.
    expect(view.query()).toBe('');
  });

  it("does not clear itself when somebody else's line lands", () => {
    const { view, lastAdded } = harness(basket);
    view.search('yogurt');

    // Four people are working this basket. Clearing the field because somebody
    // across the shop typed something takes the screen out from under the person
    // holding this phone.
    lastAdded.set(line('l-5', 'Crisps', null, 'p-somebody-else'));
    TestBed.tick();

    expect(view.query()).toBe('yogurt');
  });

  it('is given back on leaving, so a later basket does not start searched', () => {
    const { view } = harness(basket);
    view.search('milk');

    view.leave();

    expect(view.query()).toBe('');
    expect(view.searching()).toBe(false);
  });
});
