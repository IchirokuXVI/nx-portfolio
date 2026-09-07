# 0097 A postal code we looked at, and who is waiting on it

`0063` built a queue of postal codes and a worker that drains it. Its listing was written at the
same time and deliberately left unconsumed:

> The queue's own rows (section 8), for backlog 0009 to render. Defined and left unconsumed on
> purpose: stating the shape beside the queue that produces it is cheaper than retrofitting it
> afterwards.

Nothing renders it. `postalCodeDiscovery.list` has no gateway route, so the only way to see whether
a code was ever looked at is to open the harvester's database. This plan gives that queue an HTTP
surface, the counts that make a row worth reading, and the two numbers that say whether anybody is
waiting on it. The screen is `apps/luna-shopper-admin/plans/0021`.

It takes three bullets from `plans/backlog/0009` section 5, which asked for exactly these numbers
from the other direction, and leaves the rest of that plan parked. What stays there is the auto
import rule and the measurement it waits on, and **this plan is what produces that measurement**:
places found and places accepted, per postal code, is the number section 3 of `0009` says should be
measured before that rule is designed.

Depends on `0063` for the queue, on `0061` for the nearest centroid rule, on `0062` for the
neighbours, and on `0074` for the admin namespace.

## 1. The queue is the list, and the shipped table is not

Two tables mean "postal code" and only one of them can be the spine of a screen.

| Table                            | Owner     | Rows                       | Holds                                            |
| -------------------------------- | --------- | -------------------------- | ------------------------------------------------ |
| `postal_code_points`             | catalog   | every code in the country  | a centroid, and a count of shops in it           |
| `postal_code_discovery_requests` | harvester | codes somebody asked about | status, attempts, when we last looked, the error |

The queue is the spine. Every column the screen wants except the shop count is a queue column, and a
listing of eleven thousand shipped centroids answers a different question: `0074` built that one
already, at `GET /v1/admin/catalog/postal-codes`, and this plan neither replaces nor touches it.

**So the list is demand driven, and that is the point.** A code is in it because a profile write
announced it, or because an operator typed it here. A code nobody lives in never appears, and a
screen that listed the whole country would bury the forty codes that matter under eleven thousand
that do not.

## 2. Four numbers on a row, and two of them do not mean the same thing

The screen asks how many places a code produced and how many were accepted. There are two honest
answers to the first and the design shows both rather than picking one quietly.

- **Found by its runs.** `discovered_places` rows whose `runId` is one of this code's runs. A
  `STORE_DISCOVERY` centred on 14013 with a 3 km radius returns places in four other postcodes, so
  this counts the work the code caused.
- **Located in it.** `discovered_places` rows whose own `postalCode` is this code, whatever run
  found them. This counts the places a user in that code would actually be shown.

Both are one grouped query over the harvester's own database, keyed on `(country, postalCode)` and
on `runId`, and both are broken down by `DiscoveredPlaceStatus`, so one query answers found,
accepted (`IMPORTED`), refused (`REJECTED`) and undecided (`NEW`).

The row therefore carries six counts, and the screen names them in two groups. Six numbers is more
than a table wants, and one number that silently means one of two things is worse.

`PostalCodeDiscoveryRequestView` gains them:

```ts
interface DiscoveredPlaceCounts {
  total: number;
  imported: number;
  rejected: number;
  undecided: number;
}

interface PostalCodeDiscoveryRequestView {
  // ... the fields 0063 defined
  /** Places this code's own runs wrote, wherever they turned out to be. */
  foundByItsRuns: DiscoveredPlaceCounts;
  /** Places whose own postal code is this one, whichever run found them. */
  locatedInIt: DiscoveredPlaceCounts;
}
```

## 3. A discovered place takes the nearest centroid, like a shop already does

Section 2's second number is a third right today. A `DiscoveredPlace` carries whatever
`addr:postcode` OpenStreetMap had, and `0009` measured that tag at about one third populated. So
"places located in this code" would miss two thirds of them, silently, and the panel on the detail
page would be wrong in the direction that looks like an answer.

