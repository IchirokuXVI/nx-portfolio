> **PR:** [#341](https://github.com/IchirokuXVI/nx-portfolio/pull/341)

# 0074: the tools row, and a search that runs in memory

> The first of five plans that give the basket page a way to find a line. This one adds the
> row the other four hang their controls on, and the search. `0075` is the filter sheet and
> the chips, `0076` is what the sheet remembers, `0077` is grouping by category and by list,
> `0078` is prices from one shop. Backend `0109` and `0110` are the server halves of `0078`
> and of the default order named in `0075`.
>
> The basket draws its lines in server order and nothing else. With twelve lines that is
> fine. With forty, from three households, in a shop, it is not possible to find the line
> for the shelf you are standing in front of, and the person looking is often a guest who
> has never seen the app.
>
> This plan adds a search that runs on the phone, over what the page already holds. No
> request leaves the device, because every line and every product name is already in the
> store.
>
> Prerequisite reading: `0044` section 4 (the three readers), `0052` section 6 (the row),
> `0059` section 3.1 (the only search field velista has drawn) and `0062` section 2 (no
> layout depends on a price existing).

## 1. What is being built

| Piece                                                            | Where                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| The tools row under the title, holding the count and the search  | `basket-page`                                         |
| The matcher, pure                                                | a new `basket-search.ts` in `feature-shopping-lists`  |
| The view store the page reads its visible lines from             | a new `BasketViewStore` in `data-access`              |
| The search field, its result count and its no match state        | `basket-page`                                         |
| The highlighted match on the row                                 | `basket-line-row`                                     |
| The copy                                                         | `en.json`, `es.json`                                  |

## 2. Mock

Drawn in `mocks/basket-filter/`, published at
<https://claude.ai/code/artifact/82b53f55-a8a6-41bc-a019-6222a23f44c5>, approved on
2026-09-11. The `Tools.dc.html` artboard is this plan: at rest, search open, and the third
frame, which is `0075`'s. The `Lists.dc.html` artboard's second frame is the no match state.

Phone frames 390 by 844, Night only: every colour role here is already proven on Day by
`0003`, so the mock README's rule says no Day artboard is drawn.

## 3. The tools row

The progress sentence the page already draws ("4 of 12 got") moves into a row of its own
under the title bar, with the sentence at the leading edge and the controls at the trailing
edge. This plan puts one control there, the search button. `0075` puts the filter button
beside it.

**Not the header.** The header already holds back, the title, the faces, share and finish.
A sixth and seventh control there shrink the title to nothing on a 390 wide phone, and the
title is the one thing on that bar a person reads. The row under it is empty at the
trailing edge, and the count it holds is about the lines, which is what the two controls
are about too.

The row is drawn for every reader, guests included. Nothing in it names a household.

## 4. The search

### 4.1 Opening

Tapping the search button replaces the row with the field: a `type="search"` input with
the search glyph at its leading edge, a clear control inside it at the trailing edge, and
a Cancel text button after it. The field takes focus when it appears. The count and the
search button return when the search is cancelled, and Cancel also clears the query.

The field is 16px, because rule T3 (`0002` section 6.1) forbids a smaller input, and it
carries `enterkeyhint="search"`, `autocomplete="off"` and `autocapitalize="none"`, which
is what the supermarkets page's field carries.

Escape cancels the search, exactly as Cancel does, and focus returns to the search button.

### 4.2 Matching

`matchesBasketLine(line, product, query, locale)` in `basket-search.ts` is pure and carries
the tests. It folds both sides the same way: `normalize('NFD')`, the combining marks
stripped, lower cased, whitespace collapsed. A line matches when the folded query is a
substring of the folded line content, or of the folded name of its pick in the reader's
locale (`inLocale(product.name, locale)`), or of the pick's brand.

So "platano" finds Plátano, "MILK" finds milk, and "hacendado" finds every line whose pick
is that brand, which is what somebody standing at the own brand shelf types.

There is no minimum length and no debounce. `SUGGEST_MIN_CHARS` and `SUGGEST_DEBOUNCE_MS`
belong to the composer's typeahead, which asks the server. This search asks a `computed`.

An empty query matches everything, so the page draws the same list with the field open as
with it closed, and the count says so.

### 4.3 The store

`BasketViewStore` is a new `@Injectable()` in
`libs/velista/data-access/src/lib/generated-lists/basket-view-store.ts`, **provided on the
basket route beside `BasketStore`** in `routes.ts` (`providers: [BasketSocket, BasketStore,
BasketViewStore]`), for the reason `BasketStore` is: the sheets `0075` and `0078` add are
child routes of the page, and a store the page provided on its own component is not one a
sibling route can be sure to reach.

In this plan it holds one thing, the query:

```ts
readonly query = signal('');
readonly searching = computed(() => this.query() !== '');
```

and it answers `visibleLines`, which `0075` grows into the whole pipeline:

```ts
readonly visibleLines = computed(() =>
  this._basket.lines().filter((line) =>
    matchesBasketLine(line, this._basket.products().get(line.pickId ?? ''), this.query(), locale)
  )
);
```

`BasketStore.lines` stays exactly what it is, and `progress` keeps counting the whole
basket. The search hides rows. It never changes what "4 of 12 got" means.

`leave()` clears the query, so a basket opened later does not start searched.

### 4.4 The count

Under the field, one line: "3 of 12 lines", `role="status"`, `aria-live="polite"`. A
search that silently empties the screen is indistinguishable from one that broke (`0059`
section 7), and the count is what tells the two apart. It is drawn only while the field is
open.

### 4.5 The highlight

The row takes a `highlight` input, the folded query, and draws the first match in its
content inside a `<mark>` with the quiet action tint. The product caption is matched but
not highlighted: it is 12px muted text, and a mark on it competes with the name it sits
beside. Nothing else on the row changes, so a highlighted row and an ordinary one are the
same height.

### 4.6 Nothing matches

The list area draws an empty state in the shape of the basket's own (`0044`), with
different words: "No line matches “yogurt”" and, under it, "Add it below and it goes on
this list." The composer stays, because the thing somebody searched for and did not find is
very often the next line.

Submitting the composer clears the query, so the new row is seen landing rather than hidden
by the search that failed to find it. The store does that, not the page: `BasketStore`'s
`append` is where a new line of this reader's arrives, and `BasketViewStore` clears its
query when `lastAdded` changes to a line the reader added.

### 4.7 What the search never does

- It never asks the server. `BasketApi.suggest` is the composer's and stays there.
- It never reorders. The rows keep the order they have, which is the order `0075` decides.
- It is never remembered. `0076` names what is, and this is not on the list.

## 5. Copy

| Key                        | en                                  |
| -------------------------- | ----------------------------------- |
| `basket.search.open`       | Search this list                    |
| `basket.search.label`      | Search this list                    |
| `basket.search.placeholder`| Line or product                     |
| `basket.search.clear`      | Clear                               |
| `basket.search.cancel`     | Cancel                              |
| `basket.search.count`      | {{shown}} of {{total}} lines        |
| `basket.search.none`       | No line matches “{{query}}”         |
| `basket.search.noneHint`   | Add it below and it goes on this list. |

Spanish beside each. The quotation marks in `basket.search.none` are the locale's, so the
Spanish key carries «» and the English one carries “”.

## 6. Accessibility

- The field has a visible label (`basket.search.label`), not only a placeholder, drawn as
  the supermarkets page draws its own.
- The count is one polite live region, and it is the only thing announced on a keystroke.
- The search button's name says what it opens. When the field is open the button is gone,
  so there is no control that toggles and changes its name.
- Escape closes the search from anywhere inside the field, and focus lands back on the
  search button, never on the page body.
- The `<mark>` is presentational. The row's accessible name is unchanged, so a screen
  reader hears the line, not the fragment.

## 7. Tests

1. `matchesBasketLine` folds case and accents on both sides, and an empty query matches.
2. It matches the pick's name in the reader's locale and the pick's brand, and a line with
   no pick matches on its content alone.
3. Opening the search draws the field with focus, and Cancel or Escape restores the row
   and clears the query.
4. `visibleLines` narrows to the matches and `progress` still counts every line.
5. The count is drawn with `basket.search.count` and `{ shown, total }`, asserted on the
   key and its arguments, never on rendered text.
6. No match draws `basket.search.none` with the typed query and keeps the composer.
7. Adding a line through the composer clears the query.
8. The row draws a `<mark>` around the first match and none when `highlight` is empty.
9. `leave()` clears the query.

## 8. Acceptance criteria

- The basket page has a row under its title with the count at one end and a search control
  at the other, for every reader.
- Typing filters the rows on the phone, with no request, and says how many remain.
- Accents and case do not matter, and a product's name and brand count as much as the
  line's text.
- A search that matches nothing says so and still lets the shopper add the line.
- Cancelling restores the full list, and nothing about the search survives leaving the
  basket.
