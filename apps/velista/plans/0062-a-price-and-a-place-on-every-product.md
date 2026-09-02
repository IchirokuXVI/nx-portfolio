# 0062: a price and a place on every product

> Server half: `apps/luna-shopper-backend/plans/0066`, which owns every rule about what a price is,
> which scopes it comes from and who may see the shop it comes from.
>
> Prerequisite reading: `0044` section 9 (prices out of scope, which this plan closes), `0043`
> section 9 (the same refusal on `CatalogItem`), `0052` (the basket row, which grows a number) and
> `0059` section 2, which says the shops screen shows no prices and still means it.

Two screens ask a question and refuse to answer it.

The **basket row** names the product it means to buy and says nothing about what it costs, so
somebody working through a list in a shop has no idea whether they are on budget until the till.
The **pick sheet**, reached by "Change" on a row, exists for exactly one moment: standing at a
shelf, deciding between eleven milks. It lists them by name and brand. The thing being decided is
which one to pay for, and the price is the one fact it withholds.

`BasketProduct` says why, and the comment is honest:

> **No price, deliberately.** Backend `0050` resolves the pick to the first option added rather
> than the cheapest, because core holds no prices and the harvester is off outside development.

The first clause is still true and this plan does not change it. The second stops being a reason to
draw nothing the moment there is something to draw.

## 1. What is being built

| Piece                                      | Where                            |
| ------------------------------------------ | -------------------------------- |
| `BasketProduct` carries an offer           | `libs/velista/models`            |
| The scopes a basket priced against         | `libs/velista/models`            |
| Mapping both from `unknown`                | `data-access`, `basket-mappers`  |
| A money string, formatted once             | `libs/velista/platform`          |
| The price on a row                         | `basket-line-row`                |
| The price, the place and the cheapest mark | `settle-sheet`, the product pane |
| Everything above, for guests too           | no branch at all                 |

No new route, no new request, no new store method. The basket read already runs on every refetch
and now carries more.

## 2. Prices are not a state the screen can rely on

**The harvester is off in staging and in production**, on purpose and permanently as far as this
plan is concerned. So in both clusters every offer is null and every screen here renders exactly
what it renders today.

That governs the whole design, and it is stated first because it is the thing most easily forgotten
halfway through a template:

- **No layout may depend on a price existing.** A row with a price and a row without are the same
  height and the same shape. A price is a suffix, never a column, because a column of mostly empty
  cells is a screen that looks broken in the environment it actually ships to.
- **No empty state, no placeholder, no dash.** A product with no price says nothing about price.
  "Price unknown" on every one of thirty rows is noise that teaches people to stop reading the row.
- **The one exception is the pick sheet**, section 5.3: when some options are priced and others are
  not, the difference is information and is drawn.

This also decides how the work is verified. Run it against a slot with the seeded Mercadona
catalog, and then run it again against a stack with no prices at all, and the second is the one
that has to look untouched.

## 3. The models

Rule D4: ours, mapped from `unknown`, never the gateway's DTO passed through.

```ts
/** What one product costs, at the cheapest scope this basket was priced against. */
export interface ProductOffer {
  /** In `currency`. Null is a scope that carries the product with no price on it. */
  readonly price: number | null;
  readonly currency: string | null;
  /** The source's own figure, never recomputed here. Null when it published none. */
  readonly unitPrice: number | null;
  /** "EUR/L", "EUR/lv". Text for a human, not a unit to parse. */
  readonly unitPriceLabel: string | null;
  /** Without it a price has no age. */
  readonly observedAt: Date | null;
  readonly sourceKind: PriceSourceKind;
  /** Which scope quoted it. Opaque, and resolved against {@link BasketView.scopes}. */
  readonly priceScopeId: string;
}
```

`BasketProduct` gains `readonly offer: ProductOffer | null`, and its "no price, deliberately"
comment is replaced rather than deleted: the new one says the price is the cheapest at the run's
scopes, that it is absent wherever nothing was harvested, and that the **pick is still the first
option added and not the cheapest**, which is the part of the old comment that is still true and is
the reason section 5.2 draws what it draws.