`0061` solved this once, for `SupermarketLocation`, and stopped at the service boundary: nothing in
the harvester ever calls `postalCode.nearest`. This plan carries the same rule across it.

- **In the upsert loop of `StoreDiscoveryRunner`, a place with no tag asks catalog for the nearest
  centroid**, bounded by the same `POSTAL_CODE_DERIVE_MAX_METRES`, and keeps null when nothing is
  close enough. One call per untagged place, sequential, inside a run that already spends minutes on
  two rate limited HTTP requests. It costs nothing next to that, and a batched subject for it would
  be a second contract to keep in step for no measured gain.
- **`discovered_places` gains `postalCodeSource`**, `SOURCE` or `DERIVED` or null, mirroring the
  column `SupermarketLocation` already carries. A guessed code has to say that it was guessed
  wherever it is shown, and the count in section 2 is shown next to it.
- **No backfill migration.** A migration in the harvester cannot ask catalog, and a one off script
  would be a second code path for a table that refills itself: the upsert updates an existing row's
  postal code, so re running a code fills in its own places. Section 6's requeue is that button, and
  old rows keep a null code until somebody presses it.

## 4. The code has a name, and it has neighbours

**A name.** Nothing in this system stores one. `postal_code_points` is a code and two coordinates,
and an operator reading a list of bare numbers cannot tell Córdoba from Cáceres. The discovery run
already receives a display name from Nominatim when it geocodes the code, and throws it away. It is
kept: `postal_code_discovery_requests.placeName`, written at the `GEOCODE` stage, null until the
first run. One column, no request, and the list becomes readable.

**Neighbours.** `postalCode.nearby` answers them and has no HTTP surface, which `0074` chose on
purpose:

> Under `admin/catalog/` rather than beside the two open `postalCode.*` reads, because those have no
> HTTP surface at all: they are service to service, and a gateway route over them would be a
> geocoding service nobody asked for.

**This plan reverses that, narrowly, and the reversal is written down here rather than left implied
by the route.** What that paragraph refused was an open geocoding service. What this adds is one
admin gated route, behind `AdminJwtGuard`, answering the neighbours of one code an operator is
looking at: `GET /v1/admin/catalog/postal-codes/:postalCode/nearby`, with `country` and
`radiusMetres` as query parameters and the profile widening radius as the default. `postalCode.nearest`
stays where it is, because no screen asks it.

The answer is `NearbyPostalCodesView` unchanged, `known` included. Centroid to centroid, so the
screen repeats what the contract already says: two adjacent codes whose centres sit far apart are
neighbours in reality and not here.

## 5. Who is waiting on it

The one prioritisation signal, and `0009` said so:

> **How many profiles are waiting on that postal code**, which is the only real prioritisation
> signal and lives in core rather than the harvester.

Core answers it, over its own tables and no others. `profile_postal_codes` holds the code, the
`source` and the `suppressed` flag, and `shopping_profiles` holds the `userId`, so a distinct user count
is one join inside one database. Nothing crosses a service boundary, which is `0074` section 3's
rule.

A new subject, admin gated like every other admin read:

```ts
export const ADMIN_PROFILE_POSTAL_CODE_PATTERNS = {
  usage: 'adminProfilePostalCode.usage',
} as const;

interface PostalCodeUsageView {
  postalCode: string;
  /** TYPED or DEVICE rows: the code is where this profile shops from. */
  mainProfiles: number;
  /** NEARBY rows that are not suppressed: the code was derived onto it. */
  nearbyProfiles: number;
  /** NEARBY rows the user removed. Not waiting on anything, and not nothing. */
  suppressedProfiles: number;
  /** Distinct owners of the profiles above, counted the same three ways. */
  mainUsers: number;
  nearbyUsers: number;
}

interface PostalCodeUsageRequest extends AdminCredential {
  country: string;
  /** Up to one page of codes, answered in one round trip. */
  postalCodes: string[];
}
```

