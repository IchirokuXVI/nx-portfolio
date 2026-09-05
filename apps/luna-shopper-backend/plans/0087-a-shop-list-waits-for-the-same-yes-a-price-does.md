# 0087 A shop list waits for the same yes a price does

Plan `0086` settled what a run may write about a product nobody has confirmed. A fuzzy match is a
proposal, it is queued as a `CANDIDATE`, and it **never writes a price**, because a wrong number on
a real product is worse than no number at all. Only an EAN or a person makes a row `ACTIVE`.

A DEZA crawl writes no price. It writes something else: which of the chain's shops carry each
product, positive and negative. DEZA publishes no EAN and no product id, so no row of that chain can
ever reach `ACTIVE` by itself. Every automatic match there is a proposal. The crawl nonetheless
asserts the shop lists in catalog against the item the proposal named, so the rule that governs a
price does not govern the one thing this source actually produces.

This plan makes availability an observation of the source row, exactly as `0086` made a price one.
A run records what it saw beside the row. Catalog learns it when the row is `ACTIVE`: at once for a
row that already is, and at accept time for a row that was waiting, which is `0086` D7 applied to
the other thing a source states. A crawl then silences nothing, claims nothing about a product
nobody confirmed, and hands the admin who works the queue the shop lists that crawl saw.

Depends on `0086` for the one table, the ladder and the accept this extends, and cannot be built
before the pull request that builds it has landed. Depends on `0084` for the per shop column, its
provenance and the shop mapping, and on `0085` for the crawl that produces the lists. Admin plan
`0014`'s successor draws what the queue row shows, stated in section 9.

## 1. What a DEZA crawl writes today

Verified against `deza-catalog.runner.ts` on the branch that builds `0086`, not against the plans.

The runner hands its products to `SourceIngest` and then reads back which catalog item each one
resolved to. `SourceIngest` answers two different fields for that question:

| Field                | What it holds                                                          |
| -------------------- | ---------------------------------------------------------------------- |
| `outcome.itemId`     | The item, and **only when the row is `ACTIVE`**. Null otherwise.        |
| `outcome.entry.itemId` | The row's own column, which a `CANDIDATE` fills with the proposal.    |

The Mercadona walk reads the first and writes a price. The DEZA crawl reads the second and writes
availability:

```ts
for (const outcome of outcomes) {
  if (outcome.entry.itemId) {
    itemIdByKey.set(outcome.entry.externalId, outcome.entry.itemId);
  }
}
```

So a fuzzy proposal becomes a per shop claim in catalog about an item nobody confirmed. The comment
above those lines says why, and the reasoning is sound as far as it goes: with no EAN on this
source an `ACTIVE` row would only ever be one a person accepted, so reading the first field would
make a crawl write nothing at all, and `0085` said the crawl writes availability. Plan `0086` was
not the place to change it, because `0086` said DEZA is unchanged in what it writes.

Three things follow from it, and all three are the reason this plan exists:

- **A wrong proposal writes a wrong fact.** `available: false` for a product a shop does carry is a
  claim a shopper's list can be built on, taken from a name match nobody looked at.
- **The claim outlives the proposal.** Rejecting the row, or accepting it onto a different item,
  leaves the availability written against the item the proposal named. Nothing goes back for it.
- **A revert cannot take it back.** `harvest.revert` deletes prices by run and leaves availability
  alone, which plan `0082` states as a limit for a reason that no longer holds: since `0084` the
  row does carry `availabilitySourceRunId`.

And the alternative, reading `outcome.itemId`, is genuinely worse than what is there: a crawl of a
chain with no EAN would produce candidate rows and nothing else, and the source's one real signal
would be thrown away at the end of every run.

**The third option is the one neither plan took.** Keep the observation, on the row, and let a
person's yes carry it into catalog. That is what `0086` did with a leaflet's price, and it is what
this plan does with a crawl's shop list.

