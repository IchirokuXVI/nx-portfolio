# 0201: a basket row is a product

> Asked for by the owner on 2026-10-11: "The basket currently merges all lines with the same
> name, which results in having the same product duplicated if different lines have the
> same product. I think it would be way better to merge all lines with the same product,
> and only show products on the basket."
>
> His rules, in his words:
>
> - "Each line always has a single product selected, unless it doesn't have any products.
>   That means each basket row can have 0 or 1 products, never more than one. When
>   translating zone list lines to the basket, only the first product (cheapest) or the
>   favorite one is taken into account for the basket, unless the user changes it later on."
> - "If a line doesn't have products, the line name will be used instead."
> - "Even if the basket shows products, underneath everything is computed from lines."
> - "It's important to show which lists requested each product."
>
> **This plan answers section 4 of velista plan `0137`** (pull request #692), which states
> the need and no design. Section 8 below maps its four points.
>
> Velista plan `0139` is the screen. Plan `0202` is what a buy records and the change of a
> product from the basket.
>
> Prerequisite reading: plan `0136` (the open basket is a view of its lists), plan `0130`
> and its status in `0149`, plan `0199` (the favourite of a line), plan `0134` and `0142`
> (purchases), plan `0138` (change rows), plan `0196` (the lists and lines that hold a
> product), `core/src/app/baskets/basket-rows.ts`, `line-dedup.ts`,
> `basket-row-resolver.ts`, `basket-read.service.ts`, `basket-read.sql.ts`,
> `basket-settle.service.ts`, `basket-revert.service.ts`, `basket-line-add.service.ts`,
> `gateway/src/app/baskets/basket.controller.ts`, `basket-catalog.service.ts`,
> `basket.dto.ts` and `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts`.

A basket row is a group of lines that hold the same set of products, or the same name when
they hold none. This plan makes a row the group of lines that count as the same product.
Each line counts as one product. Every write names the lines it means.

## Review of 2026-10-11: settle these before you build

A review of pull request #693 checked this plan against the code on `dev`. Where this
section and a later section disagree, this section is right. A point marked **owner**
needs his decision first: ask, and do not choose.

1. **Core builds rows and progress in places that never get the picks of the gateway.**
   Section 1 merges rows on a product that only the gateway can choose. `progressOf` in
   `core/src/app/baskets/basket-rows.ts` counts rows, and these callers run with no
   gateway read: `basket.service.ts` (the counts of a basket card),
   `basket-live.service.ts` (`live/summary`), each write answer, and
   `core/src/app/admin/admin-list.service.ts` (`openRows`, for the back office). For a
   line at step 3 of section 1 these paths fall to step 4. They merge in another way and
   report another total than the read. Section 5 has the same gap: "no entry in the row
   of that product" needs picks that core does not hold. State what each path does: count
   lines, or accept picks. **Owner:** which of the two.
2. **A line at zero cannot be raised through the demand route.** Section 5 says the page
   raises a line that exists, for a list that holds the product at zero.
   `coveredLinesSql` in `core/src/app/baskets/basket-read.sql.ts` covers a line only when
   its quantity is above zero or it has a purchase in scope. Section 4 answers "Row not
   found" for a line that the basket does not cover. The flow "Add it to another list" of
   velista `0139` section 3 thus fails for exactly the lists it is for.
3. **An unknown `itemId` and a slow price read look the same.** Section 4 answers
   `validation_failed` for an unknown item. Backend `0202` says that the price read never
   fails a buy and gives it 750 ms. A timeout cannot tell unknown from slow, and core
   cannot validate the id, because the item can be off the line.
4. **Velista `0137` section 2 is cited for the price comparison.** That plan arrived with
   pull request #692.
5. **Backend `0204` and `0205` (pull request #694) expect two things from this plan when
   it is built after them, and this plan names neither.** Backend `0204` section 7 says
   that whichever plan is built second adds the field `tripItemId` to the patch of a line.
   Backend `0205` section 3 says that its rows route runs the steps of this plan that
   choose the product of a line. If `0204` or `0205` is on your base branch, do both: add
   `tripItemId` to the patch, and hand the picks to the rows route. Without them a patch
   leaves a line in the wrong row after a buy that changes its product, and the rows route
   groups lines in another way than the full read.

## What the build decided

The build of 2026-10-13 settled the points below. Point 1 is a decision of the owner. Each
other point is a choice of the builder that the owner can overturn. Where this section and a
later section disagree, this section is right.

1. **The owner decided review point 1 on 2026-10-13: a basket counts products.** "Merged
   lines are still just a single product to pick for the user." The count is exact on the
   full read (`basket.get`, `basket.live`), which takes the picks of the gateway. Every other
   path counts the rows that core builds alone: a basket card, `live/summary`, the answer of
   a write and the back office. On those paths a line at step 3 of section 1 counts as its
   first product. No path but the full read asks the catalog anything.
   - The two counts differ in one case: a line with several products and no favourite,
     whose cheapest product is not its first, where the cheapest or the first is also the
     product of another line. They differ by one for each such line.
   - **Velista `0139` must count the header itself**, with `progressOf` of
     `@portfolio/luna-shopper/basket-rules` over the rows it holds. The `progress` of a write
     answer is the count of core, so a header that takes it can be off by one until the next
     read.
   - A finished basket still counts lines. Its numbers come from `basket_trip_rows`, one row
     for each line, which this plan may not change.
2. **Review point 2: the demand route reaches a line at zero.** It names its line, always.
   The line has to be on a covered list and not deleted. It does not have to be a row of the
   basket. Every other write still answers "Row not found" for a line that the basket does
   not draw. So "Add it to another list" raises the line of a list that holds the product at
   zero.
3. **Review point 3: only a definite "not found" refuses a buy.** The gateway asks the
   catalog for the named `itemId`. When the catalog answers and the item is not in the
   answer, the settle is `validation_failed` on `itemId`. When the catalog fails or does not
   answer inside the budget of the price read, the settle goes on and records the id. A slow
   catalog must not stop a person at the shelf, and an id that nobody knows is then a
   settlement with a product that no read can name, which is what a deleted product is
   already. Core does not check the id: it can be a product that is not on the line.
4. **Review point 5: `tripItemId` is on `BasketEntryPatch` and on the entry view**, with the
   meaning of plan `0204` section 7. It is the product of the latest standing buy of the line
   through this basket in its trip. A product id is catalog data, so a room can carry it.
   Plan `0205` is not on the base branch, so no rows route exists to hand the picks to. The
   build of `0205` must take `picks` on that route as `basket.get` does.
5. **A mark belongs to the key of a row, and the key is now the product.** Before, it was the
   set of products. The full read folds the marks with its own picks, so a mark sits on the
   row the reader sees. The marks route (`changes/marks`) has no picks. It keys each line as
   core does alone and answers a mark for each covered line. The two differ in one case: a
   line left the coverage, and its mark went to the covered lines that share its product. A
   change of a covered line marks that line on both paths.
6. **A change names a line, not a row.** `rowKey` of the changes view was the anchor of the
   row. It is now the covered line the change is about, or the line that survived a merge. A
   client finds the row that holds that line among its entries.
7. **The three rules of plans `0203` and `0204` hold for a row merged on a product.**
   - `BOUGHT_ELSEWHERE` is decided from the entries of the row, whatever grouped them. A row
     of two lists is `BOUGHT_ELSEWHERE` when nothing is left on either line and this basket
     bought neither.
   - A buy and a taken back buy write their change row for each line, as before. The change
     is about a line, so the merge does not touch it.
   - `BasketAnnouncer.linesMoved` still takes the basket the write was made through. A patch
     is about lines and names no row.
8. **An entry gains five fields, not eight.** `content`, `itemIds`, `favoriteItemId`,
   `canWrite` and `tripItemId`. `BasketView.lists` already carries the name, the zone and the
   zone name of each served list, so the entry repeats none of them (section 3 says to add
   only what is missing). `canWrite` is true exactly when the entry has a `listId`: the lists
   a reader is served are the covered lists they write.
9. **`content` of a row is still the name of its anchor**, also for a row with a product. A
   client draws it when the catalog cannot name the product.
10. **"On a list served to the actor" in section 4 is read as "on a covered list".** A guest
    is served no list. With the other reading a guest could settle nothing, and the plan says
    that who may settle does not change.
11. **Who may change a demand did not move.** A reader who writes the list names any line of
    it. A reader who does not, a guest for one, names a line only when it is the whole of its
    row as core groups the basket. That is the rule "single entry rows only" of plan `0130`
    section 5, asked of the new grouping.
12. **A settle with no `itemId` records the product the named lines agree on**, and none when
    they do not agree. `basket.searchScope` takes `lineIds` where it took `rowKey`, and
    answers that same product, so the price and the settlement still name one product.
13. **A line that left the coverage counts as its favourite or its first product.** Its
    purchases are not read for this. The key decides only which covered row inherits its
    mark, and whether it makes a removed row.
14. **The lists that can take a product are decided with no picks**, like every path but the
    full read. A list whose line counts as the product only by its price is answered with that
    line. The page holds the row and leaves out a list it already draws.
15. **The walk order finds a row under its product and under every product of its lines.**
    The wire lost `optionIds`. The order still needs them, because a shelf that somebody
    settled under another product of the same line is the shelf of this row.
16. **A rename is refused for a line that holds any product**, not only for a line whose row
    has one. The two are the same thing: a line with a product is in a row with a product.
17. **The live read asks with an account.** `basket.live.priceChoices` takes a `userId`, makes
    the basket if it is missing, and answers the basket and the participant beside the lines.
    The gateway needs both to ask what the basket is priced at.
18. **The old resolver is gone.** `mergeKey`, the `SET` and `TEXT` narrowings of the covered
    lines statement and `optionIdsOf` are removed. Nothing rebuilds a row from a key.
19. **`DELETE .../skip` takes `lineIds` in the query string**, comma separated or repeated.
    A body on a `DELETE` is not delivered reliably by every client and proxy. `PUT .../skip`
    takes them in a body, like the other writes.
20. **The gateway prices a line in one call to `cheapestOf`.** Every offer that counts goes in
    one list for each line: the products in the order of the line, then the offers of each
    product. The gateway compares no price itself. `basket-picks.ts` is that function.
21. **A read that cannot price sends no picks, and still reads.** That is a failed catalog
    call, a profile with no scopes, or a shop that the catalog cannot name. With a shop that
    cannot be named the gateway does not fall back to the scopes of the profile, because they
    are not the prices of that shop. Core then counts each such line as its first product.
    One failed batch drops every pick: a line priced on half of its products can pick wrong.
22. **The read prices and composes with one set of products.** Step 3 asks `item.getMany`
    with the scopes and `offers: 'all'` that the composition uses, and the composition takes
    from that answer the products it needs. It asks the catalog only for the rest. The
    lines to price are read beside the shop of the read, so the sequence adds no round trip
    in a row for a basket where no line needs a price.
23. **The check of an unknown `itemId` runs beside the price read**, under the same budget of
    750 ms, whenever a settle body names a product.

## Brief for the agent

### Objective

Give each covered line one product for the basket, merge rows on that product, carry the
list and the line of each entry in the row, address every row write by line ids, and serve
the lists that can still take a product.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **Core merges the rows.** `mergeKey()` (`line-dedup.ts`) is `set:<itemSetHash>` for a
  line with products and `text:<normalized name>` for a line with none. `groupEntries()`
  (`basket-rows.ts`) groups the covered lines on it, and `toRowView` writes the row. Two
  lines merge only when their whole set of products is the same.
- **Core never sees a price.** It has no catalog client. The gateway reads prices after
  the rows exist: `BasketCatalogService.compose` calls `item.getMany` with the option ids
  of the rows, the scopes of the read and `offers: 'all'`.
- **The scopes of a read** are the resolved scopes of the owner's profile. With a shop
  (`locationId`, or the basket's own shop) the quoted scope of that shop is added.
- **`item.getMany` answers for each item.** `offers: 'best'` gives one `bestOffer` for each
  item, the cheapest across the scopes that were asked. Nothing answers "the cheapest of
  these items".
- **A row carries `optionIds`**, the union of the products of its entries, and the pick is
  the first of them (`basketRowPick` in velista).
- **Every row write is `rows/:rowKey/...`.** `rowKey` is the line id of any entry.
  `BasketRowResolver.resolve` rebuilds the row from that line with `mergeKey`. Only two
  bodies name lines: `allocations[].lineId` on a settle and `lineId` on a demand.
- **A line has `favoriteItemId`** since plan `0199`. No basket code reads it.
- **A buy names its product.** `line_settlements.itemId` is set when the row has one
  option or the request names one (`resolvePick`).
- **`POST /v1/baskets/:id/lines`** adds a line to a covered list the actor may write, with
  `targetListId`, `content`, `quantity` and `itemIds`.

### Target state

1. Each covered line has one basket product or none, by the rule of section 1.
2. Rows merge on that product, or on the normalized name for a line with no product
   (section 2).
3. The row view names its product, and each entry names its list, its zone, its line and
   the products of that line (section 3).
4. Settle, revert, demand, skip and rename act on the lines the request names (section 4).
5. One read answers the covered lists that do not ask for a product yet (section 5).

### Scope

- `apps/luna-shopper-backend/core/src/app/baskets`: the product of a line, the merge key,
  the read, a new resolver by lines, every row write, the new read of section 5.
- `apps/luna-shopper-backend/gateway/src/app/baskets`: the read sequence, the DTOs, the new
  route, `openapi.json`.
- `libs/luna-shopper/contracts`: `BasketRowView`, `BasketRowEntryView`, the five write
  requests, `BasketRowResult`, the new patterns and their schemas.
- `libs/luna-shopper-admin/models`: the regenerated wire types only.

### Constraints

- **Everything is computed from lines.** A row is a view. No table stores a row, a row key
  or a product of a row.
- **Core still sees no price.** The gateway chooses the cheapest product and hands core an
  item id. Core checks that the id is a product of that line.
- **One comparison of prices**, in one pure function with a spec. It is the comparison the
  cards of a line use (velista plan `0137` section 2): the price for each kilo or litre
  first, then the price, and a tie keeps the order of the line.
- **A write never rebuilds a row from a merge key.** It loads the named lines.
- **The rules of who may do what do not change**: who may settle, who may change a demand
  (`demandEditable`), who may add a line.
- **`openapi.json` and the wire types are generated output.**

### Action boundaries

- Do not build plan `0202` or velista plan `0139`.
- Do not change how a list page merges lines (`lineIdentities`), `list_lines`, or the
  purchase history reads.
- Do not change the frozen rows of a finished basket (`basket_trip_rows`).
- Stop and ask before you add a table or a column. This plan needs none.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway`
  pass. The integration specs of the read and of each write run on a slot against a real
  Postgres.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.
- The pull request states the time of `GET /v1/baskets/live` for a basket of 100 lines
  before and after, measured on a slot with a realistic catalog.

## 1. The product of a line

A covered line counts as the first of these that applies:

1. **The product of its latest buy in this trip.** The trip is the current session of a
   live basket (`BASKET_SESSION_SQL`), or the whole life of a generated basket. The buy is
   a settlement of this line, through this basket, with the outcome bought, a product, and
   no revert. This product does not have to be a product of the line. It is how a change
   "for this trip only" holds after the first buy (plan `0202` section 3).
2. **Its favourite**, when the favourite is one of its products. The favourite wins also
   when the shop of the read does not sell it.
3. **The cheapest of its products** at the scopes of the read. With a shop, only the
   prices of that shop count. A product with no price there is not a candidate.
4. **Its first product**, in the order the line holds them, when no product has a price.
5. **Nothing**, for a line with no products.

Core knows steps 1, 2, 4 and 5. Step 3 needs prices, so the gateway does it.

**The read sequence of the gateway:**

1. The shop and its chain, as today (`readShopOf`).
2. A new core pattern, `basket.priceChoices`, answers the covered lines that reach step 3:
   two or more products, no favourite among them, and no buy in this trip. For each, the
   line id and its product ids in order.
3. One `item.getMany` with `offers: 'best'` over the distinct ids and the scopes of the
   read. The pure function of the constraints picks one id for each line.
4. `basket.get` (or `basket.live`) with `picks: {lineId, itemId}[]`. Core ignores a pick
   that is not a product of its line, and that line falls to step 4.
5. `compose`, as today. It reads the products of the rows. Reuse the offers of step 3
   where the ids overlap.

A line with one product, a favourite or a buy in this trip costs nothing in steps 2 and 3.
Batch step 3 under the limit of `item.getMany`.

## 2. The merge

- The key of a line is `item:<its product>` or `text:<its normalized name>`.
- The oldest line of a row is its anchor, as today. The row of a product is named by the
  catalog, so `content` is the name of the anchor only for a row with no product.
- `left`, `bought`, `asked`, `boughtElsewhere`, `state`, the notes, the marks and the limit
  of 1000 rows are computed over the entries, as today.
- A change of shop can move a line to another row, because the cheapest product can
  differ. That is correct.

## 3. The row view

- `BasketRowView` gains `productId: string | null` and loses `optionIds`.
- `rowKey` stays the line id of the anchor. It is an address for a page, not an identity.
- `BasketRowEntryView` gains:
  - `content`, the name of the line.
  - `itemIds`, the products of the line in order, and `favoriteItemId`.
  - `listName`, `zoneId` and `zoneName`. Read first whether `BasketView` already carries
    the served lists with their zones, and add only what is missing. An entry on a list
    that is not served to the reader stays without `listId`, as today, and gains none of
    the three.
  - `canWrite`, true when the reader may edit that line.
- `BasketResult.products` holds the product of every row and nothing else. The products
  of a line that are not its basket product are read by the page that needs them.

## 4. Writes name their lines

The five routes keep their paths. `:rowKey` must be one of the named lines.

| Route | Body after this plan |
| --- | --- |
| `POST .../settle` | `lineIds` (1 to 100), `outcome`, `quantity`, `from` (the sum of `left` over those lines), `itemId`, `allocations` (only over those lines) |
| `POST .../revert` | `lineIds`, `target`, `units`, `from` (the sum of `bought` over those lines) |
| `POST .../demand` | `lineId` (always required), `quantity`, `from` |
| `PUT` and `DELETE .../skip` | `lineIds` |
| `PATCH ...` (rename) | `lineIds`. Refused with `validation_failed` for a line that has a product |

- A new resolver loads the named lines. Each must be covered by the basket and on a list
  served to the actor, else the answer is the one "Row not found" of today.
- **`itemId` on a settle** is the product of the row as the client drew it. It can be a
  product that is not on the line (a change for this trip only). The gateway reads that
  item for the price, and an id the catalog does not know is `validation_failed` on
  `itemId`. A settle of lines with no product sends none.
- **`BasketRowResult`** answers `entries` (the named lines as they are now), `progress` and
  `skippedCount`. `row` and `replacedRowKey` are removed, because a row cannot be built
  without the prices of a read. The page takes the row from its next read, which it
  already makes.
- The stale guard of `from` stays, over the named lines.

## 5. The lists that can take a product

`GET /v1/baskets/:id/products/:itemId/lists` answers, for an account participant, every
covered list the actor may write that has no entry in the row of that product:

- `listId`, `listName`, `zoneId`, `zoneName`.
- `lineId`, `lineName` and `quantity` when the list holds a line with that product among
  its products. Otherwise the three are null.

A guest gets `forbidden`. The page raises a line that exists with the demand route, and
creates one with `POST /v1/baskets/:id/lines` (`content` is the name of the product,
`itemIds` is that one product). Read plan `0196` first: reuse its queries of the lines that
hold a product where they fit.

## 6. What stays the same

Coverage, sharing, presence, the session rule, skips, "they had none", the rows bought
through another basket, the change rows of plan `0138`, the usual shop of plan `0165`
(counted for each line), the walk order, and the freeze when a basket is finished.

## 7. Tests

- The product of a line, as a pure function: each of the five steps, a favourite that is
  no longer on the line, a pick that is not on the line, a buy in this trip that names a
  product outside the line, a reverted buy.
- The comparison: unit price before price, a tie, no price at all, the prices of one shop.
- The merge on a real Postgres: two lines with different sets and the same product make
  one row, two lines with the same set and different favourites make two, two lines with
  no product and the same name make one.
- Each write: it acts on the named lines only, it refuses a line that is not covered, and
  the guard refuses a stale `from`.
- The read of section 5: a list with the line at zero, a list without it, a list the actor
  may not write, a guest.

## 8. Velista plan 0137 section 4, answered

| Its point | This plan |
| --- | --- |
| 1. The pick is the favourite of the line | Section 1, step 2 |
| 2. With no favourite, the cheapest at the scopes of the read | Section 1, steps 3 and 4 |
| 3. A pick changed by hand has to win, and for how long | Step 1: it wins from the first buy until the trip ends. Before that buy it lives on the device (velista plan `0140`). A change that is kept writes the favourite (plan `0202`) |
| 4. A row that merges lines with two favourites | It cannot happen. Two lines with different products are two rows |

## 9. Not in this plan

What a buy records, the rewrite of the buys of a trip, and the route that changes the
product of a line from the basket (all plan `0202`). The screens (velista `0139` and
`0140`).
