# 0006 (backlog) The public item refresh, and the global fetch cooldown

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

Split out of plan 0038, which builds the harvester service and the Mercadona source. That plan
originally carried a user facing endpoint letting **any** user refresh one item's price on demand,
capped at **one fetch per five minutes across the whole platform**. The endpoint is parked here.

**The blocker is deliberate and named: this needs a shared counter, and there is no Redis in this
stack yet.** Section 2 explains why the obvious substitutes do not work, and section 3 records the
Redis free design that was written before the decision to wait, so that picking this up later is a
build rather than a redesign.

Plan 0038 built the owner facing refresh (`REFRESH` run mode, platform admin gated). What is
deferred is only the **public, uncapped-audience, globally-capped** version.

**Plan 0086 deleted that owner facing `REFRESH`.** A catalog walk writes the prices it fetches, so
a second fetch of the whole tracked set had nothing left to do. The run mode this plan needs is
narrower and survives as this plan's own: **one item, one fetch, one price, and nothing else
created.** Section 1.1 states it against plan 0086's shape.

### 1.1 What the refresh run is after plan 0086

`REFRESH` comes back as a run mode when this plan is built, with the meaning the owner gave it:
a shopper's refresh **updates a price and never creates anything**. Its input is one
(`itemId`, `priceScopeId`) pair. It is a runner over `SourceIngest` (plan 0086, section 5) that:

1. Finds the item's `ACTIVE` row for the scope's chain whose `sourceKind` is `OFFICIAL_API`. No
   such row means there is nothing to fetch, and the request is refused as not refreshable rather
   than started.
2. Fetches that one product by its `externalId` through the chain's adapter, under the budget of
   section 3, and produces one observation.
3. Hands it to the ingest, which lands on rung 1 of the ladder: the row exists and is `ACTIVE`, so
   the price is written to the scope with this run's id and `OFFICIAL_API`, the scope's
   `source_entry_prices` row is replaced, and no row, item, candidate or queue entry is created.
   A 404 sets the scope's availability to false, as a walk's absence does.

It is the only run mode a non admin may start, and the only one whose cost is one request.

**The button is offered only when the current price came from an automatic source.** The price a
shopper sees is the materialized one plan 0080 decides, and it carries a `priceSourceKind`. The
refresh control is shown when that kind is `OFFICIAL_API` and the item has an `ACTIVE` row of that
kind for the chain, which is the Mercadona case. It is not shown for a leaflet price, because a
leaflet cannot be fetched again, nor for an `ADMIN` or `USER_REPORTED` price, because a fetch would
not be what the shopper is looking at. The gateway asks the harvester the same question before
starting a run, so a client that shows the button anyway is refused with the same sentence.

## 1. What the feature is

A user looking at a price they suspect is stale presses refresh. The harvester fetches that one
item's detail from the chain, updates the stored price, and returns it. The cap exists because the
endpoint is otherwise a free, unauthenticated-in-spirit proxy to a third party's API: one user with
a script could turn our polite integration into a crawl the source would be right to block.

The cap is therefore **a property of the platform, not of the caller**. It is not "five minutes per
user", which would scale linearly with the user count and defeat the purpose. It is one fetch per
five minutes in total, whoever asks.

## 2. Why it waits for Redis

**`@nestjs/throttler` cannot express this.** It is already wired into the gateway
(`libs/luna-shopper/platform/src/lib/throttling/`), and it is the wrong tool twice over:

- It keys on the **caller** (IP), and this cap is not per caller.
- Its storage is **in memory per process**, so N gateway replicas each hold their own counter and
  the effective allowance is N fetches per window rather than one.

`throttler-config.ts` says as much in its own comment: one bucket, per route overrides, per client.
Bending it into a global singleton counter would mean replacing its storage, which is the Redis
dependency by another name.

**A shared counter is the whole feature.** Any correct implementation needs one place that both
knows the last fetch time and can be read and written atomically by every replica. That is what
Redis is for, and Redis is already anticipated in this codebase: `realtime`'s config comments note
that its backplane variables join the schema "when Redis is introduced". Building a second,
different shared-counter mechanism weeks before Redis arrives means maintaining two of them and
migrating one.

