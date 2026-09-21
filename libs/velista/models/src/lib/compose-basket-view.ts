import { matchesBasketRow } from './basket-search';
import type {
  BasketListRef,
  BasketPriceScope,
  BasketProduct,
  BasketProgress,
  BasketRow,
  BasketRowEntry,
} from './basket-view';
import { basketRowPick, offerAt } from './basket-view';
import type { BasketRowState, ProductCategory } from './enums';
import { inLocale } from './shopping-profile';

/**
 * How the basket's lines are ordered (velista `0075`, section 2).
 *
 * `shop` is the order the server wrote, which backend `0110` makes the order the
 * shopper walks: it needs no client work at all, because it is the order
 * `BasketStore.rows` already arrives in. `alpha` is the only order this app
 * computes, and it is here because a shopper who does not recognise the first one
 * needs a second they can predict.
 */
export type BasketOrder = 'shop' | 'alpha';

/** What the lines are cut into. `category` and `list` are velista `0077`'s. */
export type BasketGrouping = 'none' | 'category' | 'list';

/** One of the four things the filter sheet sets, for the chip that removes it. */
export type BasketViewProperty = 'order' | 'grouping' | 'shop' | 'lists';

/**
 * Everything the filter sheet decides about the screen (velista `0075`,
 * section 2).
 *
 * The search is **not** here. It is a string somebody is typing, it is never
 * remembered (`0076`), and it has no chip, so it travels beside this state as part
 * of {@link BasketViewContext} rather than inside it.
 */
export interface BasketViewState {
  readonly order: BasketOrder;
  readonly grouping: BasketGrouping;
  /** The price scope whose prices are shown, or null for the cheapest anywhere (`0078`). */
  readonly shop: string | null;
  /**
   * The source lists kept, or null for all of them. Never remembered.
   *
   * Null rather than a set holding every list, which is the same view: the
   * difference is that null is the **default**, so nothing is chipped and the
   * sheet's count is not drawn. A toggle that ends up keeping everything collapses
   * back to null for that reason.
   */
  readonly lists: ReadonlySet<string> | null;
}

/** The view every basket opens on, and what {@link basketViewChips} measures against. */
export const DEFAULT_BASKET_VIEW_STATE: BasketViewState = {
  order: 'shop',
  grouping: 'none',
  shop: null,
  lists: null,
};

/**
 * What the pipeline needs about the basket that is not a decision somebody made.
 *
 * The locale is here because `alpha` collates in it, and the products because the
 * search looks in a pick's name and brand (`0074`, section 4.2).
 */
export interface BasketViewContext {
  /** The search, exactly as typed. Empty matches every row. */
  readonly query: string;
  readonly products: ReadonlyMap<string, BasketProduct>;
  readonly locale: string;
  /**
   * The covered lists this reader was served, by list id (velista `0090`).
   *
   * Empty for a reader who may not name any list, which is what keeps the list
   * grouping out of their view without a `seesZoneData` branch in here. A ref the
   * basket did not serve is simply absent, and an entry naming an absent list is
   * one this reader cannot place, so **one collection answers both questions**:
   * which lists there are, and whether this entry belongs to one of them.
   *
   * It replaced a `listNames` map of ids to strings. A ref carries the group's
   * name too, which the entries pane draws beside the list's own, and a name that
   * is empty is no longer representable separately from a list that was not
   * served.
   */
  readonly lists: ReadonlyMap<string, BasketListRef>;
  /**
   * The scopes the basket was priced at, by scope id (velista `0078`, section 5).
   *
   * Read for one thing only, the **chain's name**, which every mark this pipeline
   * writes has to say: "1.99 € at Dia" is a sentence and "1.99 € at
   * 7f3c…" is not. Empty for a basket the gateway could not name the scopes of,
   * which draws no marks at all rather than marks naming nobody.
   */
  readonly scopes: ReadonlyMap<string, BasketPriceScope>;
}

/**
 * What one row says about the chosen shop's price, beside the price itself
 * (velista `0078`, section 5).
 *
 * Null on most rows, which is the ordinary case: the shop lists the product and
 * nowhere else is cheaper, so the caption is a name and a number exactly as `0062`
 * drew it.
 *
 * The type `0075` declined to invent. It is a union rather than a record of
 * nullable halves because the two marks are two different sentences and a row draws
 * one of them: an "unlisted" that also carried a "cheaper elsewhere" would be a
 * state nothing can render.
 *
 * Named a **price** mark since velista `0090`. Backend `0130` gave a row a change
 * mark of its own, a row can carry both, and two marks on one row need two names.
 *
 * The strings are **resolved**, not keys with data hanging off them: the chain's
 * name is server data in the reader's language, and `inLocale` needs a locale the
 * page has no business re-deriving per row. What is left to the page is the
 * sentence around them, which is a translation key.
 */
