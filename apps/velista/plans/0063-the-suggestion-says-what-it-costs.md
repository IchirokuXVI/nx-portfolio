# 0063: the suggestion says what it costs

> **No server half.** Backend `0048` built the priced suggestion and backend `0066` finished the
> scope resolution behind it, so every number this plan draws is already on the wire and is already
> being thrown away at the mapper. Nothing in `apps/luna-shopper-backend` changes, no route changes,
> no request grows a parameter.
>
> Prerequisite reading: `0062`, which drew the first prices in the app and set every rule this one
> follows; `0043` section 6 and `0047` section 2, which built the two callers of the suggestion
> list; `0053` section 4, which built the third; and `0047` section 3, which is why a suggestion is
> scoped to where somebody shops in the first place.

Three screens let somebody search the catalog, and all three of them answer with a list of products
and no prices.

The **list page composer**, at `zones/:zoneId/lists/:listId`, is where a shopping list gets written.
The **basket composer**, at the basket, is the same control in the aisle, where a line gets added to
a trip already underway. The **line page** search attaches a catalog product to a line that exists.
All three draw the same component, `SuggestionList`, over the same model, and that model has no
price on it.

`CatalogItem` says why, and the comment was true when it was written:

> Far narrower than the gateway's `ItemView`, and deliberately: the suggestion row and the product
> chip need a name and a brand, and every price field on the wire is out of scope until the
> backend's backlog `0004` exists.

Backlog `0004` is still not built and this plan does not need it. What that sentence was waiting for
arrived as `ItemView.bestOffer` in backend `0048` and was wired to the suggest routes' scope
resolution in backend `0066`. The gateway resolves the scopes, catalog prices the results, the
response carries the number, and `toCatalogItem` drops it on the floor.

`0062` closed the same gap on the basket row and the pick sheet, and left this one open on purpose:
its section 9 lists "the composer's typeahead" under out of scope. That was the right call for a
plan whose subject was the basket. It is the whole subject of this one.

## 1. What is being built

| Piece                                     | Where                               |
| ----------------------------------------- | ----------------------------------- |
| `ProductOffer` moves beside `CatalogItem` | `libs/velista/models`               |
| `CatalogItem` carries an offer            | `libs/velista/models`               |
| `toProductOffer` moves and is exported    | `data-access`, `mappers`            |
| `toCatalogItem` reads `bestOffer`         | `data-access`, `mappers`            |
| The group suggestion carries an offer     | `libs/velista/models`, `mappers`    |
| The price on an item row                  | `libs/velista/ui`, `SuggestionList` |
| "Best price" on a group row               | `libs/velista/ui`, one new key      |

One component, one mapper, two model files and one translation key. **No new request, no new option
on an existing request, no new store method and no new component.** All three screens change because
all three already share the one component, which is the reason `0047` section 2 extracted it.

## 2. Which price, and why it needs no arithmetic

The price on a row is **what the till charges for that packet**. A six pack of milk quotes the price
of the six pack, a single 1 L carton quotes the price of the carton, and neither is divided by
anything.

This is not a computation to be added. It is what `bestOffer.price` already means, and the reason is
`0043` section 6's other consequence: **the catalog holds one record per size.** "Leche entera
Hacendado" at 1 L, at 1.5 L and as a six pack are three products with three ids, three `unitSize`
values and three prices, and the suggestion list already draws them as three rows precisely because
of that. So the row that says `6 pack` is a different row from the one that says `1 L`, and the
price belonging to it is the price of the thing it names. There is nothing to multiply.

The field that would break this rule is `unitPrice`, and section 6.4 keeps it off the row. Backend
`0066` section 2.1 states the same thing from the other end and gives the consequence of getting it
wrong: ranking or quoting by price per litre "would produce a screen recommending the six pack
because it is cheaper per litre while the shopper wanted one bottle."

`bestOffer` is the cheapest of that product's prices across the scopes the caller was resolved to,
which is section 7's subject. Cheapest **of that one product**, never of a set: on an item row
nothing here compares two products and nothing here recommends one.