## 2. The decisions

**D1. Availability is an observation of the source row.** A run records what the source said about
one row and one shop in `source_entry_availability`, beside `source_entry_prices`, unique on the
row and the shop, positive and negative, stamped with the run that observed it. It is what the
source stated about a printed product, which is true whatever the product turns out to be.

**D2. Catalog learns it only from an `ACTIVE` row.** The write to
`supermarketLocationItem.setAvailability` is derived from rows a person or an EAN has bound, and
from nothing else. `deza-catalog.runner.ts` stops reading `outcome.entry.itemId`, and no code path
outside `SourceEntryService` ever reads a row's `itemId` again while its status is `CANDIDATE`.

**D3. Absence is a claim about the shops this run saw, and about nothing else.** The popup names
the shops that carry a product, so a shop it did not name does not stock it. That is the whole
value of this source (`0085` section 1) and it is kept. The negative is stated against every shop
the run saw in the crawl, and never against a shop this run never met. A shop that appears in no
popup at all gets no observation, positive or negative, from that run.

**D4. A row this run did not observe says nothing.** DEZA's completeness cannot be proven: every
query answers at most 300 rows, a capped section is split until a budget runs out, and
`harvest_runs.report` names the sections that were left open (`0085` section 2). So a row the crawl
did not reach this time keeps the observations it already has and gains none. This is the exact
opposite of the Mercadona walk, which walks the whole tree and whose absence therefore is a claim
(`0086` section 5), and the difference is why the two cannot share one table. D9.

**D5. Accepting writes the shops the row holds.** `0086` D7 says accepting writes every scope's
price the row holds, so that an admin working the queue after an eighteen minute walk gets the
prices that walk saw. The same sentence, for the same reason, with shops in place of scopes: one
`supermarketLocationItem.setAvailability` call per mapped shop the row holds an observation for,
stamped with the run that observed it. Without it a crawl's whole output would still be thrown
away, one accept later than before.

**D6. Two rows on one item are combined, and a positive wins.** A chain can hold two rows that
resolve to one catalog item, a leaflet's printed name and a web listing, and they can disagree about
a shop. The value written for a shop and an item is the **or** over every `ACTIVE` row of that
chain bound to that item that holds an observation for that shop. Stocking either one is stocking
the item, and a `false` would be a claim the source never made. The runner already applies this
rule inside one crawl. It moves to the one place both writers go through, because an accept has to
apply it too.

**D7. An older automated observation does not overwrite a newer one.** Plan `0084` section 3 says
"any automated kind: the newer observation wins", and the code compares the value and the kind and
never the clock. Nothing noticed, because until now the only writers were runs, in run order. An
accept writes an observation from a run that finished days ago, so the word "newer" has to start
meaning something. `setAvailability` skips an automated write whose `observedAt` is older than the
row's `availabilityObservedAt`, and counts it as skipped. A person's write is unaffected: a person
still always wins, with no window, which is the rest of section 3.

**D8. A revert deletes the run's observations and restores nothing in catalog.** `0086` section 8
deletes the run's `source_entry_prices` rows because they are the run's claims and an accept after
the revert must not write them again. `source_entry_availability` rows with that run id go the same
way and for the same words. What was already written into `supermarket_location_items` is left, and
that is a limit rather than an oversight: the column holds one current value with no history, this
table holds one row per shop replaced by each run, and neither side still holds the answer the
previous run gave. Deleting the value would assert "nothing is known" where something was. Plan
`0082` states the same limit about availability, and this plan restates it rather than quietly
widening it.

**D9. The scope wide flag stays where it is.** The Mercadona walk writes `supermarketItem.setAvailability`
for a whole price scope, and it does not move onto this table. Half of what it says is an
observation of a row, the products the walk listed, and the other half is an **absence**: an
`ACTIVE` row of the chain that the finished walk never listed is not stocked in that warehouse.
An absence has no observation to hang on, so half of that claim has no row here, and a table that
held one half would be a table nobody could read the answer out of. The walk also has no bug to
fix: it reads `outcome.itemId` already, so it never asserted anything about an unconfirmed product.