export type BasketPriceMark =
  /**
   * The chosen shop lists it, and another of the basket's shops is cheaper.
   *
   * A decision the shopper faces rather than a fault, which is why it is drawn in
   * the attention role (`0002`, section 4.4) and never in a danger one.
   */
  | {
      readonly kind: 'cheaper';
      readonly price: number;
      readonly currency: string | null;
      /** The chain quoting it. The shop is not named: `0062`, section 5.1. */
      readonly chain: string;
    }
  /**
   * The chosen shop does not list it, and this line has sunk.
   *
   * {@link elsewhere} is the cheapest price anybody else on this basket quotes,
   * which is often the thing that decides whether to walk across the road, and null
   * when nobody quotes one. The line is still a line to buy either way.
   */
  | {
      readonly kind: 'unlisted';
      /** The chosen shop's chain, so the sentence names where it is missing from. */
      readonly chain: string;
      readonly elsewhere: {
        readonly price: number;
        readonly currency: string | null;
        readonly chain: string;
      } | null;
    };

/** One drawn row. A row, and under `grouping: 'list'` the entry it is drawn for. */
export interface BasketViewRow {
  /**
   * What `@for` tracks, unique inside a section.
   *
   * The row's key is not enough under the list grouping: a row two households ask
   * for is two drawn rows, and two of them tracked by one key make Angular
   * destroy one. So an entry row is keyed by the pair.
   */
  readonly key: string;
  readonly row: BasketRow;
  /**
   * The entry this row is drawn for, or null for a row about the whole thing
   * (velista `0077`, section 4).
   *
   * A row two households asked for is drawn twice under `grouping: 'list'`, each
   * time for one entry and with that household's own numbers, and this is which
   * one. Null under every other grouping, where a row is about itself.
   */
  readonly entry: BasketRowEntry | null;
  /**
   * What this row says about the chosen shop, or null (velista `0078`, section 5).
   *
   * Decided here rather than by the row component, because the **sink** is decided
   * here and the two are one answer: a row the shop does not list is marked and
   * moved, and a component working the first half out for itself is a second place
   * for them to disagree. Null on every row while no shop is chosen.
   *
   * Named `priceMark` beside {@link BasketRow.mark}, which is the change mark
   * backend `0130` gave a row and velista `0093` draws.
   */
  readonly priceMark: BasketPriceMark | null;
}

/**
 * What is written at a section's leading edge: words this app owns, or data.
 *
 * `0075` made every heading a translation key, which was true of the one sink it
 * drew and stopped being true the moment `0077` headed a section with a **list's
 * name**. A household calls its list what it likes and no key can hold that, so the
 * two kinds are a tagged union rather than a string the page guesses at: a page that
 * had to decide whether "Dairy" was a key or a name would get it wrong for a
 * household that named its list `basket.category.DAIRY`, and would more usually get
 * it wrong for one whose list is called "Dairy".
 */
export type BasketViewHeading =
  /**
   * Words this app wrote, resolved by the page: the categories and every sink.
   *
   * {@link args} is what the sentence interpolates, and it exists for `0078`'s
   * sink alone: "Not listed at Mercadona" names a chain, which is data, inside a
   * sentence this app owns. Absent on every other heading, which takes none.
   */
  | {
      readonly kind: 'key';
      readonly key: string;
      readonly args?: Readonly<Record<string, string>>;
    }
  /** Words somebody else wrote, drawn as they are: a list's own name. */
  | { readonly kind: 'text'; readonly text: string };

/**
 * One run of rows under one heading, or the whole list when nothing is grouped.
 *
 * ## The heading is words, and the hint is always a key
 *
 * {@link BasketViewHeading} says why the heading is a union and the hint is not: a
 * hint is a sentence this app wrote about why a section exists, and nobody else ever
 * writes one. The pipeline is pure and has no translator either way, so both kinds
 * are resolved by the page.
 */
