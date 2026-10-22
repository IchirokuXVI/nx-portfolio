> **PR:** [#757](https://github.com/IchirokuXVI/nx-portfolio/pull/757)

# 0156: a list or line you cannot read says one thing

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Six findings of `docs/reports/2026-10-16-velista-e2e-slot1.md` on
> what a list or line URL draws when the reader may not read it or the id is wrong: F4.3
> (major, the gone block is the raw key `list.gone.unshared`, also for a missing id), F7.6
> (an upper case uuid draws the gone block while every read answers 200), F4.4 and S12
> (sheet URLs of a forbidden list open their sheets over the gone block, one of them an
> editable empty form that fires a 403), F4.5 (the line page and history of a forbidden list
> show a generic error with a Try again that repeats the 403), F7.7 (a real list under a
> group id that does not exist renders read only with wrong copy) and F7.8 (a real line
> opened under another list says it was deleted).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0083` (a deleted line closes its sheets, which replaced the
> two keys), the sheet rule in `CLAUDE.md`, `libs/velista/feature-lists/src/lib/list-page/list-page.html:63-77`,
> `:475`, `list-page.ts:369`, `:499-501`, `:1241-1270`, `:1961-1971`, `:2094-2106`,
> `list-error-copy.ts:59-62`, `:126-151`, `select-list-state.ts:151-152`,
> `libs/velista/models/src/lib/list-view.ts:418`, `:458`, `line-page/line-context.ts:71-85`,
> `line-page.ts:137-151`, `:471-478`, `line-page.html:26-62`, `:288`,
> `libs/velista/feature-shell/src/lib/zone-guards.ts:22`, `:47-55`, `:73-86`, `:191-198`,
> `libs/velista/platform/src/lib/route-params.ts:28-57`, `libs/velista/data-access/src/lib/lines/line-store.ts:271`
> (`errorOf`), `lists/list-store.ts:110`, and `libs/velista/ui/assets/i18n/en.json:914-920`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

A list URL the reader cannot read, or whose id names nothing, draws one translated
sentence and one way back, with no sheet over it. A line URL of such a list draws the same
sentence. A list under the wrong group, and a line under the wrong list, say what they are.
An id typed in upper case lands on the same page as its lower case form.

### Context

- **The raw key is a regression of plan `0083`.** `list-page.html:66-70` renders
  `list.gone.deleted` and `list.gone.unshared`. Commit e0ab54a4a replaced
  `"deleted": "That list was deleted"` and `"unshared": ...` with the three line keys
  (`list.gone` now holds `byOthers`, `unavailable`, `close`, `en.json:914-918`), and the
  template was never updated. `list-page.spec.ts:696` asserts the raw string
  `list.gone.unshared`, and the testing translator echoes keys, so it passed. `_gone`
  (`list-page.ts:369`) is only ever set to `'unshared'` (`:1257` when the list is absent from
  the zone's loaded lists, `:2098` when `listErrorEffect` answers `'gone'`), so the `deleted`
  branch is dead. `listErrorEffect` (`list-error-copy.ts:126-151`) maps `not_found` and
  `forbidden` on `lines.read` to `'gone'` by design (the comment at `:59-62`: a reader cannot
  tell them apart). `list.error.notAvailable` (`en.json:920`) already says the right thing.
- **Ids are compared as typed.** The canMatch guards accept upper case (`UUID` at
  `zone-guards.ts:22` has `/i`), the backend accepts it (`uuid.ts:12-13`, `:41-45`), and the
  comparisons are case sensitive: `list-page.ts:499-501`, `:1252` (which draws the gone
  block), `line-page.ts:137`, `:141`, and `ZoneStore.zoneById` is a map lookup
  (`zone-store.ts:332-334`). Params come raw from `paramSignal` (`route-params.ts:28-57`).
- **The sheet outlets are unconditional.** `sheet()` (`routes.ts:111-119`) adds the segment
  and the fall guard only, `listSheetRoutes()` (`:528-594`) carries no guards on purpose
  (`:521-526`), and the outlets sit outside every state branch (`list-page.html:475`,
  `line-page.html:288` outside the `@switch` at `:26`). A guard cannot answer on a cold
  load because the lines are not read yet.
- **The line page knows only four states.** `linePageStatus` (`line-context.ts:71-85`):
  `loading`, `failed`, `missing`, `ready`. `failed` is `lines.stateOf(listId) === 'failed'`
  with no code; the template draws `list.page.failed` (`line-page.html:46-52`) and
  `retry()` (`line-page.ts:471-473`) reloads the lines. `LineStore.errorOf(listId)` exists
  (`line-store.ts:271`). The history page shares `linePageStatus`. `missing` is "the list is
  read completely and the line is not in it", so a line of another list is "deleted"
  (`line-page.html:55-62`). There is no gateway read of one line outside admin, so the
  client cannot find the line's own list.
- **A real list under a random group.** `_checkStillShared` (`list-page.ts:1961-1971`)
  loads the lists, `ListStore` sets `'failed'` (`list-store.ts:110`), the gone effect bails at
  `:1248` because the state is not `loaded`, the lines answer 200 and the page renders with
  permissions `[]` (`:521`), the read only banner and "not live" (`:544-546`).

### Target state

1. The gone block draws `list.error.notAvailable` with "Back to the group". The dead
   `deleted` branch and `ListGoneReason` are removed, or the two keys are restored in both
   locales with a reason that is actually set. Either way `list-page.spec.ts:696` asserts a
   key that exists, and a new spec walks every `rokuT` literal of the list page templates
   and asserts each exists in `en.json` and `es.json`.
2. `zoneIdGuard`, `listIdGuard` and `basketIdGuard` return a `UrlTree` with the segment
   lower cased whenever it matches the pattern and is not lower case. One URL per resource,
   and every store key stays lower case.
3. The list page's outlet is inside the ready and loading branches, never drawn while the
   state is gone or error. The line page's outlet is drawn only while `status()` is
   `ready`. When `_gone` becomes non null while a sheet URL is open, the page replaces the
   URL with the page URL (`replaceUrl`), so the address matches what is drawn.
4. `linePageStatus` gains `gone`, used when `listErrorEffect(lines.errorOf(listId),
   'lines.read')` answers `'gone'`. The line page and the history page draw the not
   available sentence with "Back to the group" and no Try again.
5. The list page, when the zone read fails with `not_found` or `forbidden`, draws the group
   not available block of plan `0157` (or, until `0157` lands, the list not available
   sentence) and never the lines.
6. `missing` on the line page reads "That line is no longer in this list" (the string at
   `en.json:1828` exists under another namespace, reuse its words) with "Back to the list",
   and the detail sheet does the same, because a line of another list cannot be told from a
   deleted one without a backend read.

### Scope

- `libs/velista/feature-lists/src/lib/list-page/list-page.html`, `list-page.ts`,
  `list-page.spec.ts`; `select-list-state.ts` and its spec if the gone kind changes.
- `libs/velista/models/src/lib/list-view.ts` (`:418`, `:458`).
- `line-page/line-context.ts` and a new `line-context.spec.ts` beside it; `line-page.ts`,
  `line-page.html`, `line-page.spec.ts`, `line-sheets.spec.ts`;
  `line-history-page/line-history-page.ts`, `.html`, `line-history-page.spec.ts`.
- `libs/velista/feature-shell/src/lib/zone-guards.ts` and `zone-guards.spec.ts` (the three
  canMatch guards only; `requireRole` belongs to `0157`).
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- A 403 and a 404 on a list keep one sentence (`list-error-copy.ts:59-62`). Do not tell a
  reader which lists exist.
- No new guard on the sheet routes. The page owns the decision, because only the page
  knows after the read.
- `0157` edits `requireRole` in the same file. Keep the diff of `zone-guards.ts` to the
  canMatch guards so the two PRs merge cleanly.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you add a gateway read for one line or
  change `listErrorEffect`'s mapping.
- If the template key walk of item 1 finds other missing keys in `feature-lists`, fix the
  ones in this plan's templates and list the rest in "What the build decided".

### Progress evidence

- New specs, each failing before the change:
  - a 403 on the lines read draws the not available sentence and no raw key;
  - every `rokuT` literal in the list page templates exists in both locale files;
  - `listIdGuard` on an upper case id returns a tree with the lower case id;
  - a sheet URL over a gone list draws no sheet, and the URL is replaced;
  - the line page on a 403 draws `gone` with a back control and no retry;
  - a line id absent from a loaded list draws the "no longer in this list" sentence.
- `npx nx run-many -t lint test -p velista/feature-lists velista/feature-shell velista/models`
  passes.
- `npx nx build velista` passes.

## 1. Not in this plan

- The group page's not available block and the cold load of the group guards. Plan `0157`.
- A redirect from a line to its own list. It needs a gateway read of one line.
- The styled 404 with a way home (S31). After plan `0150`.

## 2. Choices that are mine

- **One sentence for 403 and 404, and no `deleted` branch.** The reason was never set, and
  the copy rule already says the reader cannot tell.
- **The page hides the outlet rather than a guard refusing the sheet.** The guard has no
  answer on a cold load.
- **A canonical redirect for case.** Lower casing inside `paramSignal` would leave the
  address bar and the last list storage with whatever was typed.

## 3. What the build decided

- **No `deleted` branch.** `ListGoneReason` is removed, and the gone state is
  `{ kind: 'gone' }`. `selectListState` takes `gone: boolean`.
- **Item 6 changes the words of `list.gone.unavailable`** and adds no key. It now reads
  "That line is no longer in this list" (es: "Esa línea ya no está en esta lista"). The
  line page, the history page and every line sheet's notice (`line-gone.ts`, outside this
  plan's scope) already draw that key, so the detail sheet says the same thing without an
  edit to its code. A spec reads both locale files to assert the words, because the
  testing translator echoes keys.
- **The case redirect lower cases every id in the URL** in one `UrlTree`, not only the
  guard's own segment. A link with two upper case ids thus lands in one hop. The tree is
  built from `Router.currentNavigation().extractedUrl`. When no navigation exists, the
  guard lets the id through. A line id is lower cased only when a zone, list or basket id
  in the same URL triggers the redirect, because there is no line id guard.
- **The sheet URL is replaced from an effect on the gone state.** When the page's route
  has a child, the effect calls `navigate(['.'], { relativeTo, replaceUrl: true })`. The
  outlet is drawn only while loading or loaded. So a list whose lines failed for another
  reason (the error state) draws no sheet either. Its URL is left as it is.
- **Item 5 uses the list not available sentence**, because plan 0157 was not on `dev`. Only
  an uncached group whose read failed counts: `ZoneStore` keeps a cached group `loaded`
  after a failed refetch. The mapping is `listErrorEffect(zones.error(), 'lines.read')`,
  reused unchanged.
- **The template key walk** covers `list-page.html`, `line-page.html` and
  `line-history-page.html`. It reads the templates and both locale files from disk at test
  time. A one-off static scan of every template in `feature-lists` found no other missing
  key. Two comments in `data-access` (`list-store.ts:243`, `list-store.spec.ts:247`)
  named the old `gone: 'unshared'` state. The review round changed each to `gone`.
- **The line page draws its outlet while the line is `ready` or `missing`** (review
  round). The first build drew it only while `ready`. A `line.deleted` from another user
  removes the line, the status turns `missing`, and an open sheet then vanished: its
  `list.gone.byOthers` notice (plan 0083) was never drawn, unsaved rename text was lost
  and the address stayed on the sheet URL. The outlet is now hidden only for `gone`,
  `failed` and `loading`, so a sheet URL of a line the reader cannot read still opens
  nothing. A spec under a real router opens the delete sheet, deletes the line by others,
  and asserts the sheet and its notice stay.
- **The list page reads the group's answer again on a move to another list** (review
  round). The `listId` effect resets the gone state, and the group read runs only when
  the zone id changes. A second list under the same refused group thus drew read only.
  The `listId` effect now calls `_afterZoneRead(zoneId)` after its reset.