**D10. The document carries the shop list, so an export reproduces a crawl.** `HarvestDocument`
gains a document level `shops` array and a product level `available_at`, both optional. Without
them a `FILE_IMPORT` of a DEZA export reproduces the chain's rows and none of the one thing the
crawl produced, and since no cluster is allowed to crawl (`0083`), the export is the only way those
lists reach production at all. The codes are the source's own, `T1` to `T7`, `C1`, `C2` and `Z1`,
which is exactly what `source_locations` is keyed on, so the target environment resolves them
through its own mapping and its own `UNMAPPED` rows. The mapping is per environment and is never
exported, for the same reason `0086` does not export an `itemId`.

**D11. The rows the fuzzy path already wrote are cleared, and the scope flags recomputed.** A
migration in the catalog database clears `available` and its three provenance columns on every
`supermarket_location_items` row whose `availabilitySourceKind` is `OFFICIAL_WEB` and whose
`availabilitySourceRunId` is not null, then recomputes the scope flags those rows fed. Section 10
says how, and why doing nothing is not an option.

**What does not change.** A fuzzy match still writes no price. Only an EAN or a person makes a row
`ACTIVE`. A `REJECTED` row is the owner's and a run does not reopen it. A person's availability is
never overwritten by an automated writer and there is no protection window (`0084` section 3). An
unmapped shop is still skipped, counted and never guessed (`0084` section 6). `available` on
`supermarket_location_items` keeps its nullable boolean and its meaning, and catalog still derives
the scope flag from the shops inside its own handler (`0084` section 5).

## 3. The table

### 3.1 `source_entry_availability`

What one shop of the source said about one row, most recently. Unique on (`entryId`,
`sourceLocationId`). A run observing a shop for a row replaces that shop's row. A run that did not
meet the shop, or did not reach the product, writes nothing here and leaves what an earlier run
said.

| Column             | Notes                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `id`               | uuid                                                                                     |
| `entryId`          | uuid, the row of `0086` section 3.1. Cascade on delete.                                  |
| `sourceLocationId` | uuid, the `source_locations` row of `0084` section 6. Cascade on delete.                 |
| `available`        | boolean, not null. Positive **and** negative, which is D3.                               |
| `observedAt`       | timestamptz. When the source stated it, not when the row was written.                    |
| `runId`            | uuid, indexed. The run that observed it, and the run an accept stamps.                   |

**The shop is the harvester's row, not catalog's location.** `sourceLocationId` rather than
`supermarketLocationId`, for three reasons and the third is the one that decides it. It is a
foreign key inside one database rather than an opaque id from another. A mapping can be changed and
a resolved id frozen into an observation would then be a record of what we once believed rather
than of what the source said. And an **unmapped** shop has no catalog id at all, so keying on one
would mean discarding the observation for exactly the shop the back office is asking somebody to
map.

**A run therefore records what it saw for every shop, mapped or not.** That costs one row per
product per shop, about 130,000 rows for a chain of 13,000 products across ten shops, which is a
small table by the standards of the ones beside it. It buys the report an operator reads and it
removes the reason `0084` section 7 gave for not backfilling a newly mapped shop. Section 12 says
why this plan still does not backfill, and that the choice is now a choice.

**No `details`, and no window.** A price row carries the observation's `extra` bag and the
leaflet's validity. Availability has neither: the source states a fact about today with no printed
window, and the extra bag already sits on the row and on the price. Nothing here expires, which is
what makes an accept's write unconditional where a price's is not, stated in section 5.

### 3.2 What `source_catalog_entries` gains

One relation, `availability`, the mirror of `prices`. No column: the decision, the status and the
item are already there, and a shop list is not a second decision.

