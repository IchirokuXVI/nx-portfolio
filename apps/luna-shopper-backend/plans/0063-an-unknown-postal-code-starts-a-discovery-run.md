# 0063 An unknown postal code starts a discovery run

Every run the harvester has ever done was asked for by a person. `HarvestRunTrigger`'s doc says so,
and says what the other two values are for:

> Every run in plan 0038 is MANUAL: the scheduler is deferred to backlog 0001 section 7.6, and
> section 8.1 leans on "a person asked for this" as the reason the fetching is defensible at all.
> SCHEDULED and SYSTEM exist so the column does not need a migration when that changes.

This is the plan where `SYSTEM` starts being written. A postal code lands on somebody's profile,
catalog holds no locations in it, and a `STORE_DISCOVERY` run goes and looks.

Depends on `0062` (which announces new codes) and `0038` (the runner, the run lifecycle, the
review queue). Blocked in staging and production by `k8s/plans/0008`, which is what makes the
harvester exist there at all.

## 1. Cost is not the problem here

`HarvestRunMode`'s doc puts `STORE_DISCOVERY` at **two requests**: one Nominatim geocode, one
Overpass query. Against `CATALOG_DISCOVERY`'s 4,383 it is free, and the case for running it
automatically is not close.

Three other things are the problem, and they are all about concurrency rather than cost.

## 2. Why this cannot be a fan out

**There is already a unique index over active runs**, treating `PENDING` and `RUNNING` as in
progress. That index is correct and this plan does not touch it: two runs writing the same
harvester tables at once is a worse world than a queue.

But it means the obvious implementation fails immediately. One user granting a location permission
with `expandNearby` set can produce six new postal codes in a single write, six of them unknown,
and six `runService.start()` calls of which one succeeds and five throw. The failure is not even
visible to anybody, because section 5 of `0062` makes the announcement fire and forget.

**Politeness compounds it.** `OsmPlacesClient` gates itself to one request per second, per client
instance. Six concurrent clients are six times the rate Nominatim's policy allows, and the policy
is the reason this data source is usable at all.

So the trigger enqueues, and a worker drains the queue one run at a time. Serial by construction,
which is also exactly what the active run index already demands.

## 3. The queue

**`postal_code_discovery_requests`** (harvester):

- `country` (varchar(2)), `postalCode` (varchar(16))
- `status`: `QUEUED`, `RUNNING`, `DONE`, `FAILED`
- `requestedAt`, `lastAttemptedAt` (nullable), `attempts` (int, default 0)
- `runId` (nullable uuid, the last run this produced)
- **unique on (`country`, `postalCode`)**

The unique key is the deduplication, and it is a constraint rather than a check in a service
because the racing writers are two ordinary profile saves by two different users in the same
street. An enqueue is an upsert that leaves an existing row alone unless the cooldown has expired.

`HarvestRun` gains nothing. A run is still a run; this table is the backlog of work that has not
become one yet, which is precisely what the active run index forbids `PENDING` from being.

## 4. The cooldown is a month

A supermarket opening is a rare event and a supermarket closing is rarer. Re asking OpenStreetMap
about the same postal code every week costs two requests and buys almost nothing, and "almost
nothing, at volume, from a volunteer funded service" is the shape of a bad neighbour.

**A code that has been discovered successfully is not discovered again for 30 days.** An enqueue
inside that window is a no op, not a queued row, so a thousand users in the same postcode produce
one run a month between them.

**A failure is not a success and does not earn the full cooldown.** Nominatim returning nothing for
a code, or Overpass timing out, is a transient state or a permanently bad code and the two are
distinguishable only by trying again. Back off on `attempts` and give up after a small number,
leaving the row `FAILED` for the eventual queue in backlog `0009` to show somebody. A code that
Nominatim cannot geocode at all is worth surfacing, because it usually means the postal code is
wrong rather than that the internet is broken.

## 5. What counts as unknown

"Catalog holds no locations in this postal code", asked of catalog over NATS, counting
`SupermarketLocation` rows whose `postalCode` matches.

That count is only meaningful after `0061`, which is the plan that stops two thirds of imported
locations having a null postcode. Before it, almost every code looks unknown and this queue would
re discover the whole country. **`0061` ships first.** It is not a soft ordering preference.

An unknown code is also the normal state for a long time, because a discovery run creates nothing:
it fills the review queue and waits for an admin. So a code moves from unknown to known only when
somebody imports a place, and the queue's `DONE` means "we looked", never "we have stores".

## 6. The switches, and what a disabled harvester does with a queue

`HARVEST_ENABLED` gates whether a pod may start any run. When it is false, **enqueue still happens
and nothing drains**. That is the desired behaviour rather than a compromise: turning the switch on
later drains a real backlog of the codes users actually asked about, instead of starting from
nothing.

`MERCADONA_ENABLED` does not enter into it. `STORE_DISCOVERY` reads OpenStreetMap and never
touches a storefront, so store discovery in production with price scraping switched off is a
coherent configuration and the one `k8s/plans/0008` deploys.

## 7. The radius, which is not the profile's radius

`StoreDiscoveryInput.radiusMetres` and `0062`'s expansion radius are different numbers answering
different questions, and giving them one configuration key would be a bug waiting to happen.
`0062`'s radius decides **which postal codes a person shops in**. This one decides **how far around
a code's centre to look for shops**, and it should be comfortably larger, because a store at the
edge of a code is still that code's store and `0038` section 2.8's whole finding is that a postal
code's extent and its centre are not the same thing.

## 8. Contracts and endpoints

An internal NATS message from core to harvester carrying the codes to consider. **No gateway
route**: nothing user facing enqueues a run, and exposing one would let anybody spend our
Nominatim budget.

The queue's own rows want a read for backlog `0009` to render later. Defining it here and leaving
it unconsumed is fine and cheaper than retrofitting it.

## 9. Migrations

Harvester: create `postal_code_discovery_requests` with its unique index.

## 10. Exit criteria

- Six unknown codes announced in one write produce six queued rows and exactly one running run at
  a time, with no unique index violation anywhere in the logs.
- Two users adding the same code produce one row and one run.
- A code discovered successfully is not re run within 30 days, proven by a test that moves the
  clock rather than by waiting.
- A failing code backs off, stops after its attempt limit, and is left `FAILED` with its reason.
- With `HARVEST_ENABLED=false` the queue fills and nothing runs; flipping it to true drains it.
- A completed run leaves `DiscoveredPlace` rows at `NEW` and creates **no** catalog location, which
  is `0038`'s rule and stays true here.
- Runs carry `HarvestRunTrigger.SYSTEM`.
- `npx nx run-many -t build test -p luna-shopper-backend-harvester,luna-shopper-backend-core` passes.
