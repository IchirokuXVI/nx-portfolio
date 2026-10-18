> **PR:** [#754](https://github.com/IchirokuXVI/nx-portfolio/pull/754)

# 0157: a group URL answers when the group is not readable or not yet loaded

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Four findings of `docs/reports/2026-10-16-velista-e2e-slot1.md` on
> group URLs: F2.6 and F4.6 (a group the reader is not a member of, or a random group id,
> draws "This group is not available to you" and under it "Something went wrong on our
> side", a Try again and a reference line), F2.7 (reloading the new list or the group
> settings sheet lands on the bare group page) and F2.8 (a cold link to a member sheet lands
> on the group page too).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: `libs/velista/feature-zones/src/lib/group-page/group-page.html:24-30`,
> `group-page.ts:132-148`, `:456`, `select-group-state.ts:55-60`, `:79-80`,
> `zone-error-copy.ts:47-64`, `libs/velista/models/src/lib/zone-view.ts:99`, `:157`,
> `libs/velista/ui/src/lib/home/state-panels.ts:49-85` (`ErrorState`),
> `libs/velista/feature-shell/src/lib/zone-guards.ts:97-135`, `:167-177`, `routes.ts:488-501`,
> `:1017-1025`, `:1039`, `:1049`, `libs/velista/data-access/src/lib/zones/zone-store.ts:346-362`
> (`loadZone`), and `libs/velista/ui/assets/i18n/en.json:119`, `:693`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

A group the reader may not read draws one sentence and a way home, with no retry and no
reference line. A real failure keeps the generic block with a generic title. A sheet URL
under a group opens its sheet on a cold load for a reader who holds the role.

### Context

- **Two texts in one block.** `group-page.html:24-30` draws one `lib-error-state` with the
  title `zone.error.notAvailable` (`en.json:119`) and the body `home.error.body`
  (`en.json:693`), plus `ref` and Try again (`ErrorState`, `state-panels.ts:49-85`).
  `selectGroupState` (`select-group-state.ts:55-60`, `:79-80`) answers
  `{ kind: 'error', correlationId }` for a 404 and a 500 alike, with no code.
  `group-page.ts:132-148` passes `this._zones.error()`. `zoneErrorKey`
  (`zone-error-copy.ts:47`, `not_found` at `:64`) exists and is used only for claim
  (`group-page.ts:456`). There is no global handler at work.
- **The guards read only the cache.** `requireRole` (`zone-guards.ts:103-121`) calls
  `inject(ZoneStore).zoneById(zoneId)` and otherwise redirects to `groupPageOf(zoneId)`
  (`:167-177`); the comment at `:97-101` admits the deep link case. `zoneMemberGuard`
  (`:135`) is on `lists/new` (`routes.ts:1039`), `zoneStaffGuard` (`:124-126`) on the group
  `settings` (`:1049`), and the member sheets use one or the other (`routes.ts:488-501`)
  under `zones/:zoneId/members` (`:1017-1025`). `ZoneStore.loadZone(zoneId)` exists
  (`zone-store.ts:346-362`), upserts into `_byId` and swallows errors into `_zoneState` and
  `_error`.

### Target state

1. `GroupState` gains a kind `not-available`, chosen by `selectGroupState` when the zone
   error is a `GatewayError` with `not_found` or `forbidden`. The group page draws for it
   the one sentence `zone.error.notAvailable` and a "Home" action, with no reference line
   and no retry. The error kind keeps the generic block with a generic title ("This group
   could not be loaded") and the reference line.
2. `requireRole` is asynchronous. When `zoneById` is undefined it awaits
   `loadZone(zoneId)` and tests again. It redirects to the group page only when the zone is
   still absent or the role test fails. A cold load of `/zones/:z/sheet/lists/new`,
   `/zones/:z/sheet/settings` and `/zones/:z/members/sheet/:m/confirm/*` then opens the
   sheet for a reader with the role.
3. The redirect target of a failed role test stays the group page, which after item 1 draws
   the not available block when the zone is not readable.

### Scope

- `libs/velista/feature-zones/src/lib/select-group-state.ts` and its spec;
  `group-page/group-page.ts`, `.html`, `group-page.spec.ts`; `zone-error-copy.ts` if reused.
- `libs/velista/models/src/lib/zone-view.ts`.
- `libs/velista/feature-shell/src/lib/zone-guards.ts` (`requireRole` only) and
  `zone-guards.spec.ts`.
- `libs/velista/ui/assets/i18n/en.json` and `es.json` (a generic title key).
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- A 403 and a 404 on a group draw one sentence. Do not tell a reader which groups exist.
- Plan `0156` edits the canMatch guards of `zone-guards.ts`. Keep this diff to `requireRole`.
- A guard that loads must not hang the navigation: `loadZone` already resolves on an
  error, and the guard returns a redirect on `undefined`. Add a spec for the error path.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change the `ErrorState` component
  of `velista/ui` beyond passing it different inputs, or any route path.

### Progress evidence

- New specs, each failing before the change:
  - a 404 on the zone read gives `not-available`, which draws one sentence, Home, and no
    reference line;
  - a 500 gives `error`, which draws the generic title, the body and the reference line;
  - `requireRole` with an empty cache loads the zone and allows the member sheet route
    for a member, and redirects for a non member and on a load error.
- `npx nx run-many -t lint test -p velista/feature-zones velista/feature-shell velista/models`
  passes.
- `npx nx build velista` passes.
- One cold load on a slot of `/es/zones/:z/sheet/lists/new` as the owner opens the sheet.

## 1. Not in this plan

- The owner's empty group reading "nothing shared with you" (F2.2). Plan `0158`.
- A pending member's "Not updating live" banner that stays after approval (F2.4) and the
  turned down person's page that does not update (F2.5). Both need the realtime
  `refusedZones` latch cleared on a membership event, a small plan of their own.

## 2. Choices that are mine

- **Load in the guard, not a resolver.** The guard already decides on the zone; a resolver
  would add a second place that reads it.

## What the build decided

- **The not available choice reads the copy table.** `selectGroupState` takes the zone
  error and picks `not-available` when `zoneErrorKey(error, 'zone.read')` answers
  `zone.error.notAvailable`. The mapping of `not_found` and `forbidden` thus lives in
  one place. The error is read only when this zone's own state is `failed`.
- **`ZoneStore` keeps a read error per zone, outside Scope (review fix round).** The
  store's `error` is one slot for every read: `loadZone` and `load` clear it when any
  read starts and set it when any read fails. A realtime `zone created` or membership
  event that reloaded group B thus cleared group A's 404, and A's page flipped to the
  generic block with Try again. A 500 on A followed by a 404 on B made A read as not
  available. `zone-store.ts` now keeps a map beside `_zoneState`, cleared when that
  zone's read starts and set when it fails, and exposes `zoneErrorOf(id)`. The group
  page passes that to `selectGroupState` and to its reference line. `error()` stays
  for its other readers. The shared double in `testing/store-doubles.ts` gains a
  `zoneErrorOf` that answers null, because every page spec built on it now reads one.
- **The page's three top states are three `@if` blocks**, as the template comment says,
  not an `@else if` chain.
- **The block is the page's own `.state` section**, the one the pending state uses: an
  `h2` with the sentence and a `.primary` Home button that navigates forward to `/home`.
  It is not `EmptyState`, which wants a body, and not `ErrorState`, which always draws
  Try again. `group-page.scss` is out of scope and unchanged, so the gap above the
  button is the title's margin.
- **The generic title is `zone.error.loadFailed`**, after `notAvailable` in both files:
  "This group could not be loaded", "No se ha podido cargar este grupo".
- **The guard builds its redirect before the read**, because `inject` works only in the
  synchronous part of a guard. A cached zone, or an empty id, is decided synchronously
  with no request. A rejected load answers the redirect too.
- **A cold sheet load reads the group twice**, once in the guard and once in the page's
  existing load effect. That effect is outside this plan.
- Checked in a browser against the shared Luna slot 4: a cold load of
  `/es/zones/:z/sheet/lists/new` as the owner opens the sheet, and a random group id
  draws the one sentence and Inicio, with no retry and no reference line.