## 4. What a run does with the shops

`SourceIngest` keeps its five steps and gains a sixth. The DEZA runner keeps its crawl and loses
everything after it, which is `0086` D5 finally holding for this runner too.

`SourceObservation` gains one field:

```ts
/**
 * The source's own codes for the shops that carry this product, and null when
 * the source makes no per shop claim about it at all.
 *
 * An empty array is a claim: no shop the run saw carries it. Null is silence.
 */
availableAtShops: string[] | null;
```

`SourceIngestInput` gains the shops the run met, which is the set the negative is stated against:

```ts
/** Every shop this run saw, by the source's own code and printed name. */
shops: ObservedShop[];
```

A leaflet import and a Mercadona walk pass an empty array and a null on every observation, and step
6 does nothing at all for them.

Step 6, after the prices:

1. Resolve the shops through `SourceLocationService.observe`, which is `0084` section 6 unchanged:
   an exact name match on first sight, `ACTIVE` on exactly one hit, `UNMAPPED` on zero or on two.
2. For every observation whose `availableAtShops` is not null, replace one
   `source_entry_availability` row per shop of `input.shops`: `true` for a code in the list, `false`
   for one that is not. Every shop, mapped or not (section 3.1).
3. For every **mapped** shop, build the entries catalog is owed: for each `ACTIVE` row of the chain
   that holds an observation for that shop, the **or** of every observation that shop holds for
   rows bound to the same item (D6), carrying the newest `observedAt` among them.
4. `supermarketLocationItem.setAvailability` once per mapped shop, in chunks of 500, with the run
   id, `OFFICIAL_WEB` for a crawl and the row's own `sourceKind` in general, and that `observedAt`.
5. Report: shops seen, shops written, shops unmapped by name, rows written, and the conflicts
   catalog declined to overwrite, which is what `deza-catalog.runner.ts` already puts on the run
   and stays word for word.

Step 3 reads the chain's `ACTIVE` rows rather than the run's outcomes, and that is the point of the
whole plan: a crawl of a chain whose queue an operator has been working writes more each time,
because more rows have a yes. A crawl of a chain nobody has touched writes nothing, and stores
everything.

**The rule in step 3 is one function**, shared by the run and the accept, because those are the two
moments the same question is asked and a second copy is a second answer.

## 5. What an accept does

`sourceEntry.accept` and `sourceEntry.createItem` write the prices the row holds (`0086` section
7). They now write the shops it holds too, after the prices and by the same shape:

- Every `source_entry_availability` row of the entry whose `sourceLocation` is `ACTIVE` and mapped.
  An `UNMAPPED` or `IGNORED` shop is skipped and counted, which is `0084` section 6 at the other
  end of the queue.
- One `setAvailability` call per shop, one entry each, with **that observation's own run id** and
  its own `observedAt`, so a revert of that run takes the claim's provenance back with the rest.
- The value is the combination of D6, not the row's own observation, computed by the same function
  step 3 uses. The row being accepted is one of the `ACTIVE` rows by the time it runs.
- **Nothing is filtered by age.** A price whose window has closed writes nothing, because an
  expired price is not one anybody is charged. An availability observation has no window, so the
  age travels with the claim in `availabilityObservedAt` and D7 stops it overwriting anything
  fresher. Inventing a staleness cutoff here would be a second policy in a second place.

`sourceEntry.reject` writes nothing, as it writes no price. The observations stay on the row: they
are what the source said, and the source did not stop saying it because we decided the product is
not one we track.

**One accept is one call per shop**, ten of them for a DEZA row. That is the shape the surface has,
one shop per call, and it is a handful of messages behind one click. Section 12 says what would
change that.

## 6. Revert

`0086` section 8, with one line added. On `harvest.revert(R)`, after catalog deleted the prices
stamped `R` and the harvester deleted its price observations and its undecided rows:

