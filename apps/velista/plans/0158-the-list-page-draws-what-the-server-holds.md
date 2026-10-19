> **PR:** [#751](https://github.com/IchirokuXVI/nx-portfolio/pull/751) stage 1, [#758](https://github.com/IchirokuXVI/nx-portfolio/pull/758) stage 2

# 0158: the list page draws what the server holds

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Five findings of `docs/reports/2026-10-16-velista-e2e-slot1.md` on
> the list page and the group page drawing stale or wrong state: F3.2 (major, the list
> settings sheet on a cold load shows an empty name and the sharing switch off, and a person
> who fixes the name then saves sharing off), F3.3 (major, the product chosen for a line does
> not reach the chooser's own list until a reload), F3.4 (major, comment counts vanish on
> reload; stage 2, needs backend `0214`), F2.2 (major, the owner of a group with no lists
> reads "nothing shared with you"), F4.9 (a list row that arrives live after sharing says
> "List is empty") and F3.5 (the line page chevron says "Back to the group" and goes to the
> list).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0140` (a line takes another product), plan `0146`,
> `libs/velista/feature-lists/src/lib/list-settings-sheet/list-settings-sheet.ts:153`,
> `:184-186`, `:207`, `:218`, `:335-338`, `:400-419`, `:476-480`,
> `libs/velista/feature-catalog/src/lib/catalog-page/catalog-page.ts:853-868`,
> `list-page/list-page.ts:1152-1183`, `:1973`, `libs/velista/data-access/src/lib/lines/line-store.ts:371-420`
> (`load`, `refresh`), `:540-610` (`updateLine`), `:1252-1262`, `:1378-1397` (`_reconcile`),
> `:1525` (`_setLines`), `:1043-1047`, `:1337-1343`, `lists/list-store.ts:182-212`, `:245-250`,
> `realtime/realtime-event-mapper.ts:132-135`, `mapping/mappers.ts:357`,
> `libs/velista/feature-zones/src/lib/select-group-state.ts:115-117`,
> `libs/velista/models/src/lib/list-view.ts:248-254`, `line-page/line-page.html:8`, `:60`,
> and backend `0214`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

The settings sheet shows the list's real values on a cold load. A line patched by this
device keeps its answer when an older read lands after it. A list row that arrives live
carries its counts. The owner of an empty group reads that the group has no lists. The
line page chevron names where it goes. After backend `0214`, the comment badge survives a
reload.

### Context

- **The sheet copies once, in its constructor.** `list-settings-sheet.ts:335-338` sets
  `name`, `autoApprove` and `sharedWithZone` from `this.list()`, a computed over
  `ListStore` (`:184-186`). On a cold load it is undefined and the signals keep `''` and
  `false` (`:153`, `:207`, `:218`). Saving the name sends only `name` (`:476-480`); sharing is
  sent only when the switch is flipped (`:400-418`), so a flip from the wrong start writes
  the wrong value. `autoApprove` has the same start.
- **An older read overwrites a newer patch.** The catalog's "Use this product" calls
  `_pick.use()` and navigates back before any write (`catalog-page.ts:853-868`). The list
  page then runs, in one construction, an answer effect that PATCHes with
  `updateLine(lineId, { itemIds })` (`list-page.ts:1152-1171`) and a load effect that calls
  `LineStore.load` (`:1176-1183`, `:1973`). `updateLine` (`line-store.ts:540-610`) patches
  the row with the answer (`:586`), but `load` and `refresh` (`:371-420`) call `_setLines`
  (`:1525`), which replaces the whole array with no version check and no overlay. A GET
  started before the PATCH committed and answered after it puts the old row back. Events
  carry no origin, and `_reconcile` (`:1252-1262`, `:1378-1397`) has no version comparison
  either, so whichever arrives last wins.
- **The owner's empty reason.** `select-group-state.ts:115-117` returns `'no-access'`
  whenever `memberCount > 1`. An OWNER or ADMIN reads every list
  (`list-access.service.ts:112`), so for staff zero readable means zero lists. The zone
  read has no total (`zone.messages.ts:102-113`), so a plain member keeps the heuristic
  until backend `0214`'s optional `hasLists`.
- **The live list row drops its counts.** `list.updated` carries counts and
  `sharedWithZone` (`list.service.ts:609-610`, `list.mappers.ts:41-58`), and
  `list-store.ts:182-212` keeps `existing` or defaults `lineCount: 0, wantedCount: 0,
  sharedWithZone: false`, copying only the name, creator and `autoApprove`. A member whose
  row was made this way then gets `list.myAccessChanged`, and `_setMyPermissions` skips the
  refresh because the row exists (`:245-250`), so the zeros stay. Check that
  `toShoppingList` (`realtime-event-mapper.ts:132-135`) maps the counts before relying on
  them.
- **The chevron key.** `line-page.html:8` uses `list.header.back` ("Back to the group");
  `back()` goes to `_listUrl()` (`line-page.ts:476-478`). `list.page.toList` ("Back to the
  list") is already used at `line-page.html:60`.
- **The comment count is not on the wire.** `mappers.ts:357` (`toLine`) has no field,
  `line-store.ts:1337-1343` increments only a count it knows, and the doc comments at
  `line-store.ts:1043-1047` and `list-view.ts:248-254` say so. Backend `0214` adds
  `commentCount: number | null` to the lines read and `null` on events.

### Target state

Stage 1, no backend dependency:

1. The settings sheet seeds `name`, `autoApprove` and `sharedWithZone` the first time
   `list()` is defined, through one `effect` guarded by a seeded flag (or `linkedSignal`),
   and never overwrites a typed name after that. Save is disabled until seeded.
2. `load` and `refresh` in `LineStore` merge per line and keep the local line when
   `local.version > incoming.version` or while an overlay claims it. `_reconcile` refuses
   an event whose version is older than the local line.
3. `selectGroupState` answers `'no-lists'` for an OWNER or ADMIN with zero lists whatever
   the member count. The heuristic stays for a plain member.
4. `list-store` takes `lineCount`, `wantedCount` and `sharedWithZone` from `event.list` on
   `list.created` and `list.updated`, keeping only `myPermissions` from the existing row.
5. `line-page.html:8` uses `list.page.toList`.

Stage 2, after backend `0214`:

6. `toLine` maps `commentCount` (null to "unknown"), `load` and `refresh` record a known
   count, and the badge, the detail button and the line page row draw it after a reload.
   The two doc comments are rewritten. If `0214` ships `hasLists`, `selectGroupState` uses
   it for a plain member too.

### Scope

- `libs/velista/feature-lists/src/lib/list-settings-sheet/list-settings-sheet.ts` and its
  spec; `line-page/line-page.html` and `line-page.spec.ts` (an assertion for `toList`
  exists at `:620`).
- `libs/velista/data-access/src/lib/lines/line-store.ts`, `line-store.spec.ts`,
  `lists/list-store.ts`, `list-store.spec.ts`, `mapping/mappers.ts` and its spec,
  `realtime/realtime-event-mapper.ts` if the counts are not mapped.
- `libs/velista/feature-zones/src/lib/select-group-state.ts` and its spec.
- `libs/velista/models/src/lib/list-view.ts` (the doc comment and the count field).
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- Plan `0152` (take the list back when sharing goes off) edits the same sheet and needs
  item 1 first. Build this plan first, or both on one branch with this one's commit first.
- Rule D4: map the new field from `unknown`, and treat an absent field as unknown.
- Build stage 1 and stage 2 as two commits, so stage 1 lands alone if `0214` is late.
- Do not write a signal inside a `computed`. Seed in an `effect` or with `linkedSignal`.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change `LineApi`, the catalog
  page's return navigation, or the backend.
- If a line has no `version` on the wire (check `toLine` and the contract before you rely
  on it), stop and report; the merge rule of item 2 then needs a different key.

### Progress evidence

- New specs, each failing before the change:
  - the sheet built over an empty store, then a store fill: the three fields hold the
    list's values, and a name typed before a second fill is kept;
  - a read that resolves after `updateLine` with an older version keeps the patched line;
  - an OWNER with two members and zero lists reads `no-lists`;
  - a `list.updated` event for an unknown list creates a row with its counts;
  - the chevron's label is `list.page.toList`;
  - stage 2: a lines read with `commentCount: 2` draws the badge after a cold load.
- `npx nx run-many -t lint test -p velista/feature-lists velista/feature-zones velista/data-access velista/models`
  passes.
- `npx nx build velista` passes.
- One walk on a slot: choose a product for a line from the list, land on the list, the
  row shows the product with no reload.

## 1. Not in this plan

- The catalog page's name based `addedToLine` (`catalog-holdings.ts:149-157`), which has the
  same locale fault as F3.1 on the client. Backend `0214` fixes the server merge; a small
  velista follow up should compare by product there too.
- The composer ranking (F3.6). It is the known search strictness issue.

## 2. Choices that are mine

- **Version wins, not arrival order.** Lines carry a version for exactly this, and the
  overlay already marks a line this device is writing.
- **Staff only for the empty reason.** It is the one case the client can answer with
  certainty today.

## What the build decided

- **Stage 1 (items 1 to 5) is in PR #751. Stage 2 (item 6, `commentCount`) is in PR
  #758**, on top of backend `0214` (PR #755).
- **The sheet seeds in one place.** An `effect` hands the list to `_seedFromList` the first
  time `list()` is defined, and a `seeded` signal makes it run once. `canSave` also
  requires `seeded`. Plan `0152` builds on `_seedFromList`.
- **"While an overlay claims it" reads the line's pending write note.** `Mutations` has no
  per record query, and a line has an overlay key for each set of fields, so `_keepsLocal`
  checks that the note `writeNoteOf(lineId)` reads is `pending`. Every write of a line sets that note
  before its request and clears it after. `mutations.ts` is unchanged.
- **The read still decides which lines exist and their order.** Only the row of a line
  that the read names can be kept from the local copy.
- **Counts on a list event are optional.** `toListCounts` returns null when the payload has
  no counts, and the store then keeps the counts it already holds (rule D4). The event
  type in `realtime-events.ts` gained `counts`. That file is outside the Scope above, but
  the mapper cannot hand the counts on without it.
- **The pages after the first are merged too.** The first page replaces the array, and
  that drops every local line past position 100. `load` and `refresh` thus take a
  snapshot of the local lines before the first page lands and hand it to `_loadRest`,
  which merges each later page against it with the same `_keepsLocal` rule. A merge
  against the current store would find nothing for those lines.
- **Stage 2: the count travels on `Line` and lives in the store.** The read reaches
  `LineStore` as mapped lines through `LineApi`. Thus `Line` (in `domain.ts`, outside the
  Scope above) gained an optional `commentCount?: number | null`. Screens still read
  `commentCountOf`. `toLine` takes a whole number from 0 as known, and null, an absent
  field or any other value as unknown.
- **A read records only what it knows.** `_recordReadCounts` runs after each page of
  `load`, `refresh` and `_loadRest`. A count is recorded for a line that the merge took
  from the read and whose count is a number. A line kept from the local copy keeps its
  count, and a read that says null or nothing keeps the count the device has. Events and
  write answers never record a count, so their null erases nothing.
- **A read never lowers a known count.** Posting a comment saves only `line_comments`
  and does not bump the version of the line. A read whose count query ran before a
  comment committed can thus land after the `comment.added` event and answer 2 where the
  event made 3. `_recordReadCounts` records the larger of the known count and the read.
  That is safe because a comment is never deleted on its own (only with its line), and
  velista has no way to delete one, so a count can only grow.
- **`hasLists` is not built.** Backend `0214` did not ship it, so a plain member keeps the
  member count heuristic in `selectGroupState`.
- **The walk needed an intercept.** The shared backend slot ran code from before PR #755,
  so Playwright added the real count to the lines read. After two comments and a reload,
  the row showed the badge "2".
