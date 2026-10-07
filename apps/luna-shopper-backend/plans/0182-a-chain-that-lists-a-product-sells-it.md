> **PR:** [#613](https://github.com/IchirokuXVI/nx-portfolio/pull/613)

# 0182: a chain that lists a product sells it

> Found by the audit of the first catalog on local slot 1, 2026-10-03.
>
> Prerequisite reading: plan `0085` (one mode, two adapters, the DEZA half), plan `0167`
> (where a product is in a shop), plan `0157`, `harvester/src/app/harvest/run-report.sink.ts`
> (`availability`, `writeShopAvailability`, `writeScopeAvailability`, `drain`),
> `deza-catalog.runner.ts` (`reportAvailability`), `source-entry-write.ts`,
> `catalog/src/app/catalog/supermarket-location-item.service.ts` (`setAvailability`) and
> `supermarket-item.service.ts` (`setAvailability`).

Deza's website prints no price. What a Deza run produces is the fact that Deza sells a
product, and which of its shops carry it. None of that reached the catalog.

## Brief for the agent

### Objective

Keep what a run learned about availability on the queue row, and write it to the catalog
when the row is bound to a product, whenever that happens.

### Context

Read from slot 1 on 2026-10-03:

- 11,140 products are linked from a Deza website row. 11,061 of them have no
  `supermarket_items` row in any Deza scope. `supermarket_location_items` holds 0 rows.
- 9,442 products, 48% of the catalog, are known only from Deza and nothing says where they
  are sold.

Why:

- `run-report.sink.ts` keeps availability claims in an array in memory (`this.claims`).
  `writeShopAvailability` runs once, at the end of the run, and drops a claim whose row has
  no `itemId`. On the first run of a chain no row has one, so every claim is dropped.
- A claim for a shop with no `supermarketLocationId` is dropped too, and the comment says
  that mapping the shop later does not backfill it.
- `writeScopeAvailability` returns early unless the runner called `assortmentComplete`. The
  Deza runner never does, because a Deza walk cannot be proven complete (CLAUDE.md).
- Binding a row (`accept`, `createItem`, the bulk route) writes prices only. A row with no
  price writes nothing, so no `supermarket_items` row is created.

### Target state

1. A harvester table `source_entry_availability`:
   `entryId`, `sourceLocationId`, `available` (boolean), `observedAt`, `runId`, unique on
   entry and location, cascade on the entry. The sink upserts every claim of a run into it,
   whether or not the row is bound and whether or not the shop is mapped.
2. **At bind time**, in the same step that writes the row's prices, the harvester sends the
   row's stored claims for mapped shops to `catalog.setLocationAvailability`. One code path
   for `accept`, `createItem` and the bulk route.
3. **When a source location is mapped to a shop**, the stored claims of that location for
   bound rows are sent. The comment that says nothing is backfilled goes.
4. **At the end of a run**, the sink sends claims for rows that are bound, as today, read
   from the table and not from memory.
5. **A bound row with no price is still an offer.** Binding a row writes a
   `supermarket_items` row with a null price in the chain's default scope, through
   `SupermarketItemService.setAvailability`, when the chain has such a scope and the row has
   no price for it. A row that has a price writes it as today. Read plan `0157` first: a
   priceless row must sort after a priced one and must never be the best offer.
6. A negative claim (a shop the popup did not name) is written as `available: false`. It
   never deletes a row.
7. The run report counts claims stored, claims written and claims waiting for a binding or
   a shop.

### Scope

Work only in the harvester (the sink, the Deza and other runners only where they report
availability, `source-entry-write.ts`, the two decision services, the source location
service, the new entity and its migration, the run report), the catalog client, and
`libs/luna-shopper/contracts` if a message needs a field.

Do NOT touch: how catalog derives scope flags from shop rows, the price writer, the
effective price recompute, velista, the admin app.

### Constraints

- Catalog stays the only writer of its tables. The harvester calls it over NATS.
- A claim is a fact about one run. A later run replaces it. Nothing in this plan removes a
  product from a shop because a run did not see it, unless the source named the shop list
  (Deza's popup does).
- The bulk route applies a batch completely or not at all. Availability writes follow the
  rule the price writes follow in that route today. Read how it orders them before adding.
- Only make the changes this plan names.

### Acceptance criteria

- [ ] An integration spec on real Postgres: a Deza run over a fixture stores one claim per
      shop and product, with no row bound, and writes nothing to catalog.
- [ ] Binding one of those rows writes its claims for mapped shops, and a priceless
      `supermarket_items` row in the chain's default scope.
- [ ] Mapping a shop afterwards writes the claims of rows already bound.
- [ ] A second run with a changed shop list flips `available` and adds no duplicate.
- [ ] A catalog spec, or an existing one named in the PR, shows that a priceless offer is
      never the best offer.
- [ ] The run report carries the three counts.

### Action boundaries

Proceed with code, the migration, specs and an ephemeral slot. Stop and ask if a priceless
`supermarket_items` row changes what any velista read returns in a way plan `0157` does not
describe.

### Progress evidence

Report each criterion with its spec output.

## The data already written

The claims of the October run were never stored, so they cannot be replayed. Plan `0186`
runs Deza again on slot 1 after this plan lands. Its 11,153 rows are already bound, so the
end of that run writes their availability.

## Rows that were already bound

Target state 5 writes the offer with no price when a row is bound. A row that was bound
before this plan landed was never bound again, so it got no offer. That was the state of
the 11,153 Deza rows.

**The owner decided on 2026-10-04 that those rows get the offer too.** A follow up built
it (pull request #620).

### What was built

- At the end of a run, the harvester reads every `ACTIVE` row of the chain that the run
  saw and that holds no open price in any scope. For each product of those rows it sends
  the offer to the chain's default scope. A chain with no default scope gets none.
- The bind and the end of a run send the offer through one method, `offerWithNoPrice` in
  `source-entry-availability.ts`.
- The message `supermarketItem.setAvailability` has an option, `onlyIfMissing`. With it,
  catalog creates the row of a product that has none in the scope, and it never changes a
  row that exists. Catalog derives the flag of a row that exists from the shop rows, and
  a write of `true` on every run would flip a derived `false` back on every run. The bind
  sends the option too.
- In catalog the option is one insert that does nothing on a conflict. A row that a bind
  or the shop derivation inserted first is kept. A product that catalog no longer holds
  creates no row and does not fail the other products of the call.
- The offers go in calls of 500 products. A call that fails does not fail the run and
  does not stop the calls after it. The next run sends the offer again.
- The run report has two counts: `pricelessOffersWritten`, the rows that catalog created,
  and `pricelessOffersFailed`, the products of the calls that failed.
- A run that writes prices only writes no offer.

### What stays open

- **The default scope can say available while every shop says not stocked.** Catalog
  derives the flag from the shops into the scope that each shop is quoted from. That
  scope is not always the chain's default scope. So the row in the default scope keeps
  `available: true` from the offer, and no shop claim changes it. The owner must decide
  what the default scope row means for a chain whose shops have scopes of their own.
- **An incomplete run can state `available: false` and still be followed by the offer.**
  The offer goes to every bound row that the run saw. A run that stopped early saw a part
  of the chain only. A product can get `available: false` from a claim of that run in one
  scope, and the offer in the default scope, in the same run. The offer changes no row
  that exists, but it does create the default scope row when that row is missing.