- `source_entry_availability` rows with `runId = R` are deleted. They are the run's claims, and an
  accept after the revert must not write them again.

`PRICE_WRITING_MODES` in `harvest-run.service.ts` is unchanged and keeps its name: a DEZA crawl is
a `CATALOG_DISCOVERY`, so it is already revertable, and the check is about the mode rather than
about what this particular adapter happened to write.

What is in `supermarket_location_items` stays, which is D8. The log line the revert prints names
the count, so an operator can see that the observations went and the written value did not.

## 7. The file carries the shops

`HarvestDocument` (`0086` section 6.1) gains two optional fields, at version 1 rather than 2: the
schema is introduced by the pull request that builds `0086` and has not shipped to a cluster, so
there is no producer to break. If it has shipped by the time this is built, bump the version and
refuse an unknown one exactly as the validator already does.

Document level:

| Field   | Required | Consumed by                                                                         |
| ------- | -------- | ------------------------------------------------------------------------------------ |
| `shops` | no       | The set the negative is stated against. `external_id` required inside each, `printed_name` optional and defaulting to the code. Absent means the file makes no per shop claim. |

Product level:

| Field          | Required | Consumed by                                                                   |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `available_at` | no       | The observation's `availableAtShops`. An array of codes from the document's `shops`. An empty array says no shop carries it. Absent is silence, which is what every leaflet says. |

```json
{
  "shops": [{ "external_id": "T1", "printed_name": "Ronda del Marrubial" }],
  "products": [{ "name": "…", "available_at": ["T1", "C2"] }]
}
```

A code in `available_at` that the document's `shops` does not list is a validation error naming the
product and the code: a file that claims a shop it never introduced has no set to state a negative
against, so the whole claim is unreadable rather than partly wrong. `harvest.export` fills both
from `source_entry_availability` and `source_locations`, so a run exported and imported elsewhere
reproduces its rows, its prices **and** its shop lists, resolved through the target environment's
own mapping.

An import stamped `OFFICIAL_WEB` from a DEZA export therefore produces exactly what a crawl there
would have produced, which is the round trip `0086` section 6.2 is for.

## 8. Catalog: the newer observation wins

One change, in `SupermarketLocationItemService.setAvailability`, and it is D7. Between the person
check and the value check:

- An automated write whose `observedAt` is **older** than the row's `availabilityObservedAt` is
  skipped and counted in `skipped`. It is not a conflict: nobody disagreed, the claim simply
  arrived late.
- A row with no `availabilityObservedAt` is free, as it is free of every other guard.
- A person's write is never compared this way. `ADMIN` always wins, which is `0084` section 3 and
  the reason there is no window.

No field is added and no message changes shape. `observedAt` is already on the request and already
stored on the row. Nothing read it back until an accept could arrive with a week old claim.

The rest of the handler is untouched, including the derivation of the scope flag from the shops
(`0084` section 5). That derivation is what makes a DEZA accept complete: writing per shop
availability moves `supermarket_items.available` for the scope by itself, so nothing in the
harvester has to state the scope flag for a chain that has shops with opinions.

## 9. The surface

No new NATS pattern, on either service. What changes is what two views carry.

Contracts:

- `SourceCatalogEntryView` gains `availability: SourceEntryAvailabilityView[]`, answered inline by
  `sourceEntry.list` the way `prices` is. One entry per shop the row holds an observation for:
  `sourceLocationId`, the shop's `externalId` and `printedName`, its `status` from
  `SourceLocationStatus`, `available`, `observedAt` and `runId`. Ten shops on a row and a page of
  twenty five rows is a small answer, and a queue cannot decide a row without seeing what it is
  waiting on.
- `SourceEntryAcceptResult` gains `availabilityWritten` and `availabilityConflicts`, beside
  `pricesWritten`. The conflicts are `SupermarketLocationItemAvailabilityConflict` as catalog
  already answers them, with the shop named.
- `HarvestDocument` gains section 7's two fields and its schema its two rules.

