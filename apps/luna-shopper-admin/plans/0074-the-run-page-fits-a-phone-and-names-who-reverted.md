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
> plan `0073` on the branch `docs/harvester-walk-keeps-decisions-plans` of PR #980, admin plan
> `0041` (frame and tokens), `libs/luna-shopper-admin/feature-harvest/src/lib/run-page.ts` and
> `runs-page.ts`, `libs/luna-shopper-admin/ui/src/lib/page/page-header.ts`,
> `libs/luna-shopper-admin/ui/src/lib/harvest/run-progress.ts` and
> `libs/luna-shopper-admin/feature-people/src/lib/admins.ts`.
>
> Mock: none (open question O1).

## Brief for the agent

### Objective

On the run page at 390 px, show the status and the revert of a run in full words. Show the
phase of a run only while it runs. Name the admin who reverted a run instead of the uuid. Make
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
  finished runs showed no phase. `isTerminalRun` (`models/src/lib/harvest/harvest-run.ts`,
  near line 33) answers whether a run has finished. The runs list draws the same component
  (`runs-page.ts`, near line 200).
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
2. A run whose status is terminal shows no phase, on the run page and in the runs list. A run
   that is not terminal shows it as today.
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

- `run-progress.spec.ts`: a `COMPLETED`, `FAILED`, `ABORTED` and `STALE` run with a
  `stageLabel` draws no phase. A `RUNNING` and a `PENDING` run draw it.
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
- [ ] No finished run shows a phase. A running run does.
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

**C1 (builder choice, for the owner):** on a phone the run page moves its chips out of the
header into the first line of the overview, and the shared header rule stays. The other
answer, to let chips take their full width on every page, changes the header of the whole
back office for one page.

**C2 (builder choice, for the owner):** the phase is hidden in the admin app for a terminal
run, and the harvester keeps writing what it writes. The other answer, to clear `stage` and
`stageLabel` in the harvester when a run ends, is a backend change and loses the last phase of
a failed run, which tells a person where it stopped.

**C3 (builder choice, for the owner):** the name comes from `GET /v1/admin/admins`, which
exists. The other answer, a `revertedByName` on the run view, needs the harvester to ask auth
for a name it does not hold, a gateway DTO, and a regenerated `openapi.json` and
`wire-types.ts`.

**C4 (builder choice, for the owner):** a table keeps its columns and scrolls, with a shadow on
the side that has more. The other answer, a table that turns into a list of rows on a phone, is
more work and changes the four tables of PR #972.

## Open questions

**O1 (owner):** no mock. Screenshots at both widths in the PR stand in for one, as for admin
plan `0071` (its D3). Is that enough here?

**O2 (owner):** should C2 apply to a `FAILED` run too? Its last phase says where it stopped.
This plan hides it with every other terminal status, and the error line above it stays.
