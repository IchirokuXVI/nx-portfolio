> **PR:** [#395](https://github.com/IchirokuXVI/nx-portfolio/pull/395)

# 0030 Run presets

> Backend half: `apps/luna-shopper-backend/plans/0120`.
>
> A Mercadona run with ten walked warehouses, their copies, and a details choice is a long form. The
> harvester can now save a run request as a named preset per chain and start a run from it. This
> plan gives presets a screen: list them, create and edit them with the same form a run uses, start
> one, and save the form of a run being prepared as a new preset.

## Brief for the agent

### Objective

Add a presets screen to the harvest section, extract the run request form from `RunsPage` into a
component both screens use, add "Save as preset" to the runs page, and show and filter runs by
preset, as sections 2 to 6 describe. Use the `nx-portfolio-angular-developer` skill for the Angular
work and `design-taste-frontend` for the new screen.

### Context

- `RunsPage` (`libs/luna-shopper-admin/feature-harvest/src/lib/runs-page.ts`) holds the run form
  and the runs list in one component. After admin plan 0029 the form also carries copies, writes
  and details. `_input()` builds `Wire.SpawnHarvestRunDto`.
- Harvest screens are registered in `feature-harvest/src/lib/routes.ts`: `harvestRoutes()` (:50)
  and `HARVEST_LINKS` (:89). The section table is `apps/luna-shopper-admin/src/app/sections.ts`.
  `routes.spec.ts`, `shell-sections.spec.ts` and `app.routes.spec.ts` guard them.
- The harvest data access is `libs/luna-shopper-admin/data-access/src/lib/harvest/`:
  `harvest-service.ts`, `harvest-api.ts`, `harvest-memory.ts`, `harvest-seed.ts`.
- After backend plan 0120 the gateway answers `GET/POST /v1/admin/harvest/presets`,
  `GET/PUT/DELETE /v1/admin/harvest/presets/:id` and `POST /v1/admin/harvest/presets/:id/runs`.
  `HarvestRunPresetView` carries `id`, `supermarketId`, `name`, `input`, `createdAt`, `updatedAt`
  and `lastRun`. `HarvestRunView` carries `presetId`, and the runs list accepts `presetId`.
- A duplicate name answers 409. A preset naming a deleted scope refuses to start with a validation
  error naming the scope and the preset.
- Translations: `libs/luna-shopper-admin/ui/assets/i18n/en.json`, `harvest.nav.*` at :432 and
  `harvest.runs.*` at :560.

### Target state

Every acceptance criterion in section 8 holds and `nx affected -t lint test` is green for the
touched projects.

### Scope

- Work only in: `libs/luna-shopper-admin/feature-harvest/src/lib/` (a new run request form
  component, `runs-page.ts`, a new presets page, `routes.ts`, their specs),
  `libs/luna-shopper-admin/data-access/src/lib/harvest/`, `en.json`, and the app's section and route
  specs if a new link changes what they assert.
- Do NOT touch: the wire types by hand, any backend code, the sources page.

### Constraints

- The extraction does not change what the runs page sends. Every existing `runs-page.spec.ts` case
  stays green, moved to the new component's spec where it tests the form.
- The memory back end models presets well enough for the screen specs, including the duplicate
  name conflict.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask before adding a dependency, and if the extraction needs a change to the request the
  runs page sends.

### Progress evidence

Report after the data access with its memory fake, after the form extraction with the moved specs
green, after the presets page, and after the runs page changes.

## 1. What changes for the operator

- **Harvest, Presets**: a list per chain of saved runs, each with its mode, a short summary, and
  its latest run's status and time. Each row has Start, Edit and Delete.
- **New preset** and **Edit**: the run form, with a name field above it and Save instead of Start.
- **Runs**: the run form gains "Save as preset", which asks for a name and saves the form as it is.
  The runs list shows the preset a run came from and filters by it.

## 2. The run request form

`RunRequestForm` (`lib-run-request-form`) is the form half of `RunsPage`, moved:

- **Inputs**: `value: Wire.SpawnHarvestRunDto | null` to start from, `submitLabel`.
- **Outputs**: `submitted` with the built request, and `changed` with the request whenever it
  changes, for "Save as preset".
- It keeps its own chain choice, adapter read, scope read, copies editor, writes and details.
- When given a `value`, it loads that chain's adapter and scopes, then applies the request's fields,
  in that order, so a preset's walked scopes and copies appear ticked and filled.
- **A saved scope that no longer exists** shows as a chip with its raw id and a warning ("This scope
  no longer exists. Remove it to save.") and blocks submit. That is the form's half of backend plan
  0120's refusal.

`RunsPage` renders the form with `submitLabel` "Start run" and calls the spawn on `submitted`, as
it does today.

## 3. The presets page

`PresetsPage` at route `presets`, linked in `HARVEST_LINKS` after Runs, label key
`harvest.nav.presets` ("Presets").

- **Chain picker** at the top, as on the runs page. The list shows that chain's presets, paged with
  the house cursor, ordered by name.
- **Row**: name, mode, a summary built from `input` (for a scope list walk, "4 warehouses, 37
  copies"; for details, "new products only" or "every product"), and the latest run as a status
  badge and time, linking to that run.
- **Start**: calls `POST presets/:id/runs`. On success it goes to the runs page with the new run
  highlighted. A 409 for an active run and a validation refusal are shown on the row, with the
  server's message.
- **Edit**: opens the form with the preset's input, a name field above it, and Save. A 409 on name
  shows under the name field.
- **Delete**: confirms ("Runs started from this preset keep their record."), then deletes.
- **New preset**: the same form, empty, with the chain preselected from the picker.

A preset's `input` has no `supermarketId`. The page adds the preset's chain when it hands `input`
to the form, and strips it again when it saves.

## 4. Save as preset

On the runs page, beside Start, "Save as preset" opens a small dialog with a name field. Saving
calls `POST presets` with the form's current request. On success the dialog closes and a notice
links to the new preset. A 409 shows under the name field.

It is disabled while the form is not ready to start, since the server validates a preset exactly
as a spawn.

## 5. The runs list

- A run with `presetId` shows the preset's name, resolved through the presets list for the chain
  and cached for the screen. A preset that no longer exists shows "Deleted preset".
- A filter by preset, a select of the chain's presets, sends `presetId`.

## 6. The data access

`HarvestService` gains `listPresets(supermarketId, cursor?)`, `readPreset(id)`,
`createPreset(supermarketId, name, input)`, `updatePreset(id, { name?, input? })`,
`deletePreset(id)` and `startPreset(id)`. `harvest-api.ts` maps them to the routes of backend plan
0120 and maps every answer from `unknown` (rule D4). `harvest-memory.ts` stores presets, refuses a
duplicate name in any case with the same error shape the API answers, and records `presetId` on a
run started from one. `harvest-seed.ts` gains one Mercadona preset with two walked warehouses and
copies, so the screen has something to show.

## 7. Tests

- **Form extraction**: the moved cases pass against `RunRequestForm`. A form given a `value` shows
  its walked scopes, copies, writes and details. A saved scope that is gone blocks submit with the
  warning.
- **Presets page**: lists a chain's presets with summary and latest run. Start calls the route and
  navigates. A refusal shows on the row. Edit saves the changed input. A duplicate name shows under
  the field. Delete confirms, then removes the row.
- **Runs page**: "Save as preset" sends the form's request and the name. A run from a preset shows
  its name, and a deleted preset shows "Deleted preset". The preset filter sends `presetId`.
- **Routes**: `routes.spec.ts` knows the new route and link.
- **Memory**: the duplicate name refusal and `presetId` on a started run.

## 8. Acceptance criteria

- [ ] Presets are listed per chain with a summary and their latest run.
- [ ] A preset is created and edited with the same form a run is started with.
- [ ] A run starts from a preset in one click, and a refusal is shown on the row.
- [ ] The runs page can save its form as a preset.
- [ ] The runs list shows and filters by preset.
- [ ] Extracting the form changed no request the runs page sends.

## 9. Verification

```sh
npx nx test luna-shopper-admin/feature-harvest
npx nx test luna-shopper-admin/data-access
npx nx test luna-shopper-admin
npx nx affected -t lint test
```
