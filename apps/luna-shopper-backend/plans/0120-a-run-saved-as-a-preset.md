# 0120: a run saved as a preset

> Admin half: `apps/luna-shopper-admin/plans/0030`.
>
> A Mercadona run that walks ten warehouses and copies each onto its group (plan 0118), with
> details for new products only (plan 0119), is a long form to fill in every week and an easy one
> to get wrong. This plan saves a run's request under a name, validates it as a spawn is validated,
> and starts a run from it with one call. The run copies the preset when it starts, so editing a
> preset never rewrites what an old run did. A preset is also what a future schedule will point at.
>
> Prerequisite reading: `0118` and `0119` (the fields a preset carries), `harvest-run.service.ts`
> (`spawn`, `validate`), `harvest-run.store.ts`, `harvest-run.entity.ts`, the gateway's
> `harvest.controller.ts`, and backlog `0001` section 7.6 (the scheduler this prepares for).

## Brief for the agent

### Objective

Add a `harvest_run_presets` table to the harvester, create, read, update and delete routes for it,
and a route that starts a run from a preset, with the run recording the preset it came from, as
sections 2 to 8 describe.

### Context

- `HarvestRunService.spawn` (`harvest-run.service.ts:154`) checks the admin, checks
  `harvestEnabled`, loads the source, calls `validate` (:411), and creates the run with the
  validated payload in `harvest_runs.input`. One active run per chain is a partial unique index,
  `uq_harvest_run_active`, and a conflict answers `ConflictException` naming the active run.
- `validate` answers the payload a run stores. It reads the chain's scopes from catalog to check
  `priceScopeIds`, and after plans 0118 and 0119 it also checks `scopeCopies`, `writes` and
  `details`.
- `SpawnHarvestRunRequest` (`harvest.messages.ts:734`) and `SpawnHarvestRunDto`
  (`gateway/src/app/harvest/harvest.dto.ts:59`) carry the fields a preset saves.
- `harvest_runs` has no reference to how a run was started beyond `trigger` (`MANUAL`) and
  `requestedByUserId`.
- The harvester's latest migration is `1757100000000-AutoImportPlaces.ts`. Migrations are listed
  in `harvester/src/app/db/migrations/index.ts` and checked by `migrations.spec.ts`.
- Errors come from `libs/luna-shopper/platform/src/lib/errors/domain-exception.ts`:
  `ValidationException`, `ConflictException`, `NotFoundException`.

### Target state

Every acceptance criterion in section 11 holds, integration specs cover sections 3 to 7, and
`openapi.json` and the wire types are regenerated.

### Scope

- Work only in: `apps/luna-shopper-backend/harvester/src/app/` (a new entity, a migration, a preset
  service, the harvest controller, `harvest-run.service.ts`, `harvest-run.store.ts`, the run
  entity and view), `apps/luna-shopper-backend/gateway/src/app/harvest/` (a controller and DTOs),
  `libs/luna-shopper/contracts` (patterns, requests, views, schemas), their specs, and the generated
  files.
- Do NOT touch: the executor, the runners, the sink, catalog, and any scheduling. A schedule is not
  part of this plan.

### Constraints

- A preset and a spawn are validated by the **same** function. Extract what `spawn` checks about
  the request from what it checks about the moment (harvesting enabled, a run already active), and
  call the first half from both.
- The migration is additive.
- Regenerate `openapi.json` and the wire types, never by hand.

### Action boundaries

- Proceed with in-scope edits, specs, the migration file and generators.
- Stop and ask before running the migration anywhere but a throwaway slot, and if extracting the
  validation changes any existing spawn refusal's message or code.

### Progress evidence

Report after the entity, migration and validation extraction with specs, after the CRUD routes with
their integration spec, and after starting a run from a preset.

## 1. What is being built

| Piece                                    | Where                                               |
| ---------------------------------------- | --------------------------------------------------- |
| `harvest_run_presets`                    | a harvester entity and migration                    |
| `validateRequest` shared by both         | `harvest-run.service.ts`                            |
| Create, list, read, update, delete       | a preset service, NATS patterns, gateway routes     |
| Start a run from a preset                | `HarvestRunService.spawnFromPreset`, a gateway route |
| `presetId` on a run                      | `harvest_runs`, `HarvestRunView`, the runs list filter |

## 2. The table

`harvest_run_presets`, extending the harvester's `BaseEntity`:

| Column              | Type            | Notes                                                    |
| ------------------- | --------------- | -------------------------------------------------------- |
| `supermarketId`     | `uuid`          | not null, indexed                                        |
| `name`              | `varchar(80)`   | not null                                                 |
| `input`             | `jsonb`         | the validated request, section 3                         |
| `createdByUserId`   | `uuid`          | not null                                                 |
| `updatedByUserId`   | `uuid`          | not null                                                 |

A unique index on `("supermarketId", lower("name"))`, so a chain cannot hold two presets whose
names differ only in case. A duplicate answers `ConflictException` naming the existing preset.

**Every preset belongs to a chain.** An OpenStreetMap store discovery with no chain is not a
preset, and a `FILE_IMPORT` is not either, because it needs a document uploaded at the time.

## 3. What a preset holds

`input` is the request a spawn receives, less the credential and less `supermarketId`, which is the
column:

```ts
type HarvestRunPresetInput = Omit<SpawnHarvestRunRequest, keyof AdminCredential | 'supermarketId'>;
```

So it carries `mode`, `priceScopeId`, `priceScopeIds`, `scopeCopies`, `writes`, `details`,
`detailBackfill`, `postalCodes`, `postalCode`, `country`, `radiusMetres` and `brandKeys`, each only
when stated. `mode: FILE_IMPORT` is refused.