So the trigger for this plan is simply: **Redis exists in the stack.** At that point the
implementation is a `SET key NX PX 300000` and its refusal path, which is a day's work rather than
a design.

## 3. The Redis free design that was written, and why it is kept here

It is recorded because it is correct, not because it should be built. If Redis slips far enough that
this feature is wanted first, this is the fallback, and it is genuinely sound.

A row in the harvester database, claimed atomically:

```sql
UPDATE source_fetch_budgets
   SET "lastFetchAt" = now()
 WHERE key = $1
   AND "lastFetchAt" <= now() - make_interval(secs => $2 / 1000.0)
RETURNING "lastFetchAt";
```

Zero rows returned means the window is closed. One statement, atomic under concurrency, correct
across replicas and restarts, no new infrastructure. `source_fetch_budgets` would be
(`key` primary key, `lastFetchAt`, `minIntervalMs`).

Two properties that any implementation, Redis or Postgres, must keep:

- **The slot is claimed before the fetch and is not released if the fetch fails.** Releasing it
  turns a failing source into a hammering loop, which is the opposite of what the cap is for.
- **Discovery runs use a different budget key.** A catalog discovery walk makes thousands of
  requests over tens of minutes; sharing one budget would starve every user refresh for the whole
  run. The honest reading of the five minute cap is that it stops the *public endpoint* being a free
  proxy, not that it is the whole of our politeness toward the source. The run's own rate limiter
  (plan 0038, section 6.3) is what governs a run.

The reason this is a fallback rather than the plan: it puts a hot, contended, once-per-request write
on the primary database to answer a question Redis answers with one round trip and no durability
requirement at all. It works. It is not what that data wants to be.

## 4. The contract

Decided when this was part of 0038 and unchanged by the deferral: **a refresh that arrives while the
window is closed is refused**, not queued and not silently reported as a success.

`POST /v1/catalog/items/:itemId/refresh`, open to any authenticated user, returns `429` through the
gateway's existing problem details shape with `Retry-After`, carrying the stored price so the client
has something to show:

```json
{ "refreshed": false, "retryAfterSeconds": 143,
  "price": 1.29, "unitPrice": 1.29, "unitPriceLabel": "L",
  "observedAt": "2026-08-27T09:14:02Z", "priceSourceKind": "OFFICIAL_API" }
```

The client renders a countdown and keeps showing the price it already has. Queueing was rejected
because it needs a queue, a wait or a poll, and a rule for what happens when fifty people queue for
fifty different items against one slot every five minutes. Silently succeeding was rejected because
it tells the user their data is fresh when it is not.

**One claim buys one fetch of one (item, scope) pair.** The request carries an optional
`priceScopeId`; absent, it resolves to the item's only scope or to the scope of the zone the caller
shops in, and is refused as ambiguous when neither settles it.

A **per IP gateway throttle** sits on top, so one client cannot spend its day collecting 429s.

## 5. Open questions for whoever picks this up

- **Whether the cap should be per chain rather than global.** One fetch per five minutes across all
  supermarkets gets tighter as chains are added, and the politeness argument is per source. A per
  `supermarketId` key is a one line change to the design and a real change to the meaning.
- **Whether a refused refresh should still be recorded.** Knowing which items users try to refresh
  is a good signal for what to prioritize in a scheduled run, and it is a write on a path whose
  entire point is to avoid work.
- **Whether the five minutes is right.** It was chosen as a starting point, not measured against
  anything. It should be config, and it should be revisited once there is any usage to look at.

## 6. Exit criteria

- Redis is part of the stack before this is started.
- Any authenticated user can refresh one item, at most once per five minutes across the whole
  platform, enforced in shared storage rather than in a per replica counter, and provably so under
  a concurrent test with more than one replica.
- A refused refresh returns the stored price, its observation time and source kind, and the seconds
  remaining, and never a success.
- A failed fetch does not return the slot.
- A discovery run in progress does not starve the endpoint, and the endpoint does not disturb the
  run's own rate limit.