`BasketView` gains `readonly scopes: ReadonlyMap<string, BasketPriceScope>`, keyed by scope id, a
map for the same reason `products` is one: a row resolves an id and should not scan an array.

```ts
export interface BasketPriceScope {
  readonly priceScopeId: string;
  /** Both locales, resolved with `inLocale` where drawn. Never flattened in the mapper. */
  readonly supermarketName: LocalizedName;
  /** The shops. **Empty for a reader the server withheld them from**, per `0066` section 5. */
  readonly locations: readonly ScopeLocation[];
}

/** One shop of a scope, as much of it as the pick sheet draws. */
export interface ScopeLocation {
  readonly id: string;
  /** The shop's own name, both locales. Null where catalog has none. */
  readonly label: LocalizedName | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
}
```

`locations` is an **empty array and not an optional field**, which breaks the pattern `origins` and
`targetListId` set on `BasketLine`. Those two are optional because absent and null are different
questions there and a control hangs off the difference. Here they are the same question: there is
no shop to name, either because the reader may not have it or because catalog cannot place the
scope's stores. Both draw the chain and no address, and no control anywhere is offered over the
distinction, so a second representable state would exist only to be collapsed at every call site.

### 3.1 Money is formatted with Intl, in the selector

velista formats dates with `Intl` and never with `DatePipe`, and money follows the same rule for
the same reasons: the pipe would resolve a locale from Angular's `LOCALE_ID` rather than from
`RokuLocaleStore`, and every remote would carry its own copy of the formatting.

Add `formatMoney(amount, currency, locale)` to `libs/velista/platform` beside the date helpers. It
returns a **string**, the view model carries the string, and no template calls it. A row that has
already decided what it says cannot say it differently on a re render.

`currency` null with a price present is possible on the wire and formats as the bare number: a
price with no currency is still a number worth showing to somebody who knows what country they are
in, and inventing EUR would be a guess written into the one field people trust literally.

## 4. The row

The price goes **beside the product name**, on the caption line the row already draws, and takes
the same muted treatment the product name has. It is not on the title line: the title line is what
to buy, it is read at a glance in an aisle, and a number there competes with the one control on the
row that matters, which is the quantity.

```
Milk                                    2
Hacendado whole milk 1 L · 0.95 EUR
```

The separator is the row's existing caption separator. There is no new element when the offer is
null, and the caption is exactly the string it is today.

**No unit price on the row.** It is a second number in a place with room for one, and its whole
value is comparison, which is the pick sheet's job.

### 4.1 A row with no pick shows no price

A line added from a group has options and no pick, and the row already says so. It stays saying so.
Pricing the cheapest option there would quote a number for a product nobody has chosen, on a row
whose entire message is that the choice has not been made, and the tap that resolves it is right
there.

## 5. The pick sheet, which is what this plan is really for

The product pane in `settle-sheet` lists the line's options. Each row grows two things.

### 5.1 The price, and the place under it

```
Hacendado whole milk 1 L                 0.95 EUR
Mercadona · Ronda de los Tejares         0.63 EUR/L
```

- The **price**, right aligned, tabular numerals, at the same weight as the name.
- Under the name, the **place**: the chain, and the shop when the reader has one. `0066` section 5
  gives the chain to everybody and the shop only to a reader who passes the all or nothing rule, so
  a guest reads `Mercadona` and an owner reads `Mercadona · Ronda de los Tejares`. **There is no
  branch in this component**: it draws whatever the scope carries, and the empty array draws
  nothing after the chain.
- The **unit price**, muted, under the price, when the source published one. This is the pane where
  it belongs: it is the only screen in the app that puts two comparable products next to each
  other.

A scope with more than one location names the first and does not enumerate them. A list of four
addresses on each of eleven options is a wall, and which of a chain's shops somebody is standing in
is not a question this sheet can answer.

### 5.2 The cheapest is marked, and nothing is reordered

The cheapest priced option carries a mark, `basket.product.cheapest`, beside the existing
`basket.product.current` that marks the pick. Both can be on one row and often are not, which is
the useful case: the sheet shows the shopper, in one glance, that the default is not the cheapest.

**The order is the line's own option order and does not change.** Sorting by price would move rows
under the thumb of somebody reading them at a shelf, and it would reorder the list every time a
harvest changed a number. `0053` section 4 made the same call about the typeahead, and the reason
is the same one.