export interface BasketViewSection {
  readonly key: string;
  /** The words at the leading edge, or null for the one unheaded section. */
  readonly heading: BasketViewHeading | null;
  /** A translation key for the words at the heading's trailing edge, or null. */
  readonly hint: string | null;
  /**
   * What this section's own rows come to, or null where there is one section
   * (velista `0077`, section 3).
   *
   * A section is a whole screen's worth of shopping when the view is grouped by
   * list, and saying how much of **it** is done is the point of grouping that way.
   * Null for the unheaded section of an ungrouped view, where it would only repeat
   * the sentence in the tools row above it.
   *
   * Counted by {@link basketRowsProgress} over **states the server wrote**, and a
   * spec asserts that over a whole unfiltered basket it equals `Basket.progress`,
   * so a heading and the sentence above it cannot disagree about what "got" means.
   * Under the list grouping it counts the section's **entries**, because that is
   * what the section draws: each household's own share of each row.
   */
  readonly progress: BasketProgress | null;
  readonly rows: readonly BasketViewRow[];
}

/** The one section an ungrouped, unfiltered basket is drawn as. */
const ALL_SECTION_KEY = 'all';

/**
 * The one heading every entry this reader cannot place goes under (section 8.2).
 *
 * It replaced the sink for "lines on no list yet". No such line exists any more:
 * a line is on a list or it does not exist (backend `0136`), so the rows a reader
 * cannot head are the ones whose list they were not **served**, and there is one
 * sentence for all of them rather than a name they may not have.
 */
const OTHER_LISTS_SECTION_KEY = 'other-lists';

/** The sink holding every row with no product to take a category from (`0077`). */
const NO_CATEGORY_SECTION_KEY = 'no-category';

/** The sink holding the rows the chosen shop does not list (`0078`, section 5). */
const NOT_LISTED_SECTION_KEY = 'not-listed';

/**
 * Turn a basket's rows into the sections a page draws (velista `0075`,
 * section 3).
 *
 * ## Three steps, in this order and no other
 *
 * 1. **Filter.** The search (`0074`) and the list filter (section 8.2) decide
 *    which rows stay.
 * 2. **Order.** The server's order, or A to Z.
 * 3. **Group.** The ordered rows are cut into sections.
 *
 * Filter, then order, then group, so a row keeps whatever place the order gave it
 * **inside** its group: four rows of one category come out in the order the whole
 * basket put them in, which is why grouping needs no ordering rule of its own.
 * Reversing the last two would let a group impose an order the shopper did not
 * choose.
 *
 * ## The sink is part of the order, and that is why it is second
 *
 * A row the chosen shop does not list goes last (velista `0078`, section 5), and
 * it goes last **before** anything is cut up, which is one partition rather than
 * one per section. Grouping then keeps it: the sunk rows are already at the end of
 * the array, so each category and each list ends with its own, in the order they
 * were in. Sinking after grouping would need the rule written once per grouping,
 * and the three copies would eventually disagree.
 *
 * A `REMOVED` row sinks below them, and passes every filter on the way: it is
 * information about the basket rather than a thing to find, so nothing hides it
 * and nothing lets it sit among the things still to buy. Velista `0093` draws it.
 */