**A group row is the one row this section does not govern**, because a group has named no packet.
What it quotes, and why it is labelled rather than bare, is section 6.6.

## 3. Prices are not a state the screen can rely on

`0062` section 2 governs this plan whole, unchanged, and it is restated rather than referenced
because it is the thing most easily forgotten halfway through a template.

The harvester is off in staging and in production, permanently as far as this plan is concerned, so
in both clusters every offer is null and all three typeaheads render exactly what they render today.

- **No layout may depend on a price existing.** A row with a price and a row without are the same
  height and the same shape. The price is a suffix on a line the row already draws, never a column.
- **No empty state, no placeholder, no dash.** A product with no price says nothing about price.
- **`0062` section 5.3's exception does not extend here**, and section 6.3 says why.

## 4. The models

### 4.1 `ProductOffer` moves to `domain.ts`

`0062` put `ProductOffer` in `basket-view.ts`, which was right when the basket was the only screen
with a price on it. It is wrong now: an offer is a fact about a catalog product, not a fact about a
basket, and `CatalogItem` lives in `domain.ts`. Moving it is also the only direction that compiles
without a cycle, since `basket-view.ts` already imports from its neighbours and nothing imports from
it.

The interface itself is untouched. Both files are exported with `export *` from the models barrel, so
no consumer sees the move and no import outside `libs/velista/models` changes.

One doc comment does change. `priceScopeId` currently says it is "resolved against
`BasketView.scopes`", and after the move that is one reader's use of it rather than its definition.
It becomes: the scope that quoted this price, opaque, which the basket resolves against
`BasketView.scopes` and which no other screen resolves at all. Section 6.5 is why the typeahead does
not.

### 4.2 `CatalogItem` gains an offer

```ts
/**
 * The cheapest price this product has at the scopes the reader was resolved to,
 * or null where nothing has been harvested for it.
 *
 * It is the price of **this packet**, which is the price of this record: the
 * catalog holds one record per size, so the six pack row's offer is the six
 * pack's price and is never derived from a smaller one.
 */
readonly offer: ProductOffer | null;
```

The interface doc loses its "every price field on the wire is out of scope until the backend's
backlog `0004` exists" paragraph, which is now false, and gains the sentence that is still true:
this is narrower than `ItemView` on purpose, and it carries the one price the row draws rather than
every price field the wire has.

### 4.3 The group suggestion carries an offer, and `ProductGroup` does not

```ts
| {
    readonly kind: 'group';
    readonly group: ProductGroup;
    readonly itemIds: readonly string[];
    /**
     * The group's cheapest way to buy, at the reader's scopes, or null.
     *
     * On the variant and not on {@link ProductGroup}, for the reason `itemIds`
     * is: a group's identity is its name, and what it costs is an answer to a
     * question asked with a set of scopes. A group read anywhere else has no
     * offer to carry, and a field that is null on every other read is a field
     * nothing can trust.
     */
    readonly offer: ProductOffer | null;
  }
```

`ProductGroup` itself gains nothing, which is the same call `itemIds` already made and for the same
reason. Section 6.6 is what draws it.

## 5. The mapper

`toProductOffer` is a private function in `basket-mappers.ts` today, and `basket-mappers.ts` imports
from `mappers.ts`. So it **moves into `mappers.ts` and is exported**, and `basket-mappers.ts` imports
it from there beside `toLocalizedName`, which is the one direction that keeps those two files acyclic.
Its body does not change.

`toCatalogItem` gains one line, `offer: toProductOffer(raw['bestOffer'])`, and its doc gains the same
correction `CatalogItem`'s does.

Three properties of the existing function are worth naming, because they are the reason it is being
moved rather than copied:

- **A price of null is an offer, not an absence.** `ItemOfferView` can carry a scope that has the
  product with no number on it, and that maps to an offer whose `price` is null. Section 6.3 draws
  it as nothing, which is the same nothing an absent offer draws, and no caller has to know which
  one it got.
