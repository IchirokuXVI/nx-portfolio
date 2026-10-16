# 0155: a basket event reaches the open page, over one socket

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Two findings of `docs/reports/2026-10-16-velista-e2e-slot1.md`:
> F5.1 (major, the `basket.updated` frame arrives and the open tab never learns that the trip
> finished, so it learns from a 409 on its next tap) and F5.11 (minor, one basket page holds
> three socket connections and every frame arrives three times).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0143` (a buy reaches the other phone at once), plan `0013`
> (own origin, and why `appProviders` is spread into both modes),
> `libs/velista/data-access/src/lib/realtime/realtime-event-mapper.ts:300-307`,
> `mapping/mappers.ts:1526-1545` (`toBasketSummary`) and `:1647-1663` (`toBasketFromView`),
> `realtime/realtime-events.ts:260-267`, the consumers `baskets/basket-store.ts:283-288`,
> `basket-list-store.ts:236-238`, `live-basket-store.ts:108-117`, `purchases/purchase-store.ts:329-333`,
> the contract `libs/luna-shopper/contracts/src/schemas/messages/basket.schemas.ts:278-290`,
> `apps/velista/src/app/app.config.ts:19-22`, `app-root-route.ts:44-52`,
> `app-providers.ts:309`, `:322-433`, `libs/velista/data-access/src/lib/realtime/realtime-socket.ts:91`,
> `:159-186`, `profile-store.ts:65-69`, and `libs/velista/feature-shell/src/lib/routes.ts:1642-1652`,
> `:1699-1708`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

A `basket.updated` event changes the open page at once, and a velista page on its own
origin holds one user socket and one basket socket, never three.

### Context

- **The event is small and the mapper wants the whole view.** The contract of
  `basket.updated` is `{ basketId, kind, name, status }`, all four required
  (`basket.schemas.ts:278-290`), emitted at `basket.service.ts:720-730`. `basket.created`
  still sends the whole view (`:206`). `realtime-event-mapper.ts:300-307` maps both through
  `toBasketFromView`, which calls `toBasketSummary` (`mappers.ts:1526-1545`) and returns null
  without `id` and `generatedAt`. The event is dropped before any store sees it. The velista
  type at `realtime-events.ts:260-267` still says "the payload is the whole basket".
- **Four consumers are dead today.** `basket-store.ts:283-288` refetches when
  `event.list.id === this._id`; `basket-list-store.ts:236-238` calls `_upsert(event.list)`;
  `live-basket-store.ts:108-117` reloads on any of three types; `purchase-store.ts:329-333`
  refetches. `basket-store.spec.ts:1005-1007` feeds a pre mapped `{ list: { id } }` event,
  which is why no spec caught it.
- **Two user sockets come from one provider spread twice.** The only `io()` is
  `socket-factory.ts:2`. `RealtimeSocket` is `@Injectable()`, not root provided
  (`realtime-socket.ts:91`), bound by `provideService(REALTIME_CLIENT, RealtimeSocket)` in
  `app-providers.ts:309`, and starts itself from constructor effects (`:159-186`). In the
  standalone build `appProviders` is attached at the root (`app.config.ts:19-22`) **and** on
  the route (`app-root-route.ts:44-52`, called with `''`). The environment initializers at
  `app-providers.ts:322-433` run once per environment injector, several inject
  `ProfileStore` (`data-access-providers.ts:215-218`), and `ProfileStore` injects
  `REALTIME_CLIENT` (`profile-store.ts:65-69`). So root and route each build a
  `RealtimeSocket`, each joined to `user:{id}`. `BasketSocket` is the third, route provided
  on both basket routes (`routes.ts:1642-1652`, `:1699-1708`) with an idempotent `open()`
  (`basket-socket.ts:217-229`). The owner thus gets a basket frame on two user sockets and
  one basket socket, which is the three of the report. Under the shell only the route copy
  exists.

### Target state

1. `basket.updated` has its own velista event type `{ type: 'basket.updated', basketId,
   kind, name, status }` and its own mapper, `toBasketUpdated`, that maps from `unknown`
   and validates the four fields. `basket.created` keeps `toBasketFromView`.
2. `basket-store` refetches when `basketId` is its own. `basket-list-store` patches `name`
   and `status` onto an existing summary and schedules a refresh for an unknown id.
   `live-basket-store` and `purchase-store` react to the type as they meant to.
3. `realtime/wire-contract.spec.ts` validates the mapper against the contract schema, so a
   payload change in the backend fails a velista spec.
4. On velista's own origin, the services and initializers of `appProviders` live in one
   environment injector. `app.config.ts` carries only what a route cannot provide (the
   router, the service worker, the browser providers), and the route carries
   `appProviders` in both modes. A spec counts `SOCKET_FACTORY` calls on a booted
   standalone app and asserts one.

### Scope

- `libs/velista/data-access/src/lib/realtime/realtime-event-mapper.ts`, `realtime-events.ts`,
  `realtime/basket-events.spec.ts`, `realtime/wire-contract.spec.ts`.
- `mapping/mappers.ts` (the new mapper) and its spec.
- `baskets/basket-store.ts`, `basket-list-store.ts`, `live-basket-store.ts`,
  `purchases/purchase-store.ts` and their specs.
- `apps/velista/src/app/app.config.ts`, `app-root-route.ts`, `app-providers.ts`,
  `app-root-route.spec.ts`; `data-access-providers.ts` only if a provider must move.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Rule D4: the new mapper owns its shape and reads `unknown`.
- `provideServiceWorker` stays in `app.config.ts` only (plan `0013`).
- Every environment initializer that runs today must still run exactly once in both modes.
  List them in "What the build decided" with where each one now lives.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change the contract, the backend
  emit, or the mount factory `appRootRoute` beyond its providers.
- If moving a provider out of the root breaks a boot path under the shell (the mounted
  mode), stop and report which initializer needed the root.

### Progress evidence

- New specs, each failing before the change:
  - the wire payload `{ basketId, kind, name, status }` maps to the new event and reaches
    `basket-store`, which refetches;
  - `basket-list-store` patches the status of a known summary;
  - a booted standalone app creates one `RealtimeSocket`.
- `npx nx run-many -t lint test -p velista/data-access velista` passes.
- `npx nx build velista` passes.
- One check on a slot: two tabs on a generated trip, finish in one, the other draws "This
  trip is finished" within a second, and the websocket frame list shows one copy of the
  frame on one user socket plus one on the basket socket.

## 1. Not in this plan

- The 409 copy on a tick in a tab that did not know (F5.5). Plan `0151` covers it, and after
  this plan the tab knows.
- Reducing the basket socket to the user socket. Two sockets with two rooms is the design
  of plan `0143`.

## 2. Choices that are mine

- **A dedicated event type.** Widening `toBasketSummary` to accept a partial would make a
  summary with holes that other code trusts.
- **The route owns `appProviders` in both modes.** It is what the mounted mode already
  does, so one shape serves both and the spread of plan `0013` keeps its meaning.