**A list of codes rather than one**, because the list screen decorates a page of rows and one call
per row is a fan out. This is the shape `AdminUserNamesService` already uses to put usernames beside
a page of zones, and the rule that comes with it is `0074`'s: where the decoration fails, the screen
renders the row without it and never fails the listing.

Main and near are counted apart because they are different facts. A code twelve people typed is a
place people shop. A code derived onto twelve profiles from a neighbour is a place we widened into,
and importing a shop there serves them differently.

## 6. What an operator may do to a row

Three writes, all admin gated, all on the harvester.

### 6.1 Add a code

`POST /v1/admin/harvest/postal-codes`, taking `country`, `postalCode` and `discoverNow`.

- With `discoverNow` true it inserts a `QUEUED` row, which is what `enqueue` already writes.
- With it false it inserts a `PARKED` row, a fifth `PostalCodeDiscoveryStatus`. A fifth value rather
  than reusing one, because every existing status is a claim about a run and this row has had none:
  `DONE` would say we looked, and `FAILED` would say we tried. `claimNext` reads `QUEUED` alone, so a
  parked row is invisible to the worker until somebody queues it.
- **A code catalog does not hold is refused**, with `postalCodeUnknown`. The centroid table is the
  whole national list, so a code missing from it is a typo, and accepting it would buy four failed
  Nominatim attempts and a `FAILED` row that reads like an outage. The gateway asks catalog once,
  before writing.
- One code per call. Adding twenty is twenty calls from the browser, under the partial failure rules
  `apps/luna-shopper-admin/plans/0020` already wrote for bulk work. A bulk endpoint is a transaction
  boundary and a timeout budget that this service does not have and this screen does not need.

### 6.2 Discover it again

`POST /v1/admin/harvest/postal-codes/:id/requeue`.

Sets `QUEUED`, clears `attempts`, `nextAttemptAt` and `error`, and **ignores the cooldown**, which
is the whole reason it exists: `enqueue` refuses a `DONE` row inside its thirty days by design, and
an operator who has just imported a chain wants to look again today. `requestedAt` is not moved, for
the reason `0063` gives: it records when the code was first asked about and the claim orders by it.

Refused on a `RUNNING` row, with `runInProgress`.

**It queues, and it does not run.** The queue drains serially and the active run index allows one
run at a time, so the honest response says the row is waiting, not working. The API says it plainly
and the screen repeats it.

### 6.3 Dismiss a failed code

`POST /v1/admin/harvest/postal-codes/:id/dismiss`, setting a new `dismissed` boolean.

A code Nominatim cannot geocode usually means somebody typed a code that does not exist, and
`0063` left the reason on the row for exactly this. A dismissed row is excluded from the listing
unless asked for, stays in the table, and is undismissed by a requeue. Nothing is deleted: the row
is the record that we looked and what happened.

## 7. Reading the queue

`ListPostalCodeDiscoveryRequestsRequest` gains what the screen filters on:

| Parameter    | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `postalCode` | prefix match, which is how a person narrows a numeric code |
| `status`     | already there                                              |
| `country`    | already there                                              |
| `dismissed`  | absent means not dismissed, which is the working set       |

**The order is `requestedAt` descending, and it is not by demand.** Sorting by the number of profiles
waiting would mean core's counts inside the harvester's `ORDER BY`, which is the join `0074` section
3 says does not exist and never will. Demand is a decoration on a page of rows, so it can be shown
and not sorted on, and this plan says so rather than leaving somebody to discover it while writing
the query.

Cursor paging through the existing `encodeCursor` and `decodeCursor` helpers, keyed on
`(requestedAt, id)` like the queue's neighbours.

### 7.1 One summary, two consumers

`postalCodeDiscovery.summary`, answering counts by status, the age of the oldest queued row, and
one boolean:

```ts
interface PostalCodeDiscoverySummaryView {
  queued: number;
  running: number;
  done: number;
  failed: number;
  parked: number;
  /** The oldest QUEUED row's `requestedAt`, or null when nothing waits. */
  oldestQueuedAt: string | null;
  /** `HARVEST_ENABLED` in this deployment. False means nothing drains. */
  draining: boolean;
}
```

