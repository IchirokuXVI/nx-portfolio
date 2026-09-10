# 0077: grouping by category and by list

> Fourth of the five basket finding plans (`0074` to `0078`). `0075` built the sheet's
> "Group by" radios and the pipeline's third step. This plan is what the two groupings do.
>
> By category is the aisle view: dairy together, produce together, and the lines that name
> no product at the end. By list is the household view, the owner's alone: each list as it
> was written, with its own amounts, so "Eggs, 12" is drawn as the six one flat asked for
> and the six the other did.
>
> Server halves: none for category, because the category already travels with every
> product and the client drops it. Backend `0109` section 4 for the list view's
> per list amount got, which the basket read does not carry today.
>
> Prerequisite reading: `0075` section 3 (the pipeline and `BasketViewSection`), `0073`
> section 3 (what a list asked for and got, and the write that moves it), `0059` section
> 3.3 (grouping under real headings) and `0062` section 6 (no branch on the reader's kind).

## 1. What is being built

| Piece                                                        | Where                                     |
| ------------------------------------------------------------ | ----------------------------------------- |
| The product's category, on the client model                  | `BasketProduct`, `basket-mappers.ts`, `models` |
| The two groupings, in the pipeline                           | `compose-basket-view.ts`                  |
| Section headings with a count, on the page                   | `basket-page`                             |
| The row under the list grouping: one list's amount, and its reel | `basket-line-row`                     |
| The copy: twelve category names and the headings             | `en.json`, `es.json`                      |

## 2. The category reaches the client

`ItemView.category` is required on the wire and is an enum of twelve values, `PRODUCE`,
`DAIRY`, `BAKERY`, `MEAT`, `SEAFOOD`, `FROZEN`, `BEVERAGES`, `SNACKS`, `PANTRY`,
`HOUSEHOLD`, `PERSONAL_CARE` and `OTHER`. It travels with every basket product since the
catalog exists, and `toBasketProduct` reads `id`, `name`, `brand`, `unitSize`,
`defaultUnit` and `bestOffer` and drops it.

`libs/velista/models` gains its own list, by rule D4:

```ts
export const PRODUCT_CATEGORIES = [
  'PRODUCE', 'DAIRY', 'BAKERY', 'MEAT', 'SEAFOOD', 'FROZEN', 'BEVERAGES',
  'SNACKS', 'PANTRY', 'HOUSEHOLD', 'PERSONAL_CARE', 'OTHER',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
```

and `BasketProduct` gains `readonly categories: readonly ProductCategory[]`. A list and
not one value, because the brief says a product will one day carry several, and a pipeline
written over a list costs nothing today and nothing then. The mapper reads the one wire
value into a one element list, and a value it does not recognise maps to `OTHER` rather
than to a dropped product.

The twelve names are twelve keys, `basket.category.<VALUE>`, in the reader's language.
There is no fetch for them.

## 3. By category

The pipeline's third step, for `grouping: 'category'`:

- Every line with a resolved pick is placed in the section of each of its pick's
  categories. Today that is one section per line. When a product carries two, the line is
  drawn twice, once in each, and `visibleCount` still counts it once.
- **Sections take the order of their first line.** The category whose first line comes
  first in the ordered list is the first section. Under "The way you shop" that makes the
  aisles order the categories, which is the point of the order. Under A to Z the sections
  are ordered by their first line's name, which reads as alphabetical enough and needs no
  second rule.
- `OTHER` is a category like the others and takes its place by the same rule.
- **"No category" is last**, always, and holds every line with no pick: a free text line,
  and a line whose pick the products map does not resolve. Its heading says why: "No
  category", with the hint "lines with no product".

A heading carries a count: "1 of 3 got", in the shape the page's own progress sentence
takes, or "1 not available" when that is the only settled line in it. The section's
`progress` field (`0075` section 3) is the source, and the same key family as the page's
progress is reused so the two never disagree in wording.

## 4. By list

For `grouping: 'list'`, offered only when the lines carry `origins`, which is the same
absence rule as everything else zone shaped on this screen:

- One section per source list that any line reaches, headed by the list's name as
  `listNames` gives it, "Weekly shop · Flat 3B", and ordered by first line like every other
  grouping.
- A line is drawn once per origin, under that list's section, and the row is handed the
  origin: `BasketViewRow.origin`. A line asked for by two lists is two rows.
- Lines with no origin go to the end under "On no list yet", which is `0075`'s section for
  the same lines under the list filter, so the two never disagree.

### 4.1 The row under this grouping

A row with an `origin` draws **that list's amount**, not the basket's:

| What                       | Ungrouped, or by category         | By list                                             |
| -------------------------- | --------------------------------- | --------------------------------------------------- |
| The reel's ceiling         | `line.quantity`                   | `origin.quantity`                                   |
| The reel's value           | the line's outstanding            | `origin.quantity - origin.settled`                  |
| The partly caption         | `settled of quantity got`         | `origin.settled of origin.quantity got`             |
| The commit                 | `setOutstanding`, the whole line  | `setOriginSettled` with `from: origin.settled`      |
| The status glyph           | the line's                        | the line's                                          |

`origin.settled` is what backend `0109` section 4 adds to the origin on the basket read.
The commit is `0073`'s per list write, which already exists and already answers with the
whole line, so the row redraws from the answer exactly as the settle sheet's rows do. The
"from Weekly shop" caption is not drawn on a row that sits under that list's heading: it is
the heading.

The status glyph stays the line's. A tick beside "6 of 6 got" under one list while the
other list's six are still to get is a contradiction, so the glyph reads the line and the
number reads the origin, and the caption between them says which is which: "this list
asked for 6 of the 12".

## 5. Copy

| Key                               | en                              |
| --------------------------------- | ------------------------------- |
| `basket.category.PRODUCE`         | Produce                         |
| `basket.category.DAIRY`           | Dairy                           |
| `basket.category.BAKERY`          | Bakery                          |
| `basket.category.MEAT`            | Meat                            |
| `basket.category.SEAFOOD`         | Seafood                         |
| `basket.category.FROZEN`          | Frozen                          |
| `basket.category.BEVERAGES`       | Beverages                       |
| `basket.category.SNACKS`          | Snacks                          |
| `basket.category.PANTRY`          | Pantry                          |
| `basket.category.HOUSEHOLD`       | Household                       |
| `basket.category.PERSONAL_CARE`   | Personal care                   |
| `basket.category.OTHER`           | Other                           |
| `basket.group.noCategory`         | No category                     |
| `basket.group.noCategoryHint`     | lines with no product           |
| `basket.group.progress`           | {{done}} of {{total}} got       |
| `basket.group.unavailable_one`    | {{count}} not available         |
| `basket.group.unavailable_other`  | {{count}} not available         |
| `basket.line.listShare`           | this list asked for {{asked}} of the {{total}} |
| `basket.line.listPartly`          | {{settled}} of {{asked}} got    |

Spanish beside each.

## 6. Accessibility

- A section heading is an `h2` carrying the name and the count in one accessible name,
  "Dairy, 1 of 3 got", so a reader moving by heading hears both.
- A line drawn twice is two rows with the same accessible name, which is true: the same
  line is in two places. Nothing is announced twice on a change, because the live region
  is the page's and says the line, not the row.
- The reel under the list grouping keeps its name and adds the list, "Flat, Eggs, still to
  get", which is the shape `0073` gave the settle sheet's per list reels.

## 7. Tests

1. `toBasketProduct` maps the wire category into a one element list, and an unknown value
   into `OTHER`.
2. By category places a line under each of its categories and counts it once.
3. Sections take the order of their first line, `OTHER` included, and "No category" is
   last with every line that has no resolved pick.
4. A heading is drawn with `basket.group.progress` and the section's own counts, on the key
   and its arguments.
5. By list draws one row per origin under that list's heading, and lines with no origin
   under "On no list yet".
6. A row with an origin bounds its reel by the origin's quantity, shows the origin's
   settled amount, and commits through `setOriginSettled` with the origin's settled as
   `from`.
7. The "from" caption is not drawn on a row under its own list's heading.
8. The "List" radio is absent when no line carries `origins`, and a remembered `list`
   grouping degrades to none for that reader (`0076` test 6).
9. Filter, then order, then group: a line keeps the order the shop sink gave it inside
   its category.

## 8. Acceptance criteria

- Grouped by category, every line with a product sits under its category's heading, the
  headings follow the shopper's order, and lines without a product are last under a heading
  that says why.
- Grouped by list, the owner reads each list as it was written, with that list's own
  amounts, and moving a row's number changes what that list got and nothing else.
- A guest is never offered the list grouping and never sees a list name.
- The search, the list filter and the shop keep working inside every grouping.
