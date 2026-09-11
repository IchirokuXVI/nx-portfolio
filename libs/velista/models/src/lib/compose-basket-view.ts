import { matchesBasketLine } from './basket-search';
import type {
  BasketLine,
  BasketLineOrigin,
  BasketPriceScope,
  BasketProduct,
  BasketProgress,
} from './basket-view';
import { basketLinesProgress, offerAt } from './basket-view';
import type { ProductCategory } from './enums';
import { inLocale } from './shopping-profile';

/**
 * How the basket's lines are ordered (velista `0075`, section 2).
 *
 * `shop` is the order the server wrote, which backend `0110` makes the order the
 * shopper walks: it needs no client work at all, because it is the order
 * `BasketStore.lines` already arrives in. `alpha` is the only order this app
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
  /** The search, exactly as typed. Empty matches every line. */
  readonly query: string;
  readonly products: ReadonlyMap<string, BasketProduct>;
  readonly locale: string;
  /**
   * The source lists by name, for the headings of the list grouping (`0077`).
   *
   * Empty for a reader who may not see origins, which is what keeps that grouping
   * out of their view without a `seesZoneData` branch in here. **A list with no name
   * is not headed**, which is the rule `originsCaption` and the filter sheet's own
   * rows already follow for the same data: a heading with no words is a section
   * nobody can read.
   */
  readonly listNames: ReadonlyMap<string, string>;
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
 * The strings are **resolved**, not keys with data hanging off them: the chain's
 * name is server data in the reader's language, and `inLocale` needs a locale the
 * page has no business re-deriving per row. What is left to the page is the
 * sentence around them, which is a translation key.
 */
export type BasketRowMark =
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

/** One drawn row. A line, and under `grouping: 'list'` the origin it is drawn for. */
export interface BasketViewRow {
  /**
   * What `@for` tracks, unique inside a section.
   *
   * The line's id is not enough since `0077`: a line reaching one list through two
   * zone lines is two rows under that list's heading, and two rows tracked by one
   * key make Angular destroy one of them.
   */
  readonly key: string;
  readonly line: BasketLine;
  /**
   * The origin this row is drawn for, or null for a row that is about the whole
   * line (velista `0077`, section 4).
   *
   * A line on three lists is drawn three times under `grouping: 'list'`, each time
   * for one origin and with that list's own amounts, and this is which one. Null
   * under every other grouping, where a row is the line itself.
   */
  readonly origin: BasketLineOrigin | null;
  /**
   * What this row says about the chosen shop, or null (velista `0078`, section 5).
   *
   * Decided here rather than by the row, because the **sink** is decided here and
   * the two are one answer: a line the shop does not list is marked and moved, and
   * a component working the first half out for itself is a second place for them to
   * disagree. Null on every row while no shop is chosen.
   */
  readonly mark: BasketRowMark | null;
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
   * What this section's own lines come to, or null where there is one section
   * (velista `0077`, section 3).
   *
   * A section is a whole screen's worth of shopping when the view is grouped by
   * list, and saying how much of **it** is done is the point of grouping that way.
   * Null for the unheaded section of an ungrouped view, where it would only repeat
   * the sentence in the tools row above it.
   *
   * Counted over the section's **distinct lines**, by the same function the whole
   * basket's own sentence is counted by, so a heading and the sentence above it can
   * never disagree about what "got" means.
   */
  readonly progress: BasketProgress | null;
  readonly rows: readonly BasketViewRow[];
}

/** The one section an ungrouped, unfiltered basket is drawn as. */
const ALL_SECTION_KEY = 'all';

/** The sink holding lines no household has accepted yet (section 6). */
const NO_LIST_SECTION_KEY = 'no-list';

/** The sink holding every line with no product to take a category from (`0077`). */
const NO_CATEGORY_SECTION_KEY = 'no-category';

/** The sink holding the lines the chosen shop does not list (`0078`, section 5). */
const NOT_LISTED_SECTION_KEY = 'not-listed';