- **An offer with no `priceScopeId` is dropped.** The contract makes the field non optional, so this
  never fires in practice; it stays because a second, laxer mapper for the typeahead would be two
  functions that disagree about what an offer is. The typeahead simply ignores a field it has no map
  to resolve.
- **`unitPrice`, `unitPriceLabel`, `observedAt` and `sourceKind` are mapped and not drawn here.**
  This is the one place the model deliberately carries more than the row renders, and it is not the
  promise `CatalogItem`'s old comment warned against: they are drawn today, by the pick sheet, off
  the same interface. Narrowing the shared offer for one caller would fork it.

`toCatalogSuggestion` gains one line in its group branch, `offer: toProductOffer(raw['offer'])`,
reading the raw `ProductGroupOfferView` it has already narrowed. Two names are worth being careful
about while writing it:

- The wire calls the group's price **`offer`** and an item's **`bestOffer`**. They are the same
  `ItemOfferView` shape and one mapper reads both, but the keys are not the same string and a
  copy paste between the two branches produces a null that looks like an unpriced catalog.
- The group branch's existing local variable is already named `offer`, for the whole
  `ProductGroupOfferView`. It is renamed to `groupOffer` in passing, so the line that reads the price
  off it does not read `offer['offer']`.

`cheapestItem` is not read. Section 6.6 draws the number and not the member it belongs to.

## 6. The row

### 6.1 The price joins the note line

```
🛒  Leche entera semidesnatada                         6 pack
    Hacendado · 5,45 €

🛒  Leche entera semidesnatada                            1 L
    Hacendado · 1,05 €

🛒  Aceite de oliva virgen extra
    1,19 €
```

The price is appended to the **note line under the name**, joined by `·`, which is the separator
`basket-line-row` already uses for exactly this and which takes no translation key. Where the product
has no brand, the note line is the price alone. Where there is no price, the note line is the brand
alone, which is precisely what it is today.

### 6.2 Not at the row's end, because the size lives there

The obvious place for a price is the right edge, right aligned, which is how prices read down a list.
It cannot go there, and the reason is written on `sizeOf` already:

> How big the packet is, and it is here rather than on the note line underneath the name for one
> reason: the catalog holds one record per size, so this is the **only** field telling two otherwise
> identical rows apart. The name and the note both truncate, and two cartons of the same milk
> truncate to the same string; this end of the row never does.

That field is load bearing and it cannot move. Putting a second element beside it on a phone would
squeeze the one thing that must never truncate in order to make room for a thing that may be absent,
which is section 3's rule broken at the layout level. The note line, in contrast, is exactly where
`0062` section 4 put the price on the basket row, for the same reason and with the same separator.
Two screens quoting a product's price now say it the same way.

### 6.3 A product with no price says nothing

No `noPrice` label, no dash, no blank reserved. The note line is the brand alone and the row is the
row it is today.

`0062` section 5.3 suspends this rule for the pick sheet, where an unpriced option among priced ones
draws "No price" so a shopper does not read the blank as free. **That exception does not reach here**,
and the difference is what the two lists are. The pick sheet holds the options of **one line**: the
same product from several places, all comparable, drawn so they can be compared, where a blank among
numbers is genuinely ambiguous. A typeahead holds whatever matched three characters: groups and
products, different brands, different sizes, and a free text row at the end that is not a product at
all. A blank there does not read as free, it reads as a row of a different kind, because the list is
already full of rows of different kinds. Labelling every unpriced one is noise on the screen that has
the least room for it, and in a cluster with the harvester off it is a label on every row at once.

### 6.4 No unit price on the row

`unitPrice` is on the model and is not drawn. It is a second number in a place with room for one, and
its entire value is comparison, which is a job the pick sheet does with two products side by side and
a dropdown does not do at all: the rows here are the catalog's answer to a word somebody typed, and
they change on the next keystroke.

Quoting price per litre beside the packet price would also be the exact confusion section 2 exists to
prevent, one row further along: a six pack showing a smaller second number than a single carton reads
as the cheaper row, and it is not the row somebody wanting one bottle should be nudged toward.

### 6.5 No place on the row

