# 0196: what the catalog tab asks of the backend

> Asked for by the owner on 2026-10-08 ("Implement the backend plan, then go back to stage
> 2"). Velista plan `0134` built its first stage with no backend change (PR #679). Its
> section 9 states three reads that its second stage needs, and the owner added a fourth
> point after the walk of stage 1: "If the list has auto-approve enabled, deleting only needs
> write access".
>
> Prerequisite reading: velista `0134` sections 3, 6, 7 and 9, plan `0080` (every price a
> source gave), plan `0117` sections 2 to 6 (the order of the price rule), plan `0105`
> section 4 (the stack of a scope), plan `0007` section 2 and plan `0036` section 4.1 (who
> deletes a line), and `catalog/src/app/catalog/item.service.ts`, `effective-price.ts`,
> `effective-price.service.ts`, `core/src/app/lists/line.service.ts`, `list.service.ts`,
> `list-holding.sql.ts`, `list-permissions.sql.ts`,
> `gateway/src/app/catalog/catalog.controller.ts`, `catalog.dto.ts` and
> `gateway/src/app/lists/list.controller.ts`.

The catalog tab of velista orders products by name or by match only, shows no price history,
and cannot say which lines of a person's lists hold a product. This plan adds three orders
to the product listing, a price history that a shopper can read, and a read of the lists and
lines that hold a product. It also lets a person with write access delete an approved line
on a list that approves lines by itself.

## Brief for the agent

### Objective

Serve the four changes of sections 1 to 4 below, each with its contract schema, its gateway
route or DTO change, its specs and the regenerated `openapi.json`. Add no migration.

### Context

Every statement below was read in the file it names, on `dev` at `b0ae5d95`.

**The listing.** `GET /v1/catalog/items` is `CatalogItemsController.search()`
(`gateway/src/app/catalog/catalog.controller.ts:411`). It sends `ITEM_PATTERNS.search` with
`priceScopeIds` that the gateway resolved. `ItemService.search()`
(`catalog/src/app/catalog/item.service.ts:913`) takes the ranked branch (`rankedItems`, raw
SQL, offset paging) for `relevance` with a term, and the listed branch (`listedItems`, a
query builder, keyset paging through `applyOrder` at 2295) for `name`, `created` and
`updated`. The listed branch also filters by a term. `ItemCursor` (105) is
`{ order, locale, value, id }`. Prices are attached after the page is cut, by `offersFor`
(1437), which keeps the cheapest available `supermarket_items` row for each product through
`orderOffers` (2473). The gateway accepts the order in `SearchOrderQueryDto`
(`catalog.dto.ts:1239`), and the contract names the orders in `ITEM_ORDERS`
(`catalog.messages.ts:3772`).

**Categories.** The tree has two levels (`category.service.ts:189` refuses a parent that has
a parent). `categories.position` orders the siblings, and `orderAsTree()` (499) is the order
of the whole tree. A product is in several leaves through `item_categories`, whose
`position` 0 is its first category.

**The price rule.** `resolveEffectivePrice` (`effective-price.ts:119`) is pure. It takes the
current row for each scope and kind, the policies, the priorities of the scopes of the
stack, and a clock. `recomputeEffectivePrices` (`effective-price.service.ts:288`) shows how
its input is built: the scope, `lessSpecificScopesOf(scope)`, and one priority for each.
Nothing answers the price of a past day. `supermarket_items` holds one row for each product
and scope, and `item_prices` holds each price that a source stated, with `observedAt`,
`lastObservedAt`, `validFrom`, `validUntil` and `protectedUntil`. Only the admin route
`itemPrice.list` reads that table.

**The lists that hold a product.** `GET /v1/items/:id/lists` (`list.holdingItem`,
`core/src/app/lists/list-holding.sql.ts:30`) answers one row for each list, with the largest
quantity, for approved lines above zero, and at most 20 lists. It has no line id, no line
name and no permissions. `READABLE_LIST` (`zones/zone-summary.sql.ts:67`) is the test that
a member can read a list. `LIST_PERMISSIONS_AMONG_SQL` (`list-permissions.sql.ts:22`) shows
how the permissions of a member are read for many lists at once: staff hold all four, and
the others hold their `list_access` row.

**Who deletes a line.** `LineService.delete()` (`core/src/app/lists/line.service.ts:2693`)
lets `MANAGE` delete each line and lets `WRITE` delete a line that is not approved. It does
not read `autoApproveLines`. On a list that approves lines by itself each new line starts
approved. A person with write access thus cannot delete a line there, their own included.

### Target state

1. `GET /v1/catalog/items` accepts `order=category`, `order=price` and `order=unitPrice`
   (section 1).
2. `GET /v1/catalog/items/:id/price-history` answers the price that a shopper saw, for each
   scope of the read, over a range of time (section 2).
3. `GET /v1/items/:id/list-lines` answers each list that the caller can read, with the lines
   of that list that hold the product (section 3).
4. `DELETE /v1/lines/:id` accepts `WRITE` for an approved line when the list approves lines
   by itself (section 4).

### Scope

- `libs/luna-shopper/contracts`: the messages, the schemas, and the pattern maps.
- `apps/luna-shopper-backend/catalog`: `item.service.ts`, a new pure `price-history.ts`, a
  new `price-history.service.ts`, the controller, and their specs.
- `apps/luna-shopper-backend/core`: `list.service.ts`, a new SQL file beside
  `list-holding.sql.ts`, `line.service.ts`, the controller, and their specs.
- `apps/luna-shopper-backend/gateway`: the two controllers, `catalog.dto.ts`, their HTTP
  specs, `admin-namespace.spec.ts`, and `docs/openapi.json`.
- `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, regenerated.

### Constraints

- **No migration and no new table.** Each read works on the tables that exist.
- **Never write a price** and never decide at write time which source wins (plan `0080`).
  The history is a read.
- **The gateway validation pipe refuses an unknown query parameter.** Each new parameter is
  a property of a DTO class.
- **`openapi.json` and `wire-types.ts` are generated output.** Regenerate both, in that
  order, and never edit them by hand.
- **An integration spec runs against a real Postgres** (`describeIntegration`). Write one
  for each SQL statement of this plan, and run it on a slot. The unit `test` target proves
  less than it seems to.
- Read the memory notes on the backend specs, on raw SQL under TypeORM and on the OpenAPI
  regeneration before the first edit.

### Action boundaries

- Do not change velista, the admin app, or any file under `libs/velista`.
- Do not change `GET /v1/items/:id/lists`. The line page of velista reads it.
- Do not change the ranked branch of the listing, or what `relevance` means.
- Do not change who edits a line or who changes its quantity. Section 4 is about delete
  alone.
- Stop and ask before you add a dependency, a migration or an index.

### Progress evidence

- `npx nx affected -t lint test build --base=origin/dev` is green.
- `luna-shopper-backend-catalog:test-integration` and
  `luna-shopper-backend-core:test-integration` are green on a slot, with the new specs in
  the run. Report the counts.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` leave no diff after the commit.

This plan is for an agent with real system access. Check the paths and the line numbers
above against the repository before you start.

## 1. Three orders on the listing

| `order` | The rows come in this order |
| --- | --- |
| `category` | The place of the product's first category in the tree, then the name, then the id. A product with no category comes last |
| `price` | The lowest price of the product at the scopes of the read, then the name, then the id. A product with no price comes last |
| `unitPrice` | The lowest unit price at the scopes of the read, then the name, then the id. A product with no unit price comes last |

- **All three take the listed branch**, with or without a term. `relevance` stays the
  default with a term and `name` stays the default without one. A client asks for
  `category` by name.
- **The price of a product** is the lowest `price` among its `supermarket_items` rows at
  `priceScopeIds` that are `available` and have a price. It is the same test as `cheapest`
  in `rankedItems`, on `price` and not on `unitPrice`. The unit price order reads
  `unitPrice` the same way.
- **With no scope, no product has a price.** The price orders then answer every product in
  the order of the name. That is correct and not an error.
- **The place of a category** is its rank in `orderAsTree()`: a root by its position, and a
  leaf by the position of its root and then its own. Read the tree one time for the request,
  rank it in the service, and hand the ids and the ranks to the query as two arrays. The
  query reads the category at `item_categories.position = 0`, or the lowest position when
  none is 0.
- **Do not join in the query builder.** `take()` beside a join makes TypeORM cut the page in
  a second query. Each sort value is a scalar subquery, as each filter of `listedMatch` is
  an `EXISTS`.
- **The cursor.** `ItemCursor` gains what the three orders need: the rank for `category`,
  and the price or the unit price for the other two, where null means "no price". `value`
  keeps the name. The keyset for a price order is:
  - after a row with price `p`: the rows with a higher price, the rows with the same price
    and a later `(name, id)`, and every row with no price.
  - after a row with no price: the rows with no price and a later `(name, id)`.
  The category order has no null: a product with no category takes a rank after every rank
  of the tree, and the keyset is one row comparison on `(rank, name, id)`.
- **A cursor of another order starts over**, as a cursor of another locale does today.
- **`bestOffer` follows the order.** Under `unitPrice` the offer attached to a row is the
  one with the lowest unit price, so the row shows the number that placed it. Under each
  other order it is what it is today.
- The gateway adds the three values to `SearchOrderQueryDto` and the contract adds them to
  `ITEM_ORDERS` and to the request schema. `CatalogListQueryDto` does not change.

**Cost.** Each price order evaluates one indexed subquery for each product that the filters
keep (`uq_supermarket_item_scope` starts with `itemId`). The name order already sorts the
whole filtered set on an expression with no index. Measure the three orders on a realistic
catalog and write the timings into the pull request. Do not add an index under this plan.

## 2. A price history that a shopper can read

`GET /v1/catalog/items/:id/price-history`, behind `JwtAuthGuard`, with the scope selectors
of `PriceScopedQueryDto` and two optional instants, `from` and `to`.

- `to` defaults to now. `from` defaults to 365 days before `to`. A range longer than 400
  days is cut at its start. A `from` after `to` is 400 `validation_failed`.
- The gateway resolves the scopes as the listing does (`scopes.forRead`) and sends at most
  50 of them, with `ITEM_PATTERNS.priceHistory` (`item.priceHistory`).
- An unknown product is 404 `not_found`, the code that `item.get` answers.

The answer:

```ts
interface ItemPriceHistoryView {
  itemId: string;
  from: string; // the range that was read, after the defaults and the cut
  to: string;
  series: ItemPriceSeriesView[]; // one for each scope that exists, in the order asked
}
interface ItemPriceSeriesView {
  priceScopeId: string;
  supermarketId: string;
  points: ItemPricePointView[]; // oldest first
}
interface ItemPricePointView {
  at: string; // the price holds from here until the next point
  price: number | null; // null: nothing was shown from here
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  unitBasis: UnitBasis | null;
}
```

- **The first point of a series is at `from`** and says what was shown then, which can be
  null. A later point exists only where the price, the unit price or the label changed. A
  scope with no row at all answers one point with a null price.
- **A series holds at most 500 points.** If it has more, the oldest go and the first one
  kept moves to the instant it really starts at.

**How a point is found.** The rule is replayed, not approximated by reading one source.

1. For one scope, load the `item_prices` rows of the product at that scope and at
   `lessSpecificScopesOf(scope)`, with `observedAt <= to`. Read the policies and the
   priorities as they are now.
2. The instants at which the answer can change are, for each row: `observedAt`,
   `validFrom`, `validUntil`, `protectedUntil`, and `lastObservedAt` plus the max age of its
   kind. Keep those inside the range, with `from` itself.
3. At each instant `t`, the current row of a scope and kind is the one with the newest
   `observedAt` that is not after `t`. Hand those rows to `resolveEffectivePrice` with
   `now = t`. A row is handed over with `lastObservedAt` no later than `t`, because at `t`
   nobody had seen it later than that.
4. The row that the rule answers is the point, fresh or stale. No row is a null point.

This is a pure function, `priceHistory(input)`, in `price-history.ts`, with a table driven
spec. `price-history.service.ts` loads the rows and calls it.

**What the replay cannot know, and says so in its comment.** It reads the policies and the
priorities of today, not of the day. It cannot know that a source repeated a price between
`observedAt` and `lastObservedAt`, so it treats the row as seen all through. It does not
know that a shop stopped stocking the product for a while (`available`). Each one makes the
history a little smoother than what a shopper saw. None of them invents a price.

## 3. The lists and the lines that hold a product

`GET /v1/items/:id/list-lines`, behind `JwtAuthGuard`, on the controller that holds
`GET /v1/items/:id/lists`. It sends `LIST_PATTERNS.linesHoldingItem`
(`list.linesHoldingItem`) with `{ userId, itemId }`.

```ts
interface ListsWithItemLinesResult {
  lists: ListWithItemLinesView[];
  hasMore: boolean;
}
interface ListWithItemLinesView {
  listId: string;
  name: string;
  zoneId: string;
  zoneName: string;
  autoApproveLines: boolean;
  myPermissions: ListPermission[]; // in the order ListView uses
  lines: ItemLineView[]; // the lines of this list that hold the product, by position
}
interface ItemLineView {
  id: string;
  content: string;
  quantity: number;
  approvalStatus: LineApprovalStatus;
}
```

- **Every list that the caller can read, in every zone**, by `READABLE_LIST`. A list with no
  line that holds the product is in the answer with `lines: []`. That is the difference from
  `list.holdingItem`, and it is what a table with a stepper for each list needs.
- **A line holds the product** when a `list_line_items` row joins them. The line is not
  deleted and not `REJECTED`. A rejected line is skipped by a merge on add
  (`line.service.ts:1131`), so it is not a line that a plus raises. `PENDING` lines and
  lines at quantity zero are in the answer.
- **The order** is the zone name, the zone id, the list name, the list id. The client
  reorders for the last used list.
- **At most 100 lists** (`LISTS_WITH_ITEM_LINES_LIMITS.maxLists`), and `hasMore` says that
  more exist. A list holds at most 20 lines in the answer, the first by position.
- **`myPermissions`** follows `LIST_PERMISSIONS_AMONG_SQL`: staff hold all four.
- Two statements: the readable lists with their permissions, then the lines for those list
  ids. Put them in a new `list-item-lines.sql.ts`.
- An id that is not a uuid is 400, as `holdingItem` answers.

## 4. A writer deletes on a list that approves by itself

In `LineService.delete()`, a caller without `MANAGE` may delete an `APPROVED` line when the
list has `autoApproveLines` on and the caller holds `WRITE`.

- **The reason.** The refusal protects an agreement: a line that somebody with `DECIDE`
  approved. On a list that approves lines by itself nobody agreed to anything, and the
  status says only that the list asks for no approval. There the refusal stopped a writer
  from removing their own mistake.
- A list with `autoApproveLines` off does not change: `WRITE` deletes a `PENDING` or a
  `REJECTED` line, and only `MANAGE` deletes an approved one.
- `DECIDE` alone still deletes nothing.
- Rewrite the comment above `delete()` and the text of the refusal so that both say the
  rule as it is.
- Specs in `list-permissions.spec.ts`: a writer deletes an approved line on a list that
  approves by itself, a writer is still refused on a list that does not, a reader is refused
  on both, and a decider without write is refused on both.

## 5. Tests

- `price-history.spec.ts`, table driven: one source that changes price, a narrower scope
  that starts later, a leaflet with a window, a row that ages out and goes stale, an `ADMIN`
  row inside its protection, no row at all, and the cut at 500 points.
- `catalog-order.integration.spec.ts`: each of the three orders pages a set of 7 products 3
  at a time with no repeat and no skip, the rows with no price come last, a tie of price
  falls to the name, a cursor of another order starts over, and `bestOffer` under
  `unitPrice` is the offer with the lowest unit price.
- `price-history.integration.spec.ts`: the rows of two scopes of one chain, read through the
  service.
- `list-item-lines.integration.spec.ts`: a list with two lines that hold the product, a
  list with none, a list that the caller cannot read, a zone where the membership is
  pending, a rejected line, a deleted line, and the permissions of staff and of a member.
- Gateway HTTP specs for the two new routes and for the three new order values, and the two
  routes in the table of `admin-namespace.spec.ts`.

## 6. Not in this plan

- An index for a price order, or a stored sort key. Section 1 measures first.
- A history of the policies or of the stock of a shop (section 2 says what that costs).
- A list of every list of every zone with no product. Velista reads the zones and then the
  lists of each one, and that is enough for its sheet.
- Any change to velista. Stage 2 of velista `0134` consumes this plan.

## 7. What was decided while building

- **The rank of a category is looked up, not joined.** Section 1 says to hand the ids and
  the ranks to the query as two arrays. The query reads the rank with
  `(ranks)[array_position(ids, categoryId)]` on the row at the lowest position. A join on
  the unnested arrays took 700 ms for a first page of 22,203 products, and the lookup
  takes 67 ms.
- **A cursor of another order starts over for every order**, `name`, `created` and
  `updated` included. Before, a cursor of another order was used as it was.
- **Under `unitPrice` with `offers=all`**, `bestOffer` is the offer with the lowest unit
  price, and the `offers` array keeps its order by price. So `bestOffer` is not always
  the first of the array there.
- **A point of the history is also written where the currency changes.**
- **The contract schema leaves `order` a free string**, as it was. `ITEM_ORDERS` and the
  gateway DTO name the values. No caller inside the backend can start to fail.
- **The price history route accepts `cursor`, `limit` and `order` and ignores them**,
  because its DTO extends `PriceScopedQueryDto`.
- **`GET /v1/items/:id/list-lines` does not check the product against the catalog.** An
  unknown id answers each readable list with no line.

**Timings.** Read with `EXPLAIN (ANALYZE)` on a catalog of 22,203 products and 330,733
`supermarket_items` rows, at 10 scopes, with no filter, which is the slowest case.

| Read | Time |
| --- | --- |
| `name`, first page (what the tab did before) | 63 ms cold, 11 ms warm |
| `category`, first page | 67 ms |
| `category`, a page after a cursor | 89 ms |
| `price`, first page | 1,215 ms cold, 292 ms warm |
| `price`, a page after a cursor | 349 ms |
| `price`, one chain in `soldBy` | 259 ms |
| `unitPrice`, first page | 225 ms |

A price order costs about 13 microseconds for each product and each evaluation of the
subquery, and a page after a cursor evaluates it up to three times for a row. No index was
added. A stored sort key is the next step if these times are too long on the real catalog.