The mark is drawn only when at least two options are priced. On one priced option it says nothing
and looks like a recommendation.

### 5.3 Unpriced options among priced ones

This is the one place section 2's rule is suspended. When the pane holds a mix, an option with no
price draws `basket.product.noPrice`, muted, where the number would be. A shopper comparing eleven
milks needs to know that the blank one is unknown rather than free, and here the blank is
conspicuous because its neighbours are not blank.

When **no** option is priced, nothing is drawn on any row and the pane is exactly today's pane.

### 5.4 How old the price is

Under the pane, once, not per row: `basket.product.asOf`, naming the oldest `observedAt` among the
options shown, formatted with the existing relative date helper. One sentence for the pane rather
than a timestamp on eleven rows.

An offer whose `sourceKind` is `ADMIN` was typed in by a person rather than published by a chain,
and the pane says so in the same sentence. Passing off somebody's hand entry as the shop's own
number is the thing `ItemOfferView` carries a source kind to prevent.

## 6. Guests

No branch, anywhere in this plan, on participant kind. The server decides what arrives, the screen
draws what arrived, and a guest gets prices because a price is a public product fact.

This is worth stating because the basket has a habit of the opposite: `0056`'s send sheet is absent
for a guest, `0055`'s units sheet is refused to one, and both are right, because both name a
household. A price names a shop. The `participant-token-never-travels.spec.ts` style guard is not
needed here, since nothing new is sent; what is needed is that no component acquires a
`kind === 'GUEST'` check while implementing this.

## 7. Copy

New keys under `basket.product`, both locales:

| Key                        | English                                 |
| -------------------------- | --------------------------------------- |
| `basket.product.cheapest`  | `Cheapest`                              |
| `basket.product.noPrice`   | `No price`                              |
| `basket.product.asOf`      | `Prices from {{when}}`                  |
| `basket.product.asOfTyped` | `Prices from {{when}}, entered by hand` |

Spanish: `Más barato`, `Sin precio`, `Precios de {{when}}`, `Precios de {{when}}, introducidos a mano`.

The place line takes no key. It is a chain name and an address, both server data, joined by the
separator the app already uses.

## 8. Tests

- `basket-mappers.spec.ts`: an offer maps whole; a null offer stays null; a missing `scopes` key
  yields an empty map rather than throwing; a scope id on an offer that has no entry in `scopes`
  resolves to no place and does not break the row. That last one is the shape a partially failed
  gateway composition produces, and it must degrade rather than throw.
- `basket-line-row.spec.ts`: a priced pick renders the caption with the money string; an unpriced
  one renders exactly the caption it renders today; a line with options and no pick renders no
  price.
- `settle-sheet.spec.ts`: the cheapest mark lands on the cheapest and not on the pick when they
  differ; no mark when one option is priced; the order of the rows is the option order, asserted
  against a fixture whose cheapest is last.
- `settle-sheet.spec.ts`: a scope with an empty `locations` renders the chain alone. This is the
  guest's view and the unplaceable scope's view at once, which is the point of them being one
  state.
- Assert on **inputs and view model strings**, not rendered text, wherever a key interpolates. The
  testing translator does not interpolate.
- The money helper gets its own spec in `platform`: a locale it knows, a null currency, a zero
  price, which is a real price and not an absent one.

## 9. Out of scope

- **A basket total.** `0066` section 6 refuses to send one and this plan does not compute one.
  Summing prices on the client would produce a number that ignores what is already settled, what is
  outstanding and which shop anybody is in, and it would be the number people quoted back.
- **Choosing the shop, or telling anybody a second trip is worth it.** That is backlog `0004` and
  it is a whole feature with a threshold the user has to set.
- **Prices anywhere but the basket.** The zone list page, the composer's typeahead and the shops
  screen from `0059` all stay as they are. `0059` section 2 gives the reason for the last of those
  and it has not changed: a price on the screen where you choose shops invites the reading that
  switching one off is how you get a cheaper number.
- **Making the run pick the cheapest option.** `0066` section 6 explains why not yet. This plan is
  what makes the current default visible, which is the prerequisite for deciding whether to change
  it.
