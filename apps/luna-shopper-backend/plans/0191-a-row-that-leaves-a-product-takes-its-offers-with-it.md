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