`draining` is why this exists rather than being three counts on a screen. **A queue that fills and
never empties is the designed behaviour of a cluster with `HARVEST_ENABLED` false**, and an operator
pressing "discover again" there deserves to be told that instead of watching a row sit at `QUEUED`
for a week. It is not put on `GET /v1/admin/environment`, which answers callers with no token at
all.

The dashboard card in `apps/luna-shopper-admin/plans/0021` reads the same subject.

## 8. Where each number comes from

| Number                       | Service   | Cost                                    |
| ---------------------------- | --------- | --------------------------------------- |
| status, attempts, timestamps | harvester | the row                                 |
| places found and accepted    | harvester | one grouped query per page              |
| the code's name              | harvester | the row, written by the run             |
| shops we hold in it          | catalog   | `supermarketLocation.countByPostalCode` |
| neighbours                   | catalog   | one distance query, detail page only    |
| profiles and users waiting   | core      | one batched call per page               |

Three services for one screen, which is what the screen is: the postal code is the only thing in
this product that all three of them have an opinion about.

## 9. The places filter

`ListDiscoveredPlacesRequest` gains `country` and `postalCode`. Three layers, no new route: the
contract, `DiscoveredPlaceListQueryDto` at the gateway, and one `andWhere` in
`DiscoveredPlaceService.list`. The detail page's places panel is then the queue screen that already
exists, opened with a filter.

## 10. Regenerating the contract

Every route here changes `apps/luna-shopper-backend/gateway/docs/openapi.json`, and the admin app
reads its own types out of it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Both outputs are committed in the same change. `openapi-document.spec.ts` and `wire-types.spec.ts`
fail when either is stale.

## 11. Tests

Harvester:

- `enqueue` still refuses a `DONE` row inside its cooldown, and `requeue` writes over it.
- `requeue` is refused on a `RUNNING` row and clears the backoff on a `FAILED` one.
- A `PARKED` row is never claimed by `claimNext`, and a requeue makes it claimable.
- The counts of section 2 disagree where they should: a run centred on one code that writes places
  in another gives the first code a `foundByItsRuns` and the second a `locatedInIt`.
- Dismissing hides a row from the default listing and keeps it in the table.
- `summary` reports `draining` false when `HARVEST_ENABLED` is false.
- `StoreDiscoveryRunner` asks catalog for the nearest centroid only for places with no tag, writes
  `postalCodeSource`, and leaves the code null when nothing is within the bound.

Gateway:

- Every route refuses a velista user token and accepts an admin token.
- Adding a code catalog does not know answers `postalCodeUnknown` and writes nothing.
- The nearby route answers `known: false` for a code outside the table rather than an empty list
  that looks the same.

Core:

- Usage counts split `TYPED` and `DEVICE` from `NEARBY`, exclude suppressed rows from the nearby
  count and report them separately.
- Distinct users are counted per user and not per profile, proven with two profiles owned by one
  user.
- A code nobody uses answers zeros rather than being absent from the answer.

## 12. Exit criteria

- The discovery queue is readable over HTTP, searchable by code, and every row says when we last
  looked and what came of it.
- An operator can add a code, choose whether it discovers now, and be refused a code that does not
  exist.
- An operator can force a discovery inside the cooldown, and is told that the code is queued rather
  than running.
- The detail data of one code answers in three calls: the row and its places from the harvester, its
  neighbours from catalog, its usage from core.
- A place with no postcode tag gets one from the nearest centroid, flagged `DERIVED`.
- `openapi.json` and `wire-types.ts` are regenerated and committed.

## 13. Out of scope

- **The auto import rule** of `plans/backlog/0009` section 4. It stays parked, and this plan
  produces the measurement its section 3 asks for first.
- **A bulk endpoint.** Section 6.1 says why.
- **Telling the user when their postal code finally gets a shop.** That is a notification feature and
  it has no home yet.
- **A map.** `0009` is right that reviewing is visual, and the centroid and the places are all in the
  data by the end of this plan, so a map is a screen decision and not a backend one.
- **Sorting by demand.** Section 7.
