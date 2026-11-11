# 0191: a zone list can draw compact rows

> Decided on 2026-11-11. The owner approved a second way to draw the rows of a zone list,
> the compact row, and wants it built and deployed beside the row of today: "The compact
> version is probably better", and "let's keep three lines". Both layouts ship. He judges
> in use which one holds. The row of today stays the default and does not change in this
> plan. The compact row puts the label and the brand on one line and, under them, three
> lines of facts (the size, the price per kilo, litre or unit, and the price) beside the
> stepper of velista `0188`. It costs height: a compact row is 99 px where the row of today
> is 68, so a 390 by 844 phone shows 5 whole rows where it shows 8.
>
> Amends nothing. Needs velista `0188` built first: the compact row draws the row variant of
> that stepper (155 by 48, it never shrinks), and this plan does not specify the stepper.
> Needs PRs #959, #960 and #961 merged into `dev` (the row reads `unit`, `lineAmount` and
> the prices of velista `0179`, `0182` and `0183`). Independent of velista `0185`, `0189`
> and `0190`; where `0189` touches the same page (the search at the top, the reorder mode
> going), section 7 says what this plan does in either order.
>
> Prerequisite reading: the owner's decisions of 2026-11-10 and 2026-11-11, sections 1 and 6
> (the decisions file of this batch, carried into this plan's section 0); velista `0145`
> sections 1, 3, 5 and 7 (the row of today: flat surface, picture, the two lines, the free
> text line, the bones); velista `0179` section 2 (how a price is worded by how a product is
> sold); velista `0182` section 3 (the cost of an amount and the estimate mark); velista
> `0002` and `libs/velista/ui/src/lib/styles/README.md` (rules T1 to T3 and the three
> specs); velista `0188` (the stepper, its row variant and its accessible names).
>
> The mock the owner approved: `apps/velista/plans/mocks/stepper/index.html`, the strip "The
> alternative view: a compact row". The decided frames are the three line ones ("Compact
> row, three lines" and "Three lines, long texts"). The two line frames beside them were
> not chosen and are being removed from the mock. Its working copy is under
> `tools/dev/.run/stepper-mock/` (`src/mock.css:334` to `:475` are the compact rules,
> `src/page.js:475` to `:567` the facts it draws).
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `libs/velista/ui/src/lib/list/line-row.ts:124` to `:142` (the component), `:212` (`shown`),
> `:218` (`mayChoose`), `:232` (`statuses`), `:349` to `:381` (`accessibleName`);
> `line-row.html:14` to `:28` (the row element and its state classes), `:81` to `:124` (the
> picture by product kind), `:131` to `:154` (line 1: the name and the price), `:160` to
> `:231` (line 2: the star, the product's name, brand and size, "+N", one status word),
> `:248` to `:260` (the editor and the comment count), `:266` to `:279` (the reel that
> `0188` replaces), `:287` to `:328` (the decisions and the notices under the row);
> `line-row.scss:10` to `:26` (`.row`, `min-height: var(--app-line-row-two-line-height)`),
> `:184` to `:190` (the brand and size give way only beside a status word), `:256` to `:281`
> (the bones and their pulse); `libs/velista/ui/src/lib/list/line-list.ts:84` to `:98` (the
> one place that draws `lib-line-row`); `libs/velista/feature-lists/src/lib/list-page/list-page.html:205`,
> `:299`, `:338`, `:352` (the four `lib-line-list` of the page) and `:133` (the page's
> loading state, `lib-row-skeleton`); `libs/velista/models/src/lib/list-view.ts:134` to `:158`
> (`LineRowProduct`, `LineRowShownProduct`) and `:161` to `:312` (`LineRowVm`);
> `libs/velista/feature-lists/src/lib/select-list-state.ts:123` to `:141`
> (`ListStateCatalog`), `:362` to `:395` (`rowProduct`, the one builder of a row's product);
> `libs/velista/feature-lists/src/lib/list-page/list-page.ts:555` to `:569` (the catalog the
> page hands the builder); `libs/velista/ui/src/lib/catalog/product-row-view.ts:245`
> (`priceWords`) and `:298` (`unitPriceWords`, which hides a unit price equal to the price);
> `libs/velista/ui/src/lib/catalog/product-size.ts:31` (`productSizeText`, null for a loose
> product); `libs/velista/models/src/lib/line-amount.ts:64` (`lineAmount`) and `:40`
> (`lineAmountProductOf`); `libs/velista/models/src/lib/sold-as.ts:19` (`soldAs`), `:86`
> (`PriceWords`); `libs/velista/models/src/lib/domain.ts:545` (`CatalogItem.brand`), `:609`
> (`CatalogItem.unitBasis`), `:465` (`ProductOffer.unitPrice`);
> `libs/velista/ui/src/lib/list/list-header.html:47` to `:60` (the estimate mark, "≈" before
> a cost, and its words); `libs/velista/platform/src/lib/storage-keys.ts:99`
> (`mappingSettings`, a device setting with no expiry) and `:191` (the last key);
> `libs/velista/data-access/src/lib/shops/mapping-settings-store.ts` (a device setting read
> and written through `BrowserFacade`); `libs/velista/data-access/src/lib/data-access-providers.ts:264`
> (where that store is provided); `libs/velista/feature-account/src/lib/account-page/account-page.html:84`
> to `:169` (the section "The app": the language row, then the install row);
> `libs/velista/ui/src/lib/account/account-row.ts:65` to `:117` (the row has no switch);
> `libs/velista/feature-shop-map/src/lib/_walks.scss:67` to `:140` (a switch row and a switch
> drawn over a native checkbox) and `libs/velista/feature-shopping-lists/src/lib/filter-sheet/filter-sheet.scss:261`
> (a second copy of that switch); `libs/velista/ui/src/lib/styles/_choice.scss` (the shared
> drawn choices); `libs/velista/ui/src/lib/styles/_semantic.scss:87` to `:91` (the type
> scale), `:109` to `:119` (the space scale), `:234` to `:242` (the row's own tokens);
> `libs/velista/ui/src/lib/styles/token-hygiene.spec.ts:59` (no raw pixel outside the four
> style files); `libs/velista/ui/src/lib/styles/contrast.spec.ts:162` to `:182` (every text
> colour on every surface, and the quiet action, at 4.5 to 1).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> and `antislop` before the template, the styles or the copy.

## Brief for the agent

### Objective

Give the zone list page a second row layout, the compact row of section 6 of the owner's
decisions, chosen by one switch in the account page that is kept on the device. Build it in
the existing `LineRow` component over the existing view model, so that every row feature
(the stepper, the status words, the decisions, the notices, the accessible name) exists once
and both layouts draw it. The default row looks and behaves exactly as it does after
velista `0188`.

### Context

- One component draws a line of a zone list: `LineRow` (`lib-line-row`), and one place
  draws it: `LineList` (`line-list.ts:84`). The page has four `lib-line-list` (the search
  results, the wanted lines, the lines after the suggestions, and the plain list). Trip rows
  (`lib-trip-row`) and the suggested lines (`lib-due-line-row`) are other components.
- The row's product comes from one builder, `rowProduct` in `select-list-state.ts:362`. It
  gives `brandSize` as one string ("Hacendado · 1 L") and `price` as `PriceWords` (the piece
  price, the price per kilo with "/ kg", or the pack price). The compact row needs the brand
  and the size apart, the price per kilo, litre or unit as a line of its own, and, for a
  product sold by weight or volume, what the asked amount costs (`lineAmount`).
- A device setting with no backend field already exists twice: the theme
  (`theme-store.ts`) and the mapping settings (`mapping-settings-store.ts`). There is no
  switch in the account page today, and `lib-account-row` cannot draw one.
- No e2e suite selects a row of a zone list: a search of `apps/` for `lib-line` and
  `line-row` finds only plan files, and `apps/velista-luna-e2e/src/support/app.ts:91`
  (`rows`) selects `lib-basket-row`.
- No raw pixel may appear in a component stylesheet (`token-hygiene.spec.ts:59`). Every size
  of section 3 is a token in `_semantic.scss`.

### Target state

1. A switch "Compact rows" / "Filas compactas" in the section "The app" of the account page,
   off by default, kept on the device under `StorageKeys.listRows`.
2. With it on, every line row of the zone list page (the list and the search results) is
   drawn compact: picture 74 by 74 at the start; line 1 the label then the brand; under it
   the facts column (size, price per measure, price) and the `0188` row stepper, centred on
   the facts. 99 px high at 390 px wide.
3. The free text line, the line of several products, a line at zero, the estimate mark, a
   product still loading, a product that failed to load, the status words, the editor mark,
   the comment count, the decisions and the notices are all drawn in the compact layout as
   section 4 says.
4. One view model and one component: `LineRowShownProduct` gains the fields the compact row
   reads, filled by the one builder; `LineRow` gains a `layout` input. No fact is computed in
   a template.
5. With the switch off, nothing on the page differs from the build before this plan.

### Scope

- Work in `libs/velista/models` (the view model and the facts rule), `libs/velista/ui` (the
  row, the list, the switch, the tokens, the assets), `libs/velista/platform` (the storage
  key), `libs/velista/data-access` (the setting's store), `libs/velista/feature-lists` (the
  builder and the page), `libs/velista/feature-account` (the switch on the account page) and
  `apps/velista-luna-e2e`.
- Do NOT change the stepper (velista `0188`), the search field or the progress bar (velista
  `0189`), the shopping list (velista `0190`), the add rules (velista `0185`), the trip rows,
  the suggested lines, the line sheet or the line page.
- Do NOT change how the default row looks. Its spec must pass unchanged except where a spec
  names an input this plan adds.

### Constraints

- Rule T1 and the hygiene spec: only semantic and component tokens in a component
  stylesheet; every new size is a token in `_semantic.scss`.
- Rule D5: the new store is `@Injectable()`, never `providedIn: 'root'`, provided in
  `data-access-providers.ts`.
- Every string through RokuTranslator keys in `en` and `es`. No dashes as punctuation in
  copy or comments.
- Money through the formatter the builder already receives (`ListStateCatalog.formatMoney`);
  no `DatePipe`, no `CurrencyPipe`.
- Zoneless, `OnPush`, signals, `input()` and `output()`.

### Action boundaries

- Stop and say so if velista `0188` is not built: there is no row stepper to place.
- Stop and ask before adding a dependency, before deleting a file this plan does not name,
  and before any decision that changes what a person sees and this plan does not settle.
- Stop and ask if the owner answers a question of the last section in a way that changes a
  section, before building that section.
- Do not touch `openapi.json` or `wire-types.ts`; this plan changes no gateway shape.

### Progress evidence

Each criterion of section 9 with its spec output; `npx nx affected -t lint test`;
`npx nx build velista`; the e2e of section 8 on a slot; and a walk on a slot with
screenshots at 390 by 844 and at 360 by 800, in Day and Night, of the list with the switch
off and on, with a free text line, a line of several products, a loose product at 750 g, a
kilo piece, a line at zero and a long brand.

## 0. Decisions

### The owner's, 2026-11-11, fixed

- **Two layouts, both deployed.** The compact row is its own plan in the build order. The
  owner deploys both layouts and judges which one holds ("The compact version is probably
  better").
- **Three lines of facts** ("let's keep three lines"). The two line variant of the mock was
  not chosen.
- **The layout.** First line: the label, then the brand. The label crops first; the brand
  has a width limit (96 px in the mock). Under it, two columns. The first holds three lines:
  the size, the price per kilo, litre or unit, and the price. The second holds the stepper,
  which "needs to grow and cannot be made smaller"; the first column "will crop the data as
  needed". The stepper is centred on the three lines. The picture takes the height of the
  row's content (74 by 74).
- **The measures.** Row 99 px; label and brand 272 px; facts column 105 px; 5 whole rows on
  390 by 844. Label 16 px 600 on a 22 px line; brand 14 px, secondary; size and price per
  kilo 12 px (`--app-text-xs`) on 16 px lines; price 16 px 600 on 20 px; padding 12 px top
  and bottom.
- **The free text line** shows "Elige un producto" in the facts column, on a 44 px target,
  in the quiet action colour.
- **The stepper** is the D3 row stepper of velista `0188`, 155 by 48. Its amount is an
  output in a row; only minus and plus change it (decisions, section 1).

### The writer's, open to the owner

- **A. One switch in the account page, kept on the device, off by default.** The owner never
  said how a person chooses the layout. The account page is the app's settings screen: its
  section "The app" (`account-page.html:84`) already holds the one other choice about how
  the app looks on this phone, the language. The switch sits under the language row:
  "Compact rows" with the hint "Lists show the size and the price per kilo on every row.
  Only on this phone." in `en`, "Filas compactas" and "Las listas muestran el tamaño y el
  precio por kilo en cada fila. Solo en este teléfono." in `es`. No backend field: the
  choice is about this screen size and this person's eyes, and the theme and the mapping
  settings set the pattern (`storage-keys.ts`). Off by default, because the decisions file
  says the default row stays and a trial that flips everybody is a different decision.
  Questions 1 and 2.
- **B. One component, one view model.** `LineRow` gains `layout = input<ListRowLayout>('default')`
  and draws the inside of its `.row` element in two branches. Everything outside the
  branches is shared: the row element and its state classes, the tap and the keys, the
  accessible name, the status words for a screen reader, the decisions and the notices
  under the row, and the stepper's binding. A second component would copy all of that, and
  the next row feature (velista `0192`'s deletion at zero, for one) would be built twice.
  The facts are decided once, in models, by a pure function (section 2.2), so the template
  only draws.
- **C. Line 3 is the price the row of today shows, except for a product sold by weight or
  volume, where it is what the asked amount costs.** For a pack it is the pack price, and for
  a kilo piece the piece price, as `priceWords` gives today. For a product sold by the kilo
  or the litre, `priceWords` gives the price per kilo with "/ kg", which line 2 already
  holds, so line 3 says what the line's amount costs, with the estimate mark: "≈1,88 €" for
  750 g at 2,50 € / kg. This is what the approved mock draws for the plátanos, the tomate
  and the melón (`page.js:464` to `:470`). The mock's queso row (300 g, "13,99 €") reads the
  line's kind and not the product's, which is a mock artefact; built by the rule, that row
  reads "≈4,20 €". Question 3.
- **D. Line 2 shows the price per measure whenever the chain gives one, also when it equals
  the price.** `unitPriceWords` (`product-row-view.ts:298`) hides a unit price equal to the
  pack price so a card does not print one number twice. In the compact row each line is a
  fixed slot that is compared down the list, so an empty slot reads as "unknown". The mock
  draws "0,99 €/l" over "0,99 €" for a litre of milk. Basis words are the existing
  `catalog.per.*` keys ("/ kg", "/ L", "/ unidad", "/ docena", "/ lavado").
- **E. The label is 600 for every line.** The row of today draws a name the person gave in
  600 and a product's name in 400 (`line-row.scss:121`), and draws the product's name on
  line 2 for a named line. The compact row has no slot for a second name, and the brand
  beside the label is already the second voice, so every label is 600 as the mock draws it,
  and a named line does not draw its product's name (it shows the brand, the size and the
  prices of that product). Question 4.
- **F. The status word, the editor and the comment count end line 1.** The row of today ends
  line 2 with one status word and puts the editor and the count beside the reel. The compact
  row has room for neither beside a stepper that never shrinks. Line 1 ends with the
  editor's initial (no word), the comment glyph and its number, then the status word, and
  none of them crops. While any of them is drawn the label crops first, then the brand,
  which is the same order. Question 5.
- **G. The search results draw rows in the chosen layout.** A person who chose compact rows
  sees one shape for a line wherever the page draws it. Weak point 6 says what it costs.
- **H. The page's loading state is not changed.** It draws `lib-row-skeleton`, which is
  shaped like a member row and matches neither layout today. A product still loading inside
  a loaded row draws bones in the compact shape (section 4.6).
- **I. No reorder in the compact layout.** If velista `0189` has not removed the reorder mode
  when this plan is built, `LineList` passes `'default'` to every row while the list is
  being reordered: the grip and a row being dragged are the row of today's business, and
  `0189` removes them.

## 1. The setting

- **Model.** `export type ListRowLayout = 'default' | 'compact'` and
  `export const DEFAULT_LIST_ROW_LAYOUT: ListRowLayout = 'default'` in
  `libs/velista/models/src/lib/list-view.ts`, exported from the barrel.
- **Key.** `listRows: \`list-rows:${APP_KEY}\`` in `StorageKeys`
  (`libs/velista/platform/src/lib/storage-keys.ts`), after `flexibleUpdateAsked`, with a doc
  comment in the style of `mappingSettings`: one record for the device, no expiry, not on
  the server.
- **Store.** `ListRowsStore` in `libs/velista/data-access/src/lib/lists/list-rows-store.ts`,
  copied in shape from `MappingSettingsStore`: `@Injectable()`, a private signal read once
  from `BrowserFacade.readStorage(StorageKeys.listRows)` at construction, a readonly
  `layout: Signal<ListRowLayout>`, and `setLayout(layout)`, which sets the signal and writes
  `JSON.stringify({ version: 1, layout })` inside a `try`. A record that is missing, not
  JSON, not a record, or names a layout this build does not know reads as the default.
  Provided in `data-access-providers.ts` beside `MappingSettingsStore` (`:264`) and exported
  from the barrel.
- **The switch.** A new presentational component `AccountSwitch` (`lib-account-switch`) in
  `libs/velista/ui/src/lib/account/account-switch.ts`, exported from `@portfolio/velista/ui`:
  inputs `label`, `hint`, `checked`; output `changed: boolean`. A `<label>` that holds the
  title, the hint and a native `<input type="checkbox" role="switch">`, so the whole row is
  the target, the words are the name, and the hint is read with it (`aria-describedby` on
  the hint's id). Its look is the account row's (surface, padding, hairline as
  `account-row.scss` draws them) with the switch of `_walks.scss:97` to `:140`, moved into
  a new `@mixin switch` in `libs/velista/ui/src/lib/styles/_choice.scss` so a ui component
  can use it. The two existing copies (`_walks.scss`, `filter-sheet.scss:261`) are left as
  they are (Not in this plan).
- **The account page.** In the section "The app", directly after the language row
  (`account-page.html:91` to `:98`), `<lib-account-switch>` bound to `ListRowsStore.layout()
  === 'compact'`, calling `setLayout(on ? 'compact' : 'default')`. Drawn for a guest and a
  registered account alike, like the language row. The change applies at once; there is no
  save.
- **The page.** `ListPage` injects `ListRowsStore` and passes `layout()` to each of its four
  `lib-line-list`; `LineList` gains `layout = input<ListRowLayout>('default')` and passes it
  to each `lib-line-row` (with decision I while reordering).

| key | `en` | `es` |
| --- | --- | --- |
| `account.listRows.label` | Compact rows | Filas compactas |
| `account.listRows.hint` | Lists show the size and the price per kilo on every row. Only on this phone. | Las listas muestran el tamaño y el precio por kilo en cada fila. Solo en este teléfono. |

## 2. The view model

### 2.1 New fields, one builder

`LineRowShownProduct` (`list-view.ts:140`) gains, each with a doc comment:

- `brand: string | null`: the product's brand, trimmed, null when empty.
- `size: string | null`: `productSizeText` of the product (`product-size.ts:31`), so "1000
  ml", "12 uds", "~2,5 kg" for a kilo piece, and null for a loose product and for a count of
  one. `brandSize` stays for the default row.
- `perMeasure: PriceWords | null`: the price per kilo, litre or unit (decision D).
- `askedCost: { readonly amount: string; readonly estimated: boolean } | null`: what the
  line's amount costs, set only when the shown product is sold by the kilo or by the litre
  (`soldAs` answers `BY_THE_KILO` or `BY_THE_LITRE`), the line's quantity is above 0, and
  `lineAmount(quantity, unit, lineAmountProductOf(item), offer)` answers a value. Its
  `amount` is that value's cents through `formatMoney`, and `estimated` is its own flag
  (true for every such line today).

`rowProduct` (`select-list-state.ts:362`) fills all four, and nothing else builds them.
`ListStateCatalog` (`:123`) gains `sizeOf: (item: CatalogItem) => string | null`, and
`list-page.ts:565` supplies it with `productSizeText(item.size, item.unit, locale,
translate, item.approxWeight)`. A product the catalog has not named (`item === null`) has
`brand`, `size`, `perMeasure` and `askedCost` null.

`perMeasure` comes from a new exported function beside `unitPriceWords` in
`product-row-view.ts`, `measurePriceWords(offer, product, locale, translate)`:

- `BY_THE_KILO`, `BY_THE_LITRE`: `priceWords` of the same arguments (the price with its
  "/ kg" or "/ L").
- `KILO_PIECE`: `unitPriceWords` of the same arguments (the price per kilo).
- `PACK`: `offer.unitPrice` with `catalog.per.<product.unitBasis>` whenever both are set,
  equal to the price or not; null otherwise.

### 2.2 The facts, decided once

A pure function in `libs/velista/models/src/lib/list-view.ts`:

```ts
export interface LineRowFacts {
  /** Line 1 of the facts column, or null for an empty line. */
  readonly size: string | null;
  /** Line 2: the price per kilo, litre or unit, as words, or null. */
  readonly perMeasure: PriceWords | null;
  /** Line 3: the price, or null for "No price". */
  readonly price: { readonly amount: string; readonly estimated: boolean } | null;
  /** Line 3 is empty, not "No price": a loose product at zero (section 4.4). */
  readonly priceBlank: boolean;
}

export function lineRowFacts(
  product: LineRowShownProduct,
  quantity: number
): LineRowFacts;
```

Line 3 is `askedCost` when set; else `price` as an exact amount (`{ amount:
price.amount, estimated: false }`) when `price` is set and its `per` is null; else, when
`price.per` is set (a loose product, whose `askedCost` is null only at zero or with no
figure), `priceBlank` is true at quantity 0 and `price` is null with `priceBlank` false
otherwise. The component reads `lineRowFacts` in a `computed` and draws; it decides
nothing.

## 3. The layout and its tokens

### 3.1 Tokens

Added to `_semantic.scss` after `--app-line-product-name-min` (`:242`), each with a comment
that names this plan:

| token | value | what |
| --- | --- | --- |
| `--app-line-compact-label-leading` | 22px | line 1 |
| `--app-line-compact-fact-leading` | 16px | facts lines 1 and 2 |
| `--app-line-compact-price-leading` | 20px | facts line 3 |
| `--app-line-compact-facts-height` | `calc(2 * var(--app-line-compact-fact-leading) + var(--app-line-compact-price-leading))` | 52 px |
| `--app-line-compact-picture-size` | `calc(var(--app-line-compact-label-leading) + var(--app-line-compact-facts-height))` | 74 px |
| `--app-line-compact-brand-max` | 96px | the brand's limit |
| `--app-line-compact-choose-leading` | 18px | "Elige un producto" when it wraps |

Every other value is an existing token: padding and both column gaps `--app-space-4` (12
px), the gap inside line 1 `--app-space-3`, the picture's corner `--app-radius-md`, the
choose target `--app-touch-target`, the type sizes `--app-text-base`, `--app-text-sm` and
`--app-text-xs`.

### 3.2 The grid

Inside `.row.compact` (the class the `layout` input sets on the row element), one grid,
copied from `mock.css:340` to `:445`:

- `.row.compact`: `align-items: stretch`, `min-height: 0` (the two line height token does
  not apply), `padding-block: var(--app-space-4)`. The row's hairline is the shared
  `row-surface` mixin, so the row is 12 + 22 + 52 + 12 + 1 = 99 px.
- `.compact-grid`: `display: grid; grid-template-columns: var(--app-line-compact-picture-size)
  minmax(0, 1fr); grid-template-rows: var(--app-line-compact-label-leading)
  var(--app-line-compact-facts-height); column-gap: var(--app-space-4); flex: 1;
  min-inline-size: 0`.
- The picture spans both rows of column 1, at the picture token in both axes. It is the same
  `lib-product-picture`, sized through the custom properties it already reads
  (`--app-line-picture-size` set to the compact token, `--app-line-picture-radius` to
  `--app-radius-md`, `--app-line-picture-glyph` to `--app-icon-lg`); the photo is
  `object-fit: contain`.
- Line 1 (column 2, row 1): a flex row on the baseline, gap `--app-space-3`, `white-space:
  nowrap`, `line-height: var(--app-line-compact-label-leading)`.
  - The label: `flex: 0 1 auto; min-inline-size: 0; overflow: hidden; text-overflow:
    ellipsis`, `--app-text-base`, 600, `--app-text-primary`. The search `<mark>` is drawn
    on it as today (`line-row.html:133` to `:139`).
  - The brand: `flex: 0 0 auto; max-inline-size: var(--app-line-compact-brand-max);
    overflow: hidden; text-overflow: ellipsis`, `--app-text-sm`, `--app-text-secondary`.
  - The marks of decision F, `flex: none`, `margin-inline-start: auto` on the first of
    them.
- Under it (column 2, row 2): a flex row, `align-items: center`, gap `--app-space-4`.
  - The facts column: `flex: 1 1 auto; min-inline-size: 0; align-self: stretch; display:
    grid; grid-template-rows: var(--app-line-compact-fact-leading)
    var(--app-line-compact-fact-leading) var(--app-line-compact-price-leading)`. Each line
    is `display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-variant-numeric: tabular-nums`. Lines 1 and 2: `--app-text-xs` on the fact
    leading, `--app-text-secondary`. Line 3: `--app-text-base`, 600, on the price leading,
    `--app-text-primary`. An empty line keeps its height.
  - The stepper: the row variant of velista `0188`, `flex: none; margin-inline-start:
    auto`. It is centred on the 52 px of facts by `align-items: center` (48 against 52).

### 3.3 What crops, in order

1. On line 1, the label, down to nothing but its ellipsis.
2. Then the brand, only when the label is gone and the marks still need room (a status
   word on a narrow phone).
3. The brand never shows more than 96 px; "Quesería Artesana de Villalón" reads "Quese…".
4. In the facts column each line crops on its own at the column's edge, with an ellipsis.
5. The stepper, the picture and the marks never crop and never shrink.

## 4. Every kind of row

### 4.1 A line with one product

Picture; label and brand; size, price per measure, price; stepper. A product with no brand
draws no brand and the label takes the room. A loose product has no size: line 1 of the
facts is empty and keeps its height (weak point 1).

### 4.2 A line with several products

Line 1 draws, in the brand's place and under the brand's limit: the star when the shown
product is the line's favourite (the existing `lib-star-filled-icon` with
`list.row.favorite` as its name, as `line-row.html:164` to `:172`), the shown product's
brand, and "+N" (the existing `list.row.more` name). Only the brand text gives way inside
that limit; the star and "+N" never crop ("★ Quese… +2"). The facts are the shown product's.

### 4.3 A free text line (no product)

- With a reader who may choose (`mayChoose`): the picture is the dashed square with the plus
  at the compact picture size, a button named `list.row.chooseFor` as today. The facts
  column holds one button, "Elige un producto" (`list.row.choose`), filling the column:
  `min-block-size: var(--app-touch-target)`, `--app-text-sm`, 600,
  `--app-action-quiet-fg`, `line-height: var(--app-line-compact-choose-leading)`, start
  aligned, allowed to wrap onto two lines, the focus ring inside the button. Both buttons
  stop the press from reaching the row, as today (`line-row.html:99` to `:110`, `:200` to
  `:208`). No brand.
- With a reader who may not choose: the plain product picture, and line 1 of the facts reads
  `list.row.noProduct` in `--app-text-muted`.
- With no catalog at all (`line.product === undefined`): the facts line 1 draws
  `line.detail` when set.

### 4.4 A line at zero

The stepper reads 0 as velista `0188` draws it. The facts stay: the size and the price per
measure as for any line, and line 3 the pack or piece price. For a loose product line 3 is
empty at zero (`priceBlank`): there is no amount to cost, and the price per kilo is on the
line above. A settled line keeps its muted label (`.row.settled`).

### 4.5 The estimate mark

Line 3 of a loose product is drawn `≈{{ amount }}` with no space, as the list header draws a
cost (`list-header.html:49`), and the facts are never read out on their own (the row is a
button with its own name, section 5), so no visually hidden words are needed in the column.
A pack or piece price carries no mark.

### 4.6 A product still loading, and one that failed

- `loading`: the picture is a bone at the compact picture size, line 1 draws the real label
  and a bone at the brand's limit, the facts column three bones (60%, 45% and 40% of its
  width, each one line high), the stepper drawn as `0188` draws it. The bones pulse as
  today and stand still under `prefers-reduced-motion` (`line-row.scss:267`).
- `unread`: the plain picture, the label, no brand, three empty fact lines; the page says
  once that products did not load, as today.

### 4.7 State the row already carries

The violet edge of a line waiting for approval, the sunken background of a turned down line,
70% while a write is in flight, the muted label of a settled line, the decisions under the
row and the failed and overwritten notices are the shared row element and the shared markup,
and look the same in both layouts.

## 5. The accessible name

`accessibleName()` (`line-row.ts:349`) stays one method. Its product part depends on the
layout, so the name says what the row draws:

- Default: as today.
- Compact: the label; "Favourite" when the star is drawn; the brand; the size; the price
  per measure as `priceWordsText`; line 3 as its amount, or `list.row.about` with the
  amount when it is an estimate; `list.row.more` when "+N" is drawn; then the quantity
  through `formatAmount` as today. A named line's product name is not in it (decision E).
  A free text line's name is the label and the quantity, as today.

| key | `en` | `es` |
| --- | --- | --- |
| `list.row.about` | about {{price}} | unos {{price}} |

So "Plátano de Canarias IGP, 2,50 € / kg, unos 1,88 €, 750 g". The status words stay in
`aria-describedby`; the stepper's group and buttons are named by velista `0188`.

## 6. Weak points the owner already knows

The owner asked for these to be stated; the plan does not fix them.

1. **The size line is empty for a loose product** (bananas, tomato): `productSizeText`
   answers null with no size and no weight, and nothing else belongs in that slot.
2. **The 12 px lines are the smallest text on the page.** `--app-text-xs` in
   `--app-text-secondary` clears 4.5 to 1 on every surface in both themes
   (`contrast.spec.ts:162`), so it is legible by the numbers, but it is small in an aisle.
3. **The brand limit cuts long brands** ("Quese… +2").
4. **5 whole rows where the default shows 8** on 390 by 844.
5. **Narrow phones squeeze the facts, not the stepper.** The facts column is the width minus
   285 px (two 16 px gutters, the 74 px picture, two 12 px gaps, the 155 px stepper): 105
   px at 390, 90 at 375, 75 at 360, 35 at 320. At 320 every fact crops to a few characters.
   A line waiting for approval loses 12 px more to its edge and padding
   (`line-row.scss:42` to `:46`). Question 6.
6. **The search results get less.** The decisions file measured, on the default row, that
   with the keyboard open the results show one row of the list and one product. A compact
   row is 31 px taller; whether one product still fits whole was not measured. The walk
   measures it.
7. **The page mixes shapes.** The suggested lines and the trip rows keep their own rows in
   both layouts.

## 7. Order against velista 0189

- The search moving to the top and the progress bar going are `0189`'s; this plan does not
  draw them and works under either page head.
- If `0189` removed the reorder mode first, decision I has nothing to do. If not, the rows
  fall back to the default layout while reordering.

## 8. Specs and e2e

- `list-rows-store.spec.ts` (data-access): the default with no record, with a record that is
  not JSON, not a record, or names an unknown layout; `setLayout('compact')` sets the signal
  and writes `{ "version": 1, "layout": "compact" }`; a storage that throws keeps the choice
  for the document.
- `list-view.spec.ts` or a new `line-row-facts.spec.ts` (models): `lineRowFacts` for a pack
  (size, measure price equal to the price, the price, no mark); a loose product at 750 g
  ("≈", from `askedCost`); a loose product at 0 (`priceBlank`); a kilo piece ("~2,5 kg",
  price per kilo, the piece price); a kilo piece with no piece price (price null); a
  product with no unit basis (measure null).
- `select-list-state.spec.ts` (feature-lists): `rowProduct` fills `brand`, `size`,
  `perMeasure` and `askedCost` for each kind above, null for a product the catalog has not
  named, and `askedCost` null at 0 and for a pack.
- `product-row-view.spec.ts` (ui): `measurePriceWords` for the four kinds, a pack whose unit
  price equals its price (drawn), a pack with no basis (null).
- `line-row.spec.ts` (ui), a new `describe('compact layout')`: the row carries `.compact`;
  line 1 holds the label then the brand and the marks; the facts column holds three lines in
  order; the free text line draws the dashed picture and "Elige un producto" as buttons that
  emit `chooseProduct` and do not emit `opened`; a reader who may not choose sees "No
  product"; a line of several products draws the star, the brand and "+2" inside the brand
  element; a loose product at 750 g draws "≈" and at 0 an empty third line; `loading` draws
  the four bones and the label; the accessible name of section 5 for a pack, a loose product
  and a free text line; the decisions and both notices are drawn under a compact row; the
  stepper is present and bound as in the default layout. Every existing spec of the default
  layout passes unchanged.
- `line-list.spec.ts` (ui): `layout` reaches every row; while reordering every row is
  default.
- `account-switch.spec.ts` (ui): a switch role, named by its label, described by its hint,
  `checked` reflected, `changed` emitted on a click on the label and on Space.
- `account-page.spec.ts` (feature-account): the switch is under the language row for a
  registered account and a guest, reflects the store, and a flip calls `setLayout`.
- `list-page.spec.ts` (feature-lists): with the store at `compact` the rows carry `.compact`,
  the search results too, and a flip of the store redraws them without a reload.
- `token-hygiene.spec.ts` passes with the new rules: every size in `line-row.scss` and
  `account-switch.scss` is a token, and the new tokens live in `_semantic.scss`, an exempt
  file. No change to the spec.
- `contrast.spec.ts`: the compact row adds no colour token. Its pairs are
  `--app-text-primary`, `--app-text-secondary` and `--app-text-muted` on
  `--app-surface-ground` and `--app-surface-sunken`, the quiet action on the ground, and
  `--app-border-strong` on the ground, all already asserted (`:162` to `:182`, `:230` to
  `:240`). Add one named case, "the compact row's 12 px facts", asserting
  `--app-text-secondary` on `--app-surface-ground` and `--app-surface-sunken` at 4.5 to 1 in
  both themes, so a later change to the secondary colour names this row when it fails.
- **e2e**, a new `apps/velista-luna-e2e/src/list-rows.spec.ts`, in the suite the staging gate
  already runs (no new gate entry), at a 390 by 844 viewport:
  - Before: the test makes its own loose product line on Groceries the way `shop.spec.ts`
    does (`ensureItem` with `'KILOGRAM'`, `setAdminPrice` at 1,99, `addProductLine` with
    `quantity: 750, unit: 'GRAM'`), and deletes it after.
  - Signed in as Alice, the account page shows the switch "Compact rows" off.
  - Turn it on, open the Groceries list page (`/en/zones/<zone>/lists/<LIST_GROCERIES_ID>`,
    the zone the demo world gives that list in `libs/luna-shopper/test-fixtures/src/lib/demo-world.ts:284`).
  - The line's row (`lib-line-row` that holds its name) carries `.compact`, its bounding box
    is 99 px high (one pixel of tolerance), its picture 74 by 74, its stepper group 155 by
    48; its facts read the price per kilo with "1.99" and "/ kg" and a third line that starts
    with "≈" and holds "1.49".
  - Reload: still compact. Turn the switch off: the row is 68 px high and has no `.compact`.
  - The stepper's own steps are `0188`'s e2e, not this one.

## 9. Acceptance criteria

- [ ] The account page has the switch "Compact rows" / "Filas compactas" under the language
      row, off by default, and its state survives a reload on the same device.
- [ ] With it off, the zone list page renders as it did before this plan (the default row
      specs pass unchanged, and the walk's screenshots match).
- [ ] With it on, every line row of the zone list and of its search results is compact: 99
      px high, picture 74 by 74, label and brand on line 1, three fact lines, the `0188` row
      stepper centred on them, at 390 px wide (the e2e and the walk).
- [ ] The label crops first, the brand never exceeds 96 px, the stepper and the picture
      never shrink (the walk at 360 and 320, and the long texts of the mock).
- [ ] A free text line, a line of several products, a loose product at 750 g and at 0, a
      kilo piece, a loading product and a failed product draw as section 4 says (the
      `line-row.spec.ts` cases).
- [ ] `lineRowFacts` and `rowProduct` decide every fact; the compact template computes none.
- [ ] Every new size is a token in `_semantic.scss`; `token-hygiene.spec.ts` and
      `contrast.spec.ts` pass, the latter with its new named case.
- [ ] Every new key exists in `en` and `es`.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e of
      section 8 passes on a slot.

## Not in this plan

- **The stepper itself.** Velista `0188`.
- **The search at the top and the progress bar.** Velista `0189`.
- **The shopping list's rows.** Velista `0190`.
- **A compact shape for the suggested lines, the trip rows or the page's loading skeleton.**
  Weak point 7 and decision H.
- **Folding the two existing switch copies** (`_walks.scss`, `filter-sheet.scss`) onto the
  new `@mixin switch`. A follow up, so this plan touches no other feature.
- **Storing the choice on the account.** Decision A.
- **Choosing which layout stays.** The owner decides after both are deployed; removing the
  other is a later plan.

## Questions for the owner

1. Is the switch where you expect it: the account page, section "The app", under the
   language, named "Compact rows" / "Filas compactas", kept on this phone only?
2. Off by default while you compare, or on by default for everybody so the trial reaches
   more people?
3. The third fact line: a pack's price and a piece's price as the row of today shows them,
   and for a product sold by weight or volume what the asked amount costs, with "≈"
   (decision C). Or should every line show what its whole amount costs (2 cartons of milk
   at 0,99 € reading "1,98 €")?
4. A line you named ("Pan") with a product chosen: the compact row shows your name, the
   brand and the facts, but not the product's own name, which the row of today shows on its
   second line (decision E). Is that enough?
5. A status ("Bought", "Ana is buying this"), the editor mark and the comment count go at
   the end of the first line, and the label gives way to them (decision F). Acceptable, or
   should a status word replace the brand while it shows?
6. On a 320 px phone the facts column is 35 px wide and every fact crops to a few
   characters. Is that acceptable for the trial, or should the compact switch hide itself,
   or the row fall back to the default, below a width you name?
