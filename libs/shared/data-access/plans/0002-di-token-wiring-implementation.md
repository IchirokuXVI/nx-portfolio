# Data access DI token wiring — implementation plan

> Concrete, step by step implementation of the fix described in
> `0001-data-access-di-token-wiring.md`. That file is the brief (why and where);
> this file is the how. The 11 flagged sites carry `TODO(di-wiring)` comments that
> point back to `0001`; remove those comments as each site is migrated.

## Goal

Replace every direct injection of a concrete data access implementation
(`*Memory` / `*Api` / `*Mock`) with injection of an `InjectionToken` typed against
the service interface (`*ServiceI`). Providers pick the implementation by
environment, so the portfolio demo keeps running in memory while a real backend can
be swapped in without touching a single consumer.

## Current shape (verified)

- Interfaces are named `*ServiceI` and live in the service file, for example
  `libs/odontogram/data-access/src/lib/odontogram/odontogram-service.ts` exports
  `OdontogramServiceI`.
- Implementations sit next to the interface (`odontogram-memory.ts`,
  `odontogram-api.ts`) and are re-exported from each scope's barrel
  (`@portfolio/<scope>/data-access`).
- Consumers do `inject(OdontogramMemory)` directly (see
  `libs/odontogram/feature-full-odontogram-crud/.../feature-full-odontogram-crud.ts`).
- Environment values already come from `libs/shared/environments`
  (`environment` object, swapped at build time via `fileReplacements`).

## Step 1 — shared token helper

Add a small helper to `libs/shared/data-access` so every scope declares tokens and
providers the same way. Export it from that lib's barrel.

- `defineServiceToken<T>(description: string): InjectionToken<T>` — thin wrapper over
  `new InjectionToken<T>(description)` for a consistent description convention.
- `provideService<T>(token, memoryImpl, apiImpl)` — returns a `Provider` that selects
  the implementation from the environment. Start with a single switch: use the API
  implementation when a real backend is configured (a `BACK_API_DOMAIN` is set in
  `environment`), otherwise the in-memory implementation. Implement with
  `{ provide: token, useClass: <chosen> }` (or `useExisting` when the concrete class
  is already provided elsewhere).

Keep the selection logic in one place so a future "force API in staging" toggle is a
one line change.

## Step 2 — declare one token per service

For each service interface, add an `InjectionToken<XServiceI>` next to the interface
and export it from the scope barrel. Proposed names:

| Scope          | Interface              | Token                     |
| -------------- | ---------------------- | ------------------------- |
| odontogram     | `OdontogramServiceI`   | `ODONTOGRAM_SERVICE`      |
| odontogram     | `ToothTreatmentServiceI` | `TOOTH_TREATMENT_SERVICE` |
| odontogram     | `TreatmentServiceI`    | `TREATMENT_SERVICE`       |
| damoclesSword  | `ProjectServiceI`      | `DS_PROJECT_SERVICE`      |
| damoclesSword  | `NewsServiceI`         | `NEWS_SERVICE`            |
| damoclesSword  | `AssetServiceI`        | `ASSET_SERVICE`           |
| damoclesSword  | `ContactServiceI`      | `CONTACT_SERVICE`         |
| landing / v2   | `ProjectServiceI`      | `LANDING_PROJECT_SERVICE` |
| landing-v2     | `InfoFactServiceI`     | `INFO_FACT_SERVICE`       |

Adjust names to whatever interfaces actually exist per scope; confirm each `*ServiceI`
before adding a token. Where an interface does not yet exist (some `*Mock`/`*Memory`
may be untyped), define it first from the concrete class's public surface.

## Step 3 — provide tokens by environment

Provide each token where the consuming feature is bootstrapped, not globally, so a
remote stays self contained:

- Odontogram tokens: in `feature-full-odontogram-crud` route providers (and wherever
  `tooth-treatments-modal` is reached).
- damoclesSword tokens: in the damoclesSword feature-shell / remote-entry providers.
- landing and landing-v2 tokens: in each wrapper's route providers.

Use the Step 1 `provideService(...)` helper for every entry so the environment switch
is uniform. Odontogram is the best first target: it already has a complete
`OdontogramApi`, so wiring `ODONTOGRAM_SERVICE` proves the memory-vs-API switch end to
end before the other scopes (which are memory-only today) follow the same shape.

## Step 4 — migrate consumers (the 11 flagged sites)

Change each `inject(ConcreteClass)` to `inject(TOKEN)` and update the field type to the
interface. Delete the `TODO(di-wiring)` comment at each site as it is migrated.

Consumer components:

1. `libs/odontogram/feature-full-odontogram-crud/.../feature-full-odontogram-crud.ts`
   — `TreatmentMemory`, `ToothTreatmentMemory`, `OdontogramMemory`
2. `libs/odontogram/ui/src/lib/tooth-treatments-modal/tooth-treatments-modal.ts`
   — `ToothTreatmentMemory`, `OdontogramMemory`
3. `libs/landing-v2/feature-shell/.../landing-v2-wrapper.ts` — `ProjectMemory`, `InfoFactMemory`
4. `libs/landing-v2/feature-project/.../project-page.ts` — `ProjectMemory`
5. `libs/landing/feature-shell/.../landing-wrapper.ts` — `ProjectMemory`
6. `libs/damoclesSword/ui/src/lib/section-projects/section-projects.ts` — `ProjectMemory`
7. `libs/damoclesSword/ui/src/lib/section-news/section-news.ts` — `NewsMemory`
8. `libs/damoclesSword/ui/src/lib/trailer-video/trailer-video.ts` — `AssetMemory`
9. `libs/damoclesSword/ui/src/lib/contact-form/contact-form.ts` — `ContactMock`
   (already typed `ContactServiceI`; still needs a real endpoint behind the token)

Data-access internal composition (do last, once the helper exists):

10. `libs/damoclesSword/data-access/src/lib/project/project-memory.ts` — injects `AssetMemory`
11. `libs/damoclesSword/data-access/src/lib/news/news-memory.ts` — injects `AssetMemory`

For 10 and 11, inject `ASSET_SERVICE` instead of `AssetMemory`, and make sure the token
is provided wherever these memory services are provided.

## Step 5 — tests

Specs intentionally inject concrete implementations and stay as is. Where a migrated
consumer's spec constructs the component through Angular DI, add a
`{ provide: TOKEN, useClass: <Memory impl> }` to that spec's providers so the token
resolves. Run `npx nx affected -t test lint build` and keep everything green.

## Step 6 — cleanup

- Confirm no `TODO(di-wiring)` comments remain: `grep -rn "TODO(di-wiring)" libs`.
- Update `0001-data-access-di-token-wiring.md` (or add a closing note) marking the work
  done, or delete it once this plan is fully executed.

## Suggested order

odontogram (proves memory↔API switch) → damoclesSword UI consumers → landing /
landing-v2 wrappers → damoclesSword data-access internal (`project-memory`,
`news-memory`). One scope per commit keeps the diff reviewable.
