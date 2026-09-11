import { matchesBasketLine } from './basket-search';
import type {
  BasketLine,
  BasketLineOrigin,
  BasketProduct,
} from './basket-view';

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
}

/** One drawn row. A line, and under `grouping: 'list'` the origin it is drawn for. */
export interface BasketViewRow {
  readonly line: BasketLine;
  /**
   * The origin this row is drawn for, which is `0077`'s and null until then.
   *
   * A line on three lists is drawn three times under `grouping: 'list'`, each time
   * for one origin and with that list's own amounts, and this is which one. Null
   * everywhere else, including for every row this plan draws.
   */
  readonly origin: BasketLineOrigin | null;
}

/**
 * One run of rows under one heading, or the whole list when nothing is grouped.
 *
 * ## The heading is a translation key
 *
 * Both strings here are keys rather than words, because the pipeline is pure and
 * has no translator: the page resolves them. That holds for every heading this
 * plan produces, which is the one sink section, and `0077` will have to widen it:
 * a section headed by a **list name** is headed by data and not by a key, and
 * deciding how the two live in one field belongs to the plan that produces the
 * second kind.
 */
export interface BasketViewSection {
  readonly key: string;
  /** A translation key, or null for the one unheaded section of an ungrouped view. */
  readonly heading: string | null;
  /** A translation key for the words at the heading's trailing edge, or null. */
  readonly hint: string | null;
  /**
   * What this section's own lines come to, which is `0077`'s and null until then.
   *
   * A section is a whole screen's worth of shopping when the view is grouped by
   * list, and saying how much of **it** is done is the point of grouping that way.
   * Null while there is one section, where it would only repeat the tools row.
   */
  readonly progress: {
    readonly done: number;
    readonly total: number;
    readonly unavailable: number;
  } | null;
  readonly rows: readonly BasketViewRow[];
}

/** The one section an ungrouped, unfiltered basket is drawn as. */
const ALL_SECTION_KEY = 'all';

/** The sink holding lines no household has accepted yet (section 6). */
const NO_LIST_SECTION_KEY = 'no-list';

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
 * ## What is not here yet
 *
 * `grouping` is read and honoured only as far as `none`, because `0077` is what
 * cuts the lines by category and by list. The radios that set it exist in this
 * plan and are chipped by it, so the state travels before anything acts on it; a
 * basket set to `category` today draws one section, exactly as `none` does.
 * `0078`'s sink for a shop that does not list a line is likewise absent, which is
 * why {@link BasketViewState.shop} is carried and never read.
 */
export function composeBasketView(
  lines: readonly BasketLine[],
  state: BasketViewState,
  context: BasketViewContext
): readonly BasketViewSection[] {
  const kept = filterLines(lines, state, context);
  const ordered = orderLines(kept, state, context);
  return groupLines(ordered, state);
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

/**
 * Step three: cut the ordered lines into sections.
 *
 * One unheaded section, plus the sink when the list filter is on and something is
 * in it. The sink is a **section** rather than a caption here because there are no
 * other sections to put a caption inside, which is the rule `0078`'s sink follows
 * too: a sink is a section when there are no sections, and a caption when there
 * are.
 *
 * It exists only while the list filter is on. With no filter the basket is drawn in
 * the order the shopper walks and nothing else, and pulling the aisle's own lines
 * to the bottom under a heading would be a reordering nobody asked for.
 */
function groupLines(
  lines: readonly BasketLine[],
  state: BasketViewState
): readonly BasketViewSection[] {
  if (state.lists === null) {
    return [section(ALL_SECTION_KEY, null, null, lines)];
  }

  const onAList: BasketLine[] = [];
  const onNoList: BasketLine[] = [];
  for (const line of lines) {
    // Present and empty, which is the line nobody has accepted yet. An absent
    // `origins` is a redacted one and belongs with the rest: a guest is never told
    // that a line is on no list, because they are never told about lists at all.
    if (line.origins !== undefined && line.origins.length === 0) {
      onNoList.push(line);
    } else {
      onAList.push(line);
    }
  }

  const sections = [section(ALL_SECTION_KEY, null, null, onAList)];
  if (onNoList.length > 0) {
    sections.push(
      section(
        NO_LIST_SECTION_KEY,
        'basket.group.noList',
        'basket.group.noListHint',
        onNoList
      )
    );
  }
  return sections;
}

function section(
  key: string,
  heading: string | null,
  hint: string | null,
  lines: readonly BasketLine[]
): BasketViewSection {
  return {
    key,
    heading,
    hint,
    progress: null,
    rows: lines.map((line) => ({ line, origin: null })),
  };
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
