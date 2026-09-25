> **PR:** [#433](https://github.com/IchirokuXVI/nx-portfolio/pull/433)

# 0143: what was paid, recorded at the shelf

> Part of the series recorded in `0130`. Needs `0136` (the open basket is a view, and its
> row settle). Client half: velista `0095`, which sends the scope and draws the spend.
>
> `line_settlements` was given two columns on the day it was created, `pricePaidCents` and
> `supermarketLocationId`, "declared and written by nothing here" (plan `0047` section 3.4,
> restated in `line-settlement.entity.ts:184-196`). They were waiting for backlog `0004`,
> which was going to price a frozen basket. A basket is not frozen any more, so that plan's
> "paid against a priced revision" has nothing to stand on, and `0130` section 9 replaces it
> with something smaller and truer: **when somebody settles a row, record what the screen
> said one of it costs, and where.** That is enough to answer "what did I spend last week"
> (`0142`), and it is recorded at the only moment anybody knows it.
>
> The hard part is not the column. It is who is allowed to say the number. A client is not,
> because the actor can be a guest, and a guest writing money into a household's history is
> exactly the write `0130` section 5 exists to refuse. So the client names a **place** and
> the gateway reads the **price**.
>
> Prerequisite reading: `0130` sections 5, 6, 9 and 13. `0136` for the row settle request,
> the settle message and the revert. Plan `0109` (every shop's price on a basket read) and
> velista `0078` sections 4 and 5 (what a scope is, and that picking a shop picks its
> scope). Plan `0066` sections 3 to 5 (the gateway prices a basket read as its owner). Then
> `gateway/src/app/generated-lists/generated-list-sharing.controller.ts:471-740` and
> `:969-1027`, `gateway/src/app/catalog/scope-resolution.service.ts`, and
> `ItemOfferView` in `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts:685`.

## Brief for the agent

### Objective

Make a settle record the price of one unit, its currency, the price scope it was read at
and, when the shopper named one, the shop, read by the gateway as the basket's owner and
never sent by a client, and never at the cost of a settle that fails.

### Context

- `line_settlements."pricePaidCents"` (`int NULL`) and `"supermarketLocationId"` (`uuid
  NULL`) exist and every write sets them to null: `settlement.service.ts:173-174` and the
  basket settle, which `0136` rebuilt on rows. The revert split copies both
  (`generated-list-reopen.service.ts:349-350` today, the revert service of `0136` after
  it).
- A price lives in catalog. `ItemOfferView` (`catalog.messages.ts:685-705`) is one
  product's price at one price scope: `price: number | null` in currency units with two
  decimals (`supermarket_items.price` is `numeric(12,2)`), `currency`, `unitPrice`,
  `unitPriceLabel`, `observedAt`, `sourceKind`, `stale`.
- **In catalog, `unitPrice` already means something else**: the chain's own price per
  reference unit, per kilogram or per litre, "stored verbatim and never recomputed"
  (`supermarket-item.entity.ts:52-63`, and the first rule of `CLAUDE.md` about the
  harvester). Section 2 is about that collision.
- A **price scope** is a warehouse's catchment, not a shop: "a scope is a warehouse's
  catchment, not a country" (`generated-list-sharing.controller.ts:690-691`). It belongs to
  one chain and covers many shops. A **location** is one shop. velista `0078` section 5:
  "Picking either picks the scope".
- The gateway prices a basket read **as the basket's owner**: core answers whose basket it
  is and which profile it is priced with, `ScopeResolutionService.describe(ownerUserId,
  { profileId })` resolves that to scopes (cached), and `ITEM_PATTERNS.getMany` with
  `{ ids, priceScopeIds, offers: 'all' }` answers every scope's offer for each product
  (`:526-559`, `:969-1027`). "The scope is the run's and never the reader's."
- Shops are served only to some readers: "`locations` is populated only when
  `seesZoneData` is true", because a street address tells a stranger holding a forwarded
  link where the owner lives (`:573-582`). `0136` deleted `seesZoneData` and decided what
  gates `locations` instead. Read what it decided. This plan reuses that one condition.
- Nest's NATS client waits for ever (memory note "Assistant timeout is Envoy's default").
  A price lookup with no budget of its own can hold a settle until the proxy cuts it.
- Staging and production hold no prices today (velista `0078` section 5.1). Every
  storefront is switched off per chain in both clusters (`CLAUDE.md`, the harvester).

### Target state

Every acceptance criterion in section 10 holds. A settle on a slot with a seeded catalog
writes a price, a settle with catalog stopped writes nulls and still succeeds, and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway
luna-shopper/contracts luna-shopper-admin/models` is green with `openapi.json` and the wire
types regenerated.

### Scope

- Work only in:
  - one migration in `core/src/app/db/migrations/`, its line in `index.ts`, and
    `core/src/app/entities/line-settlement.entity.ts`.
  - core: the row settle service and the revert service of `0136`,
    `core/src/app/lists/settlement.service.ts`, `core/src/app/lists/list.mappers.ts`
    (`toLineSettlementView`), and `core/src/app/purchases/` when `0142` is built.
  - contracts: the row settle request and message of `0136`, `SettleLineRequest`,
    `LineSettlementView`, a new `SettlementPaid`, their schemas.
  - gateway: a new `gateway/src/app/baskets/settle-price.service.ts` and its spec, the row
    settle route of `0136`, `gateway/src/app/lists/list.controller.ts` and `list.dto.ts`
    for the hand settle.
  - the generated files.
- Do NOT touch: catalog (no new subject, no new column: the price is read through
  `item.getMany` as it is), `item_prices` and everything plan `0080` decides, the basket
  read's pricing, any velista file, `unitPrice` anywhere.

### Constraints

- **A price never fails a settle, and never delays one past its budget.** Every way of not
  knowing a price ends in nulls and a settlement that was written.
- **Core never reads a price.** It stores what the gateway said. Core has no catalog
  client and this plan does not give it one.
- **A client never sends an amount.** The DTOs accept a scope id and a location id and are
  `forbidNonWhitelisted`. The amount exists only on the NATS message.
- The price is read as the basket's owner, at the basket's scopes, as the read is.
- A price is stored with its currency or not at all, by a check constraint.
- The revert split copies every column this plan adds.
- Regenerate `openapi.json` and the wire types. Never edit them by hand.

### Action boundaries

- Proceed with in scope edits, specs, the migration and the generators.
- Stop and ask if `0136` left no single condition deciding who is served `locations`.
  Section 4.3 needs exactly one, and inventing a second is how a guest learns a street.
- Stop and ask before serving `supermarketLocationId` to readers of a list. Section 6
  recommends against it and the product owner decides.

### Progress evidence

Report after the migration, after core stores and copies the columns, after the gateway
reads a price with its failure specs, and after the views, each with the spec run.

## 1. What is being built

| Piece                                                                   | Where                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `pricePaidCurrency`, `priceScopeId`, four check constraints             | one migration, the entity                         |
| `SettlementPaid` on the two settle messages                             | contracts                                         |
| `priceScopeId`, `supermarketLocationId` on the two settle DTOs          | gateway                                           |
| `SettlePriceService`: a price, read as the owner, inside a budget       | new `gateway/src/app/baskets/`                    |
| the columns stored by both settles and copied by the revert split       | core                                              |
| the price on `LineSettlementView`, the money shape on `0142`'s two views | contracts, core mappers                           |

## 2. The name

An earlier draft of `0130` renamed the column `unitPricePaidCents`, so that nobody reads it
as the total of a row. The worry is right and the name is wrong for this codebase, and
`0130` section 2.1 now says what this section argues. Catalog already owns the words: `price` is what one unit on the shelf costs, and
`unitPrice` is the chain's price per kilogram or per litre, a number this product is
forbidden to derive. A settlement column called `unitPricePaid` reads, to anybody who has
worked in catalog, as "the per kilo price that was paid", which is a different number.

**The column keeps its name, `pricePaidCents`, and gets a definition**: the catalog
`price` of one unit of `itemId` at `priceScopeId`, in the minor unit of
`pricePaidCurrency`, as the gateway read it when the settle was made. A row's cost is
`"pricePaidCents" * "quantity"`. The definition goes in the entity comment, in a `COMMENT
ON COLUMN`, and in the contract.

It is a price per unit and not a total, for two reasons the structure gives. A settle
writes one row per entry of the row it settled (`0130` section 3), and a total has
to be divided between them. And a revert smaller than the row it lands in **splits** that
row (plan `0104` section 3.2), which a per unit price survives by being copied and a total
does not.

**A currency.** Catalog stores one beside every price
(`supermarket_items.currency`, `varchar(3)`). An amount of money with no currency is a
number, and every sum over it (`0142`) is only honest while every row happens to be in
euros. The column is cheap now and a backfill later.

## 3. The columns

```ts
// line-settlement.entity.ts, replacing the comment at :184-196

/**
 * What one unit cost when this was settled, in the minor unit of
 * {@link pricePaidCurrency} (plan 0143, section 2).
 *
 * **One unit, never the row.** It is catalog's `price` of {@link itemId} at
 * {@link priceScopeId}, read by the gateway as the basket's owner at the moment
 * of the settle. It is not catalog's `unitPrice`, which is a per kilogram number
 * this product never derives. A row's cost is this times {@link quantity}.
 *
 * Null whenever nobody knew: free text, no scope named, a product that scope
 * does not price, a catalog that did not answer in time, every settlement
 * written before this plan, and every `NOT_AVAILABLE`.
 */
@Column({ type: 'int', nullable: true })
pricePaidCents!: number | null;

/** ISO 4217, null exactly when {@link pricePaidCents} is (`ck_line_settlements_price`). */
@Column({ type: 'varchar', length: 3, nullable: true })
pricePaidCurrency!: string | null;

/**
 * The price scope the shopper was looking at, which is a chain's catchment and
 * not a shop. Opaque: a catalog id with no foreign key, like {@link itemId}.
 * Recorded for `NOT_AVAILABLE` too, because "which chain had none" is the half
 * of that outcome worth keeping.
 */
@Column({ type: 'uuid', nullable: true })
priceScopeId!: string | null;

/** The one shop, when the shopper had picked one and is allowed to be told shops at all. */
@Column({ type: 'uuid', nullable: true })
supermarketLocationId!: string | null;
```

## 4. How a price reaches a settlement

### 4.1 What a client sends

Both settle DTOs gain two optional fields and nothing else:

```ts
/** On the row settle DTO of 0136, and on SettleLineDto (list.dto.ts). */
@IsOptional() @IsUUID() priceScopeId?: string;
@IsOptional() @IsUUID() supermarketLocationId?: string;
```

- `priceScopeId` is the scope the row's price on screen was read at: the shop the shopper
  chose (velista `0078`), or the scope of the cheapest offer when they chose none and the
  screen showed that one. A client that showed no price sends nothing.
- A guest sends a scope like anybody else. A scope id reaches every reader of a basket on
  every offer (`BasketPriceScopeView.priceScopeId`), it names a chain's catchment, and plan
  `0066` section 5 already ruled that what a tin costs at a chain "is a product fact and not
  a fact about anybody's household".
- `supermarketLocationId` is sent only by a client that was served shops.
- `forbidNonWhitelisted` refuses an amount. There is no field to put one in.

### 4.2 What the gateway does

`SettlePriceService.read(input): Promise<SettlementPaid | null>`, called by the row settle
route before it sends the settle message, and by the hand settle route the same way:

```ts
interface SettlePriceInput {
  /** Whose scopes. The basket's owner, or the caller on the list page. */
  userId: string;
  /** The profile the basket is priced with (0133). Undefined on the list page. */
  profileId: string | undefined;
  itemId: string | undefined;
  priceScopeId: string | undefined;
  supermarketLocationId: string | undefined;
  /** 0136's one condition for serving `locations` to this reader. */
  servedLocations: boolean;
}

/** On the NATS messages only. Never on a DTO. */
export interface SettlementPaid {
  priceScopeId: string;
  supermarketLocationId: string | null;
  /** Null together: the scope was real and the price was not known. */
  pricePaidCents: number | null;
  pricePaidCurrency: string | null;
}
```

1. No `priceScopeId`: answer null. Nothing is recorded, and that is an ordinary settle.
2. Resolve the scopes with `ScopeResolutionService.describe(userId, { profileId })`, which
   is the cached pair of round trips the basket read already made a moment ago. **The
   scope must be one of `priceScopeIds`.** A scope the owner's profile does not resolve to
   is refused by answering null, not by an error: the profile can have changed between the
   read and the tap, and the shopper can neither see that nor fix it.
3. With an `itemId`, ask catalog for that one product at that one scope:
   `ITEM_PATTERNS.getMany` with `{ ids: [itemId], priceScopeIds: [priceScopeId], offers:
   'all' }`, and take the offer whose `priceScopeId` matches. `price` and `currency` both
   present gives `pricePaidCents = Math.round(price * 100)` and the currency. Anything else
   gives the two nulls. **A `stale` offer is recorded**: it is the number the screen
   showed, which is the whole definition of this column. No `itemId` (free text, or a
   shopper who did not say which product) gives the two nulls and keeps the scope.
4. With a `supermarketLocationId` and `servedLocations`, confirm the shop belongs to the
   scope with the read `locationsOf` already makes (`supermarketLocation.list` with the
   chain and `priceScopeId`, `generated-list-sharing.controller.ts:708-730`), in parallel
   with step 3. Not served shops, or not in the scope: null. **Never an error**, for the
   reason in step 2.
5. Steps 2 to 4 share **one budget**, `SETTLE_PRICE_BUDGET_MS`, 750, a named constant at
   the top of the service. It is a `Promise.race` against a timer, because the NATS client
   has no timeout of its own. When the budget runs out the answer is
   `{ priceScopeId, supermarketLocationId: null, pricePaidCents: null, pricePaidCurrency:
   null }` when step 2 had already passed, and null otherwise. The lookup that lost the
   race is left to finish and its result is dropped. Log at `debug`, never `warn`: a slow
   catalog is catalog's alarm to raise.
6. Every `catch` on this path answers null. The spec for each is in section 9.

On the **row settle**, `userId` is the basket's owner and `profileId` its
`pricingProfileId`, both of which the gateway already asks core for to price the read
(`GENERATED_LIST_SHARING_PATTERNS.searchScope` today, whatever `0136` and `0144` call it).
On the **list page** settle, `userId` is the caller, `profileId` is undefined, which
resolves the caller's default profile, and `servedLocations` is true: they are the caller's
own shops.

The settle costs one catalog round trip more than today, at most 750 ms and usually a few,
and only when the client named a scope. It runs before the write and not after it, because
a second message that attaches a price to a settlement already written has to find
its rows again after a revert split them.

### 4.3 What core does

`SettleLineRequest` and the row settle message of `0136` gain `paid?: SettlementPaid`.
Core validates shape only (uuids, a non negative integer, three upper case letters) and
writes the four columns on **every row the settle writes**, one per entry, all with the
same values. For `NOT_AVAILABLE` it writes the scope and the shop and forces the two price
columns to null, which `ck_line_settlements_price_bought` also holds.

The revert split copies `pricePaidCents`, `pricePaidCurrency`, `priceScopeId` and
`supermarketLocationId` onto the row it appends, beside the columns it copies today. A
reverted row keeps its price: it is history, and `0142` sums standing rows only.

## 5. Migration

`SettlementPricePaid<timestamp>`.

```sql
-- up
ALTER TABLE "line_settlements"
  ADD COLUMN "pricePaidCurrency" character varying(3),
  ADD COLUMN "priceScopeId" uuid;

ALTER TABLE "line_settlements"
  ADD CONSTRAINT "ck_line_settlements_price" CHECK (
    ("pricePaidCents" IS NULL) = ("pricePaidCurrency" IS NULL)
  ),
  ADD CONSTRAINT "ck_line_settlements_price_amount" CHECK (
    "pricePaidCents" IS NULL OR "pricePaidCents" >= 0
  ),
  ADD CONSTRAINT "ck_line_settlements_price_bought" CHECK (
    "pricePaidCents" IS NULL OR "outcome" = 'BOUGHT'
  ),
  ADD CONSTRAINT "ck_line_settlements_location_scope" CHECK (
    "supermarketLocationId" IS NULL OR "priceScopeId" IS NOT NULL
  );

COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS
  'Catalog price of ONE unit of "itemId" at "priceScopeId", in the minor unit of "pricePaidCurrency", read by the gateway when the settle was made (plan 0143). Not the row total and not catalog unitPrice. Null when nobody knew.';
COMMENT ON COLUMN "line_settlements"."priceScopeId" IS
  'The price scope the shopper was looking at: a chain catchment, not a shop. Opaque catalog id, no foreign key (plan 0143).';

-- down
ALTER TABLE "line_settlements"
  DROP CONSTRAINT "ck_line_settlements_location_scope",
  DROP CONSTRAINT "ck_line_settlements_price_bought",
  DROP CONSTRAINT "ck_line_settlements_price_amount",
  DROP CONSTRAINT "ck_line_settlements_price";
ALTER TABLE "line_settlements"
  DROP COLUMN "priceScopeId",
  DROP COLUMN "pricePaidCurrency";
```

- Every existing row has all four columns null, so every constraint holds on the day it is
  added and there is no backfill. The outcome enum is compared, not extended, so the one
  transaction of `migrate.ts` is no obstacle here (`0130` section 13).
- `down` is lossy for the two columns it drops, and says so: a currency and a scope
  recorded since are gone, and `pricePaidCents` is left holding amounts with no currency.
  That is the state the table was designed in, so nothing else breaks.
- No index. Nothing reads by scope or by shop yet, and `line_settlements` is the table plan
  `0047` section 3.4 warned is the largest in core.

## 6. Who is shown a price

A decision for the product owner, with a recommendation.

**Recommended: `LineSettlementView` gains `pricePaidCents`, `pricePaidCurrency` and
`priceScopeId`, and never `supermarketLocationId`.**

- A reader of a list already learns what the household bought, how many, when, and who
  settled it (`list.messages.ts:821-865`). What the milk cost at that chain is the same
  kind of fact, and it is the one a household asks about. Plan `0066` section 5 already
  calls a chain's price a product fact.
- `LineSettlementView` rides on `line.settled`, which reaches the **zone room**, and the
  zone room is wider than `READ` on the list (`trips.announce.ts:57-60` says so). That is
  true of the purchase itself today. The price adds nothing a member of the zone is not
  already told about the purchase, so this plan widens no audience. It is stated here so
  that nobody finds it later.
- **The shop is different.** A shop and a time say where a named member of the household
  was standing at 18:40. That is not a fact about the milk. `supermarketLocationId` is
  stored, and it is served in exactly one place: a person's own history (section 7), where
  the reader is the person it is about or the owner whose basket was being shopped.

If the product owner prefers a household to see nothing about money, drop the three fields
from `LineSettlementView` and keep section 7. Nothing else in this plan changes.

## 7. The money shape in a person's history

`0142` serves `spentCents: number | null` on an entry and `pricePaidCents` on a row, from
the one column that existed. With a currency beside it, both become one shape:

```ts
export interface MoneyView {
  cents: number;
  currency: string; // ISO 4217
}

// PurchaseEntryView: `spentCents` is replaced by
spent: MoneyView | null; // null when no row carries a price, or when two currencies meet

// PurchaseRowView: `pricePaidCents` is replaced by
pricePaid: MoneyView | null; // of one unit
priceScopeId: string | null;
supermarketLocationId: string | null;
```

- An entry whose priced rows carry two currencies has no total. `spent` is null, every row
  still says what it cost, and `unpricedCount` is unchanged: it counts rows with no price,
  not rows that refuse to add up. The entries statement gains `COUNT(DISTINCT
  "pricePaidCurrency")` and `MIN("pricePaidCurrency")` and the mapper decides. Rows group by
  `(lineId, itemId, pricePaidCents, pricePaidCurrency)`.
- **Either order works.** If `0142` is built first, this section edits its two views, its
  SQL and its mappers. If this plan is built first, `0142`'s builder writes these shapes
  directly and ignores `spentCents` and `pricePaidCents` in its own text.

## 8. Not in this plan

- **What a basket will cost.** That is a sum over the read's offers and belongs to the
  client (velista `0078`) or to a rewritten backlog `0004`. This plan records what was
  paid, after the fact.
- **The receipt.** What the till charged differs from the shelf price by every offer and
  loyalty discount there is. The column is the price the screen showed, and its comment
  says so.
- **Weighed products.** A settle counts units, and a weighed product's cost needs a weight
  the measurement series (`0095`, `0096`, velista `0070`) has not built. Until it does,
  whatever catalog's `price` says for such a product is what `getMany` answers, which the
  series says is null, and null is recorded.
- A household's spend, and any report by chain or by shop. The columns make them possible.
- Prices in staging and production. Every storefront is off in both clusters, so the
  columns fill on a developer's slot first and stay null in a cluster until a chain is
  switched on. Nothing here depends on that.

## 9. Tests

Gateway unit specs (`settle-price.service.spec.ts`), with NATS and the scope service
faked. Each failure is its own case, because "never fails a settle" is a list of cases:

1. No `priceScopeId`: null, and catalog is never asked.
2. A scope outside the owner's resolved scopes: null.
3. A priced product: `Math.round(price * 100)` and the currency. `0.1 + 0.2` style inputs
   (`2.675`) round to the cent.
4. `price` null, `currency` null, the product absent from the answer, and no `itemId`:
   the scope is kept and the two price fields are null.
5. A `stale` offer is recorded.
6. A location in the scope is kept. One outside it, and any location from a reader who is
   not served shops, is null and the price is still recorded.
7. `describe` throws, `getMany` throws, the location read throws: null or the scope alone,
   never a rejection.
8. A catalog that never answers: the promise resolves inside the budget (fake timers) with
   the scope and nulls, and the settle message is still sent.
9. The row settle route reads the price as the **owner** and at the basket's profile even
   when the actor is a registered participant with a profile of their own, and when the
   actor is a guest.
10. A body carrying `pricePaidCents` is refused with the house validation error.

Core unit specs:

11. Both settles write the four columns on every row of a settle over two entries.
12. `NOT_AVAILABLE` keeps the scope and the shop and writes no price, even when the
    message carried one.
13. A malformed `paid` (a negative amount, a two letter currency) is a validation failure.
14. A revert smaller than its row appends a row carrying all four columns.

Integration specs, real database:

15. Each check constraint refuses what it is for: a price with no currency, a negative
    price, a price on `NOT_AVAILABLE`, a shop with no scope.
16. The migration runs up and down on a database that holds settlements.
17. `0142`'s entries: two currencies in one entry answer `spent` null and both rows priced.

## 10. Acceptance criteria

- [ ] A settle that names a scope records what one unit cost there, its currency and the
      scope, on every row it writes, for a guest as for anybody else.
- [ ] No request body can carry an amount of money.
- [ ] The price is read as the basket's owner at the basket's scopes, never as the actor.
- [ ] No state of catalog, of the profile or of the clock fails a settle or holds it past
      750 ms.
- [ ] A shop is recorded only from a reader who is served shops, and is served back only in
      a person's own history.
- [ ] A price is never stored without a currency, never negative, never on
      `NOT_AVAILABLE`, and a shop is never stored without a scope, all by constraint.
- [ ] A partial revert keeps the price on both halves.
- [ ] `pricePaidCents` keeps its name, its comment says "one unit", and `0130` section 2.1
      agrees with it.
- [ ] `openapi.json` and the wire types are current.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

On a slot whose catalog holds the seeded Mercadona prices (memory notes "Seeded Mercadona
catalog" and "Basket with price scopes on slot 0": postal code 14013 and a priced line),
settle a priced row with a scope and read the row back from `line_settlements`. Then stop
the catalog service alone (`luna-slot.sh --restart` is not what stops it, stop the process)
and settle again: the settle succeeds inside a second and the row holds the scope and
nulls. Give the slot back.