/**
 * Turn a basket's lines into the sections a page draws (velista `0075`,
 * section 3).
 *
 * ## Three steps, in this order and no other
 *
 * 1. **Filter.** The search (`0074`) and the list filter (section 6) decide which
 *    lines stay.
 * 2. **Order.** The server's position, or A to Z.
 * 3. **Group.** The ordered lines are cut into sections.
 *
 * Filter, then order, then group, so a line keeps whatever place the order gave it
 * **inside** its group: four lines of one category come out in the order the whole
 * basket put them in, which is why grouping needs no ordering rule of its own.
 * Reversing the last two would let a group impose an order the shopper did not
 * choose.
 *
 * ## The sink is part of the order, and that is why it is second
 *
 * A line the chosen shop does not list goes last (velista `0078`, section 5), and
 * it goes last **before** anything is cut up, which is one partition rather than one
 * per section. Grouping then keeps it: the sunk lines are already at the end of the
 * array, so each category and each list ends with its own, in the order they were
 * in. Sinking after grouping would need the rule written once per grouping, and the
 * three copies would eventually disagree.
 */
export function composeBasketView(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketViewSection[] {
  // Over the whole basket rather than over what survived the filter: a search that
  // hides eight rows must not change what the ninth says about the shop, and the
  // "has this shop priced anything" test below is a fact about the basket.
  const prices = priceView(lines, state, context);
  const kept = filterLines(lines, state, context);
  const ordered = orderLines(kept, state, context);
  const sunk = sinkUnlisted(ordered, prices);
  return groupLines(sunk, state, context, prices);
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
  /** One mark per line that has one. A line absent from it draws nothing. */
  readonly marks: ReadonlyMap<string, BasketRowMark>;
  /** The lines this shop does not list, which sink and are marked. */
  readonly unlisted: ReadonlySet<string>;
}

function priceView(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext
): PriceView | null {
  const shop = basketPricedScope(lines, state, context);
  if (shop === null) {
    return null;
  }

  const scope = context.scopes.get(shop);
  if (scope === undefined) {
    return null;
  }

  const chain = inLocale(scope.supermarketName, context.locale);
  const picked = lines.map((line) => pickOf(line, context));
  const marks = new Map<string, BasketRowMark>();
  const unlisted = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const product = picked[index];
    if (product === undefined) {
      // No pick, or a pick the catalog can no longer resolve. There is nothing to
      // be unlisted, so the row says nothing and never sinks.
      continue;
    }

    const here = offerAt(product, shop);
    const best = cheapestElsewhere(product, shop, context);

    if (here === null) {
      unlisted.add(line.id);
      marks.set(line.id, { kind: 'unlisted', chain, elsewhere: best });
      continue;
    }

    // A scope can carry a product with no number on it, which is listed and
    // unpriced. Nothing can be called cheaper than a price that does not exist.
    if (here.price !== null && best !== null && best.price < here.price) {
      marks.set(line.id, {
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
 * Exported because the **row** needs the same answer the pipeline needs: it draws
 * `offerAt(pick, this)` where it used to draw the cheapest, and a row that read
 * `BasketViewState.shop` directly would quote nothing at all on a basket where this
 * says null. One question, so the price a row shows and the marks the pipeline
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
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: Pick<BasketViewContext, 'products' | 'scopes'>
): string | null {
  const shop = state.shop;
  if (shop === null || !context.scopes.has(shop)) {
    return null;
  }

  const priced = lines.some(
    (line) => offerAt(pickOf(line, context), shop) !== null
  );
  return priced ? shop : null;
}

/** The product a line means, or undefined for a line that means none. */
function pickOf(
  line: BasketLine,
  context: Pick<BasketViewContext, 'products'>
): BasketProduct | undefined {
  const pickId = line.pickId;
  return pickId === null ? undefined : context.products.get(pickId);
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
 * Put the lines the chosen shop does not list at the end, keeping their order.
 *
 * A stable partition and not a sort, so two sunk lines come out in the order the
 * step before put them in, and so does everything above them. By identity when
 * nothing sank, which is every basket until somebody picks a shop.
 */
function sinkUnlisted(
  lines: readonly BasketLine[],
  prices: PriceView | null
): readonly BasketLine[] {
  if (prices === null || prices.unlisted.size === 0) {
    return lines;
  }

  const held: BasketLine[] = [];
  const sunk: BasketLine[] = [];
  for (const line of lines) {
    if (prices.unlisted.has(line.id)) {
      sunk.push(line);
    } else {
      held.push(line);
    }
  }
  return [...held, ...sunk];
}

/** Step one: the search, and then the lists. */
function filterLines(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketLine[] {
  const searched =
    context.query === ''
      ? lines
      : lines.filter((line) =>
          matchesBasketLine(
            line,
            context.products.get(line.pickId ?? ''),
            context.query,
            context.locale
          )
        );

  const lists = state.lists;
  if (lists === null) {
    return searched;
  }

  return searched.filter((line) => keptByLists(line, lists));
}

/**
 * Whether the list filter keeps one line.
 *
 * Three cases and they are three, not two. A line with **any** origin on a kept
 * list stays, which is the filter doing its job. A line whose `origins` is present
 * and **empty** has reached no household yet and always stays (section 6): a
 * filter for one list must never hide what somebody typed in the aisle thirty
 * seconds ago. And a line whose `origins` is **absent** belongs to a reader who may
 * not see origins at all, which is a different thing from a line with none, and it
 * stays too, because there is nothing here to filter it on.
 *
 * Collapsing the last two is the bug `originsCaption` is also careful about: one is
 * redaction and the other is a fact about the line.
 */
function keptByLists(line: BasketLine, lists: ReadonlySet<string>): boolean {
  const origins = line.origins;
  if (origins === undefined || origins.length === 0) {
    return true;
  }
  return origins.some((origin) => lists.has(origin.listId));
}

/** Step two: the server's order, or the one this app computes. */
function orderLines(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketLine[] {
  if (state.order !== 'alpha') {
    // By identity, not by a copy. This is the order the array already holds, which
    // backend `0110` makes the order the shopper walks, so there is nothing to do.
    return lines;
  }

  // Base sensitivity, so "Ávila" sorts with "Avila" and "leche" with "Leche": a
  // shopper scanning an alphabetical list does not hold the accent rules of their
  // own language in mind while doing it.
  const collator = new Intl.Collator(context.locale, { sensitivity: 'base' });
  // Copied before sorting, because `sort` mutates and the array it was handed is
  // the store's own. `sort` is stable, so lines that collate equal keep the order
  // the step before gave them.
  return [...lines].sort((left, right) =>
    collator.compare(left.content, right.content)
  );
}

/** Step three: cut the ordered lines into sections, however the shopper asked. */
function groupLines(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  if (state.grouping === 'category') {
    return byCategory(lines, context, prices);
  }
  if (state.grouping === 'list') {
    return byList(lines, context, prices);
  }
  return ungrouped(lines, state, prices);
}

/**
 * Nothing is grouped: one unheaded section, plus the sink when the list filter is
 * on and something is in it.
 *
 * The sink is a **section** rather than a caption here because there are no other
 * sections to put a caption inside, which is the rule `0078`'s sink follows too: a
 * sink is a section when there are no sections, and a caption when there are.
 *
 * It exists only while the list filter is on. With no filter the basket is drawn in
 * the order the shopper walks and nothing else, and pulling the aisle's own lines
 * to the bottom under a heading would be a reordering nobody asked for.
 *
 * ## Two sinks, and the shop's is last and wins
 *
 * `0078`'s sink is unconditional, unlike the one above it: it is drawn whenever a
 * shop is chosen and something sank, because a shopper who asked for one shop's
 * prices asked exactly this question. A line that is both unlisted **and** on no
 * list goes to the shop's sink, which is the more useful of the two sentences to
 * somebody standing in the shop, and puts the line in one place rather than
 * splitting the unlisted lines across two headings.
 */
function ungrouped(
  lines: readonly BasketLine[],
  state: BasketViewState,
  prices: PriceView | null
): readonly BasketViewSection[] {
  const onAList: BasketLine[] = [];
  const onNoList: BasketLine[] = [];
  const notListed: BasketLine[] = [];

  for (const line of lines) {
    if (prices !== null && prices.unlisted.has(line.id)) {
      notListed.push(line);
    } else if (state.lists !== null && isOnNoList(line)) {
      onNoList.push(line);
    } else {
      onAList.push(line);
    }
  }

  const sections = [
    section(ALL_SECTION_KEY, null, null, rowsOf(onAList, prices), false),
  ];
  if (onNoList.length > 0) {
    sections.push(noListSection(rowsOf(onNoList, prices), false));
  }
  if (notListed.length > 0 && prices !== null) {
    sections.push(
      notListedSection(prices.chain, rowsOf(notListed, prices), false)
    );
  }
  return sections;
}

/**
 * The aisle view: every line under each of its product's categories (`0077`,
 * section 3).
 *
 * ## Sections take the order of their first line
 *
 * A category is created the first time a line lands in it and the sections come out
 * in that order, which is the whole ordering rule and it needs no second one. Under
 * "The way you shop" the aisles then order the categories, which is the point of
 * that order; under A to Z the sections follow their first line's name, which reads
 * as alphabetical enough. `OTHER` is a category like the others and takes its place
 * by the same rule rather than being pushed anywhere.
 *
 * ## A line can be in two places
 *
 * {@link BasketProduct.categories} is a list, so a product carrying two puts its
 * line under two headings. `basketViewLines` counts it once, which is what keeps the
 * sheet's button from reporting more lines than the basket has.
 *
 * ## "No category" is last, always
 *
 * It holds every line with no resolved pick: a free text line somebody typed in an
 * aisle, and a line whose pick the products map cannot resolve because the basket
 * has outlived the catalog it was built from. Both are lines to buy and neither has
 * an aisle, so the heading says why rather than inventing one.
 */
function byCategory(
  lines: readonly BasketLine[],
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  // Insertion ordered, which is what makes a section's place its first line's
  // place. A `Map` guarantees that; an object keyed on the same strings would not.
  const aisles = new Map<ProductCategory, BasketLine[]>();
  const noCategory: BasketLine[] = [];

  for (const line of lines) {
    const pickId = line.pickId;
    const product = pickId === null ? undefined : context.products.get(pickId);
    if (product === undefined) {
      noCategory.push(line);
      continue;
    }

    for (const category of product.categories) {
      const held = aisles.get(category);
      if (held === undefined) {
        aisles.set(category, [line]);
      } else {
        held.push(line);
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
 * The household view: each list as it was written, with its own amounts (`0077`,
 * section 4).
 *
 * One section per source list any line reaches, headed by the list's **name**, and
 * a line is drawn once per origin, so a line two households asked for is two rows.
 * Each row carries its origin, and the row component reads that list's own numbers
 * off it rather than the basket's summed ones.
 *
 * ## Three kinds of line, and they are three
 *
 * A line with origins on named lists is placed under each of them. A line whose
 * `origins` is present and **empty** has reached no household yet and goes to the
 * sink at the end, which is the same sink and the same words `0075` gives those
 * lines under the list filter, so the two can never disagree.
 *
 * And a line this view **cannot place** goes in an unheaded section at the top:
 * either its `origins` is absent, which is a reader who may not see lists at all, or
 * every list it names is one {@link BasketViewContext.listNames} has no name for. A
 * redacted line must not be swept under "On no list yet", because that sentence is a
 * fact about the line and this reader has been told no facts about lists. In
 * practice the section is empty, because the grouping is not offered to a reader
 * with no source lists; it exists so that the pipeline stays total rather than
 * dropping a line off a screen somebody is shopping from.
 */
function byList(
  lines: readonly BasketLine[],
  context: BasketViewContext,
  prices: PriceView | null
): readonly BasketViewSection[] {
  const lists = new Map<string, BasketViewRow[]>();
  const unplaceable: BasketLine[] = [];
  const onNoList: BasketLine[] = [];

  for (const line of lines) {
    if (isOnNoList(line)) {
      onNoList.push(line);
      continue;
    }

    let placed = false;
    for (const origin of line.origins ?? []) {
      const name = context.listNames.get(origin.listId);
      if (name === undefined || name === '') {
        continue;
      }
      placed = true;
      const row: BasketViewRow = {
        // The origin's own id, not the line's: one list reached through two zone
        // lines is two rows under one heading, and one key for both would have
        // Angular destroy one of them.
        key: origin.id,
        line,
        origin,
        mark: prices?.marks.get(line.id) ?? null,
      };
      const held = lists.get(origin.listId);
      if (held === undefined) {
        lists.set(origin.listId, [row]);
      } else {
        held.push(row);
      }
    }

    if (!placed) {
      unplaceable.push(line);
    }
  }

  const sections: BasketViewSection[] = [];
  if (unplaceable.length > 0) {
    sections.push(
      section(ALL_SECTION_KEY, null, null, rowsOf(unplaceable, prices), true)
    );
  }

  for (const [listId, rows] of lists) {
    sections.push(
      section(
        `list:${listId}`,
        // The name and not a key: a household calls its list what it likes. Every
        // row above answered `listNames`, so it is present and non-empty here.
        { kind: 'text', text: context.listNames.get(listId) ?? '' },
        null,
        rows,
        true
      )
    );
  }

  if (onNoList.length > 0) {
    sections.push(noListSection(rowsOf(onNoList, prices), true));
  }

  return sections;
}

/**
 * Whether a line has reached no household yet, which is **not** the same question
 * as whether this reader may see the ones it reached.
 *
 * Present and empty is a fact about the line. An absent `origins` is a redaction,
 * and collapsing the two is the bug `originsCaption` is also careful about: one of
 * them would tell a guest that a line is on no list, and a guest is never told about
 * lists at all.
 */
function isOnNoList(line: BasketLine): boolean {
  return line.origins !== undefined && line.origins.length === 0;
}

/** The sink for lines nobody has accepted yet, worded once for both groupings. */
function noListSection(
  rows: readonly BasketViewRow[],
  counted: boolean
): BasketViewSection {
  return section(
    NO_LIST_SECTION_KEY,
    { kind: 'key', key: 'basket.group.noList' },
    'basket.group.noListHint',
    rows,
    counted
  );
}

/**
 * The sink for the lines the chosen shop does not list (`0078`, section 5).
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

/** A run of lines as rows about themselves, which is every grouping but by list. */
function rowsOf(
  lines: readonly BasketLine[],
  prices: PriceView | null
): readonly BasketViewRow[] {
  return lines.map((line) => ({
    key: line.id,
    line,
    origin: null,
    mark: prices?.marks.get(line.id) ?? null,
  }));
}

/**
 * One section, counted or not.
 *
 * `counted` is false for the unheaded section of an ungrouped view, where a count
 * would only repeat the sentence in the tools row above it, and true wherever there
 * is a heading to put it on. The count is over the section's **distinct** lines, so
 * a line drawn twice under one heading is one thing to buy and says so.
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
    progress: counted ? basketLinesProgress(distinctLines(rows)) : null,
    rows,
  };
}

/** The distinct lines of one run of rows, in the order they are drawn. */
function distinctLines(rows: readonly BasketViewRow[]): readonly BasketLine[] {
  const seen = new Set<string>();
  const lines: BasketLine[] = [];
  for (const row of rows) {
    if (seen.has(row.line.id)) {
      continue;
    }
    seen.add(row.line.id);
    lines.push(row.line);
  }
  return lines;
}

/**
 * The distinct lines a set of sections draws, in the order they are drawn.
 *
 * **Distinct**, because `0077` draws a line on three lists three times, once per
 * origin, and a count that said twelve of nine would be worse than no count. What
 * the sheet's button and the chip row's count both say is this length, so there is
 * one answer to "how many lines am I looking at" rather than two that agree until
 * somebody groups by list.
 */
export function basketViewLines(
  sections: readonly BasketViewSection[]
): readonly BasketLine[] {
  const seen = new Set<string>();
  const lines: BasketLine[] = [];
  for (const part of sections) {
    for (const row of part.rows) {
      if (seen.has(row.line.id)) {
        continue;
      }
      seen.add(row.line.id);
      lines.push(row.line);
    }
  }
  return lines;
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
    /** The kept lists' names, for the one list case. Absent names are skipped. */
    readonly listNames: ReadonlyMap<string, string>;
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
      kept.length === 1 ? (names.listNames.get(kept[0]) ?? null) : null;
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
