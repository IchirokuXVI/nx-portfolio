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
