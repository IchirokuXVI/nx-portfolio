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