`0062` section 5.1 draws the chain, and the shop where the reader may have it, under each option in
the pick sheet. The typeahead draws neither, for two reasons and either would be enough:

- **The response does not carry it.** The basket read composes a `scopes` map so a row can resolve
  its `priceScopeId` into a chain and an address. `CatalogSuggestResponse` is one array of
  suggestions and nothing else. Drawing a place here would mean a server change, which is the one
  thing this plan is able to avoid entirely.
- **The row has no room for it**, and `0059` section 2's caution applies: a chain name beside a price
  on the screen where lines get written invites the reading that the app is steering the list toward
  a shop, which is a whole feature with a threshold the user has to set, and it is backlog `0004`.

### 6.6 A group row says "Best price"

A group row draws its price too, and it draws it **labelled**, on the same note line, after the
message that is already there:

```
🧺  Leche                                                grupo
    adds its 4 products · Best price: 1,05 €

🧺  Aceite de oliva                                      grupo
    adds its 6 products
```

`ProductGroupOfferView` carries `cheapestItem` and `offer`, and `offer` is the price this draws.
Where it is null, which is every group in a cluster with the harvester off and any group none of
whose members is priced at the reader's scopes, the note line is exactly the sentence it is today.

The label is not decoration. An item row's number is the price of the thing that row adds, and a
bare number under a group would read the same way while meaning something else: a group adds several
products and no single price among them is what the row costs. "Best price" says the number is the
floor rather than the total, which is the one sentence that makes the two kinds of row readable in
one list.

#### What the number is

**The price of the group's most economical member, which is not always its smallest number.**
`item.searchOffers` picks the group's offer with `ORDER BY unitPrice ASC NULLS LAST, price ASC`, so
the member it lands on is the cheapest **per litre or per kilo**, and `offer.price` is that member's
own packet price. A six pack that wins on price per litre therefore quotes the six pack's price, and
that figure can be larger than a single carton's.

This is deliberate on the server's side and it is right for a group: a group is a **kind** of thing
rather than a packet, so "the best price for milk" is the most economical way to buy milk. Section 2
governs items, where somebody has named a packet and must be quoted that packet; a group has named
no packet, so there is nothing for section 2 to hold to.

The row does not name the member, and section 12 keeps it out. `cheapestItem` is on the wire, so it
is one mapper line away if the label turns out to raise the question more often than it answers it.

#### Both halves on one line, in this order

The note line stays one line, so a priced group row and an unpriced one are the same height, which is
section 3's rule and would be broken by a second element under the first.

One line means the note can truncate on a narrow screen, and the order decides which half is lost.
"adds its 4 products" comes first. That sentence exists to stop a row quietly attaching four products
to somebody's list, which is a surprise the first three times, and losing it would reintroduce the
thing it was written to prevent. Losing the price is section 3's ordinary state anyway: it is what
every row in staging and production shows.

### 6.7 How the component formats it

`SuggestionList` gains two methods beside `nameOf` and `sizeOf`, one per kind of row, because the two
notes are different in kind and not only in content: an item's note is **data** (a brand and a
number), and a group's is **copy** with data interpolated into it.

```ts
/** An item's note: the brand, the price, or both, or nothing. */
noteOf(suggestion: CatalogSuggestion): string | null;

/** A group's price, as a key and the money to put in it, or null when unpriced. */
bestPriceOf(suggestion: CatalogSuggestion): { key: string; args: { price: string } } | null;
```

`noteOf` returns the joined string, or null when the row has neither brand nor price, and the
template draws one element or none.

`bestPriceOf` returns the `{ key, args }` shape `sizeOf` already returns, and the template pipes it
through `rokuT` exactly as it pipes `sizeOf`. **The component never translates**, because nothing in
velista injects `ROKU_TRANSLATOR` into a component and this plan is not the place to start: every
translated string in this component reaches the template as a key and is rendered by the pipe. What
the method does is format the money and decide whether there is anything to say at all.

