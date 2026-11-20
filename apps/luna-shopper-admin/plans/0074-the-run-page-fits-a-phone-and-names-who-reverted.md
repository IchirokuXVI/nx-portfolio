> **PR:** [#1014](https://github.com/IchirokuXVI/nx-portfolio/pull/1014), [#1039](https://github.com/IchirokuXVI/nx-portfolio/pull/1039) (a run's own request and the narrowing rule), [#1040](https://github.com/IchirokuXVI/nx-portfolio/pull/1040) (the estimate reads only a whole walk), [#1043](https://github.com/IchirokuXVI/nx-portfolio/pull/1043) (a run states its import window, its walk config digest and its adapter), [#1047](https://github.com/IchirokuXVI/nx-portfolio/pull/1047) (no estimate across adapters or configs, no note once ended), [#1050](https://github.com/IchirokuXVI/nx-portfolio/pull/1050) (a store discovery stores the adapter that walked it)

# 0074: the run page fits a phone and names who reverted a run

> Four findings from the screenshots of PR #972 (admin plan `0071`), taken on 2026-11-11 at
> 1360 px and 390 px against the memory back end. The owner put them in a later plan. Checked
> against `origin/dev` and the branch `feat/admin-0071-run-warnings-have-words` of PR #972 on
> 2026-11-16.
>
> | Finding | On `origin/dev` | On the branch of PR #972 |
> | --- | --- | --- |
> | C. At 390 px the two status chips of the run header read "COMPLE..." and "REVER..." on the seeded run `run-catalog-reverted`. | Yes. The chips and the rule that cuts them are on `dev`. | Yes, unchanged. |
> | D. A completed and reverted run shows the phase "Fetching products" over its progress bar. | Yes. | Yes, unchanged. |
> | E. "Reverted by" shows a uuid and not a name. | Yes, on the run page and in the hover of the runs list. | Yes, unchanged. |
> | F. At 390 px a report table scrolls inside its own box, nothing shows that it scrolls, and its last column is cut mid word. | Not as such. The one report table of `dev`, the copies table, has no scroll box at all. Its width at 390 px was not measured. | Yes. PR #972 adds the box (`.scroll`) around its three new tables, and not around the copies table. |
>
> Prerequisite reading: admin plan `0071` on the branch of PR #972, admin plan `0072`, admin
> plan `0073` (written in PR #980, merged into `dev` on 2026-11-16, not built), admin plan
> `0041` (frame and tokens), `libs/luna-shopper-admin/feature-harvest/src/lib/run-page.ts` and
> `runs-page.ts`, `libs/luna-shopper-admin/ui/src/lib/page/page-header.ts`,
> `libs/luna-shopper-admin/ui/src/lib/harvest/run-progress.ts` and
> `libs/luna-shopper-admin/feature-people/src/lib/admins.ts`.
>
> Mock: none (D2). Screenshots at 1360 px and 390 px are the proof.

## Brief for the agent

### Objective

On the run page at 390 px, show the status and the revert of a run in full words. Hide the
phase of a run that completed or was reverted, and keep it on a run that stopped short. Name
the admin who reverted a run instead of the uuid. Make
every report table show that it scrolls, with no word cut in half. Follow the "Angular
conventions" section of `CLAUDE.md`, and load the `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-layoutmobile` skills.

### Context

- **C, the chips.** The run page projects `run.status` and, for a reverted run, the chip
  `harvest.run.reverted.chip` ("Reverted") into `lib-page-header` as `pageChip` elements
  (`run-page.ts` on `dev`, near lines 85 to 115). The header holds a rule that a chip never
  wraps and ends in an ellipsis (`page-header.ts`, near lines 330 to 337). On a phone
  (`compact`, read from the viewport service) the chips together take at most 40% of the row
  (near lines 340 to 345), and the title keeps at least 5.5rem. A long title and two chips
  cut both chips. Every page of the back office uses this header.
- **D, the phase.** `RunProgressView` (`ui/src/lib/harvest/run-progress.ts`, near lines 52 and
  167) draws `run.stageLabel` whenever it is set, in every status. The harvester writes
  `stage` and `stageLabel` while a run works (`harvest-run.store.ts`, near lines 427 to 445)
  and never clears them when the run ends. A finished run on a real cluster thus keeps its
  last phase too, not only the seed. The seed has `stageLabel: 'Fetching products'` on
  `run-catalog-reverted` and on `run-catalog-completed`, and null on `run-catalog-failed` and
  `run-import-completed` (`data-access/src/lib/harvest/harvest-seed.ts`), which is why two
  finished runs showed no phase. The run status enum (`HarvestRunStatus`,
  `contracts/src/lib/enums/harvest.enums.ts`, near line 113) has six values: `PENDING`,
  `RUNNING`, `COMPLETED`, `FAILED`, `ABORTED` and `STALE`. The last four are terminal
  (`TERMINAL_RUN_STATUSES`, `models/src/lib/harvest/harvest-run.ts`, near line 25).
  **Reverted is not a status.** It is `revertedAt` on a terminal run, read by `isReverted`
  (same file, near line 127), and `canRevert` allows a revert of any terminal run of a mode
  that writes prices, so a `FAILED`, `ABORTED` or `STALE` run can be reverted too. The runs
  list draws the same component (`runs-page.ts`, near line 200).
- **E, the name.** The wire view of a run carries `revertedByUserId` and no name
  (`wire-types.ts`, near line 4842). The harvester stores the id the gateway passes, which is
  `admin.adminId` (`gateway/src/app/admin/admin-credential.ts`, near line 21). The gateway
  already answers `GET /v1/admin/admins` with `{ admins }`, each `{ adminId, username,
  displayName, lastLoginAt, disabledAt }` (`admin-auth.AdminIdentityView` in `openapi.json`),
  behind the same guard as every admin route. The People section reads it through
  `ADMINS_SOURCE` (`feature-people/src/lib/admins.ts`, near line 112), with a memory seed.
  The run page writes the fact `revertedBy` from the uuid (`run-page.ts`, near line 818), and
  the runs list puts the uuid in a hover (`runs-page.ts`, near line 804). **So the name needs
  no gateway change**: the admin app can read it from the route it already has.
- **F, the tables.** On the branch of PR #972 the report section draws four tables with the
  class `copies`: the copies, the DEZA sections, the El Jamón categories and the size
  examples. The last three sit in `<div class="scroll">`, which is `overflow-x: auto` and
  nothing else (the branch's `run-page.ts`, near lines 812 to 817). A box that scrolls on a
  phone shows no scroll bar until it is touched, so the cut at its edge reads as a broken
  table.

### Target state

1. At 390 px on `run-catalog-reverted`, the status and the revert read in full words, and the
   header is no taller than on any other page (section 1).
2. A `COMPLETED` run and a reverted run, whatever its status, show no phase, on the run page
   and in the runs list. Every other run shows it as today (the table of section 1b).
3. "Reverted by" names the admin: `displayName`, else `username`. An id the list does not hold
   reads as the words of section 4, never as the uuid alone. The runs list hover says the same.
4. Every table of the report section sits in one scroll box that shows when more is to its
   side, and no cell breaks a word (section 3).

### Scope

- `feature-harvest`: `run-page.ts`, `run-page.spec.ts`, `runs-page.ts`, `runs-page.spec.ts`.
- `ui`: `run-progress.ts` and its spec. `page-header.ts` only if choice C1 is overruled.
- `data-access`: a reader of the admin names for the harvest pages, over
  `ADMIN_ADMINS_PATH`, with its memory twin and seed (section 2). `harvest-seed.ts` only to
  give `revertedByUserId` an admin of the seed.
- `libs/luna-shopper-admin/ui/assets/i18n/en.json`: the copy of section 4.
- No gateway, no backend, no new route, no `openapi.json` or `wire-types.ts` change.

### Constraints

- The header rule of `page-header.ts` is shared by every page. Do not change it for one page
  (choice C1).
- Read the admins answer from `unknown` (rule D4) and draw nothing it does not hold.
- No dash as punctuation in any copy.
- The scroll cue is CSS only, with no script and no scroll listener.
- This plan changes no cell content of a table, only its box and its wrapping. The warnings
  table keeps the rule of PR #972: the bold name of a warning is hidden for `LISTING_UNREAD`
  and `LISTING_SHORT` only, and drawn for every other code. Nothing here hides or draws a
  name on another rule.
- Run `npx nx build luna-shopper-admin`. The PR checks never build the admin app.

### Action boundaries

- Build after PR #972 merges, and after admin plan `0073` (section 5). Cut from `dev` then.
- Stop and ask before you add a gateway field, a route or a screen, or change `page-header.ts`.

### Progress evidence

The spec output, `npx nx build luna-shopper-admin`, and screenshots at 1360 px and 390 px of
`run-catalog-reverted`, of `run-catalog-running`, and of one DEZA run of the seed of PR #972
with its sections table scrolled to the start and to the end. At 390 px use a viewport as tall
as the page, because a full page capture draws the fixed tab bar mid page.

## 1. C: the status in full words

On a phone, the run page draws no chip in the header. It draws the same two facts as the first
line of the overview tab, above the progress bar: the status chip and, for a reverted run, the
"Reverted" chip, in the same classes and tones as today. At 1360 px nothing moves: the chips
stay in the header (choice C1).

The line is part of the page and not of the header, so it may wrap, and it costs one line on a
screen that has room below the header. The scheduled chip of admin plan `0067` moves with the
other two, so the three stay together.

## 1b. D: which run shows its phase

`RunProgressView` draws `run.stageLabel` by one predicate in `run-progress.ts`: hide it when
the run is `COMPLETED` or `isReverted(run)` is true, and draw it otherwise when it is set. The
run page and the runs list both draw that component, so both follow.

| Status | Not reverted | Reverted | Whose rule |
| --- | --- | --- | --- |
| `PENDING` | phase, as today | cannot happen (`canRevert` needs a terminal run) | today |
| `RUNNING` | phase, as today | cannot happen | today |
| `COMPLETED` | no phase | no phase | the owner (D1) |
| `FAILED` | the phase it died in | no phase | the owner (D1) |
| `ABORTED` | the phase it was stopped in | no phase | builder choice C5 |
| `STALE` | the phase its heartbeat stopped in | no phase | builder choice C5 |

The error line of a `FAILED` run stays above the phase, as today. A reverted run of any status
hides the phase, because its writes are taken back and the phase it reached no longer says
anything about the data.

## 2. E: the reader of admin names

One small reader in `data-access`, provided with the harvest data access providers: it asks
`GET /v1/admin/admins` once per page load, keeps the answer in a signal, and answers
`nameOf(adminId)`: `displayName` when it is a non empty string, else `username`, else null.
It reads the answer from `unknown`. A failed request answers null for every id and is not
retried while the page lives. The memory twin answers from the admins seed of
`feature-people`, or from a seed of its own if the import would cross a feature library
(`CLAUDE.md` forbids it).

The run page asks for the name only when `revertedByUserId` is set. The runs list asks once
for the page, not once per row.

## 3. F: a table that shows it scrolls

- The copies table moves into the same `.scroll` box as the other three.
- The box shows a shadow on each side that has more to show, with the
  `background-attachment: local, scroll` technique on the box. The shadow uses the border
  token of plan `0041`, never a new color.
- A header cell does not wrap. A body cell wraps between words only: no `overflow-wrap:
  anywhere` on a table cell. A number cell does not wrap. The address list of PR #972
  (`.addresses`) is not a table and keeps its rule.
- At 1360 px no table scrolls, and the box draws no shadow.

## 4. Copy

| Key | English |
| --- | --- |
| `harvest.run.revertedByUnknown` | An admin no longer listed |

The fact label `harvest.run.fact.revertedBy` ("Reverted by") stays. The uuid is still in the
hover of the name, so a person who needs the id finds it.

## 5. Shared files and build order

| File | Admin `0071` (PR #972) | Admin `0073` | Admin `0072` | This plan |
| --- | --- | --- | --- | --- |
| `run-page.ts`, `run-page.spec.ts` | report fields, the `.scroll` box | entry links in the examples table | | C, E, F |
| `runs-page.ts`, its spec | | | | E |
| `harvest-seed.ts` | three seeded runs | one example | two seeded doubts | one admin id |
| `en.json` | warning and report copy | link copy | doubt copy | section 4 |
| `entries-queue-page.ts`, its spec | | entry address | doubt chip | |
| `harvest-memory.ts` | | `entryId` filter | doubts | |
| `run-progress.ts` (`ui`) | | | | D |

**Order:** PR #972 (admin `0071`), then admin `0073`, then admin `0072`, then this plan. This
plan shares `run-page.ts` with `0071` and `0073` and only the seed and `en.json` with `0072`,
so it may also build before `0072` if the owner wants the phone fixes first. Each plan cuts
from `dev` after the one before it merges.

## Tests

- `run-progress.spec.ts`, each with a `stageLabel`: a `COMPLETED` run draws no phase. A
  reverted `COMPLETED`, `FAILED`, `ABORTED` and `STALE` run draws no phase. A `FAILED`,
  `ABORTED` and `STALE` run that is not reverted draws it. A `RUNNING` and a `PENDING` run
  draw it.
- `run-page.spec.ts`: with the viewport compact, the chips are in the overview line and not in
  the header. With it wide, they are in the header.
- `run-page.spec.ts`: "Reverted by" reads the seed admin's `displayName`, the `username` when
  the display name is null, and the copy of section 4 for an id the list does not hold.
- `runs-page.spec.ts`: the hover of a reverted row names the admin.
- The reader's spec: an answer with no `admins` array, a row with no `adminId`, and a failed
  request each answer null and do not throw.
- `run-page.spec.ts`: every report table is inside a `.scroll` box.

## Acceptance criteria

- [ ] At 390 px on `run-catalog-reverted`, "Completed" and "Reverted" read in full.
- [ ] The header of the run page is as tall as on any other page, at both widths.
- [ ] A completed run and a reverted run show no phase. A running run and a failed, aborted or
      stale run that is not reverted show it.
- [ ] "Reverted by" names an admin, and never shows only a uuid.
- [ ] Every report table shows that it scrolls at 390 px and breaks no word.
- [ ] No gateway, backend, `openapi.json` or `wire-types.ts` change.
- [ ] `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.

## Verification

```sh
npx nx test luna-shopper-admin/ui
npx nx test luna-shopper-admin/data-access
npx nx test luna-shopper-admin/feature-harvest
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

## Decisions

All four builder choices were accepted by the owner on 2026-11-16, with C2 narrowed by his
answer to O2.

**C1 (owner, accepted 2026-11-16):** on a phone the run page moves its chips out of the header
into the first line of the overview tab, and the shared header rule stays. The other answer,
to let chips take their full width on every page, changes the header of the whole back office
for one page.

**C2 and D1 (owner, answered 2026-11-16, was C2 and O2):** the phase is hidden in the admin app
for `COMPLETED` runs and reverted runs only. A `FAILED` run keeps the phase it died in, because
it tells a person where it stopped. The harvester keeps writing what it writes: clearing
`stage` and `stageLabel` there is a backend change and would lose that phase. Section 1b holds
the table.

**C3 (owner, accepted 2026-11-16):** the name comes from `GET /v1/admin/admins`, which exists.
The other answer, a `revertedByName` on the run view, needs the harvester to ask auth for a
name it does not hold, a gateway DTO, and a regenerated `openapi.json` and `wire-types.ts`.

**C4 (owner, accepted 2026-11-16):** a table keeps its columns and scrolls, with a shadow on
the side that has more. The other answer, a table that turns into a list of rows on a phone, is
more work and changes the four tables of PR #972.

**D2 (owner, answered 2026-11-16, was O1):** no mock. Screenshots at 1360 px and 390 px in the
PR are the proof, as for admin plan `0071` (its D3).

**C5 (builder choice, for the owner):** the owner's answer names `COMPLETED`, reverted and
`FAILED`. It does not name `ABORTED` and `STALE`. Both keep their phase when they are not
reverted, as `FAILED` does: an aborted run stopped where a person stopped it, and a stale run
stopped where its process died, and in both the phase says where that was. A reverted one of
either hides it, as every reverted run does.

## Open questions

None. C5 stands unless the owner overrules it.

## Notes of 2026-11-20 (owner decisions of the harvester round)

These notes record what the owner decided since about the estimate on the run page ("N
processed of about M", PRs #1028 and #1036) and the run view it reads. They change nothing in
the sections above.

- **A run's view carries its own request (owner decision 114a, PR #1039).** `HarvestRunView`
  has `input`, on the single read, on every row of the run list and on the dashboard's runs.
  It is what `harvest_runs.input` stored, in the shape of a preset's input
  (`readRunInput`, `apps/luna-shopper-backend/harvester/src/app/harvest/run-input.ts`), never
  the preset's current input. It is a record of what ran. Never send it back as a run request
  and never save it as a preset, because it states resolved values that the spawn refuses for
  some chains. It is null when the stored input cannot be read: not an object, a mode this
  build does not know, or a field of the wrong type.
- **One rule says whether a request is narrowed (owner decision 114a, PR #1039).**
  `isNarrowedRunRequest` and `isNarrowedRun` live in
  `libs/luna-shopper/contracts/src/lib/messages/run-narrowing.ts`, behind the alias
  `@portfolio/luna-shopper/contracts/run-narrowing`, which the browser build can import. The
  back office calls them and does not restate the rule. A null or absent request counts as
  narrowed, and so does a mode the rule does not know.

  | Mode                | Narrowed when                                            |
  | ------------------- | -------------------------------------------------------- |
  | `CATALOG_DISCOVERY` | `detailBackfill: true`, or `priceScopeIds` names an id   |
  | `STORE_DISCOVERY`   | `postalCodes` names a code, or `postalCode` is not blank |
  | `FILE_IMPORT`       | never                                                    |

- **The sources list takes only a page query (owner decision 119b, PR #1039).**
  `GET /v1/admin/harvest/sources` binds `PageQueryDto`. The run filters it used to accept and
  ignore are now refused with 400.
- **The chain and mode answer only for a whole walk (owner decision 112b, PR #1040).** The
  estimate reads the runs of the run's own preset first. It reads the completed runs of the same
  chain and mode only when the run's own request is not narrowed, and from those it takes only a
  run whose request is not narrowed either (`EarlierRunTotals`,
  `libs/luna-shopper-admin/data-access/src/lib/harvest/earlier-run-totals.ts`). A narrowed run
  with no preset thus shows no estimate. Since PR #1047, both reads also pass over a run that
  walked under another configuration (owner decision 130b), and no read is made at all for a
  run whose adapter's walk total cannot be compared (owner decision 127b). Both are below.
- **A completed run with no total shows its count alone (owner decision 120b, PR #1040).** The
  note that the run does not know yet how much work it has is not drawn for a `COMPLETED` run
  (`unsizedNote`, `libs/luna-shopper-admin/ui/src/lib/harvest/run-progress.ts`). Owner decision
  131b (PR #1047) widened this: only a run that is still going keeps the note. A failed,
  aborted or stale run no longer does.
- **A failed reread keeps the number shown (owner decision 121b, PR #1040).** When a reread of
  the earlier total fails twice, the number from the earlier read stays. A reread that succeeds
  and finds no reference clears it.
- **A file import's record states its source kind and window (owner decision 129b, PR
  #1043).** The run view's `input` is now a `HarvestRunInputRecord`: a preset's input plus
  `sourceKind`, `validFrom` and `validUntil`, read off a `FILE_IMPORT` run (`readRunInput`,
  `apps/luna-shopper-backend/harvester/src/app/harvest/run-input.ts`). The window is ISO 8601
  instants as the spawn resolved them, not the local days a spawn request takes. Each added
  field is absent on a run of another mode. A preset is still `HarvestRunPresetInput` and cannot
  carry them.
- **A run stores the configuration and the adapter it walked under (owner decisions 130b and
  127b, PR #1043).** The spawn (`HarvestRunService.start`) stores two values from the source row
  the run names. `configFingerprint` is a sha256, hex, over the canonical JSON (keys sorted at
  every depth) of the row's `adapterKey` and `config` (`walkConfigFingerprint`,
  `apps/luna-shopper-backend/harvester/src/app/harvest/walk-fingerprint.ts`). The rate fields
  and `enabled` are not in it. `adapterKey` is the row's adapter. Migration
  `RunWalkConfig1760720000000` adds both as nullable columns of `harvest_runs`, with no
  backfill. The run view states both. Since PR #1050, a store discovery and a file import store
  what `runWalkConfig` gives (owner decision 137b, below).
- **One rule compares two configurations (owner decision 130b, PR #1043).**
  `walkedUnderSameConfig` in `@portfolio/luna-shopper/contracts/run-narrowing` is true only when
  both fingerprints are non empty strings and equal.
- **An adapter says whether its walk total can be compared (owner decision 127b, PR #1043).**
  `AdapterCapabilities.comparableWalkTotal` is false for `deza-web`, whose capped queries can
  count different totals for one assortment, and false for an adapter the build does not know.
  It is true for every other adapter.
- **No estimate for a walk total that cannot be compared (owner decision 127b, PR #1047).**
  `hasComparableWalkTotal` (`libs/luna-shopper-admin/models/src/lib/harvest/harvest-run.ts`)
  reads the run's own `adapterKey` through the capability table. It is false for `deza-web`,
  for a null or absent adapter and for an unknown one. For such a run `runProgress` draws no
  estimate whatever total it is handed, and `wantsEarlierTotal` is false, so no reference is
  read, on the preset read or on the chain and mode read.
- **A reference ran under the same configuration (owner decision 130b, PR #1047).** On the
  preset read and on the chain and mode read, `EarlierRunTotals` passes over an earlier run
  whose `configFingerprint` does not match this run's (`walkedUnderSameConfigAs`). A run with
  no fingerprint of its own makes no read.
- **The unsized note is drawn only for a run still going (owner decision 131b, PR #1047).**
  `unsizedNote` is true only while `isTerminalRun` is false, the rule polling stops on: a
  pending or running run. A completed, failed, aborted or stale run with no total and no
  estimate shows its count alone.
- **Decisions that keep what is built.** No code changed for these.
  - 126a: a Mercadona or DIA walk always counts as narrowed, because its request must name
    price scopes.
  - 128a: the paged routes document no parameters in the OpenAPI document.
  - 132a: the seeded running store discovery of the memory back end stays.
  - 133a, recorded on backend plan `0268`, and 134a, recorded on backend plan `0251`.
  - 135a: `comparableWalkTotal` stays true for `osm-places` and `manual`.
  - 138a: the run page draws a Carrefour category past the paging ceiling as its
    `LISTING_TRUNCATED` warning (backend plan `0251`, PR #1051), and it does not draw the
    report's `truncatedCategories` list.
- **Known effects of PRs #1043 and #1047.**
  - After the deploy, no estimate shows for a chain until one new run of it completes, because
    older runs have no fingerprint.
  - A DEZA run never shows an estimate.
  - A run with no source row (a file import, an OpenStreetMap store discovery) stores no
    fingerprint and no adapter, so it never shows an estimate. This is open owner decision 137.
    PR #1050 changed this for a store discovery (owner decision 137b, below). A file import
    still stores neither.
  - A run that the postal code queue starts stores neither value either, because that worker
    calls the run store directly (`postal-code-discovery.worker.ts`). It shows no estimate.
    PR #1050 changed this: the queue now stores both, by the same rule as the spawn.
  - The reference search reads only the newest 5 completed, unreverted runs of each read
    (`REFERENCE_PAGE`). A matching run older than those is not found.
- **A store discovery stores the adapter that walked it (owner decision 137b, PR #1050).** One
  function, `runWalkConfig`
  (`apps/luna-shopper-backend/harvester/src/app/harvest/walk-fingerprint.ts`), decides the
  `adapterKey` and `configFingerprint` of a run. The spawn (`HarvestRunService.start`) and the
  postal code queue (`PostalCodeDiscoveryWorker`) both call it. A file import stores neither.
  A store discovery of a chain whose adapter lists its own shops stores the chain row's values.
  Every other store discovery is walked by OpenStreetMap and stores `osm-places` with the
  fingerprint of an empty config. Every other run stores its source row's values, as before.
  - **It restores no estimate on any real path.** A review found this, and the owner knew it
    when he chose to merge. A store discovery with no chain cannot be saved as a preset
    (`harvest-run-preset.service.ts` refuses it: "A store discovery around a postal code
    belongs to no chain, so it cannot be saved as a preset."). Such a run has no chain for the
    chain and mode read. Its centre always makes its request narrowed. Its value is that the
    stored adapter is the one that walked.
  - **A latent hazard.** Every OpenStreetMap run shares one fingerprint, whatever its centre or
    radius. If presets for OpenStreetMap store discoveries are ever allowed, the centre and
    radius must first enter the fingerprint or the reference rule.
