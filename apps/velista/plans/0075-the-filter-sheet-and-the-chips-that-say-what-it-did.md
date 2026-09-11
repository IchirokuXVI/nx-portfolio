> **PR:** [#345](https://github.com/IchirokuXVI/nx-portfolio/pull/345)

# 0075: the filter sheet, and the chips that say what it did

> Second of the five basket finding plans (`0074` to `0078`). This one is the sheet, the
> chips on the page that name what the sheet turned on, the order in which filtering,
> ordering and grouping are applied, and the list filter. Grouping itself is `0077` and the
> shop is `0078`, and both draw their sections into the sheet this plan builds.
>
> Server half of the default order: backend `0110`, which writes each line's position from
> the shopper's past trips. This plan draws that order and names it, and adds no client
> side ordering beyond A to Z.
>
> Prerequisite reading: `0074` (the tools row and the view store this extends), `0030`
> section 6.1 (checkboxes and radios rather than a segmented control), `0031` and `0040`
> (the sheet rules), `0044` section 4.1 (what a guest never sees) and `0065` section 2 (a
> mark that is on everything is not a mark).

## 1. What is being built

| Piece                                                               | Where                                              |
| ------------------------------------------------------------------- | -------------------------------------------------- |
| The filter button on the tools row, with its count                  | `basket-page`, a new `FilterIcon` in `velista/ui`  |
| The sheet at `sheet/filter`, its route and its export               | `filter-sheet`, `feature-shell/routes.ts`, `index.ts` |
| The view state, and the pipeline that turns lines into sections     | `BasketViewStore`, a new `compose-basket-view.ts`   |
| The chip row, one line, with the `+N` chip                          | a new `ChipRow` in `velista/ui`, `basket-page`     |
| The list filter, and the lines on no list yet                       | `compose-basket-view.ts`, `basket-page`            |
| The sheet's row in the dismissal table                              | `basket-sheet-dismissal.spec.ts`                   |
| The copy                                                            | `en.json`, `es.json`                               |

## 2. The view state

`BasketViewStore` (`0074` section 4.3) grows into the whole state of the screen:

```ts
export type BasketOrder = 'shop' | 'alpha';
export type BasketGrouping = 'none' | 'category' | 'list';

export interface BasketViewState {
  readonly order: BasketOrder;
  readonly grouping: BasketGrouping;
  /** The price scope whose prices are shown, or null for the cheapest anywhere (`0078`). */
  readonly shop: string | null;
  /** The source lists kept, or null for all of them. Never remembered. */
  readonly lists: ReadonlySet<string> | null;
}
```

`order: 'shop'` is the server's position and needs no client work: it is the order
`BasketStore.lines` already arrives in, which backend `0110` makes the order the shopper
walks. `'alpha'` sorts by `Intl.Collator(locale, { sensitivity: 'base' })` over the line
content. The default is `shop`, `none`, `null`, `null`.

Each property has a setter, and every setter applies **immediately**: the page behind the
scrim redraws as the radio is tapped. There is no draft and no apply step, for two reasons.
The count the sheet's button shows is then the truth rather than a prediction. And `0078`
leaves this sheet for the shop picker and comes back, which a draft held in the sheet's own
component does not survive.

`reset()` puts every property back to its default. `leave()` on the basket store is
mirrored: the view state returns to the defaults, and then `0076` restores what is
remembered when the next basket opens.

## 3. The pipeline

`composeBasketView(lines, state, context)` in
`libs/velista/feature-shopping-lists/src/lib/basket-view/compose-basket-view.ts` is pure
and carries the tests. Three steps, in this order and no other:

1. **Filter.** The search (`0074`) and the list filter (section 6) decide which lines
   stay.
2. **Order.** The server position, or A to Z. Then `0078`'s sink: lines the chosen shop
   does not list move to the end, keeping their relative order.
3. **Group.** `0077` cuts the ordered lines into sections. With no grouping there is one
   section with no heading.

Filter first, then order, then group, so a line keeps whatever place the order gave it
inside its group. Four lines of one category keep the order the shop filter gave them,
which is the rule the brief asked for and the reason grouping has no ordering rule of its
own.

The answer is what the page draws:

```ts
export interface BasketViewSection {
  readonly key: string;
  /** Null for the one unheaded section of an ungrouped view. */
  readonly heading: string | null;
  readonly hint: string | null;
  readonly progress: { done: number; total: number; unavailable: number } | null;
  readonly rows: readonly BasketViewRow[];
}

export interface BasketViewRow {
  readonly line: BasketLine;
  /** The mark this row carries, or null. `0078` adds `cheaperAt` and `notListed`. */
  readonly mark: BasketRowMark | null;
  /** The origin this row is drawn for, under `grouping: 'list'` (`0077`). */
  readonly origin: BasketLineOrigin | null;
}
```

`BasketViewStore.sections` is the `computed` that calls it, and `basket-page.html` replaces
its one `@for (line of lines())` with a loop over sections and their rows. The row component
is unchanged in this plan: it receives `row.line` as it received `line`.

`visibleCount` is the number of distinct lines across the sections, which is what the
sheet's button and the chip row's count say. A line drawn twice (`0077`) counts once.

## 4. The sheet

`FilterSheet`, at `sheet/filter`, declared with `sheet()` in `routes.ts` beside the
basket's four other sheets, unguarded like them, exported from `feature-shopping-lists`'s
`index.ts`, and one more row in `basket-sheet-dismissal.spec.ts`'s table.

Top to bottom, as the mock draws it:

- The title, "Filter and order", and **Reset** as a text button in the title row. Reset is
  immediate and closes nothing.
- **ORDER**, a radio group: "The way you shop", with "Calculated from your last trips"
  under it, and "A to Z".
- **GROUP BY**, a radio group: "Nothing", "Category", "List". `0077` builds what they do.
  "List" is drawn only for a reader whose lines carry `origins`, which is the same absence
  rule the row's "from" caption follows (`0044` section 4.1): the data decides, and there
  is no `seesZoneData` branch in the template beyond the one the store already answers.
- **PRICES FROM**, `0078`'s section. Absent until that plan lands, and absent for a basket
  with no scopes.
- **LISTS**, section 6. Absent for a reader with no origins.
- The footer, `sheetFooter`: one primary button, "Show 12 lines", whose number is
  `visibleCount`. It dismisses the sheet. Nothing else is in the footer, because nothing
  here is destructive and the sheet has no cancel: what was tapped is already applied.

Checkboxes and radios, never a segmented control. `0030` section 6.1 made that call for
independent options and `0024` for a choice that is not a decision, and every group here
is one of the two.

The sheet body scrolls and the footer does not (`0040`). Nothing inside the body scrolls on
its own.

## 5. The chips

Under the tools row, a `ChipRow` draws one chip per property that is not at its default:

| Property        | Chip                                   |
| --------------- | -------------------------------------- |
| `order: alpha`  | A to Z                                 |
| `grouping`      | By category, By list                   |
| `shop` (`0078`) | the chain's name alone, "Mercadona"    |
| `lists`, one    | Only Groceries                         |
| `lists`, several| 2 of 3 lists                           |

Each chip is a button whose x resets that one property, and whose accessible name says so:
"Remove: A to Z". The row's trailing edge holds the count, "7 of 12", drawn only while the
count is below the total.

**One line, never two.** The row is `white-space: nowrap` and `overflow: hidden`, and
`ChipRow` measures with a `ResizeObserver`: it draws the longest prefix of chips that fits
beside a `+N` chip, where N is how many did not. `+N` opens the sheet, because the things it
stands for are only nameable there. With nothing on, the row is not drawn at all, and the
list moves up.

The filter button on the tools row carries the same number as a badge, the count of
properties that are not at their default, and its accessible name includes it: "Filter and
order, 2 on". When nothing is on, the glyph is plain and the name is "Filter and order".

Chips for order and grouping exist even though neither hides a line: the row is how the
state is understood without opening the sheet, and a list that is suddenly grouped with no
chip saying so looks broken to the next person handed the phone.

## 6. The list filter

Drawn for a reader whose lines carry `origins`, from `BasketView.sources` and
`BasketStore.listNames`: one checkbox per source list, named "List" with the group under
it, exactly as the "from" caption names them, with the count of lines that reach that list
at the trailing edge.

A line stays when any of its origins is a kept list. Unchecking the last kept list is
refused: the checkbox does not move, because a filter that keeps nothing is not a filter.

**Lines on no list yet are always shown.** A line typed in the aisle has no origin until a
household accepts it, and a filter for one household must not hide what somebody just
added. Ungrouped, those lines sink to the end under a heading, "On no list yet", with the
hint "added in the shop". Grouped (`0077`), they go to the end of their group and the row
carries the caption "on no list yet" instead, after the "Added by" caption. The same rule
as `0078`'s sink: a sink is a section when there are no sections, and a caption when there
are.

The list filter is never remembered (`0076`) and is cleared on `leave()`. It names
households, and it is about this basket.

## 7. Realtime

Nothing here listens. `sections` is a `computed` over `BasketStore.lines`, so `apply`,
`append` and `drop` flow through it, a line that arrives lands in its section, and a full
`refresh` redraws every section from the new array. `lastAdded` and `lastSplit` are
unchanged.

## 8. Copy

| Key                              | en                                 |
| -------------------------------- | ---------------------------------- |
| `basket.view.open`               | Filter and order                   |
| `basket.view.openCount`          | Filter and order, {{count}} on     |
| `basket.view.title`              | Filter and order                   |
| `basket.view.reset`              | Reset                              |
| `basket.view.show_one`           | Show 1 line                        |
| `basket.view.show_other`         | Show {{count}} lines               |
| `basket.view.count`              | {{shown}} of {{total}}             |
| `basket.view.order.legend`       | Order                              |
| `basket.view.order.shop`         | The way you shop                   |
| `basket.view.order.shopHint`     | Calculated from your last trips    |
| `basket.view.order.alpha`        | A to Z                             |
| `basket.view.group.legend`       | Group by                           |
| `basket.view.group.none`         | Nothing                            |
| `basket.view.group.category`     | Category                           |
| `basket.view.group.list`         | List                               |
| `basket.view.group.listHint`     | each list’s own amounts            |
| `basket.view.lists.legend`       | Lists                              |
| `basket.view.lists.only`         | Only {{name}}                      |
| `basket.view.lists.some`         | {{kept}} of {{total}} lists        |
| `basket.view.chip.remove`        | Remove: {{name}}                   |
| `basket.view.chip.more`          | +{{count}}                         |
| `basket.view.chip.moreLabel`     | {{count}} more, open filter and order |
| `basket.group.noList`            | On no list yet                     |
| `basket.group.noListHint`        | added in the shop                  |
| `basket.line.noList`             | on no list yet                     |

Spanish beside each.

## 9. Accessibility

- Each radio group is a `fieldset` with a `legend`, so a screen reader hears "Order" before
  "The way you shop". Real radios and checkboxes, the label the tap target, which is the
  shape every velista checkbox already takes.
- The sheet's `labelledBy` is the title. The Reset button is in the tab order before the
  first group.
- A section heading on the page is a real heading (`h2`), the page's `h1` being the basket
  name, so groups are navigable and not only visible (`0059` section 7).
- The chip row is a list of buttons. The `+N` chip's name says what it opens.
- Nothing is conveyed by the amber tint alone: every chip has its words and every heading
  has its text.

## 10. Tests

1. `composeBasketView` applies filter, then order, then group, and a line keeps its order
   inside its group.
2. `order: 'alpha'` sorts with a base sensitivity collator, so "Ávila" sorts with "Avila".
3. The list filter keeps a line that reaches any kept list, always keeps a line with no
   origins, and refuses to uncheck the last kept list.
4. Ungrouped, lines on no list sink to the end under `basket.group.noList`, and grouped
   they sink inside their group and the row carries `basket.line.noList`.
5. Every setter applies immediately, and `reset()` restores the defaults.
6. The sheet draws the "List" grouping and the lists section only when a line carries
   `origins`.
7. The footer button is drawn with `basket.view.show` and `visibleCount`, on the key and
   its arguments.
8. The chip row draws one chip per non default property, each chip resets its property, and
   the `+N` chip appears with the right N when the row is narrower than its chips.
9. The filter button's name carries the count.
10. The route resolves `sheet/filter` to `FilterSheet`, and the dismissal table has its row.
11. `leave()` clears the list filter and the view state.

## 11. Acceptance criteria

- The basket page has a filter button beside the search, and a sheet with order, group by
  and, for a reader who sees lists, a lists section.
- Tapping an option changes the page at once, and the sheet's button says how many lines
  the page shows.
- Every option that is on is named by a chip on one line under the tools row, each chip
  removes its option, and what does not fit is one `+N` chip that opens the sheet.
- A guest never sees a list name, in the sheet, in a chip or in a heading.
- Filtering by list never hides a line that is on no list yet.
