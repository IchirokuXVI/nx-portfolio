> **PR:** [#704](https://github.com/IchirokuXVI/nx-portfolio/pull/704)

# 0205: the basket read does less work

> Asked for by the owner on 2026-10-11, with the slow sync of the shopping list: "Also
> check if the basket read can be made cheaper, without losing any functionality."
>
> The read was traced in the code the same day and **nothing was measured**. It crosses
> NATS up to eight times in a row before it answers. This plan measures it first, then
> removes the work that the measurement shows is worth removing.
>
> Plan `0204` takes this read off the path of a buy. After it, the read still runs when
> the page opens, when the app comes back, when the socket reconnects, and after an add, a
> rename, a merge, a delete or a move of the coverage.
>
> **Order with plan `0201`.** That plan rewrites the read sequence of the gateway and asks
> for its own measurement. If `0201` is on your base branch, measure and change the read
> it left. If it is not, build this plan on the read of today. Section 2 says which
> candidates hold in both.
>
> Prerequisite reading: plan `0136` (the basket read), plan `0163` (the shop of a read),
> plan `0165` (the usual shop, and why the chain is learned before the rows), plan `0167`
> (sections), plan `0109` section 3 (every offer of every scope), plan `0138` section 7
> (marks), plan `0201` section 1 if it is on your base branch,
> `gateway/src/app/baskets/basket.controller.ts` (`get`, `live`),
> `basket-catalog.service.ts` in full, `participant.guard.ts`, the scope resolution
> service and its cache, `core/src/app/baskets/basket-read.service.ts` in full,
> `basket-read.sql.ts`, `basket-sharing.service.ts` (`resolveParticipant`),
> `basket-line-add.service.ts` (`searchScope`), and the memory note on a realistic catalog
> to measure on.

## Review of 2026-10-11: settle these before you build

A review of pull request #694 checked this plan against the code on `dev`. The eight
stages of `GET /v1/baskets/:id` are as the plan lists them. Where this section and a
later section disagree, this section is right.

1. **`GET /v1/baskets/live/rows` with a "participant guard" in section 3 does not match
   the code.** The live routes are on `BasketLiveController` behind `JwtAuthGuard`, with
   no participant (`basket.controller.ts`).
2. **"It runs stages 1 to 4 and stops" does not describe the live route.** That route has
   no guard hop and no `readShopOf`, and it asks `searchScope` inside `compose`. The plan
   lists stages for `:id` only. The first basket of section 1, a `LIVE` basket read by
   its owner, is measured on a route that the list does not describe. List the stages of
   the live route before you measure it.
3. **The rows route and backend `0201`.** Section 3 says that the route runs the steps of
   backend `0201` that choose the product of a line when that plan is on the base branch.
   Backend `0201` (pull request #693) did not name the route. Its review section now
   does.

## What the build decided

The build of 2026-10-13 settled the points below. Each one is a choice of the builder that
the owner can overturn. Where this section and a later section disagree, this section is
right. Plans `0201`, `0202`, `0203` and `0204` were on the base branch.

**In one paragraph.** The read was measured stage by stage. On a development slot it takes
430 to 490 ms, and about 80% of that is not work: each round trip over NATS waits about
45 ms in the port proxy of Docker Desktop. A cluster does not pay that wait. Without it the
whole read is about 65 ms of work in a row. So no candidate of section 2 saves 20 ms where
people use the app, and by the rule of this plan all six are dropped and the read code is
as it was. The rows read of section 3 is built, and it is the saving: it asks 4 or 5
questions where the full read asks 14 to 18, and answers 64 to 72 kB where the full read
answers 213 to 233 kB. **One point waits for the owner: the wait of 45 ms is outside the
list of this plan, and the build did not touch it (point 3).**

### The measurement

1. **The world.** An ephemeral slot with a copy of the catalog volume of the locked slot 1:
   22,203 products, 42 shops, 105 price scopes. One owner with postal code `14005` (8 shops
   of 4 chains, 7 price scopes). One list of 100 lines: 40 with one product, 40 with two
   products and no favourite, 20 of free text. The `LIVE` basket draws them as 97 rows and
   77 products. A guest joined on a link. The shop of a read is a Mercadona of that postal
   code. Development builds. Each figure is the median of 20 reads after 5 that were thrown
   away. The stages come from the traces of the `observability` profile, which split every
   round trip and every query, so no timing log was added.

2. **The whole request, before and after.** "Hops" counts every round trip over NATS. Eight
   of them are in a row with no shop, and nine or ten at a shop. "Work" is the time inside the
   services, added over every hop.

   | Read | Answer | Hops | Before | After | Work in the services | Queries |
   | --- | --- | --- | --- | --- | --- | --- |
   | `live`, owner, no shop | 218 kB | 14 | 449 ms (p95 467) | 440 ms (p95 470) | 82 ms | 72 |
   | `live`, owner, at a shop | 233 kB | 17 | 489 ms (p95 512) | 481 ms (p95 518) | 91 ms | 85 |
   | `:id`, owner, no shop | 218 kB | 15 | 431 ms (p95 450) | 436 ms (p95 480) | 85 ms | 72 |
   | `:id`, owner, at a shop | 233 kB | 18 | 491 ms (p95 502) | 489 ms (p95 500) | 90 ms | 85 |
   | `:id`, guest, no shop | 213 kB | 15 | 432 ms (p95 458) | 439 ms (p95 458) | 74 ms | 68 |
   | `:id`, guest, at a shop | 228 kB | 18 | 489 ms (p95 512) | 493 ms (p95 520) | 88 ms | 81 |

   "After" is the same read on the code of this pull request. It did not move, because no
   candidate was applied.

3. **Most of the time is one wait, and it is outside the list. This point waits for the
   owner.** Every round trip takes about 50 ms, and the service works for 2 to 11 ms of it.
   The other 45 ms pass before the service sees the request.
   - The broker is not slow. A request and its answer through the same NATS take 1 ms.
   - The same question to core takes 5.5 ms through `request()` of the NATS library, which
     listens on one inbox for every answer. It takes 50 ms the way `ClientNats` of Nest asks
     it: a new subscription for each request, then the publish, then the unsubscribe. That
     is two small writes in a row and then a read, and the port proxy of Docker Desktop
     holds the second write for about 40 ms.
   - From a container inside the compose network both ways take 5 ms. Only a process on
     the host pays the wait, and `luna-slot.sh` runs every service on the host.
   - **A cluster does not pay it.** A public route that crosses NATS one time, against one
     that crosses it no time, on one kept connection: 50.2 ms against 1.6 ms on the slot,
     50.6 ms against 48.7 ms on production, 74.4 ms against 62.7 ms on staging. So a hop
     costs about 2 ms on production and about 12 ms on staging, with the work inside.
   - A throwaway change that made the gateway ask through one inbox brought the six reads
     from 430 to 490 ms down to 160 to 260 ms on the slot. A wait still appeared wherever
     two requests left together, and after a large answer. That change was not committed.
     It touches every route of the gateway, and it is not in the scope of this plan.
   - **What the owner can decide:** leave it, because only a development machine pays it.
     Or write a plan that makes the gateway ask through one inbox, which more than halves
     every read on a slot and changes nothing in a cluster. Or run the services of a slot
     inside the compose network. The build recommends the second, as its own plan. Every
     route that crosses NATS pays this wait on a slot, not only the basket.

4. **The stages of `GET /v1/baskets/:id`, read by the owner at a shop.** This is the longest
   read. "One inbox" is the throwaway change of point 3, and it is the closest this
   machine comes to a cluster.

   | Stage | Starts at | Round trip | One inbox | Work inside | Queries |
   | --- | --- | --- | --- | --- | --- |
   | `basket.participant.resolve` (the guard) | 2 ms | 45.8 ms | 6.9 ms | 4.8 ms | 2 |
   | `basket.searchScope` | 48 ms | 50.7 ms | 5.7 ms | 4.6 ms | 5 |
   | `basket.priceChoices`, beside it | 48 ms | 52.7 ms | 50.3 ms | 6.8 ms | 7 |
   | `shopAvailability`, the shop alone | 99 ms | 6.5 ms | 4.7 ms | 3.5 ms | 5 |
   | `item.getMany`, the lines to price | 106 ms | 56.7 ms | 10.2 ms | 7.3 ms | 4 |
   | `basket.get` | 162 ms | 61.3 ms | 12.4 ms | 10.9 ms | 17 |
   | `shopAvailability`, with the products | 232 ms | 53.3 ms | 47.2 ms | 4.1 ms | 6 |
   | `section.itemsAtLocation`, beside it | 232 ms | 52.0 ms | 4.3 ms | 2.9 ms | 1 |
   | `item.getMany`, the other products | 287 ms | 51.8 ms | 50.4 ms | 5.5 ms | 4 |
   | `profiles.resolveScopes` (the selection) | 339 ms | 46.3 ms | 3.6 ms | 2.4 ms | 4 |
   | `supermarket.list` (the chains) | 385 ms | 49.4 ms | 3.0 ms | 1.9 ms | 2 |
   | `supermarketLocation.list`, seven together | 435 ms | 52.8 ms | 52.2 ms | 4.5 ms | 4 each |

   - The resolution of the profile is not in the table. It is answered from Redis in under
     1 ms.
   - With no shop the two `shopAvailability` rows and the sections row are absent.
   - Inside `basket.get` one trace was read query by query: 16 queries, each between 0.6 and
     1.6 ms. No query of `view` or of `rowsOf` stands out. The whole hop works for 9 to
     11 ms.
   - The work in a row adds to about 50 ms at a shop. With about 1.5 ms for each of the
     ten hops in a row, the read is about 65 ms without the wait.

5. **The stages of `GET /v1/baskets/live`** (review point 2), read by the owner with no
   shop. The route has no guard hop. `basket.live.priceChoices` makes the basket and answers
   the reader. `basket.searchScope` is asked after it and not beside it, and only when a
   line needs a price. With a shop, `shopAvailability` runs beside the first stage.

   | Stage | Starts at | Round trip | One inbox | Work inside | Queries |
   | --- | --- | --- | --- | --- | --- |
   | `basket.live.priceChoices` | 2 ms | 49.0 ms | 9.6 ms | 8.5 ms | 9 |
   | `basket.searchScope` | 51 ms | 55.6 ms | 5.2 ms | 4.7 ms | 5 |
   | `item.getMany`, the lines to price | 109 ms | 54.3 ms | 10.1 ms | 7.8 ms | 4 |
   | `basket.live` | 170 ms | 61.7 ms | 11.9 ms | 10.5 ms | 16 |
   | `item.getMany`, the other products | 232 ms | 55.6 ms | 57.8 ms | 6.0 ms | 4 |
   | `profiles.resolveScopes` (the selection) | 288 ms | 46.4 ms | 3.7 ms | 2.7 ms | 4 |
   | `supermarket.list` (the chains) | 342 ms | 49.8 ms | 3.3 ms | 2.1 ms | 2 |
   | `supermarketLocation.list`, seven together | 393 ms | 53.8 ms | 52.6 ms | 6.0 ms | 4 each |

6. **Staging was not measured read by read.** Staging runs the code of `main`, which is
   older than plan `0201`, and the measure needs an account with 100 lines there. The probe
   of point 3 answers the question that the staging measure was for: how far a slot is from
   a cluster. It is 45 ms for each hop in a row.

### The candidates

7. **Which number decides.** The plan drops a candidate that saves less than 20 ms. Each
   candidate takes one hop, or part of one, out of the row. On the slot a hop is 50 ms, so
   candidates A and D would pass. But 45 ms of each hop is the wait of point 3, which no
   person on a cluster pays. The build judged every candidate by what it saves without that
   wait: the work inside, and one hop of 2 ms (production) to 12 ms (staging). No candidate
   was applied and then taken out. Its number is read from the tables above.

   | | Candidate | Saves without the wait | Saves on a slot | Decision |
   | --- | --- | --- | --- | --- |
   | A | The selection beside the products | 2.4 ms of work and one hop: 4 to 14 ms | 46 ms | dropped |
   | B | The chain of a shop from memory | `:id`: 1.3 ms and at most one hop. `live`: nothing, the shop is read beside a longer stage | 6 ms, this hop does not wait | dropped |
   | C | One core hop where there are three | No hop: `searchScope` already runs beside `priceChoices`, which is longer. Two queries of the resolve in `basket.get`: under 2 ms | under 2 ms | dropped |
   | D | The shops of the scopes in one round trip | No hop: the seven reads already leave together. About 24 queries less in catalog | nothing | dropped |
   | D | The same, from a cache | 6.4 ms of work and two hops: 10 to 30 ms | 100 ms | dropped, see below |
   | E | The queries of core beside each other | Two or three queries of about 1 ms: under 3 ms | under 3 ms | dropped |
   | F | The second `shopAvailability` | Nothing. It runs beside the sections read | nothing | dropped |

   - A, B, C and E together save about 13 ms of about 65 ms on production.
   - **The cache of D is the one candidate near the bar.** With the hop of staging it saves
     about 30 ms. With the hop of production it saves about 10 ms. The plan says to prefer
     no cache, and the people who use the app are on production, so it is dropped. The
     owner can ask for it.
   - Since plan `0201`, `searchScope` and `priceChoices` run beside each other. That is why
     candidate C saves no hop any more.

8. **The rows read is where the time went.** After an event a client does not need the
   catalog half. Section 3 removes it from that read. Measured on the same slot:

   | Read | Answer | Hops | Whole request | Work in the services | Queries |
   | --- | --- | --- | --- | --- | --- |
   | `live/rows`, owner, no shop | 69 kB | 4 | 228 ms (p95 253) | 30 ms | 34 |
   | `live/rows`, owner, at a shop | 72 kB | 5 | 220 ms (p95 258) | 33 ms | 40 |
   | `:id/rows`, owner, no shop | 69 kB | 5 | 230 ms (p95 251) | 37 ms | 34 |
   | `:id/rows`, guest, no shop | 64 kB | 5 | 230 ms (p95 241) | 31 ms | 30 |

   Against the full read that is half of the time on a slot, a third of the bytes and under
   half of the queries. Without the wait it is about 30 ms of work in four hops.

### The rows read (section 3)

9. **No message was added.** The route asks core `basket.get`, or `basket.live`, which is
   the message of the full read. So core is not changed, and the rows of the two reads are
   one computation. The route answers `BasketView`, which the document now names as
   `basket.BasketView`.
10. **The code that reads the rows is one function for both reads.** `rowsOf` and
    `liveRowsOf` of `BasketCatalogService` hold what the two handlers held, line for line.
    The full read calls it and then composes. The rows read calls it and answers.
11. **It prices the lines that need a price** (review point 3, and plan `0201` decision 4).
    The product of a line with several products and no favourite is its cheapest, so the
    rows read asks catalog one question for those lines. A basket where no line needs a
    price asks catalog nothing. It then costs core four questions on `:id/rows`, the guard among
    them, and two on `live/rows`.
12. **`live/rows` is on `BasketLiveController`, behind `JwtAuthGuard`** (review point 1). It
    has no participant, and it makes the basket the first time, as `live` does.
    `route-order.spec.ts` asserts that it registers before `:id/rows`.
13. **The lock is asked of core's own view too.** A basket started at a shop refuses another
    `locationId` with 409 `basket_shop_locked`. The full read asks this twice, the second
    time in the composition, so that it holds when `basket.searchScope` failed. The rows
    read has no composition, so `rowsOf` asks it after the rows.
14. **The reads are not throttled**, like every read of this surface.
15. **What the route says about prices is on its answer.** The document holds no description
    of an operation, only of an answer. So the sentence of section 3 about the age of the
    prices is the description of the 200 answer of both routes.

### The proof (section 4)

16. **It is a spec of the gateway, with core and catalog played.** The gateway has no
    integration target, and this build changes nothing in core or in catalog. So
    `basket-read-answer.spec.ts` runs both controllers and the real composition over one
    fixed world, and compares the whole answer of each read with
    `basket-read-answer.recorded.json`. What core computes for each reader is proved in
    core on a real Postgres, by `basket-read.integration.spec.ts` and the files beside it.
    That part did not change.
17. **The recording was made with the read code of `dev`.** The first commit holds the spec
    alone, before the handlers were touched. A type check then corrected four fixtures, and
    the file was recorded again with the controller and the composition of `dev` in place.
    The code of this pull request answers that recording.
18. **Fifty cases.** The owner, a member who writes one of two lists and a guest. No shop, a
    shop, a basket started at a shop, and that basket asked at another shop (the refusal).
    A basket with no profile and a profile that was deleted. Eleven questions that fail,
    each alone, for three reads: four of core and seven of catalog. A participant removed
    after the guard (the refusal). The same for `live`.
19. **A read where something fails is recorded as what differs** from the same read with
    nothing failing: each path that moved, and its value. Only the two owner reads are held
    whole. The file is 70 kB that way, and it says what each failure costs.
20. **Nothing is normalized.** The world has no clock and no random id.
21. **Each fixture says what it is there for.** A second block asserts that the world
    reaches each branch: another product is picked at a shop than with none, a refused shop
    is left out, a list is named only to a reader who writes it.

### Velista after this plan

- **Velista `0143`** reads `GET /v1/baskets/:id/rows`, or `GET /v1/baskets/live/rows` for
  the permanent basket, when it cannot apply a patch. It sends the `locationId` of its
  full read. The answer is the full answer without `products`, `scopes` and `shop`. It
  makes the full read when a row names a product that it does not hold.
- The full reads answer what they answered. No field moved.

## Brief for the agent

### Objective

Measure `GET /v1/baskets/:id` and `GET /v1/baskets/live` stage by stage on a realistic
basket. Apply the candidates of section 2 that the measurement supports. Add a read of the
rows alone for a client that already holds the catalog half. The answer of the two
existing routes does not change by one field.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it. **The times in this section are not known. Only the order is.**

The stages of `GET /v1/baskets/:id`, each a round trip over NATS, in the order they run:

1. **`ParticipantGuard`** verifies the token and sends `participantResolve` to core. It
   has no cache, on purpose: a removed participant is refused on the next request (plan
   `0051`, section 3.3).
2. **`readShopOf`** sends `basket.searchScope` to core, to learn the shop the basket was
   started at.
3. With a shop, **`chainOf`** sends `shopAvailability` to catalog with no products, only
   to learn the chain of the shop. Core needs the chain for `usual` (plan `0165`).
4. **`basket.get`** to core. `BasketReadService.read` resolves the basket and the
   participant again, then `view` runs in a row: the coverage, the lists the reader
   writes, then three reads in parallel (the rows, the people, the list refs). `rowsOf`
   itself runs in a row: the session of the basket, the covered lines, the marks, then
   five queries in parallel, then the usual counts.
5. **`compose`** runs three reads in parallel: the scopes of the owner (through the cached
   scope resolution), `shopAvailability` again, now with the products, and the sections.
6. **`productsOf`** sends `item.getMany` to catalog with every product of every row,
   every scope and `offers: 'all'`.
7. **`selectionOf`** reads the postal codes and the refusals of the profile.
8. **`scopesOf`** names the chain of each scope, then sends **one
   `supermarketLocation.list` for each chain**, with the largest page size, to list the
   shops a reader can pick.

Three more facts:

- Core resolves the same basket and the same participant three times in one read: for
  stages 1, 2 and 4.
- Stage 7 does not need the answer of stage 6. It runs after it today.
- Every write through a basket runs `view` again for its answer, and a settle runs
  `paidFor` before the write (one `basket.searchScope` and one catalog read).

### Target state

1. The pull request holds a table of times for each stage, before and after, for the
   three baskets of section 1.
2. Each candidate of section 2 is applied or dropped, with the number that decided it.
3. `GET /v1/baskets/:id/rows` exists (section 3).
4. A spec proves that the two existing routes answer exactly what they answered
   (section 4).

### Scope

- `apps/luna-shopper-backend/gateway/src/app/baskets/`: the controller, the catalog
  composition, the guard, the DTOs, `openapi.json`.
- `apps/luna-shopper-backend/core/src/app/baskets/`: the read service, its SQL, the
  resolve of a participant, the search scope.
- `apps/luna-shopper-backend/catalog`: only for a batched read that section 2 names, and
  only when the measurement asks for it.
- `libs/luna-shopper/contracts`: the patterns and messages that a candidate needs.
- `libs/luna-shopper-admin/models`: the regenerated wire types only.

### Constraints

- **No functionality is lost.** `BasketResult` and `BasketView` keep every field, with
  the same value for the same data. That includes the failure rules: a catalog that does
  not answer costs the captions and never the screen.
- **A removed participant is still refused on the next request.** Nothing caches the
  answer of the guard.
- **A cache holds only what does not belong to one reader**, and it states how it is
  cleared. Prefer no cache where a parallel read or a merged round trip does the job.
- **A candidate that saves less than 5% of the total, or less than 20 ms, is dropped.**
  Write its number in the pull request and leave the code as it is.
- **The clock rules stay.** The session, the skip window and the six hours of an outside
  buy are computed by the database.
- **`openapi.json` and the wire types are generated output.**

### Action boundaries

- Do not build plan `0203`, plan `0204` or any velista plan.
- Do not change what a row is, the redaction of a reader, or any event.
- Stop and ask before a change that makes one reader's answer depend on a value cached
  for another reader.
- Stop and ask before a new index or a migration. Show the `EXPLAIN (ANALYZE)` first.
- Stop and ask if the measurement shows that one stage outside this list holds most of
  the time.

### Progress evidence

- The table of section 1, before any change, posted first.
- The spec of section 4, green before the first change and after the last.
- The same table after the changes.
- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-catalog luna-shopper/contracts`
  passes, and the integration specs of the read run on a slot.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.

## 1. Measure first

On a Luna slot of your own with a realistic catalog (the memory note says how to get one,
and never to run on the kept volume itself). Build three baskets:

| Basket | Why |
| --- | --- |
| A `LIVE` basket of 100 lines, 80 with products, read by its owner with no shop | the ordinary read |
| The same, read with `locationId` | stages 3 and 5 with a shop, and `usual` |
| The same, read by a guest on a link | no access query, no list refs |

For each, record the median of 20 reads, after 5 reads that are thrown away:

- the whole request, at the gateway,
- each of the eight stages of "Context",
- inside stage 4, each query of `rowsOf` and of `view`.

Use the traces of the `observability` profile of the slot if they split the stages. If
they do not, add timing logs on a branch you throw away. Do not commit them.

Then record the same three reads on staging, as whole requests only, to know how far a
slot is from a cluster.

## 2. The candidates

Apply them in this order. Measure after each one.

| | Candidate | Holds with `0201` |
| --- | --- | --- |
| A | **Stage 7 beside stage 6.** `selectionOf` needs the owner and the profile, which are known after stage 5. Run it in parallel with `productsOf`. | yes |
| B | **The chain of a shop without a round trip of its own.** Stage 3 exists only to turn a shop id into a chain id. Read first whether catalog can ever move a shop to another chain (plan `0193` links places to shops). If it cannot, keep the pair in the memory of the gateway. If it can, keep it for ten minutes. | yes |
| C | **One core hop where there are three.** Let the resolve of the guard answer what `basket.searchScope` answers, for the read routes only, so stage 2 costs nothing. Then let `basket.get` take the participant the guard resolved instead of resolving again. Core checks the participant again inside the hop that reads, so the refusal of a removed person stays at the same moment. | yes |
| D | **The shops of the scopes.** Stage 8 lists every shop of every chain on every read. First try one catalog pattern that answers several scopes in one round trip. Only if that is not enough, cache the answer for each scope, cleared by the event that already clears the scope resolution cache. The refusals of a profile are applied after the cache, as today, so the cached value belongs to no reader. | yes |
| E | **The queries of `view` and `rowsOf` that wait for nothing.** Run the session read beside the coverage. Run the marks beside the five parallel queries, and read the purchases of the removed lines in a second small query only when the marks name a removed line. | yes, check the order `0201` left |
| F | **The second `shopAvailability`.** Stage 5 asks the shop again with the products. With candidate B the first call is gone, so this is the only one. Nothing to do unless B was dropped. | yes |

Two things this plan does **not** try, and why:

- **A cache of the rows.** A row is computed from lines that many people write, for one
  reader, with windows that move with the clock. Every way to clear such a cache is a way
  to serve a stale shopping list.
- **A smaller answer.** `offers: 'all'` is what lets the screen answer "what does this
  shop charge" (plan `0109`). Removing it removes a function.

## 3. The rows alone

`GET /v1/baskets/:id/rows` and `GET /v1/baskets/live/rows`, participant guard, answer
`BasketView`: the rows, the lists, the people, the progress and the marks, as core
computes them. No products, no scopes, no shop.

- It takes the same `locationId` as the full read, because `usual` depends on the chain.
- It runs stages 1 to 4 and stops.
- **With plan `0201` on the base branch** it also runs the steps of that plan that choose
  the product of a line, because the rows depend on them. It still skips `compose`.
- A client calls it for a read after an event, when it already holds the catalog half. It
  falls back to the full read when the answer names a product it does not hold (velista
  plan `0143`).
- The full read is unchanged, and it is the read of a page that opens.

The prices a client holds can then be as old as its last full read. A full read happens
when the page opens, when the app comes back and when the socket reconnects, and a price
changes when a harvest runs. State this in the description of the route.

## 4. The proof that nothing was lost

Before the first change, write an integration spec that records the full answer of the
two existing routes for a fixed set of fixtures, and compares the answer after each
change, field by field:

- the owner, a member who writes one of two lists, and a guest,
- with no shop, with `locationId`, and on a basket started at a shop (also the refusal
  `basket_shop_locked`),
- a basket with no profile, and a profile that was deleted,
- catalog not answering each of its reads in turn (the answer keeps its rows),
- a participant removed between the guard and the read (the answer is the refusal of
  today).

Values that move with the clock or with random ids are normalized by the spec, not
ignored.

## 5. Tests

- The spec of section 4.
- Each candidate that was applied has a spec for the case it could break: candidate B a
  shop the catalog does not know, candidate C a participant who was removed and a guest
  with a session secret, candidate D a refused chain and a refused shop, candidate E a
  basket with a removed row that this basket bought.
- The rows route: the same rows, people, progress and marks as the full read made in the
  same test, for the three readers of section 4.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 6. Not in this plan

- The time of a write on the device that makes it: `paidFor` before a settle, and the
  whole `view` that every write recomputes for its answer. Plan `0201` changes what a
  write answers. Measure that after it.
- The read of the listing that the card on the dashboard makes.
- The catalog reads behind `item.getMany`.
