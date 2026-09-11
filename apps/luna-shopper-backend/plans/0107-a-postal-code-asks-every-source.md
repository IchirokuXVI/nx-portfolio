> **PR:** [#342](https://github.com/IchirokuXVI/nx-portfolio/pull/342)

# 0107 A postal code asks every source, and a trusted one answers into the catalog

A postal code enters the queue because a profile write announced it or because an operator typed it
(`0063`, `0097`). When the worker drains it, it starts exactly one run:

```ts
mode: HarvestRunMode.STORE_DISCOVERY,
supermarketId: null,
sourceId: null,
radiusMetres: settings.discoveryRadiusMetres,
```

That is `postal-code-discovery.worker.ts:146`, and `supermarketId: null` sends it to
`OsmStoreDiscoveryRunner`, because `runnerFor(undefined)` returns the OpenStreetMap case. So a code
that reaches the queue is asked of OpenStreetMap and of nothing else, even though LIDL publishes its
own shops and Mercadona will after `0106`.

Every place either source finds then waits for an admin to click it, one at a time, in a queue that
is 1,675 rows deep for Mercadona alone.

This plan does two things. **A postal code asks every configured place source, not only
OpenStreetMap. A source an operator has marked trusted writes its places straight into the catalog,
after they are checked.**

Depends on `0106` for Mercadona's postal code filter, which is what stops a chain wide source being
re-read for every code in the queue.

## 1. What a place source is

Any source that can answer "what shops are at or near this code". Today that is three things and they
do not have the same shape:

| Source          | Answers                     | Cost per postal code       |
| --------------- | --------------------------- | -------------------------- |
| OpenStreetMap   | a radius around the centre  | one Overpass query         |
| `lidl-api`      | the whole country           | three requests, once       |
| `mercadona-api` | the whole country, filtered | one request plus the codes |

**The middle column is why the filter matters.** A chain that names its whole country has nothing to
centre on, so asking it once per code would re-read the same document for every code in the queue.
`0106` gives Mercadona `postalCodes`, and this plan gives LIDL the same optional field, read the same
way: filter the records the chain published, do not fetch differently.

## 2. What the queue starts

For one code, the worker resolves the set of place sources and enqueues one run per source that has
not answered this code recently.

```ts
/**
 * The sources a code is asked of.
 *
 * OpenStreetMap is always in the set and is not a `supermarket_sources` row: it
 * is about a place rather than about a chain, and it finds many chains at once.
 * Every other member is an enabled row whose adapter lists its own stores.
 */
async placeSourcesFor(country: string): Promise<PlaceSourceRef[]>;
```

A chain source that is **disabled** is not asked. That is `0083`'s rule unchanged: whether a chain may
be fetched is a row, and this plan does not add a second switch beside it.

### 2.1 "Unless they already ran" is the rule that already exists

`discoveryCooldownDays` (`HARVEST_DISCOVERY_COOLDOWN_DAYS`, 30 by default) and the active run index
already decide whether a code is due. This plan changes what that question is asked about: it becomes
**per code and per source** rather than per code. Otherwise the first source to answer a code marks
it done and the other two are never asked.

So the dedupe query at `postal-code-discovery.service.ts:394`, which today filters on
`r."mode" = 'STORE_DISCOVERY'`, also filters on the run's source.

### 2.2 One code, three runs, and the queue row is done when all of them are

A code is `DISCOVERED` when every run it started has finished, and it carries the per source outcome
so a partial answer is readable. A source that failed does not hold the code hostage: the row records
which source failed and the code is retried for that source alone.

## 3. A trusted source imports itself

### 3.1 The switch is a column, not configuration

```sql
ALTER TABLE "supermarket_sources"
  ADD COLUMN "autoImportPlaces" boolean NOT NULL DEFAULT false;
```

Off by default, one per chain, written from the back office beside `enabled`. It is a column for
exactly the reason `0083` gives: a second chain would otherwise need a second environment variable
threaded through `app-config.ts`, the config map, `_env.tpl` and both `luna-slot` scripts before it
could be trusted. **Do not add a per chain environment variable.**

It is a separate decision from `enabled`, and separate for the same reason `HARVEST_ENABLED` is
separate from the Helm switch: reading a chain's shops and letting them into the catalog unreviewed
are two things an operator decides at two different times.

**OpenStreetMap can never carry it.** It has no row to put it on, and that is the correct answer
rather than an omission: its data is community sourced, two thirds of its shops carry no postcode,
and `0038` section 6.1 exists because of that. A place from a radius search stays `NEW` and waits for
a person.

### 3.2 What "checked" means

A trusted place is imported only if it carries every field an import needs. The check is a pure
function over the reported place, so it is testable with no database:

| Field                   | Why it is required                                                   |
| ----------------------- | -------------------------------------------------------------------- |
| `latitude`, `longitude` | a shop with no position cannot be found or ranked                    |
| `postalCode`            | the shop's own, from the source, never derived here                  |
| `country`               | keys the centroid lookup catalog does on import                      |
| `externalRef`           | the identity a re-run recognizes, so a second run does not duplicate |
| a resolvable chain      | `externalBrandKey` or an exact brand name, per `0038` section 11     |

**`name` was on this list and is not any more.** Mercadona's store finder publishes none at all
(`0106` section 1), so every one of its 1,675 shops failed the check and waited for a person to press
import on a row nothing was wrong with. The address is what identifies a shop of a chain, it travels
on `street` and `city`, and velista already draws it under the chain's name for any shop whose label
is null. Dropped in [#349](https://github.com/IchirokuXVI/nx-portfolio/pull/349).

**A place that fails the check is not an error and is not rejected.** It becomes an ordinary `NEW`
row in the queue with the failed fields named on it, which is the existing screen doing the existing
job. The trusted path is a fast lane, not a replacement for the queue.

### 3.3 What the import does

Exactly what `DiscoveredPlaceService.import` already does, called by the run instead of by an admin:
create the location through `CatalogClient`, set `status = IMPORTED`, write back
`supermarketLocationId` so a re-run recognizes the place as already ours. The scope is the one the
source declared for that shop (`0106` section 3.1), or a `STORE` scope when the source declared none.

The actor is the harvester's provisioned `HARVESTER_ACTOR_ID`, so the catalog audit says a run did
this and not a person.

**A place already `IMPORTED` is left alone.** Re-running a chain must not rewrite a location an
operator has since edited, which is the same rule `admin:ensure` follows for an existing admin row.

## 4. What changes

| File                                                      | Change                                   |
| --------------------------------------------------------- | ---------------------------------------- |
| `harvester/.../entities/supermarket-source.entity.ts`     | `autoImportPlaces`                       |
| `harvester/.../db/migrations/<ts>-AutoImportPlaces.ts`    | the column                               |
| `harvester/.../harvest/postal-code-discovery.worker.ts`   | one run per place source                 |
| `harvester/.../harvest/postal-code-discovery.service.ts`  | due per code and per source              |
| `harvester/.../harvest/place-import-check.ts`             | the pure check                           |
| `harvester/.../harvest/discovered-place.service.ts`       | the trusted path, reusing `import`       |
| `harvester/.../harvest/lidl-store-discovery.runner.ts`    | the optional postal code filter          |
| `harvester/.../harvest/supermarket-source.service.ts`     | `autoImportPlaces` through upsert        |
| `libs/luna-shopper/contracts/.../harvest.messages.ts`     | the field on the source views and writes |
| `libs/luna-shopper-admin/feature-harvest/sources-page.ts` | the toggle, beside `enabled`             |

The back office toggle needs a sentence saying what it does, because it is the one switch in the
harvester that writes to the catalog without a person looking first.

## 5. Order of work

1. The column, the contract and the back office toggle, all off.
2. Due per code and per source.
3. One run per place source, with OpenStreetMap still always in the set.
4. LIDL's filter.
5. The check, then the trusted import behind it.
6. `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.

## 6. Tests

- One code with three configured sources starts three runs. With one of them disabled, two.
- A code answered by OpenStreetMap last week and never by LIDL starts the LIDL run alone.
- A failed source run leaves the code retryable for that source and does not re-ask the others.
- The check, as a table of cases: every field missing in turn, and a place that passes.
- A trusted source with a complete place writes a location and marks the place `IMPORTED`.
- A trusted source with an incomplete place writes no location, leaves the place `NEW`, and names the
  missing fields.
- A trusted source meeting a place that is already `IMPORTED` writes nothing.
- An OpenStreetMap place is never auto imported, even when the chain it resolves to is trusted.
- An integration spec, in the harvester's own integration target, proving the actor on the written
  location is the harvester's.

## 7. Decisions

- **D1. `autoImportPlaces` is a column.** A row per chain, off by default, written from the back
  office. `0083` already settled this shape for `enabled`.
- **D2. It is separate from `enabled`.** Fetching a chain and trusting it are two decisions.
- **D3. OpenStreetMap is never trusted.** No row to carry the flag, and its data is why the review
  queue exists.
- **D4. A failing check demotes to the queue.** Nothing is rejected automatically. A rejection is a
  judgement and this check is only a completeness test.
- **D5. Due is per code and per source.** Otherwise the first source to answer silences the rest.
- **D6. An imported place is never rewritten by a later run.**

## 8. What this plan does not do

- It does not merge two sources' opinions of the same shop. Each source's place resolves through its
  own `externalRef`, and two chains describing one building is not a case that exists.
- It does not change the radius, the centroid table, or the derive bound from `0097`.
- It fetches no price and declares no scope beyond what `0106` already declares.
- It does not give OpenStreetMap a postal code filter. Its query is already centred on the code.