Gateway: nothing. The three entry routes and the import route keep their shapes and answer the
widened views.

`openapi.json` and `wire-types.ts` are regenerated and committed, and the wire types spec proves
it.

**What the queue row shows**, for admin plan `0014`'s successor rather than for this plan. A count
beside the price lines is enough: "carried by 4 of the 10 shops this run named", expanding to the
list with the unmapped ones marked, and a row with no observations saying so rather than showing a
blank. The accept confirmation gains the same sentence the prices have: "availability written for 6
shops", or "no shop lists on this row, nothing written", so an operator who accepts a leaflet row
and sees nothing does not read it as a failure. That screen is not designed here.

## 10. The migrations

**Harvester, `1757000000000-SourceEntryAvailability`.** Create the table of section 3.1 with its
unique index and its run index, both foreign keys cascading. Register `SourceEntryAvailability` in
`data-source.ts`, which is the step a secondary entry point makes easy to miss. Additive, and it
backfills nothing: no run recorded per shop observations, so there is nothing to fold in. `down`
drops the table.

**Catalog, `1757000000001-ClearCrawledAvailability`.** D11, in three statements.

1. Collect the affected (`itemId`, `priceScopeId`) pairs into a temporary table, through
   `supermarket_locations`, for every `supermarket_location_items` row whose
   `availabilitySourceKind` is `OFFICIAL_WEB` and whose `availabilitySourceRunId` is not null.
2. Set `available`, `availabilitySourceKind`, `availabilityObservedAt` and
   `availabilitySourceRunId` to null on those rows. **Cleared, not deleted**: the row may also hold
   a `positionInStore` an operator typed, and that is not this plan's to throw away.
3. Recompute `supermarket_items.available` for each collected pair by `0084` section 5's rule: true
   when any location of the scope says true, false when every location that has an opinion says
   false, unchanged when none has one, and never for a row whose `priceSourceKind` is `ADMIN`.

**Why not nothing.** Those rows are the fuzzy path's writes and no other writer produces that pair
of values. Every one of them is a claim about an item the proposal named, and after this plan
nothing will ever correct one: the next crawl no longer writes for an unconfirmed row, and the item
it was written against is not one any `ACTIVE` row points at. A wrong fact with a provenance saying
a crawl made it, that no crawl will ever revisit, is worse than an empty column.

**Why this is safe.** No cluster has any such row. Harvesting is off for every chain in staging and
production (`0083`), and `deza-web` has never run outside a developer slot. `OFFICIAL_WEB` with a
run id is the DEZA crawl and only the DEZA crawl, today. `down` cannot restore what it cleared and
says so, which is the same sentence `0086`'s migration uses about the runs it deletes.

Prove both on a throwaway Postgres before opening the pull request, through the built `migrate.js`
and the CLI path, with a database holding a crawl's rows, a person's row beside them and a
`positionInStore` on one of each.

## 11. Testing

Unit, no database:

- `source-ingest.spec.ts`: an observation with `availableAtShops` writes one row per shop of
  `input.shops`, `true` for a named code and `false` for the rest. A null makes none. An empty array
  makes every shop false. A shop the run did not see gets no row (D3). A row the run did not observe
  keeps the observations it had (D4).
- The combination function of D6, table driven. One `ACTIVE` row is itself. Two disagreeing
  `ACTIVE` rows are true. A `CANDIDATE` row is not counted at all. The answer carries the newest
  `observedAt` of the ones it combined.
- `deza-catalog.runner.spec.ts`: **the test that states the rule**. A crawl whose products all
  resolve to `CANDIDATE` rows calls `setLocationAvailability` **never**, and leaves a
  `source_entry_availability` row per product per shop. The same crawl after the operator accepted
  two rows writes those two items and no others. An unmapped shop is stored, not written, and named
  in the report.
