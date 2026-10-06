> **PR:** [#652](https://github.com/IchirokuXVI/nx-portfolio/pull/652)

# 0191: a row that leaves a product takes its offers with it

> Found by the repair of the first catalog on local slot 1 (plan `0186`, stage A, steps A5
> and A7, 2026-10-06). The evidence is in `.curation-runs/2026-10-audit-repair/` of the
> main checkout: `stage-a-summary.md` (A5, A7, section 5 points 5 and 7) and
> `proposals/A5-sizes-against-unit-prices.md` ("Unlink the row").
>
> Prerequisite reading: plan `0080` (insert on change, the materialized row), plan `0086`
> section 7, plan `0155` (two rows of one product), plan `0181` target 7, plan `0182`,
> plan `0185`, `harvester/src/app/harvest/source-entry.service.ts` (`accept`, `createItem`,
> `reject`, `load`, `bind`), `source-entry-write.ts` (`bindFields`,
> `SourceEntryPriceWriter`), `source-entry-availability.ts` (`writeForEntries`, `send`),
> `source-ingest.ts` (`writeChunk`, `settle`), `run-report.sink.ts`
> (`writeScopeAvailability`), `catalog/src/app/catalog/effective-price.service.ts`
> (`recomputeEffectivePrices`) and `item-price.service.ts` (`delete`, `deleteByRun`).

A queue row was bound to the wrong product. A person moved it to the right one. The right
product got the price. The wrong product kept everything the row had written on it: a
price row, and an offer in 20 scopes of the chain. Nothing in the system will ever take
those back, because nothing remembers that the row wrote them.

## Brief for the agent

### Objective

When a bound row is moved to another product, or rejected, withdraw from the old product
what that row stated, and make "two rows of one chain price one product at one scope"
follow one rule on every path that writes a price.

### Context

Every statement below was read in the file it names.

- **A bound row can be decided again, on the one row routes only.** `accept` and
  `createItem` in `source-entry.service.ts` call `load`, which reads a row of any status.
  `bindFields` then overwrites `itemId`. Nothing reads the old `itemId` first. `reject`
  sets `itemId` to null on a bound row the same way. The bulk route refuses such a row:
  `checkRows` in `source-entry-batch.service.ts` answers `NOT_PENDING` for a row that is
  not `CANDIDATE` or `UNRESOLVED`.
- **The new product gets the prices.** `writeRowPrices` calls
  `SourceEntryPriceWriter.write`, which sends every open price of the row to
  `catalog.addPrices` for the new product, and then `writeForEntries`.
- **The old product keeps its price rows.** `item_prices` has no column that names a
  queue row. Its rows carry the product, the scope, the kind and the run. Catalog removes
  a price in two ways only: `ItemPriceService.delete`, one row, for an admin, and
  `deleteByRun`, for a revert.
- **The old product keeps its offers, with or without a price.** A price at one scope is
  materialized on `supermarket_items` for that scope and for each scope that falls
  through to it. When the last price row goes, `recomputeEffectivePrices` finds the held
  row and calls `applyEffective` with no price: the row stays, its price becomes null,
  and `available` is not touched. The function creates no row for a product that nothing
  prices, and it removes none. That is the figurine: 20 rows, price null, available true.
- **No later run corrects it.** `writeScopeAvailability` writes `available: false` only
  for the products that the bound rows of the chain still name. After the move no row
  names the old product. The El Jamón runner states no availability at all
  (`eljamon-catalog.runner.ts`), and a walk that declares its assortment complete has the
  same gap. Shop rows in `supermarket_location_items` stay for the same reason: `send`
  selects by the product that a row names now.
- **The barcode stays too.** An accept teaches the row's real barcode to its product
  (plan `0185`). After a wrong bind the wrong product holds it, and `barcodeToTeach`
  refuses the move with `item_ean_held`. The A5 proposal had to plan a manual clear of
  `ean` on the old product before the accept.
- **Two articles of one chain on one product follow three different rules.**
  - In a run, `settle` withholds every price when two rows that are not sold by weight
    price one product at one scope, and counts a conflict (plan `0155`). The map it reads
    is built per call of `writeChunk`, and the sink pushes chunks of 400 products
    (`PRODUCT_CHUNK` in `run-report.sink.ts`). Two rows in two chunks are both sent, and
    the second insert becomes the current price. Only rows sold by weight are compared
    across chunks, through `weighed`.
  - On an accept, `SourceEntryPriceWriter.write` looks at other rows only when the row is
    sold by weight (`otherPieces`). A second article is written over the first.
  - That is the El Pozo burger: El Jamón articles 93003284 at 2.45 € and 93003273 at
    2.95 € on product `7541e849`, in one scope. Which price a shopper sees depends on
    which row a chunk or a person wrote last, and each run can add a row to the history.
    **Not confirmed:** whether the two rows fell in one chunk or in two on the runs so
    far. The code allows both.

### Target state

1. **One operation withdraws what a chain states for a product and no longer states.**
   Call it "settle a product at a chain". It takes a product and a chain, reads the rows
   of the chain that are bound to the product now, and makes catalog agree with them:
   - For each scope of the chain and each kind, when no bound row of that kind holds an
     open price there, the price rows of the product at that scope and kind that a run of
     the harvester wrote are deleted. An `ADMIN` row is never touched.
   - When a bound row does hold one, that price is written again through
     `SourceEntryPriceWriter`, so the current row is the one a bound row states.
   - After the prices, an offer of the product in a scope of the chain is removed when
     nothing prices it, no bound row of the chain names the product, and no shop row backs
     it. The shop rows that a harvest run wrote for the product at the shops of the chain
     are removed under the same condition.
2. **Catalog owns the deletes.** Two new messages, for a service actor and audited like
   `deleteByRun`: one removes the run written price rows of a product at named scopes and
   kinds and recomputes, one removes the offers and shop rows of a product at named scopes
   under the condition of target 1. The harvester never writes to a catalog table.
3. **A decision that moves or drops a bound row settles the old product.** `accept`,
   `createItem` and `reject` remember the old `itemId` of a row that was `ACTIVE`, do what
   they do today, and then settle the old product at the row's chain. A failure of that
   step leaves the decision standing and is the error the request answers with, as the
   price write is today.
4. **The barcode moves with the row.** When the old product holds the row's real barcode,
   the row's chain prints it on no other row, and no other bound row of any chain prints
   it on the old product, the decision takes it off the old product before it teaches it
   to the new one. Otherwise `item_ean_held` stands, and its sentence names the old
   product.
5. **A route for a person, and for the one time repair.**
   `POST /v1/admin/harvest/items/:itemId/settle` with `{ supermarketId }` runs target 1
   and answers what it deleted and wrote. `dryRun: true` answers the same and writes
   nothing.
6. **One rule for two articles of one chain on one product**, stated once in
   `source-entry-write.ts` and used by the run and by the accept. The rule is option 2A
   of section 2, which the owner decided on 2026-10-06:
   - In a run, the comparison holds across chunks, as `weighed` already does for rows
     sold by weight. When the second row arrives after the first was sent, the run counts
     the conflict and names both rows in its report. It does not take back the first.
   - On an accept or a create, the row is bound, and no price is written for a scope where
     another bound row of the same chain and kind holds an open price of another amount.
     The answer names that row, and `pricesWritten` counts what was written.
   - The entries of a product (`GET /v1/admin/harvest/items/:itemId/entries`) say for each
     row whether another bound row of its chain prices the same scope.
7. Regenerated `openapi.json` and `wire-types.ts`.

### Scope

- In: the harvester (`source-entry.service.ts`, `source-entry-write.ts`,
  `source-ingest.ts`, `source-entry-availability.ts`, `catalog-client.service.ts`, the
  controller), catalog (`item-price.service.ts`, `supermarket-item.service.ts`,
  `supermarket-location-item.service.ts`, their controllers), `libs/luna-shopper/contracts`,
  the gateway route and DTOs, the two generated files.
- Out: the bulk decisions route, `unbindSharedEans`, the revert, the effective price
  rules, the admin app screens, velista.

### Constraints

- Never write a price to `supermarket_items` directly, and never decide at write time
  which source wins (CLAUDE.md). The deletes go through `item_prices` and the recompute.
- Nothing a person typed is removed: no `ADMIN` price, no shop row a person wrote. Read
  how `setLocationAvailability` reports a row a person typed as a conflict, and keep the
  same line.
- An offer with `available: false` is an answer, not a leftover (plan `0187`). Target 1
  removes an offer only under its three conditions.
- `name`, `brand` and `sizeFormat` of the row do not change (plan `0086`, D8).
- No release task. Both clusters hold no products.

### Action boundaries

- Proceed with code, specs and an ephemeral slot.
- Do not settle anything on slot 1. Section 3 is the owner's step.
- Stop and ask before any change to what `recomputeEffectivePrices` does with a row that
  has no price. This plan removes the row from outside, after the recompute.
- Stop and ask if a price row cannot be told from one a person wrote by its kind and its
  run id alone.

### Progress evidence

- An integration spec on real Postgres for the figurine: a row bound to product A with a
  price at the chain's default scope, a chain with three scopes that fall through to it,
  then an accept onto product B. A holds no price row of the chain and no offer in any of
  the scopes. B holds the price.
- The same with a second row of the chain still bound to A: A keeps that row's price and
  its offers.
- The same with an `ADMIN` price on A: the price and its offer stay.
- A reject of a bound row, with the same checks.
- A spec for the barcode: the move succeeds without a manual clear, and the old product
  no longer finds by that barcode.
- A spec for two articles in two chunks of one run: one conflict is counted and named.
- A spec for the accept of a second article: bound, no price for the shared scope, the
  other row named.
- `dryRun` writes nothing.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 1. Not in this plan

- **A row that a run unbinds.** `unbindSharedEans` sends a row bound by its EAN back to
  the queue and says that its price "stays in catalog until it expires". A storefront
  price has no end date. The same leftovers follow, and the settle of target 1 would
  remove them. It is left out because that unbind is automatic and this plan acts on a
  person's decision. The owner decided to leave it for a follow up (section 2, C).
- **A pack count that the wrong row filled** (`fillPackCounts`). Catalog cannot tell it
  from a count a person typed. A person checks the old product.
- **A deleted or merged product.** A delete cascades its rows in catalog.
- **A move through the bulk route.** It refuses a bound row, and that stays.

## 2. Decisions, decided by the owner, 2026-10-06

All three are closed. The builder builds them and asks about none.

**A. Two articles of one chain on one product, at one scope.** Stage B asks for this rule
too: two containers of one Mercadona milk at 0.96 € and 1.15 €.

- 2A, decided by the owner, 2026-10-06: withhold, as plan `0155` says, on every path
  (target 6). The bind is allowed, the price is not sent, and the back office shows the
  pair. A person then makes a second product or removes a row. The price that was current
  before the conflict stays and ages.
- 2B, rejected: the lowest price wins, as plan `0181` does for pieces sold by weight. A
  shopper sees a price, and it can be the price of the smaller pack.
- 2C, rejected: refuse the accept that creates the pair unless the request says `force`.
  It stops the second barcode of plan `0185` from binding until a person confirms it.

**B. An offer with no price that no row backs.**

- 2D, decided by the owner, 2026-10-06: remove the row (target 1). No row means that
  nothing is known, which is what `recomputeEffectivePrices` already says when it creates
  none.
- 2E, rejected: keep the row and set `available: false`. That reads as "this chain says
  it does not sell it", which no source said.

**C. The automatic unbind of plan `0155`.**

- 2F, decided by the owner, 2026-10-06: leave it as it is in this plan, and call the
  settle from it in a follow up once target 1 has run on real data.
- 2G, rejected: call it now, before target 1 has run on real data.

## 3. The data already written

Only local slot 1 holds these rows. A new harvest run repairs none of them: no run names
the old product, and insert on change never removes a row.

- **The F1 figurine, `b3827082-e364-4242-acf0-e41565547754`.** Its stale price row was
  deleted by hand in stage A. It still holds 20 offers in El Jamón scopes with no price.
  After this plan lands, one call settles it: the route of target 5 with the El Jamón
  chain, first with `dryRun`. The expected answer is 20 offers removed and no price
  touched.
- **Every other bound row that was moved before this plan.** In step A7, stage A also
  made the BBQ skewers two products (`45fc969c`, 20 cm, and `1ca7b228`, 32.5 cm).
  **Not confirmed:** whether a bound row left the first product for the second, and what
  it left there. Run the settle with `dryRun` for the first, and for any product that a
  later repair moves a row off.
- **The El Pozo burger, `7541e849-c084-412d-90a4-26bbf5376953`.** A person first says
  whether the "king" pack (row `67a821e4-69c0-49be-9c52-15f6dbe25c23`) is 240 g or 260 g.
  Then a create from that row makes its product, and target 3 settles the old one: the
  2.95 € row goes from it without a manual delete, and the row `0e539371` writes its
  2.45 € again.
- **The Fanta bottle of the A5 proposal** moves with one accept under target 4, where the
  proposal needed three calls.
- The dumps of `after-stage-b-final/` are taken before this repair. Take new ones after
  it, before any restore into a cluster.

## 4. What was built, and what the owner must decide

Every target state is built. The points below are the choices the builder made where the
plan left room, and the consequences that only the owner can settle.

A review of the first build found five ways in which the settle deleted a price row that
a bound row still stood behind. This section describes the code after the fix round. The
catalog that the settle runs on was curated by hand, so one rule decides each doubt:
**the row stays.** A leftover price is an error that a person can see and remove. A
deleted price, with its page and its text, cannot be brought back.

### The settle, as a call

`POST /v1/admin/harvest/items/:itemId/settle` with `{ "supermarketId": "<uuid>" }`, and
`"dryRun": true` for an answer that writes nothing. The message is `sourceEntry.settleItem`.
The answer is `SettleItemAtChainResult`:

- `boundEntryIds`: the rows bound now.
- `pricesWithdrawn` and `pricesWithdrawnAt`: the price rows removed, by scope and kind.
- `pricesRestated`: the prices that the bound rows state, one for each scope and kind.
- `pricesWritten`: the price rows that catalog inserted for those statements.
- `pricesKeptAsWritten`: statements that catalog did not apply (see "The kind of a price").
- `pricesWithheld`: the prices of two rows that state two amounts.
- `offersRemoved`, `offersKept`, and the three shop row fields.

A second call changes no row, no id and no trail row. On a product that is already
settled, a dry run and a real call both answer zero rows withdrawn and zero rows written.
`pricesRestated` still counts what the bound rows state. An unknown chain answers 404. A
product that no row names answers zeros.

The two catalog messages are `itemPrice.withdraw` and `supermarketItem.withdraw`. Both take
`dryRun`, and a dry run executes the statements of a real call in a transaction that is
rolled back, so the two answers cannot differ. **Only a service actor can send them.** An
operator token is refused with `forbidden`. `requireServiceActor` in catalog's
`platform-admin.service.ts` does that after the gate, and no other message changed.

### The settle removes only what no bound row accounts for

The harvester sends two lists inside `itemPrice.withdraw`:

- `held`: each price row that a bound row holds, **open or closed**, with its scope, its
  kind and its run. Catalog removes nothing at such a scope and kind.
- `stated`: for a scope and kind where the open prices of the bound rows come to one
  price, that price, with its values, its run and its instant.

At each other scope and kind of the chain, catalog removes the price rows of the product
that a run wrote.

**For the owner, a choice that can be reversed.** The first build spared a scope and kind
only while a bound row held an _open_ price there. The rows of a leaflet that ended last
week were thus deleted, with page, raw text and promotion, although the row that printed
them was still bound. The code now spares each scope and kind where a bound row holds a
price row, open or not. The cost is that an expired price of a row that is still bound is
never cleaned up by a settle. To reverse the choice, build `held` from the open prices
only, in `SourceEntrySettler.settle`.

### A bound row that still states a price: what is removed, and where it is written

Target 1 says that such a price "is written again, so the current row is the one a bound row
states". One run stamps every product that it reads with one instant, so the row that left
and the row that stayed carry the same `observedAt`, and catalog breaks that tie by the id
of the two rows. A 2.45 next to a 2.95 with the same instant is current or not by chance.

So at the scope and kind of a statement, catalog removes a price row only when all of
these are true:

- A run wrote it.
- It was observed at the instant of the statement, or later.
- Its values differ from the statement.
- It is not the row of another run that a bound row names at that scope.

The rows before that instant are the history of the scope and stay. The row that already
says what is stated stays too, with its id. Catalog then makes the statement the current
row through the insert on change of every other price write. All of this is **one catalog
transaction**. The first build deleted in one message and wrote in a second one, and
deleted the stated row itself each time. A failure between the two left the product with
an older price, and each call made new ids, new details rows and new trail rows.

Nothing is stated, and the scope and kind are only held, in these cases:

- Two bound rows state two amounts (decision 2A).
- A bound row holds a closed price there that is as new as the open one, or newer. The
  statement would remove that row.

When several bound rows agree on the amount, the statement is the **newest** observation.
The first build took the row that was decided first. A row that the chain stopped listing
then put its old instant and its old run on the price of a live row, and the settle
deleted the newer history.

**For the owner:** the alternative from the first build still stands. Catalog can remove
every run written row of a stated scope and kind and keep no history. It is simpler to
explain and it loses the history of the row that stayed.

### The kind of a price is the kind of its run

A source row has one `sourceKind`, and each full observation rewrites it. A row that the
Deza website and a Deza leaflet both print is one shared row (plan `0190`). Slot 1 holds
six bound rows whose kind changed after a leaflet wrote their price. The first build read
the kind from the row. For those six products a settle found no statement for the leaflet
kind, deleted the leaflet price, and wrote it again as a website price with the run of the
leaflet.

The settle now reads the kind of each price from the run in its `runId`
(`sourceKindsOfRuns` in `run-source-kind.ts`). A file import carries the kind in its
input. Each other run has the kind of the adapter of its chain. When the run cannot be
read (the price names no run, the run is gone, or the chain has no source row), the price
has no kind. Catalog then spares **every** kind at that scope, and the settle states
nothing there.

One more case comes from plan `0190`, which is not built. An accept still writes a price
with the kind of its row. A leaflet price that was accepted while the row said
`OFFICIAL_WEB` is in catalog as a website price with the run of the leaflet. Catalog thus
also spares each kind under which it holds a row of a run that a bound row names at that
scope. It does not apply a statement whose run it holds there under another kind. The
price stays under the kind it was written with, and `pricesKeptAsWritten` names it.

**For the owner:** such a price keeps the wrong kind until plan `0190` lands and a person
decides what to do with it. A settle reports it and does not repair it.

### What tells a run's price from a person's

A row is removed only when its kind is an automated one and it names a run. This is the
kind and the run id alone, as the action boundaries ask, so the builder did not stop.

One case follows from it. A row of an automated kind with no run id is always kept. A person
can type such a price in the back office, and a price that plan `0086` folded in from before
runs were recorded has no run id either. Nothing tells those two apart, so both stay.

**For the owner:** if slot 1 holds run written rows with no run id, a settle leaves them. A
query for `"sourceRunId" IS NULL` with an automated kind shows whether any exist.

### One rule, and what it changes for a run

`decideArticles` in `source-entry-write.ts` is the rule, and the run and the accept both
read it:

1. One row sends its price.
2. Rows that are all sold by weight send the lowest price per kilo (plan `0181`).
3. Rows that state the same amount send that amount.
4. Any other set of rows sends nothing.

Point 3 is new for a run. Plan `0155` withheld the price of any two rows of one product in
one batch, also when both stated the same amount. Target 6 says "of another amount" for an
accept, and one rule cannot say two things, so a run now sends an amount that its rows agree
on. The amount is the price and the unit price together: one pack price beside two prices
per kilo is two pack sizes, and a conflict.

Point 4 is stricter than before for an accept. A fixed pack that is accepted next to a
piece sold by weight used to be written. The run already withheld that pair, and now the
accept does too.

**For the owner:** say so if two rows of one amount must stay a conflict.

### The run's report names the pairs

The report holds `priceConflicts` next to `pricesConflicted`: the product, the scope, the
rows, and `firstWasSent` when an earlier chunk had sent the first row's price. A pair is
counted one time for the run, in whatever chunks it falls. The report names the first 200.
A file import counts its conflicts and does not name them, because its report is built from
the counters alone.

### An offer that a person wrote

`supermarket_items` holds no provenance, and the back office can set its availability flag.
So "nothing a person typed is removed" needed a way to see a typed offer. The audit trail is
that way: an offer whose row an operator created or changed is kept, with the reason
`PERSON`. An offer that only the harvester or the recompute wrote is removed under the three
conditions, whatever its flag says.

**The offer is kept when the trail cannot tell**, with the reason `NO_TRAIL`. The review
asked for "no trail row at all for that offer". That test cannot be used: the recompute
creates an offer without a trail row, so the 20 offers of the figurine have none, and the
settle would keep each leftover that this plan exists to remove. The code tests the trail
and not the offer. An offer that is older than the oldest row of `catalog_audit` is kept,
and so is each offer when the table is empty. The trail was not written while such an
offer existed, so it cannot say that no person wrote it.

**For the owner:** a catalog that is restored without its audit rows thus keeps each offer
that the restore brought. It loses no protection. The settle removes nothing there and
answers `NO_TRAIL`. Restore `catalog_audit` together with the other tables if the settle
must clean up after the restore. Plan `0075` names a job that prunes `SERVICE` rows of
the trail. It is not built. If it is built, the oldest row can become a later one, and
more offers answer `NO_TRAIL`. That errs toward a kept row.

### Shop rows

- A shop row whose availability a person wrote is left alone and reported, in the words of
  `setLocationAvailability`.
- A shop row that a run wrote, on which a person also typed a position, keeps the position.
  Its availability is cleared.
- A shop row that holds only what a run wrote is removed.

The shop rows of a run are removed whenever no bound row of the chain names the product.
That includes a product whose offer stays because a person typed a price for it: the price
is the person's, and the shop claim was the row's.

**For the owner:** "under the same condition" in target 1 can also be read as "only when the
offer of that shop's scope goes". Under that reading a typed price keeps the shop rows of a
row that left. The builder took the first reading.

### The barcode

- A move takes the barcode off the old product and teaches it to the new one in the one
  call. Section 3's Fanta bottle is one accept.
- A create from a bound row makes the product with no barcode, and moves the barcode to it
  after the bind. Catalog holds a barcode on one product, also for the length of a call.
- When another row that is bound to the old product prints the barcode, the answer is
  `item_ean_held`. Its sentence names the old product and that row.
- A reject leaves the barcode on the product. A rejected row names no product, so the
  barcode has nowhere to go.

**For the owner:** a product can therefore keep a barcode that no bound row prints. Whether
a reject must clear it is not in this plan.

### The order of a decision

Bind, then the settle of the old product, then prices and availability, then the barcode.

The settle comes directly after the bind is saved. It depends on the bind alone, and a
second call of the decision cannot do it: the saved row names the new product, or none,
and nothing records the product that the row left. The first build ran the settle last.
A price write or a barcode write that failed thus left the old product with its price and
its offers, and no later call settled it.

Each failure after the save names the old product and the chain in its sentence
(`namingLeftProduct`), and says if the product was settled. The error keeps its class and
its code.

- The settle fails. The prices of the new product are still written. The request then
  answers with the error of the settle, which names the settle route and its body.
- A later step fails. The request answers with that error, and the sentence says that the
  old product was settled before it.

### The bulk route

It still refuses a bound row. It shares the price writer, so decision 2A reaches it: a price
that the writer withheld is named in `priceSkips`, where every price that did not land is
named.

### What proves it

- `catalog/src/app/catalog/item-withdraw.integration.spec.ts`, on real Postgres: the
  figurine with its three scopes, the `ADMIN` price, a typed price with no run, the typed
  offer, the shop rows, the dry run. From the fix round: the stated row keeps its id, a
  second call changes no row and no trail row, a failed write of the statement also
  undoes the removal, the history of a leaflet that ended, a price with no kind, a price
  under another kind than its run's, the refused operator, and `NO_TRAIL`.
- `harvester/src/app/harvest/source-entry-settle.integration.spec.ts`, on real Postgres:
  which rows count as bound, the move, the reject, the second article, the barcode. From
  the fix round: the kind of a price from its run for a row whose kind changed, a run
  that is gone, a closed price, and a price write that fails after the old product was
  settled.
- `harvester/src/app/harvest/settle-across-services.integration.spec.ts`, on **both**
  databases. The real harvester services and the real `CatalogClient` on one side, the
  real `ItemPriceService` and `SupermarketItemService` on the other, over a schema that
  the spec migrates with the migrations of catalog. Only NATS is replaced: the client
  hands each message to the catalog service for its pattern in the same process. It runs
  settle, state again and settle again, and compares each price row, each offer, the
  details rows and the size of the trail. It also holds one case for each of the five
  findings. Run it with:

  ```sh
  LUNA_INTEGRATION=1 \
  HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
  CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
    npx nx run luna-shopper-backend-harvester:test-integration \
      --testFile=settle-across-services.integration.spec.ts
  ```

  It reads `CATALOG_DB_URL` from the `.env` of catalog when the variable is not exported,
  so the `verify-infra` job runs it with the other harvester suites.

- The first build also ran a script over the gateway on an ephemeral slot. That script
  was never committed. The spec above replaces it.