export function composeBasketView(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketViewSection[] {
  // Over the whole basket rather than over what survived the filter: a search that
  // hides eight rows must not change what the ninth says about the shop, and the
  // "has this shop priced anything" test below is a fact about the basket.
  const prices = priceView(rows, state, context);
  const kept = filterRows(rows, state, context);
  const ordered = orderRows(kept, state, context);
  const sunk = sinkUnlisted(ordered, prices);
  return groupRows(sunk, state, context, prices);
}

/**
 * What the chosen shop makes of this basket: a mark per line, and which lines sank.
 *
 * Null wherever no marking may be drawn, and there are three such cases rather than
 * one. No shop is chosen, which is the default and the ordinary state of the screen.
 * A shop this basket was not priced at, which is a remembered choice against a
 * basket that has changed (`0076`) and cannot say anything about it. And **a scope
 * that lists nothing on this basket**, which is velista `0078` section 5.1 and is
 * the one that matters in the world as it is today: staging and production carry no
 * prices at all, a profile's shops exist whether or not the harvester has reached
 * them, and a shop nobody has priced is not a shop that stocks nothing. Marking
 * every line "not listed at Mercadona" there would be the app inventing a fact.
 */
interface PriceView {
  /** The chosen shop's chain, in the reader's language, for every sentence here. */
  readonly chain: string;
  /** One mark per row that has one, by `rowKey`. A row absent from it draws nothing. */
  readonly marks: ReadonlyMap<string, BasketPriceMark>;
  /** The rows this shop does not list, by `rowKey`, which sink and are marked. */
  readonly unlisted: ReadonlySet<string>;
}

function priceView(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: BasketViewContext
): PriceView | null {
  const shop = basketPricedScope(rows, state, context);
  if (shop === null) {
    return null;
  }

  const scope = context.scopes.get(shop);
  if (scope === undefined) {
    return null;
  }

  const chain = inLocale(scope.supermarketName, context.locale);
  const marks = new Map<string, BasketPriceMark>();
  const unlisted = new Set<string>();

  for (const row of rows) {
    const product = basketRowPick(row, context.products);
    if (product === undefined) {
      // No product, or one the catalog can no longer resolve. There is nothing to
      // be unlisted, so the row says nothing and never sinks.
      continue;
    }

    const here = offerAt(product, shop);
    const best = cheapestElsewhere(product, shop, context);

    if (here === null) {
      unlisted.add(row.rowKey);
      marks.set(row.rowKey, { kind: 'unlisted', chain, elsewhere: best });
      continue;
    }

    // A scope can carry a product with no number on it, which is listed and
    // unpriced. Nothing can be called cheaper than a price that does not exist.
    if (here.price !== null && best !== null && best.price < here.price) {
      marks.set(row.rowKey, {
        kind: 'cheaper',
        price: best.price,
        currency: best.currency,
        chain: best.chain,
      });
    }
  }

  return { chain, marks, unlisted };
}

/**
 * The scope every row on this screen quotes, or null for the cheapest anywhere
 * (velista `0078`, sections 5 and 5.1).
 *
 * Exported because the **row component** needs the same answer the pipeline needs:
 * it draws `offerAt(pick, this)` where it used to draw the cheapest, and a row that
 * read `BasketViewState.shop` directly would quote nothing at all on a basket where
 * this says null. One question, so the price a row shows and the marks the pipeline
 * writes cannot come from different shops.
 *
 * Three ways to answer null, and the third is the one that matters today. No shop is
 * chosen. A shop this basket was not priced at, which a remembered choice can be
 * (`0076`). Or **a shop that lists nothing on this basket**: staging and production
 * carry no prices, a profile's shops exist whether or not the harvester has reached
 * them, and a shop nobody has priced is not a shop that stocks nothing. One priced
 * product is enough to say the harvester has been to this chain, which is what makes
 * its silence about the rest worth drawing.
 */
export function basketPricedScope(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: Pick<BasketViewContext, 'products' | 'scopes'>
): string | null {
  const shop = state.shop;
  if (shop === null || !context.scopes.has(shop)) {
    return null;
  }

  const priced = rows.some(
    (row) => offerAt(basketRowPick(row, context.products), shop) !== null
  );
  return priced ? shop : null;
}

/**
 * The cheapest price any **other** scope on this basket quotes, and who quotes it.
 *
 * A minimum rather than the first entry, although backend `0109` sorts them cheapest
 * first: an ordering promised by a response is not one this file can be held to, and
 * the scan is over a handful of offers.
 *
 * A scope {@link BasketViewContext.scopes} cannot name is skipped rather than drawn
 * with its id. "1.99 € at 7f3c…" is not a sentence, and the offer it came
 * from is still counted by nothing else on the screen.
 */
function cheapestElsewhere(
  product: BasketProduct,
  shop: string,
  context: BasketViewContext
): { price: number; currency: string | null; chain: string } | null {
  let best: { price: number; currency: string | null; chain: string } | null =
    null;

  for (const offer of product.offers) {
    if (offer.priceScopeId === shop || offer.price === null) {
      continue;
    }
    const scope = context.scopes.get(offer.priceScopeId);
    if (scope === undefined) {
      continue;
    }
    if (best === null || offer.price < best.price) {
      best = {
        price: offer.price,
        currency: offer.currency,
        chain: inLocale(scope.supermarketName, context.locale),
      };
    }
  }

  return best;
}

/**
 * Put the rows the chosen shop does not list at the end, and the `REMOVED` rows
 * below those.
 *
 * A stable partition and not a sort, so two sunk rows come out in the order the
 * step before put them in, and so does everything above them. By identity when
 * nothing sank, which is every basket until somebody picks a shop.
 *
 * `REMOVED` is last of all and unconditional: a row somebody took off the basket
 * is a fact about it rather than a thing to buy, so it never sits among the
 * things still to buy, whatever shop is chosen.
 */
function sinkUnlisted(
  rows: readonly BasketRow[],
  prices: PriceView | null
): readonly BasketRow[] {
  const sinksForPrice = prices !== null && prices.unlisted.size > 0;
  const hasRemoved = rows.some((row) => row.state === 'REMOVED');
  if (!sinksForPrice && !hasRemoved) {
    return rows;
  }

  const held: BasketRow[] = [];
  const sunk: BasketRow[] = [];
  const removed: BasketRow[] = [];
  for (const row of rows) {
    if (row.state === 'REMOVED') {
      removed.push(row);
    } else if (prices !== null && prices.unlisted.has(row.rowKey)) {
      sunk.push(row);
    } else {
      held.push(row);
    }
  }
  return [...held, ...sunk, ...removed];
}

/** Step one: the search, and then the lists. */
function filterRows(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketRow[] {
  const searched =
    context.query === ''
      ? rows
      : rows.filter(
          (row) =>
            row.state === 'REMOVED' ||
            matchesBasketRow(
              row,
              basketRowPick(row, context.products),
              context.query,
              context.locale
            )
        );

  const lists = state.lists;
  if (lists === null) {
    return searched;
  }

  return searched.filter((row) => keptByLists(row, lists));
}

/**
 * Whether the list filter keeps one row (velista `0090`, section 8.2).
 *
 * Three cases and they are three. A row with **any** served entry on a kept list
 * stays, which is the filter doing its job. A row with an entry this reader was
 * not served stays too, because **a reader cannot filter out what they cannot
 * name**: the entry might be on a kept list and there is no way to ask. And a
 * `REMOVED` row stays whatever the filter says, for the reason it also sinks.
 *
 * This is the successor of "lines on no list yet are always shown" (velista
 * `0075`, section 6). No such line exists now, and the sentence that replaced it
 * is about redaction rather than about a line nobody has claimed.
 */
function keptByLists(row: BasketRow, lists: ReadonlySet<string>): boolean {
  if (row.state === 'REMOVED') {
    return true;
  }
  return row.entries.some(
    (entry) => entry.listId === null || lists.has(entry.listId)
  );
}

/** Step two: the server's order, or the one this app computes. */
function orderRows(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketRow[] {
  if (state.order !== 'alpha') {
    // By identity, not by a copy. This is the order the array already holds, which
    // backend `0110` makes the order the shopper walks, so there is nothing to do.
    return rows;
  }

  // Base sensitivity, so "Ávila" sorts with "Avila" and "leche" with "Leche": a
  // shopper scanning an alphabetical list does not hold the accent rules of their
  // own language in mind while doing it.
  const collator = new Intl.Collator(context.locale, { sensitivity: 'base' });
  // Copied before sorting, because `sort` mutates and the array it was handed is
  // the store's own. `sort` is stable, so rows that collate equal keep the order
  // the step before gave them.
  return [...rows].sort((left, right) =>
    collator.compare(left.content, right.content)
  );
}

/** Step three: cut the ordered rows into sections, however the shopper asked. */
function groupRows(
  rows: readonly BasketRow[],
  state: BasketViewState,
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  if (state.grouping === 'category') {
    return byCategory(rows, context, prices);
  }
  if (state.grouping === 'list') {
    return byList(rows, context, prices);
  }
  return ungrouped(rows, prices);
}

/**
 * Nothing is grouped: one unheaded section, plus the shop's sink when something
 * sank.
 *
 * There used to be a second sink here, for lines no household had accepted yet,
 * drawn while the list filter was on. Backend `0136` removed the thing it held: a
 * line is on a list or it does not exist. What is left is `0078`'s sink, which is
 * unconditional, because a shopper who asked for one shop's prices asked exactly
 * the question it answers.
 *
 * The sink is a **section** rather than a caption here because there are no other
 * sections to put a caption inside, which is the rule `0078`'s sink already
 * follows: a sink is a section when there are no sections, and a caption when
 * there are.
 */
function ungrouped(
  rows: readonly BasketRow[],
  prices: PriceView | null
): readonly BasketViewSection[] {
  const listed: BasketRow[] = [];
  const notListed: BasketRow[] = [];

  for (const row of rows) {
    if (prices !== null && prices.unlisted.has(row.rowKey)) {
      notListed.push(row);
    } else {
      listed.push(row);
    }
  }

  const sections = [
    section(ALL_SECTION_KEY, null, null, rowsOf(listed, prices), false),
  ];
  if (notListed.length > 0 && prices !== null) {
    sections.push(
      notListedSection(prices.chain, rowsOf(notListed, prices), false)
    );
  }
  return sections;
}

/**
 * The aisle view: every row under each of its product's categories (`0077`,
 * section 3).
 *
 * ## Sections take the order of their first row
 *
 * A category is created the first time a row lands in it and the sections come out
 * in that order, which is the whole ordering rule and it needs no second one. Under
 * "The way you shop" the aisles then order the categories, which is the point of
 * that order; under A to Z the sections follow their first row's name, which reads
 * as alphabetical enough. `OTHER` is a category like the others and takes its place
 * by the same rule rather than being pushed anywhere.
 *
 * ## A row can be in two places
 *
 * {@link BasketProduct.categories} is a list, so a product carrying two puts its
 * row under two headings. `basketViewRows` counts it once, which is what keeps the
 * sheet's button from reporting more rows than the basket has.
 *
 * ## "No category" is last, always
 *
 * It holds every row with no resolved product: something somebody typed in an
 * aisle, and a row whose product the catalog can no longer name because the basket
 * has outlived it. Both are things to buy and neither has an aisle, so the heading
 * says why rather than inventing one.
 */
function byCategory(
  rows: readonly BasketRow[],
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  // Insertion ordered, which is what makes a section's place its first row's
  // place. A `Map` guarantees that; an object keyed on the same strings would not.
  const aisles = new Map<ProductCategory, BasketRow[]>();
  const noCategory: BasketRow[] = [];

  for (const row of rows) {
    const product = basketRowPick(row, context.products);
    if (product === undefined) {
      noCategory.push(row);
      continue;
    }

    for (const category of product.categories) {
      const held = aisles.get(category);
      if (held === undefined) {
        aisles.set(category, [row]);
      } else {
        held.push(row);
      }
    }
  }

  const sections: BasketViewSection[] = [];
  for (const [category, held] of aisles) {
    sections.push(
      section(
        `category:${category}`,
        { kind: 'key', key: `basket.category.${category}` },
        null,
        rowsOf(held, prices),
        true
      )
    );
  }

  if (noCategory.length > 0) {
    sections.push(
      section(
        NO_CATEGORY_SECTION_KEY,
        { kind: 'key', key: 'basket.group.noCategory' },
        'basket.group.noCategoryHint',
        rowsOf(noCategory, prices),
        true
      )
    );
  }

  return sections;
}

/**
 * The household view: each list as it was written, with its own numbers (`0077`,
 * section 4).
 *
 * One section per served list any entry is on, headed by the list's **name**, and
 * a row is drawn once per entry, so a row two households asked for is two drawn
 * rows. Each carries its entry, and the row component reads that household's own
 * numbers and state off it rather than the row's summed ones.
 *
 * ## Every entry this reader cannot place goes under one heading, last
 *
 * An entry whose `listId` is null is on a list this reader was not served. There
 * is one heading for all of them and it names none of them, which is the only
 * honest thing it can say: "Other lists". It is last, because a reader can act on
 * the sections they can name and cannot act on this one.
 *
 * The grouping is offered only when the basket serves at least one list, so on a
 * guest's screen this section would be the whole basket. That test is
 * `BasketViewStore._offersGrouping`, and it is asked before anybody reaches here.
 */
function byList(
  rows: readonly BasketRow[],
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  const lists = new Map<string, BasketViewRow[]>();
  const others: BasketViewRow[] = [];

  for (const row of rows) {
    for (const entry of row.entries) {
      const drawn: BasketViewRow = {
        // The pair, not the row's key: one row asked for by two households is two
        // drawn rows, and one key for both would have Angular destroy one.
        key: `${row.rowKey}:${entry.lineId}`,
        row,
        entry,
        priceMark: prices?.marks.get(row.rowKey) ?? null,
      };

      const listId = entry.listId;
      const ref = listId === null ? undefined : context.lists.get(listId);
      if (listId === null || ref === undefined) {
        others.push(drawn);
        continue;
      }

      const held = lists.get(listId);
      if (held === undefined) {
        lists.set(listId, [drawn]);
      } else {
        held.push(drawn);
      }
    }
  }

  const sections: BasketViewSection[] = [];
  for (const [listId, drawn] of lists) {
    sections.push(
      section(
        `list:${listId}`,
        // The name and not a key: a household calls its list what it likes. Every
        // row above answered `context.lists`, so the ref is present here.
        { kind: 'text', text: context.lists.get(listId)?.name ?? '' },
        null,
        drawn,
        true
      )
    );
  }

  if (others.length > 0) {
    sections.push(
      section(
        OTHER_LISTS_SECTION_KEY,
        { kind: 'key', key: 'basket.group.otherLists' },
        null,
        others,
        true
      )
    );
  }

  return sections;
}

/**
 * The sink for the rows the chosen shop does not list (`0078`, section 5).
 *
 * The chain is in the heading rather than only on each row, because the section is
 * the answer to "what does this shop not have" and a heading reading "Not listed"
 * would leave a reader who scrolled to it asking where. It is data inside a sentence
 * this app owns, which is what {@link BasketViewHeading}'s `args` is for.
 */
function notListedSection(
  chain: string,
  rows: readonly BasketViewRow[],
  counted: boolean
): BasketViewSection {
  return section(
    NOT_LISTED_SECTION_KEY,
    { kind: 'key', key: 'basket.group.notListed', args: { chain } },
    'basket.group.notListedHint',
    rows,
    counted
  );
}

/** A run of rows as rows about themselves, which is every grouping but by list. */
function rowsOf(
  rows: readonly BasketRow[],
  prices: PriceView | null
): readonly BasketViewRow[] {
  return rows.map((row) => ({
    key: row.rowKey,
    row,
    entry: null,
    priceMark: prices?.marks.get(row.rowKey) ?? null,
  }));
}

/**
 * One section, counted or not.
 *
 * `counted` is false for the unheaded section of an ungrouped view, where a count
 * would only repeat the sentence in the tools row above it, and true wherever there
 * is a heading to put it on.
 *
 * It counts **what the section draws**: its entries under the list grouping, where
 * each drawn row is one household's share, and its distinct rows everywhere else,
 * so a row drawn under two categories is one thing to buy and says so.
 */
function section(
  key: string,
  heading: BasketViewHeading | null,
  hint: string | null,
  rows: readonly BasketViewRow[],
  counted: boolean
): BasketViewSection {
  return {
    key,
    heading,
    hint,
    progress: counted ? basketRowsProgress(countedUnits(rows)) : null,
    rows,
  };
}

/**
 * What one section's count is taken over: its entries, or its distinct rows.
 *
 * Under the list grouping every drawn row carries an entry and the entry is what
 * the section is about, so "three of five" under a household's heading is that
 * household's own shopping. Everywhere else a row is about itself, and a row drawn
 * twice under one heading is counted once.
 */
function countedUnits(
  rows: readonly BasketViewRow[]
): readonly { readonly state: BasketRowState }[] {
  const seen = new Set<string>();
  const units: { readonly state: BasketRowState }[] = [];
  for (const drawn of rows) {
    const entry = drawn.entry;
    if (entry !== null) {
      units.push(entry);
      continue;
    }
    if (seen.has(drawn.row.rowKey)) {
      continue;
    }
    seen.add(drawn.row.rowKey);
    units.push(drawn.row);
  }
  return units;
}

/**
 * What a run of rows or entries comes to: got, had none, and how many there are
 * (velista `0090`, section 8.3).
 *
 * **It counts states and compares no number with another.** That is the whole
 * difference from `basketLinesProgress`, which asked whether a line's settled
 * amount had reached what it asked for, and is the arithmetic backend `0130`
 * section 4 took over: the server knows about closes, skips and purchases another
 * shopper made, and this side knows what it was told.
 *
 * `total` is every unit that is not `REMOVED`, because a row somebody took off the
 * basket is not a thing to buy and must not make the basket look unfinished.
 *
 * **`done` is not `finished`.** A `NOT_AVAILABLE` row is closed without anything
 * being bought, so counting it as one somebody got would report a shop that had
 * none as a purchase, which is the claim the row's own caption is careful not to
 * make.
 *
 * A spec asserts that over an unfiltered, ungrouped basket this equals the
 * server's own `Basket.progress`, so the heading of a section and the sentence
 * above it cannot disagree about what "got" means.
 */
export function basketRowsProgress(
  units: readonly { readonly state: BasketRowState }[]
): BasketProgress {
  let done = 0;
  let unavailable = 0;
  let total = 0;

  for (const unit of units) {
    if (unit.state === 'REMOVED') {
      continue;
    }
    total += 1;
    if (unit.state === 'DONE') {
      done += 1;
    } else if (unit.state === 'NOT_AVAILABLE') {
      unavailable += 1;
    }
  }

  return { done, unavailable, total };
}

/**
 * The distinct rows a set of sections draws, in the order they are drawn.
 *
 * **Distinct**, because `0077` draws a row asked for by three households three
 * times, once per entry, and a count that said twelve of nine would be worse than
 * no count. What the sheet's button and the chip row's count both say is this
 * length, so there is one answer to "how many rows am I looking at" rather than
 * two that agree until somebody groups by list.
 */
export function basketViewRows(
  sections: readonly BasketViewSection[]
): readonly BasketRow[] {
  const seen = new Set<string>();
  const rows: BasketRow[] = [];
  for (const part of sections) {
    for (const drawn of part.rows) {
      if (seen.has(drawn.row.rowKey)) {
        continue;
      }
      seen.add(drawn.row.rowKey);
      rows.push(drawn.row);
    }
  }
  return rows;
}

/** One chip on the page, naming a property that is not at its default. */
export interface BasketViewChip {
  /** Which property this chip's x puts back to its default. */
  readonly property: BasketViewProperty;
  /** The translation key for the chip's words. */
  readonly key: string;
  /** What that key interpolates, or null when it takes nothing. */
  readonly args: Readonly<Record<string, string | number>> | null;
}

/**
 * What the chip row draws, one chip per property that is not at its default
 * (velista `0075`, section 5).
 *
 * Order and grouping are chipped even though neither hides a single line. The row
 * is how the state of this screen is understood **without opening the sheet**, and
 * a basket that is suddenly alphabetical with nothing saying so looks broken to the
 * next person handed the phone.
 *
 * The shop's chip is the chain's name alone rather than the shop's: the chip row is
 * one line on a 390 wide phone, and "Mercadona" is what distinguishes this view
 * from the default while a street name is what distinguishes one Mercadona from
 * another. `0078` is what fills `chainName` in; until then a chosen shop chips its
 * own id, which no reader can reach because that plan draws the control that sets
 * it.
 */
export function basketViewChips(
  state: BasketViewState,
  names: {
    /** The served lists by id, for the one list case (velista `0090`). */
    readonly lists: ReadonlyMap<string, BasketListRef>;
    /** How many source lists the basket has, for the several lists case. */
    readonly listCount: number;
    /** The chosen shop's chain, which `0078` supplies. */
    readonly chainName?: string | null;
  }
): readonly BasketViewChip[] {
  const chips: BasketViewChip[] = [];

  if (state.order !== DEFAULT_BASKET_VIEW_STATE.order) {
    chips.push({
      property: 'order',
      key: 'basket.view.order.alpha',
      args: null,
    });
  }

  if (state.grouping !== DEFAULT_BASKET_VIEW_STATE.grouping) {
    chips.push({
      property: 'grouping',
      key:
        state.grouping === 'category'
          ? 'basket.view.chip.byCategory'
          : 'basket.view.chip.byList',
      args: null,
    });
  }

  if (state.shop !== null) {
    chips.push({
      property: 'shop',
      key: 'basket.view.chip.shop',
      args: { name: names.chainName ?? state.shop },
    });
  }

  const lists = state.lists;
  if (lists !== null) {
    const kept = [...lists];
    // One kept list is named, because the name is the useful half and it fits. Two
    // of three is counted, because two names do not fit beside the other chips and
    // a truncated household name is worse than a number.
    const onlyName =
      kept.length === 1 ? (names.lists.get(kept[0])?.name ?? null) : null;
    chips.push(
      onlyName === null
        ? {
            property: 'lists',
            key: 'basket.view.lists.some',
            args: { kept: kept.length, total: names.listCount },
          }
        : {
            property: 'lists',
            key: 'basket.view.lists.only',
            args: { name: onlyName },
          }
    );
  }

  return chips;
}

/** How many of the four properties are not at their default, for the badge. */
export function basketViewActiveCount(state: BasketViewState): number {
  let count = 0;
  if (state.order !== DEFAULT_BASKET_VIEW_STATE.order) {
    count += 1;
  }
  if (state.grouping !== DEFAULT_BASKET_VIEW_STATE.grouping) {
    count += 1;
  }
  if (state.shop !== null) {
    count += 1;
  }
  if (state.lists !== null) {
    count += 1;
  }
  return count;
}

/**
 * Put one property back to its default, which is what a chip's x does.
 *
 * Here rather than four methods on the store, so that the chip row has one thing to
 * call with the property it is holding and cannot get the mapping wrong.
 */
export function resetBasketViewProperty(
  state: BasketViewState,
  property: BasketViewProperty
): BasketViewState {
  return { ...state, [property]: DEFAULT_BASKET_VIEW_STATE[property] };
}
