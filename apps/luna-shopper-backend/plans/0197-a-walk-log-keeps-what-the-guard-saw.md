# 0197: a walk log keeps what the guard saw

> A small addition to the walk log of `0168`. Needed by velista `0136`, which writes the
> new event. The guard that produces it is `libs/luna-shopper/shop-map/recorder/plans/0005`.
>
> Prerequisite reading: `0168` sections on the log and the fold,
> `libs/luna-shopper/shop-map/plans/0002`, and
> `libs/luna-shopper/contracts/src/schemas/messages/shop-walk.schemas.ts`.

On 2026-10-08 a walk in production stopped eight times with the reason `frame-moved`.
The log could not say which rule of the guard had fired, or by how much, because a
`stopped` entry keeps one word. The question "was it the camera or the compass" was
answered from where the stops fell on the map, which is an inference.

## Brief for the agent

### Objective

Add one event type, `guard`, to the walk log, so that an entry can keep what the tracking
guard decided and the number behind it. The event changes nothing in the map.

### Context

- **The log's events** are `path`, `mark-put`, `mark-removed`, `area-put`, `area-removed`
  and `section-left`. They are `WalkEvent` in
  `libs/luna-shopper/shop-map/model/src/lib/v2/types.ts`, restated on the wire as
  `ShopWalkEvent` in the contracts, stored as `jsonb` in `shop_walk_entries.events`.
- **The fold** (`catalog/src/app/shop-walks/walk-fold.ts` and the model's `walk-log.ts`)
  turns events into the document.
- **The stop reasons** (`SHOP_WALK_STOP_REASONS`) stay as they are. A shopper facing text
  reads them, and the cause is a detail for the person who debugs a walk.

### Target state

1. `WalkEvent` and `ShopWalkEvent` gain:

   ```ts
   {
     type: 'guard';
     logMs: number;
     what: 'lost' | 'jump' | 'turned' | 'heading'
         | 'compass-disturbed' | 'compass-settled';
     degrees?: number;  // turned, heading, compass-disturbed
     metres?: number;   // jump
   }
   ```

   `what` is an enum in the contracts (`SHOP_WALK_GUARD_KINDS`).
2. **The fold ignores it**, in the model and in catalog. A walk with `guard` events folds
   to the same document as the walk without them, which a spec asserts in each place.
3. **The rewind and the timeline ignore it.** It is no marker of the slider.
4. **An entry holds at most 50 `guard` events** (`SHOP_WALK_LIMITS`). A compass that
   flickers must not grow an entry without end.
5. The OpenAPI document and the admin wire types are regenerated and committed.

### Scope

Work in `libs/luna-shopper/contracts`, `libs/luna-shopper/shop-map/model` (the event
type and the fold only), `apps/luna-shopper-backend/catalog/src/app/shop-walks`,
`apps/luna-shopper-backend/gateway` (the DTO and its spec), and the two generated files.

Do not touch: the stop reasons, the entity (no migration: `events` is `jsonb`), velista,
the recorder library.

### Constraints

- No migration and no new column.
- The public map read and every shopper view carry no `guard` event.
- Regenerate, never edit by hand:
  `npx nx run luna-shopper-backend-gateway:openapi`, then
  `npx nx run luna-shopper-admin/models:wire-types`.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: adding a stop reason, storing a raw sensor sample, or showing the
event to a shopper.

### Progress evidence

The spec runs of the contracts, the model, catalog and the gateway, the two generated
diffs, and one append over a slot with a `guard` event followed by a read of the log
that answers it back.

## 1. The order of release

The gateway refuses an event type it does not know. This plan therefore reaches a
cluster before velista `0136` does. Both travel in one release when they are merged in
this order.

## 2. Not in this plan

- Writing the event: velista `0136`.
- A screen that shows it. The log read (`GET /v1/catalog/walks/:id/log`) and a database
  query are enough for now.
