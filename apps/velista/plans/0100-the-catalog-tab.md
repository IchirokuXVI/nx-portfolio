> **PR:** [#472](https://github.com/IchirokuXVI/nx-portfolio/pull/472)

# 0100: the catalog tab

> Backend half: `apps/luna-shopper-backend/plans/0146`, which must be merged first.
> Depends on `0097`, which added the tab and the placeholder route this plan fills.
> Mock: `mocks/catalog/`, published at https://claude.ai/artifact/9UppvQ8HfCVouog2WK7fi7.
>
> velista can name a product it already holds and can suggest one while a line is being
> typed, and that is the whole of its relationship with the catalog. Nobody can browse.
> This plan builds the second tab: every product from every supermarket, narrowed to one
> chain, searched, and ordered, with the search and the order on the screen rather than
> behind a sheet.
>
> Prerequisite reading: `0048` and `0049` (the ranked read and its scopes), `0069`
> section 2 (no scopes is not an empty catalog), `0074` and `0079` (the tools row, and
> why the basket hides its search), `0078` (prices from one shop), `0097` in full,
> backend `0146` in full, and `libs/velista/data-access/src/lib/catalog/`.

## Brief for the agent

### Objective

Build the catalog screen of the mock: a live search, a chain chip row, three orders, an
infinite list of priced products, a sheet for one product, and honest empty states.

### Context

- `GET /v1/catalog/items` exists and **velista has never called it**. It takes `query`,
  `category`, `productGroupId`, `order`, `cursor`, `limit`, the scope selectors, and
  after backend `0146` the `soldBy` filter. It answers `ItemPage`.
- An `ItemView` carries `name` (localized), `brand`, `imageUrl`, `unitSize`,
  `defaultUnit`, `category`, and `bestOffer` when the read had scopes: `price`,
  `currency`, `unitPrice`, `unitPriceLabel`, `observedAt`, `stale`. With `all` it also
  carries `scopes`, every shop's price, cheapest first (`0109`).
- `bestOffer` names a `priceScopeId` and **not a chain**. The app already maps scopes to
  chain names for `0078`; reuse that, never a second mapping.
- The orders the server accepts are `relevance`, `name`, `created` and `updated`, and
  it defaults to `relevance` with a query and `name` without one. **There is no price
  order**, and this plan does not ask for one.
- `GET /v1/catalog/shops/summary` answers the chains near the caller's codes, each with
  a shop count. `GET /v1/catalog/scope` says which of the priceless states the caller
  is in.
- `libs/velista/data-access/src/lib/catalog/` holds `catalog-api`, `catalog-memory` and
  `catalog-service` behind a token, which is the pattern every read in this app follows.

### Target state

Pressing the Catalog tab shows products with prices from where the person shops.
Typing narrows them. A chip narrows them to one chain. Three pills reorder them. A row
opens a sheet naming every shop's price.

### Scope

Work only in:

- `libs/velista/feature-catalog/` (a new library)
- `libs/velista/ui/src/lib/catalog/` (its presentational parts)
- `libs/velista/data-access/src/lib/catalog/` (the browse read and its memory double)
- `libs/velista/feature-shell/src/lib/routes.ts` (replacing the placeholder) and its spec
- `libs/velista/models/`

Do not touch: the basket's tools row, the line composer's suggestions, the shops page.

### Constraints

- Follow the `nx-portfolio-angular-developer` and `design-taste-frontend` skills.
- **Rule D4**: never render a backend DTO. Map `ItemView` into this app's own model in
  `mapping/`, as every other read does.
- Prices are formatted with the money helper in `platform`, never by hand, and dates
  with `Intl`, never `DatePipe`.
- Every string is a key. No `@angular/core/rxjs-interop`. `svh` only.
- The screen is a tab root, so it keeps the bar from `0097` under it.

### Action boundaries

Stop and ask before: adding a price order, adding a category chip row, changing the
basket's `ListTools`, or adding a dependency.

### Progress evidence

After each section output: the files changed and the spec you ran.

## 1. What is being built

| Thing | Where |
| --- | --- |
| `CatalogPage` | `feature-catalog/src/lib/catalog-page/` |
| `ProductRow`, `ChainChips`, `OrderPills` | `ui/src/lib/catalog/` |
| `ProductSheet` | `feature-catalog/src/lib/product-sheet/` |
| `CatalogBrowse` read + memory double | `data-access/src/lib/catalog/` |

## 2. The tools, and why they are not in a sheet

The field is a field, the chains are chips and the order is three pills. Nothing on
this screen opens a sheet to change what is shown.

That is the opposite of the basket, where `ListTools` hides the search behind a
magnifier and the rest behind a filter sheet, and the difference is what each screen is
for. In the basket the lines are the point and the tools are occasional. Here narrowing
**is** the activity: somebody arrives without knowing what they want, and a screen that
hides its own controls gives them a wall of products and a magnifier.

- **The field** searches as it is typed, debounced, and carries a clear button once it
  holds anything. Its placeholder names the scope: `Search every supermarket`, or
  `Search Mercadona` while a chip is on.
- **The chips** are `All shops` and one per chain from
  `GET /v1/catalog/shops/summary`, in the order that read returns. The row scrolls
  sideways rather than folding, because five chains do not fit in 390 pixels and a
  folded chip is a chip nobody finds. One chain at a time; the chosen chip carries a
  clear cross.
- **The pills** are `A to Z` and `Newest` with nothing typed, and `Best match`,
  `A to Z`, `Newest` once something is. Best match leads and is chosen the moment a
  search begins, and A to Z is what the screen opens on.

**Best match exists only while there is something to match.** That is the server's own
rule, and relevance with no query is an arbitrary order wearing a confident label.

## 3. The list

A page of rows, then the next page when the end comes near. Cursor paging, never page
numbers.

A row: a 52px image (the carton glyph when `imageUrl` is null), the product's name in
the content language, `brand · size` under it, and on the right the cheapest price with
the chain's name under it. With a chain chosen the right hand column shows the price
and the price per litre or kilo instead, because the chain's name is the same on every
row and the comparison worth making is between sizes.

A stale price is drawn in the muted colour with the same treatment `0078` already uses.
Never invent a badge for it here.

## 4. The states

- **Loading**: skeleton rows, the same shape as a row.
- **Loading more**: one skeleton row at the end, and a line that says so.
- **Nothing found**: names the words that found nothing, suggests a shorter word, and
  offers to clear the search. Never a bare "no results".
- **No postal code**: the whole catalog, every row marked `no price`, and one card at
  the top saying we do not know where you shop, with a button to the place screen.
  This is `0069`'s rule and it is not negotiable: an empty screen tells somebody who
  merely refused every shop near them that there is no such thing as milk.
- **Every chain refused**: the same as no postal code, with its own sentence.
- **Offline**: the app's existing connection screen covers this, as everywhere else.

## 5. One product

A row opens a sheet at `catalog/sheet/products/:itemId`, stamped by `sheet()` like
every other sheet in this app, so the back button dismisses it and the URL says what is
open.

It shows the name, `brand · size`, then every shop's price, cheapest first, from the
`scopes` array, with the cheapest marked and a shop that does not sell it saying so. At
the foot, when the price was last seen, in the words `0078` already uses.

**It does not add the product to a list.** Adding from the catalog is a screen of its
own: it has to choose the list, the group and the quantity, and none of that fits under
a sheet that exists to answer "what does this cost". Leave the space for it and build
nothing.

## 6. Copy

| Key | English | Spanish |
| --- | --- | --- |
| `catalog.title` | Catalog | Catálogo |
| `catalog.near` | near {{code}} | cerca de {{code}} |
| `catalog.search.all` | Search every supermarket | Buscar en todos los supermercados |
| `catalog.search.chain` | Search {{chain}} | Buscar en {{chain}} |
| `catalog.chips.all` | All shops | Todas las tiendas |
| `catalog.order.label` | Order | Orden |
| `catalog.order.relevance` | Best match | Más parecido |
| `catalog.order.name` | A to Z | A a Z |
| `catalog.order.created` | Newest | Más nuevos |
| `catalog.count` | {{count}} products | {{count}} productos |
| `catalog.chain.shops` | {{count}} shops near you. Prices are what {{chain}} charges here. | {{count}} tiendas cerca. Los precios son los de {{chain}} aquí. |
| `catalog.row.noPrice` | no price | sin precio |
| `catalog.empty.title` | Nothing matches "{{query}}" | No hay nada que coincida con "{{query}}" |
| `catalog.empty.body` | Check the spelling, or look for a shorter word. | Revisa la ortografía o prueba con una palabra más corta. |
| `catalog.empty.clear` | Clear the search | Borrar la búsqueda |
| `catalog.noScope.title` | We do not know where you shop | No sabemos dónde compras |
| `catalog.noScope.body` | You can read the whole catalog without a postal code. Prices need one, because they are not the same in two towns. | Puedes ver todo el catálogo sin código postal. Los precios lo necesitan, porque no son iguales en dos pueblos. |
| `catalog.noScope.add` | Add my postal code | Añadir mi código postal |
| `catalog.more` | Loading more | Cargando más |
| `catalog.product.cheapest` | CHEAPEST | MÁS BARATO |
| `catalog.product.notSold` | not sold here | aquí no se vende |
| `catalog.product.seen` | Seen {{when}}. Velista reads the shops, so a price can be behind the shelf. | Visto {{when}}. Velista lee las tiendas, así que un precio puede ir por detrás del lineal. |

## 7. Accessibility

- The field has a visible label or an accessible one, and the result count is announced
  politely on a keystroke, because a search that silently empties the screen is
  indistinguishable from one that broke. `ListTools` already does this; copy it.
- The chips are a group of toggle buttons with `aria-pressed`, not links.
- The pills are a radio group, because exactly one is on.
- Each row is one link or one button, and its accessible name is the product, the size
  and the price in that order.
- The price is never colour alone, and `no price` is words rather than a dash.

## 8. Not in this plan

- Ordering by price, and anything about offers or discounts. Neither exists in the read
  model, and both were dropped on purpose.
- A category chip row. Twelve categories exist in the data, and two rows of chips above
  a list is most of a phone.
- Adding a product to a list from the catalog (section 5).
- The catalog for a guest. Every catalog route is account authenticated today, and the
  bar is not drawn for a guest at all (`0097`, section 4).

## 9. Tests

- `catalog-page.spec.ts`: opens on A to Z; typing switches the pills to Best match and
  debounces; a chip narrows and changes the placeholder; clearing the chip restores;
  the count is announced.
- `product-row.spec.ts`: price with a chain, unit price with a chain chosen, `no price`
  with none, and a stale price drawn as stale.
- `catalog-browse.spec.ts` in data-access: maps `ItemView` into the app's model, pages
  by cursor, and never renders a field the wire does not carry (rule D4).
- `product-sheet.spec.ts`: every scope in order, the cheapest marked, a shop that does
  not sell it, and the seen line.
- `routes.spec.ts`: the product sheet is addressed under the sheet segment and carries
  the fall guard.
- A spec for the no-scope state asserting a full list of rows and one card, never an
  empty list.

## 10. Acceptance criteria

- [ ] The Catalog tab opens a list of products priced from the person's own scopes.
- [ ] The search, the chips and the pills are all on the screen, and none opens a
      sheet.
- [ ] A chain chip lists what that chain sells, through `soldBy`.
- [ ] Best match appears only with a query.
- [ ] With no postal code the catalog is full and every row says `no price`.
- [ ] A row opens a sheet naming every shop's price, and adds nothing to any list.
- [ ] `npx nx lint velista && npx nx test velista` pass.

## 11. Verification

```sh
npx nx test velista-feature-catalog
npx nx test velista-ui
npx nx test velista-data-access
npx nx test velista-feature-shell
npx nx lint velista
npx nx build velista
```

Then, on a slot with the seeded Mercadona catalog and postal code 14013: browse, type
`leche`, choose Mercadona, open a product, and repeat the whole walk with the postal
code removed from the profile.