**What is stored is the validated payload**, with the defaults of plan 0119 resolved. A preset that
saved `details: NEW` keeps saying `NEW` if the default ever changes.

## 4. Validation

`validate` is split:

- `validateRequest(req, source)` checks everything about the request: the mode, the chain, the
  scopes and their bands, the copies, `writes`, `details`, the postal codes. It reads catalog for
  the chain's scopes, as today.
- `spawn` keeps the checks about the moment: `harvestEnabled`, a disabled source, and the active
  run conflict.

**Saving a preset calls `validateRequest`.** A preset that saves is a run that can start, as long
as nothing changed in between.

**Starting a run from a preset calls `validateRequest` again.** A scope the preset names can be
deleted after the preset is saved. That is a `ValidationException` naming the scope and the preset,
not a warning, and no run is created. Silently dropping a target is worse for a saved run than for
a typed one, because nobody is looking at the form when it happens.

## 5. The routes

NATS patterns in `HARVEST_PRESET_PATTERNS`:

| Pattern                  | Request                                           | Answer                        |
| ------------------------ | ------------------------------------------------- | ----------------------------- |
| `harvestPreset.list`     | `supermarketId?`, `cursor?`, `limit?`             | a page of `HarvestRunPresetView` |
| `harvestPreset.get`      | `presetId`                                        | `HarvestRunPresetView`        |
| `harvestPreset.create`   | `supermarketId`, `name`, `input`                  | `HarvestRunPresetView`        |
| `harvestPreset.update`   | `presetId`, `name?`, `input?`                     | `HarvestRunPresetView`        |
| `harvestPreset.delete`   | `presetId`                                        | nothing                       |
| `harvest.spawnFromPreset`| `presetId`                                        | `HarvestRunView`              |

Every request extends `AdminCredential`. `update` replaces `input` whole when it is given, and
validates the result. The chain of a preset never changes.

Gateway, in a new `AdminHarvestPresetsController`:

| Route                                         | Pattern                   |
| --------------------------------------------- | ------------------------- |
| `GET /v1/admin/harvest/presets`               | `harvestPreset.list`      |
| `POST /v1/admin/harvest/presets`              | `harvestPreset.create`    |
| `GET /v1/admin/harvest/presets/:id`           | `harvestPreset.get`       |
| `PUT /v1/admin/harvest/presets/:id`           | `harvestPreset.update`    |
| `DELETE /v1/admin/harvest/presets/:id`        | `harvestPreset.delete`    |
| `POST /v1/admin/harvest/presets/:id/runs`     | `harvest.spawnFromPreset` |

**Starting a run from a preset is its own route, not a `presetId` on the spawn DTO.** A spawn that
names a preset and also a scope has to decide which one wins, and a route that takes nothing
but the id cannot be asked.

The list is paged with the house cursor and ordered by `name`.

## 6. The view

```ts
interface HarvestRunPresetView {
  id: string;
  supermarketId: string;
  name: string;
  input: HarvestRunPresetInput;
  createdAt: string;
  updatedAt: string;
  /** The latest run started from this preset, for the list. */
  lastRun: { id: string; status: HarvestRunStatus; requestedAt: string } | null;
}
```

`lastRun` is one query over `harvest_runs` by `presetId`, with an index on that column (section 7).

## 7. A run remembers its preset

`harvest_runs` gains `presetId uuid null`, indexed, **with no foreign key**. Deleting a preset
leaves its runs as they were, and a run still says it came from a preset that is gone. The run's
`input` is a copy taken at spawn, so what the run did is never read back from the preset.

`HarvestRunView` gains `presetId`, and the runs list accepts `presetId` as a filter.

`trigger` stays `MANUAL`. A person started it, and `trigger` is where a schedule will one day say
otherwise.

## 8. What this plan does not do

- **No schedule.** Backlog 0001 section 7.6 is still unbuilt. When it is, a schedule names a preset
  and this plan's `spawnFromPreset` is what it calls.
- No sharing of presets between chains, and no preset for a chainless discovery.
- No preset versioning. A run's `input` is the history.

## 9. Errors

| Case                                          | Exception             |
| --------------------------------------------- | --------------------- |
| a name already used in the chain, any case    | `ConflictException`   |
| an unknown preset id                          | `NotFoundException`   |
| any `validateRequest` refusal, save or start  | `ValidationException` |
| `mode: FILE_IMPORT`                           | `ValidationException` |
| starting while the chain has an active run    | `ConflictException`, as a spawn |

## 10. Tests

- **Validation extraction**: every existing spawn refusal still answers the same code and message
  (the existing `harvest-run.service.spec.ts` cases pass unchanged).
- **Preset service**: create validates and stores the resolved input, a duplicate name in another
  case is refused, update revalidates, delete removes the row and leaves runs untouched.
- **Start**: a run from a preset has the preset's input and `presetId`. A preset naming a deleted
  scope refuses with the scope and preset named, and creates no run. An active run conflicts.
- **Migration**: the table, the case insensitive unique index, and `harvest_runs.presetId` with its
  index.
- **Gateway**: each route reaches its pattern, and `openapi-document.spec.ts` passes after
  regeneration.
- **Integration**: create a preset, start two runs from it, and read `lastRun` as the second.

## 11. Acceptance criteria

- [ ] A preset is saved only if its input passes the same validation as a spawn.
- [ ] Starting a run from a preset validates again and refuses a scope that is gone.
- [ ] The run stores a copy of the preset's input and the preset's id.
- [ ] Editing or deleting a preset does not change any run.
- [ ] Names are unique per chain regardless of case.
- [ ] The list shows each preset's latest run.
- [ ] No existing spawn refusal changes.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## 12. Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx test luna-shopper-backend-gateway
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx affected -t lint test
```