The two halves of a group's note are joined by the separator the app already uses, written in the
template between the two piped expressions rather than in a component method. That is the one place
this plan puts a separator in markup, and the reason is that both halves here are copy, so there is
no string for a method to have joined.

Money is formatted with `formatMoney` from `@portfolio/velista/platform`, which `0062` section 3.1
added and specced. Its doc says it is called in a selector and never in a template, and this is the
documented shape of that rule rather than an exception to it: **the string is built in the component,
in a method, and the template calls the method.** This component has no store and no view model. It
is handed models and resolves the reader's language itself, from `RokuLocaleStore`, which is exactly
what `nameOf` and `sizeOf` already do and why they exist as methods. A price built in a template
expression would be the thing the rule forbids.

Money is formatted with `formatMoney` from `@portfolio/velista/platform`, which `0062` section 3.1
added and specced. Its doc says it is called in a selector and never in a template, and this is the
documented shape of that rule rather than an exception to it: **the string is built in the component,
in a method, and the template calls the method.** This component has no store and no view model. It
is handed models and resolves the reader's language itself, from `RokuLocaleStore`, which is exactly
what `nameOf` and `sizeOf` already do and why they exist as methods. A price built in a template
expression would be the thing the rule forbids.

An offer whose `price` is null returns the brand alone, so section 6.3 is one branch and not a
scattering of them.

## 7. Where the price comes from, on each of the three screens

Nothing in this section is built. It is here because it is the question somebody will ask when a
price appears on one screen and not another, and the answer is already in the code.

| Screen             | The call                               | The scopes                                                     |
| ------------------ | -------------------------------------- | -------------------------------------------------------------- |
| List page composer | `CatalogApi.suggest(q, { profileId })` | The selected shopping profile's, resolved by the gateway       |
| Line page search   | `CatalogApi.suggest(q, { profileId })` | The same                                                       |
| Basket composer    | `BasketApi.suggest(listId, q)`         | The **run's**, from the basket's own snapshot. No client scope |

The first two send `profileId` from `ShoppingProfileStore.selected()`, which `0047` section 3 added for
exactly this reason: the scope is where you shop. The third deliberately sends no scope at all, which
`BasketApi.suggest`'s own comment explains: the ranking is the run's, and a guest naming where to
price a stranger's basket is not a thing the server accepts.

Two consequences follow and both are correct:

- **A reader with no profile, or a profile that resolves to nothing, gets a full catalog with no
  prices.** That is backend `0069`'s subject, it is the same state as excluding every shop, and it is
  what section 3 says the screen must already render.
- **The basket composer and the list page composer can quote different prices for the same product**,
  when the run was composed against scopes the reader's current profile does not cover. Neither is
  wrong: one is what the trip was priced at and the other is where the reader shops. Nothing on
  either screen claims otherwise, because neither draws a place.

## 8. Guests

No branch, anywhere, on participant kind. `0062` section 6 settled it: a price is a public product
fact, and unlike the send sheet and the units sheet, nothing here names a household.

The basket composer is guest reachable, and a guest gets prices there the same way an owner does,
through the same route with the same scopes. The all or nothing location rule from backend `0066`
section 5 is not even reachable in this plan, since section 6.5 draws no place.

What is required is that **no component acquires a `kind === 'GUEST'` check while implementing this**.

## 9. Copy

**One new key**, for the group row's label, in both locales:

| Key                  | English                 | Spanish                   |
| -------------------- | ----------------------- | ------------------------- |
| `list.add.bestPrice` | `Best price: {{price}}` | `Mejor precio: {{price}}` |

`{{price}}` arrives already formatted, from `formatMoney`, so the key interpolates a string and never
a number. A key that interpolated the number would format it with i18next's own rules rather than
with the reader's language as `RokuLocaleStore` holds it, which is the whole reason `formatMoney`
exists.

**An item row takes no key**, and that difference is section 6.7's: its note is a brand and a
formatted number, both data, joined by the separator the app already uses. `0062` section 7 made the
same call about its place line and for the same reason.