- `source-entry.service.spec.ts`: accept writes one call per mapped shop with that observation's
  own run id and `observedAt`. An `UNMAPPED` shop is skipped and counted. A row with no
  observations writes nothing and says zero. Reject writes nothing and deletes nothing. A second
  `ACTIVE` row's positive beats this row's negative.
- `supermarket-location-item.service.spec.ts`: D7, all four cases. An older automated write is
  skipped, an equal one is skipped, a newer one wins, and a person's write ignores the clock
  entirely. The existing four cases of `0084` section 3 keep passing unchanged.
- `harvest-document.spec.ts`: `shops` and `available_at` validate. A code not in `shops` is refused
  naming the product and the code. A document with neither is accepted and claims nothing.
- `harvest-export.spec.ts`: an export of a crawl carries its shops and every product's
  `available_at`. Importing it into an empty chain reproduces the rows, the shop rows as `UNMAPPED`
  and the observations.
- `harvest-run.service.spec.ts`: a revert deletes the run's availability observations, and does not
  touch catalog's rows.

Integration, against a slot's Postgres through `test-integration`:

- The whole loop in one spec: crawl, queue, accept, catalog holds the shop lists, revert, the
  observations are gone and the written value is not.
- `migrations.integration.spec.ts` gains the catalog cleanup of section 10, asserting the cleared
  rows, the surviving `positionInStore`, the person's row untouched and the recomputed scope flags.

Then the two generated files, regenerated and committed, and `npx nx affected -t lint test build`
green. Build, not only test: the backend services type check in the build and nowhere else.

## 12. What this does not do

- **It does not backfill a newly mapped shop.** `0084` section 7 said mapping does not backfill
  because the run did not store what it skipped. It stores it now, so that reason is spent and the
  rule survives as a choice: a crawl is minutes, mapping is rare, and a second write path into
  catalog is a second place D6 has to be right. The data is there for whoever wants to reverse it,
  and `sourceLocation.map` is where it would go.
- **It does not batch an accept.** Ten calls behind one click is fine and a bulk accept over a
  whole queue is not, so if the queue ever gains one, `setAvailability` gains a shape that takes
  several shops. Not before.
- **It does not move the Mercadona walk's scope availability.** D9, and the reasoning is there.
- **It does not give availability a history.** One current value per shop with provenance is still
  the requirement (`0084` section 2), and the consequence is that a revert restores nothing (D8).
  If a reverted run's availability claims ever matter, availability gets a history first, which is
  the sentence `0082` already wrote.
- **It does not change what a shopper sees.** `0080`'s policies and the materialized price row are
  untouched. The scope flag moves only through the derivation catalog already does.
- **It does not draw a screen.** Section 9 states what the queue row needs and admin plan `0014`'s
  successor draws it.

## 13. Exit criteria

- `source_entry_availability` exists, holds one row per source row per shop, positive and negative,
  and is written for mapped and unmapped shops alike.
- A DEZA crawl of a chain nobody has worked the queue for calls
  `supermarketLocationItem.setAvailability` zero times, and stores every observation it made.
- No code path reads a `CANDIDATE` row's `itemId` to write anything into catalog.
- Accepting a queued row writes the shop lists the row holds, each stamped with the run that
  observed it, and the answer says how many shops it wrote and which it skipped as unmapped.
- Two `ACTIVE` rows of one chain bound to one item that disagree about a shop leave that shop
  carrying the item, at a run and at an accept alike, through one shared function.
- An automated write older than what the row already holds is skipped rather than applied, and a
  person's write still wins with no window.
- `harvest.revert` deletes the run's availability observations, and the log line says so.
- A finished DEZA run exports a document carrying its shops and every product's `available_at`, and
  importing it into a chain with no rows reproduces the rows, the shop rows and the observations.
- The rows the fuzzy path wrote are cleared in catalog, the scope flags they fed are recomputed, and
  a `positionInStore` beside one of them survives.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test build` is green.
