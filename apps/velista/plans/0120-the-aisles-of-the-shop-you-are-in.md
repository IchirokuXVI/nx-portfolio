# 0120: the aisles of the shop you are in

> **Mock first.** There is no mock for this plan yet. The session that builds it draws
> `mocks/aisles/` first (the basket grouped by the shop's aisles, the mixed list where the
> shop covers only half of the taxonomy, a row that appears in two aisles, and the filter
> sheet's wording with a shop chosen), and stops for the user's review before any code.
>
> Needs `0118` (categories are data), `0102` (buying at one shop) and backend `0167` (shop
> sections, and `sectionIds` on the basket read at a shop). Followed by `0121`, which draws
> the shop's map beside this grouping. Prerequisite reading: `0077`
> (grouping by category, whose pipeline this plan extends), `0075` section 3 (the pipeline
> and `BasketViewSection`), `0091` section 7 (the shop is where the person is standing),
> backend `0167` section 3 (the rule that decides a product's sections) and `0141` (the
> order of rows inside a group, which this plan keeps).

`0077` called grouping by category "the aisle view", and it is, until the person stands in a
shop whose aisles are not the taxonomy's. With "Buying at" set (`0102`), the basket read
answers, for every product, which of that shop's sections it is in (backend `0167`), and
this plan draws the basket in those sections, in the order the shop is walked. A product no
section covers keeps its own categories, so a shop nobody has configured looks exactly as it
does today.

## Brief for the agent

### Objective

When the basket view holds a shop, group by category becomes group by aisle: the shop's
sections in the shop's order, then the categories of the products no section covers, then
the rows with no product. Without a shop, nothing changes. Use the
`nx-portfolio-angular-developer` skill and `design-taste-frontend` for the headings.

### Context

- **The pipeline**: `composeBasketView` in `libs/velista/models/src/lib/compose-basket-view.ts`,
  `byCategory` at lines 820 to 870 after `0118`: a `Map` keyed by category, insertion
  ordered, a row under every category of its product, the `no-category` sink last, and the
  incoming row order kept inside a section. `BasketViewSection` has a key, a heading (a key
  or a text), a note, rows and a collapsible flag.
- **The shop**: `BasketViewState.shop` after `0102` holds the chosen shop, and the basket
  read is made at it. Its products (`BasketProduct`, `basket-mappers.ts`) will carry
  `sectionIds` when the read had a shop (backend `0167` section 4), mapped from `unknown`.
- **The shop's sections**: `GET /v1/catalog/locations/:id/sections` answers the ordered
  list with names and a `source` of `LOCATION` or `CHAIN`. It takes no account, so a guest
  on a shared basket at a shop can read it.
- **Copy today**: `basket.view.group.category` (the radio), `basket.view.chip.byCategory`
  (the chip), `basket.group.noCategory` and its hint.
- **The e2e**: `apps/velista-luna-e2e/src/shop.spec.ts` groups by category and reads
  headings.

### Target state

1. **The model.** `BasketProduct.sectionIds: readonly string[] | null`, null when the read
   had no shop. A `ShopSectionsStore` in `libs/velista/data-access` reads a shop's sections
   once per shop per session, with an in memory twin, and exposes them in order with
   `inLocale` names.
2. **The grouping.** With a shop and its sections loaded, `byCategory` becomes `byAisle`:
   - one section per shop section that holds at least one row, in the shop's order, headed
     by the section's name, with a row under every section its product names
   - then one section per app category, for the rows whose product has an empty `sectionIds`,
     built exactly as `byCategory` builds them today (first row's place, data names)
   - then the `no-category` sink, as today
   Inside every section the incoming order stays: `0141`'s walk order is an order of rows,
   and the shop's order is an order of aisles.
3. **Before the sections load**, or when the read fails to name them, the view is
   `byCategory` as today, and it re-composes when they land. Nothing waits.
4. **Copy.** With a shop chosen the radio reads "Group by aisle" / "Agrupar por pasillo" and
   the chip "By aisle" / "Por pasillo". Without one, the words of `0077` stay. The mock
   decides whether the mixed list's second half gets a divider or a hint ("Not in an aisle
   here yet"), and the copy for it.
5. **A row in two aisles** is drawn in both, and settling it in one settles it in both,
   which the pipeline already does for a product in two categories. The mock shows one.
6. **The e2e** gains a case: a shop with two configured sections, a basket of three
   products, the headings in the shop's order and a third product under its own category.

### Scope

Work in `libs/velista/models` (`compose-basket-view.ts`, `basket-view.ts`, their specs),
`libs/velista/data-access` (the basket mapper, `ShopSectionsStore` and its twin),
`libs/velista/feature-shopping-lists` (the filter sheet's words, the basket page's section
heading if the mock adds a divider), the locale files, and the e2e.

Do not touch: the zone list, the catalog tab, the shop picker, settling, or the walk order.

### Constraints

- Rule D4: `sectionIds` and the sections are mapped from `unknown`, and no contract type.
- `inLocale` for section names. Every string is a key. No `@angular/core/rxjs-interop`.
- The pipeline stays a pure function of state, context and rows: the sections arrive
  through the context like the products do, and `compose-basket-view.spec.ts` covers the
  mixed list without a component.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: ordering the second half of the mixed list by anything but first
appearance, drawing an aisle number, reading sections for the catalog tab, or changing how a
row in two sections settles.

### Progress evidence

The mock, then the user's review. Then per target: the files changed and the spec run,
including a table spec of `byAisle` with the four cases of target 2 and target 3. At the
end: `npx nx test` and `npx nx lint` for the touched libraries, `npx nx build velista`, and
the e2e against a slot serving backend `0167` with two sections configured on one shop.

## 1. Why the server decides the sections and the client decides the order of the rest

The rule that puts a product in a section reads pins, coverage and presence across four
tables (backend `0167` section 3), and a basket read already asks catalog about every
product at the shop. Sending the answer as ids costs a few bytes per product. The order of
the uncovered categories is a display choice with no data behind it, so it stays where
`0077` put it: the first row's place.

## 2. Not in this plan

- Configuring sections from the phone: the back office (admin `0037`).
- A per shop pin, or a shopper saying "this is in aisle 4" (backlog territory, next to
  backlog `0016`).
- Sections on the zone list, which has no shop.