`list.add.groupAdds`, `list.add.groupBadge`, `list.add.asWritten` and the size keys are untouched.
`groupAdds` in particular keeps its wording, including its lower case opening, because it is still
the first half of the sentence and the label follows it.

## 10. Tests

- `mappers.spec.ts`: `toCatalogItem` maps a whole `bestOffer`; an absent `bestOffer` yields a null
  offer; a `bestOffer` whose `price` is null yields an offer with a null price rather than a null
  offer, which is the distinction section 5 keeps; `toCatalogSuggestion` carries the offer through on
  an item and on a group.
- `mappers.spec.ts`, the two keys: a group suggestion whose raw half carries `offer` maps to an offer,
  and a group suggestion carrying `bestOffer` instead maps to null. The second is the copy paste
  section 5 warns about, and it is the assertion that would have caught it.
- `basket-mappers.spec.ts` needs no new case and must keep passing unchanged. That is the assertion
  that moving `toProductOffer` moved a function and not a behaviour.
- `suggestion-list.spec.ts`: a priced item renders brand and money on one note line; an unpriced item
  renders exactly the brand it renders today; a priced item with no brand renders the money alone; an
  item with neither renders no note element at all; the size badge is unchanged in every one of
  those.
- `suggestion-list.spec.ts`, the group row: a priced group renders its "adds N" note **and** the
  `list.add.bestPrice` key, in that order, on one note element; an unpriced group renders the note it
  renders today and no second expression; a priced group's note element is the same element and the
  same count of them as an unpriced group's, which is section 6.6's one line rule asserted rather
  than described.
- The group's price is asserted on **`bestPriceOf`'s return**, not on rendered text: the key
  interpolates and the testing translator does not. `args.price` is the money string, so that
  assertion also covers the formatting without going through the DOM.
- `suggestion-list.spec.ts`: the row order is untouched by any of this, asserted against a fixture
  whose cheapest row is not its first. The `above` placement's reversal is the panel's, from the
  suggestion order fix, and no price may ever influence it.
- An item's note is safe to read off the DOM, since a brand and a formatted number are plain data
  and no key interpolates. Everything on a group row goes through a key and none of it is.
- `money.spec.ts` gains nothing. `formatMoney` is already specced and this plan only calls it.

## 11. Verifying it

The same two runs `0062` asked for, and the second is the one that matters most:

1. Against a slot with the seeded Mercadona catalog, all three typeaheads show prices, and a search
   for "leche" shows several sizes of one milk whose prices differ in the direction their sizes do,
   with the "leche" **group** above them carrying its own labelled best price. Check that group's
   number against the products under it, since section 6.6 says it may be larger than the smallest of
   them and that is the state most likely to be reported as a bug.
   The seeded catalog has one chain, so a profile covering Mercadona is what makes any of this
   appear at all.
2. Against a stack with no prices at all, all three typeaheads look **untouched**. Not "degraded
   gracefully": identical to today, because that is what staging and production are.

## 12. Out of scope

- **Unit price on a row, and a place on any row.** Sections 6.4 and 6.5.
- **Naming the member a group's best price belongs to.** `cheapestItem` is on the wire and section
  6.6 does not read it. The row has one note line, the label already spends part of it, and a brand
  and a size after that is the row's whole width for a product the row does not add. If the label
  turns out to raise the question more than it answers it, that is one mapper line and one key.
- **Reordering, or marking one row cheapest.** The order is the server's ranking and is never
  re sorted, which `toCatalogSuggestion`'s comment, `0053` section 4 and `0062` section 5.2 all state
  already. A cheapest mark additionally needs a comparable set, and a set of search results is not
  one: it holds groups, brands and sizes that were never candidates for each other.
- **A "no price" label.** Section 6.3.
- **A total, anywhere.** Backend `0066` section 6 refuses to send one and no screen computes one.
- **The zone list page's own rows.** A line on a list is not a product until it has a pick, and what
  a line costs is the basket's question, which `0062` answered.
- **The shops screen.** `0059` section 2 gives the reason and it has not changed.
- **Choosing where to shop, or telling anybody a second trip is worth it.** Backend backlog `0004`.
