> **PR:** [#979](https://github.com/IchirokuXVI/nx-portfolio/pull/979)

# 0189: the search field sits at the top of a list

> Decided on 2026-11-10 and 2026-11-11. On the zone list page and on the shopping list page the
> composer's field (the page's one search since velista `0117`) moves from the foot of the
> screen to the top, so a person's own lines are the first thing they see when they type. The
> progress bar goes from both pages. The zone list loses its "Por comprar" heading and its
> "Ponerlas en orden" action, and ordering rows by hand goes with them. The bottom bar is never
> hidden while typing. The first touch or pen drag of the page's column takes the focus off
> the field, so the keyboard goes, and the words and the results stay.
>
> Amends velista `0117` (rule F3, the bar hides while typing, and target 3, the tools row hides
> while results show), velista `0106` (the composer dock is the item after the column; it is
> now the item before it), velista `0060` and `0132` section 4 (the two progress bars), and the
> reorder mode of velista `0012` (rule L4), `0082` section 7 and `0088` section 7. Needs PRs
> #959, #960 and #961 merged into `dev`, because every anchor below is on that code. Needs no
> backend plan and changes no wire shape. Velista `0185` changes the same composer; either
> can be built first (section 6).
>
> The mock the owner approved on 2026-11-11: `apps/velista/plans/mocks/stepper/index.html`,
> group "Search at the top" (strips `strip-searchtop-1440.png`, frames `frame-searchtop-*.png`
> in its `shots`). The same mock draws the steppers of velista `0188`; ignore them here.
>
> Prerequisite reading: velista `0117` (whole), `0106` (the app is a column whose last item is
> the bar), `0109` (`?search=1` and back), `0038` section 5 (the voice strip), `0185` sections
> 0 E and 5 (the refusal sentence on the composer), `0088` section 7 and `0082` section 7 (what
> the reorder mode was), `0132` sections 3 and 4 (the basket's total and its bar), and
> "Going back never leaves the app" in `CLAUDE.md`.
>
> Code anchors, all on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
>
> - Zone list page, `libs/velista/feature-lists/src/lib/list-page/list-page.ts`: `reordering`
>   `:419`, `_column` `:503`, `_added` `:513`, `reordering:` passed into the two selectors at
>   `:600` and `:859`, `dueSection` excludes reorder at `:870` to `:880`, `canReorder`,
>   `_reorderable` and `_heldByLive` `:964` to `:1007`, `reorderHeld` `:1015`, `_chrome`
>   `:1035`, `searchOpen` `:1046`, `typing` `:1055`, `_fieldFocused` and `onFieldFocused`
>   `:1079` to `:1085`, `_hideChrome` `:1087` to `:1094`, `_resultsHeading` `:1097`,
>   `_scrollToResults` `:1103` to `:1130`, `holdFocus` `:1196` to `:1203`, the add follow
>   effect `:1588` to `:1605`, the linked row scroll `:1642` to `:1648`, `setComposing(false)`
>   on destroy `:1658` to `:1659`, `_scrollToNewest` `:1684` to `:1703`, `back()` ends the
>   mode `:1710` to `:1715`, `openLine` refuses in the mode `:1734`, `moveUp` and `moveDown`
>   in `act` `:1824` to `:1828`, `_added` bumps `:1879` and `:1969`, `_markTook` `:2080` to
>   `:2108`, `startReorder` and `endReorder` `:2386` to `:2400`, `_move`, `moveTo` and
>   `_reorder` `:2565` to `:2633`, `rowInView` `:2715` to `:2726`, the `ToBuyHeading`
>   import `:132` and `:238`, the class comment "Reorder is a mode" `:210` to `:215`.
> - `list-page.html`: the header comment `:14` to `:15`, the filter's condition `:30` to `:32`,
>   the settings' condition `:49`, `lib-list-header` in the column `:94` to `:96`, the results
>   `:170` to `:240` with `#resultsHeading` at `:189`, `lib-to-buy-heading` `:278` to `:290`,
>   the due label `h3` `:313` to `:317`, the reorder bindings on `lib-line-list` `:358` and
>   `:364`, `!reordering()` `:369`, "Done" `:409` to `:413`, the dock and its comments `:417`
>   to `:513` (`!reordering()` at `:427`, `(fieldFocused)` at `:500`), the add choice popover
>   `:519` to `:539`.
> - `list-page.scss`: `:host` `:3` to `:12`, `.page` `:14` to `:22`, `.composer-dock` and
>   `lib-line-composer` `:33` to `:53`, `.voice-strip` `:55` to `:91`, `.reorder-done` `:252`
>   to `:258`, `.results` `:260` to `:269`.
> - `libs/velista/ui/src/lib/list/list-header.html:11` to `:68` (the progress comment, the
>   count line with the cost, the bar), `list-header.ts:26` to `:31` and `:43` to `:68`
>   (`percent`), `list-header.scss:14` to `:67`.
> - `libs/velista/ui/src/lib/list/to-buy-heading.{ts,scss,spec.ts}`, exported at
>   `libs/velista/ui/src/index.ts:90`.
> - Shopping list page, `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.html`:
>   `main#column` `:70`, the typing branch `:241` to `:327`, `lib-list-tools` `:358` to `:469`
>   with `lib-basket-total-bar` at `:461` to `:468`, the no prices note `:477` to `:484`, the
>   dock `:709` to `:743` (`(fieldFocused)` at `:734`), `lib-list-picker` `:753` to `:762`.
>   `basket-page.ts`: `setComposing(false)` on destroy `:1096`, `_chrome` `:1755`,
>   `_fieldFocused`, `onFieldFocused` and `_hideChrome` `:1807` to `:1822`, `_column` `:1824`,
>   `_scrollToResults` `:1829` to `:1856`, `holdFocus` `:1923` to `:1930`. `basket-page.scss`:
>   `:host` and `.page` `:1` to `:39`, `.composer-dock` `:41` to `:56`, `lib-list-tools`
>   `:137` to `:159`, `.chips, .total-bar` `:161` to `:164`.
> - `libs/velista/ui/src/lib/list/list-tools.scss:1` to `:17` (sticky host), `list-tools.ts:39`
>   and `:49` (`tools-bar`).
> - `libs/velista/ui/src/lib/basket/basket-total-bar.{ts,spec.ts}` (keys `basket.total.barLabel`,
>   `barLabelExact`, `boughtEnd`, `leftEnd` at `basket-total-bar.ts:34` to `:75`).
> - `libs/velista/platform/src/lib/nav-chrome.ts:53` to `:56` (reason 4), `:83`, `:106` to
>   `:117`, `:146` to `:152`; its spec `nav-chrome.spec.ts:114` to `:130`.
> - `libs/velista/ui/src/lib/list/line-composer.ts:261` to `:265` (`fieldFocused`), `:302`
>   (`_field`); `line-composer.html:81` and `:82`; `line-composer.scss:1` to `:15`.
> - `libs/velista/ui/src/lib/list/anchored-popover.ts:31` to `:73` and `:136` to `:153`
>   (`side`, above first by default); `list-picker.ts:80` to `:88`.
> - `libs/velista/platform/src/lib/tour/tour-stops.ts:115` to `:126` (the voice stop on
>   `list-composer`, `placement: 'above'`).
> - The reorder chain: `libs/velista/ui/src/lib/list/line-list.ts:70` to `:71`, `:96`, `:117`,
>   `:169` to `:175`, the drag `:177` to `:340`; `line-row.ts:27`, `:44` to `:56`, `:129`,
>   `:139`, `:145` to `:151`, `:193` to `:196`, `:228`, `:395`, `:425` to `:440`;
>   `line-row.html:10` to `:70`, `:78`, `:85` to `:90`, `:264` to `:266`; `line-row.scss`
>   (`.reordering`, `.grip`); `libs/velista/ui/src/lib/icons/icons.ts:639` to `:652`
>   (`GripIcon`); `libs/velista/models/src/lib/compose-list-groups.ts:46`, `:163` to `:200`,
>   `:288` to `:320` (`reorderWithinSlots`); `compose-list-view.ts:200` to `:212`
>   (`listViewHoldsReorder`); `libs/velista/data-access/src/lib/lists/list-view-store.ts:236`
>   to `:239` (`holdsReorder`); `libs/velista/feature-lists/src/lib/select-list-state.ts:80`,
>   `:189` to `:193`, `:339` to `:351`; `libs/velista/models/src/lib/list-view.ts:453` to
>   `:457` (`canReorder`); `libs/velista/data-access/src/lib/lines/line-service.ts:279` to
>   `:286`, `line-api.ts:409` to `:420`, `line-memory.ts:888`, `line-store.ts:1296` to
>   `:1315`; `libs/velista/data-access/src/lib/testing/store-doubles.ts:842` and `:1355`;
>   `libs/velista/models/src/lib/requests.ts:278` (`ReorderLinesRequest`);
>   `libs/velista/feature-lists/src/lib/list-error-copy.ts:24`, `:37`, `:78` to `:79`, `:123`,
>   `:144`.
> - Kept on purpose: `line.reordered` handled at `line-store.ts:1621`, `list-store.ts:283`,
>   `zone-store.ts:939`, typed at `realtime-events.ts:215` and `:412`; the gateway route
>   `apps/luna-shopper-backend/gateway/src/app/lists/list.controller.ts:499`; the order
>   `'list'` of `libs/velista/models/src/lib/compose-list-view.ts:19` to `:20`.
> - `apps/velista/src/index.html:7` to `:16` (`interactive-widget=resizes-content`);
>   `libs/velista/ui/src/lib/layout/app-layout.scss:121` to `:127` (`100svh`) and `:228` to
>   `:234` (`.nav-room`); `libs/velista/ui/src/lib/styles/_semantic.scss:501` to `:509` (the
>   bar's bottom padding).
> - Copy: `libs/velista/ui/assets/i18n/en.json` and `es.json`: `list.header.pending`, `done`,
>   `cost`, `costExact`; `list.trips.toBuy`; `list.reorder.*` (nine keys); `list.line.movedTo`;
>   `basket.total.barLabel`, `barLabelExact`, `boughtEnd`, `leftEnd`.
>
> Read "Angular conventions" in `CLAUDE.md` before any code. Load `design-taste-frontend` and
> `antislop` before the template, the styles or the copy.

## Brief for the agent

### Objective

On the zone list page and the shopping list page, put the composer's field directly under the
page's head block and keep it there while the column scrolls; remove both progress bars;
remove "Por comprar", "Ponerlas en orden" and the reorder mode from the zone list; stop hiding
the bottom bar while typing; and make the first touch or pen drag of the column take the focus
off the field while the words and the results stay.

### Context

- One component, `LineComposer`, serves both pages. Each page draws it in a `.composer-dock`
  that is the item after its scrolling column (`main#column`, the `.page` class), so the field
  sits directly above the bar (velista `0106`).
- While the field has focus or holds words, each page calls `NavChrome.setComposing(true)`
  (`_hideChrome`), and `NavChrome.reserved` then drops the bar and its room. Nothing else in
  the app calls `setComposing` (a search of `libs/velista` outside specs finds the two pages
  only).
- The results show while the field **holds words** (`typing()` reads the words), and the open
  state lives in `?search=1`. Focus plays no part in either, so a field that loses focus keeps
  its words, its results and its history entry. `holdFocus` cancels `mousedown` on the results
  so a tap in them never takes the keyboard down (rule T2 of velista `0101`).
- The zone list's head block is `lib-list-header` ("en Casa", the count line with the cost,
  the bar, the viewers, the stale band), today the first item in the column. The shopping
  list's head block is `lib-list-tools` (faces, the count sentence, the total, the filter, the
  chips, the total bar), sticky inside the column and hidden while results show.
- `rowInView` looks for `.composer-dock` inside the column, but the dock is outside it, so the
  lookup has never found anything and the foot is always the column's own bottom.
- The reorder mode is a page flag (`reordering`), a header action (`ToBuyHeading`), a grip and
  a drag on each row (`LineRow`, `LineList`), a selector input (`compose-list-groups`,
  `select-list-state`), a hold (`listViewHoldsReorder`) and one write (`LineStore.reorder`, the
  route `POST /v1/lists/:id/lines/reorder`). The realtime event `line.reordered` is how the
  other open screens heard a reorder.
- The e2e suites touch none of this: no step in `apps/velista-luna-e2e` or `apps/velista-e2e`
  names the reorder mode, "To buy", the zone list's progress or the basket's total bar. The
  basket's count sentence (`.tools-bar .progress`, `shop.spec.ts:102`, `:228`,
  `sync.spec.ts:99`) stays.

### Target state

1. **Zone list.** A pinned block between `lib-page-header` and the column holds
   `lib-list-header` ("en Casa", the viewers, the stale band; no count line, no cost, no bar)
   and under it the dock: the field, then the voice strip. The column starts with the dropped
   notices and the page notices, then the results or the list. No "Por comprar" heading, no
   "Ponerlas en orden", no reorder mode, no grip.
2. **Shopping list.** A pinned block between `lib-page-header` and the column holds
   `lib-list-tools` (faces, count, total, filter, chips; no bar) and under it the dock. The
   tools block stays while typing.
3. **The bar stays.** `NavChrome` has no composing state; the bar is drawn and keeps its room
   while the field has focus or holds words.
4. **The drag.** A touch or pen drag that starts in the column and moves more than 8 CSS px
   from where it started blurs the field when the field has focus. Words, results and
   `?search=1` stay. A mouse, a wheel, a scroll and a tap never blur it.
5. **Scrolls.** When the results first show, the column goes to its top on both pages. After an
   add that makes a new line, the page brings that line's row into view if it is not.

### Scope

- Work in `libs/velista/feature-lists` (the list page, `select-list-state`, `list-error-copy`
  and their specs), `libs/velista/feature-shopping-lists` (the basket page and its spec),
  `libs/velista/ui` (`line-composer`, `list-header`, `list-tools`, `line-list`, `line-row`,
  `to-buy-heading`, `basket-total-bar`, `icons.ts`, `index.ts`, a new directive, the assets),
  `libs/velista/models` (`compose-list-groups`, `compose-list-view`, `list-view`,
  `requests`), `libs/velista/data-access` (`list-view-store`, the line service, api, memory,
  store and store doubles), `libs/velista/platform` (`nav-chrome`, `tour-stops`) and
  `apps/velista-luna-e2e`.
- Do NOT touch the stepper (velista `0188`), the shopping list row cell or its sheet (velista
  `0190`), the compact row (velista `0191`), the add rules or the composer's quantity picker
  (velista `0185`, backend `0260`), or any backend project.

### Constraints

- Zoneless, `OnPush`, signals, `input()` and `output()`. No `@angular/core/rxjs-interop`.
- The drag listeners are passive and never call `preventDefault` or `stopPropagation`: the
  column's own scroll must run untouched.
- No new dependency. `watchKeyboardInset` is not needed and not used: with
  `interactive-widget=resizes-content` the layout viewport already shrinks.
- `token-hygiene.spec.ts`: no raw pixel values in styles. The 8 px threshold is a TypeScript
  constant, not a style.
- Copy only through RokuTranslator keys; this plan adds none.
- No dashes as punctuation in comments.

### Action boundaries

- Proceed with sections 1 to 8 once PRs #959 to #961 are in `dev`.
- Stop and ask before deleting a file this plan does not name (it names
  `to-buy-heading.{ts,scss,spec.ts}` and `basket-total-bar.{ts,spec.ts}`).
- Stop and ask before touching the gateway's reorder route, the `position` column or any
  migration.
- Stop and ask if the CDP touch drag of section 8 cannot be made to blur the field reliably in
  the e2e project; report what was tried and leave the page specs as the coverage.
- Stop and ask before any change that decides behaviour this plan does not settle.

### Progress evidence

Each criterion of section 9 with its spec output; `npx nx affected -t lint test` green;
`npx nx build velista` green with no new budget warning; one walk on a slot at 390 by 844 in
the browser's touch emulation, with screenshots of both pages at rest, typing, and after a
drag, against the mock's frames.

## 0. Decisions

### The owner's, 2026-11-10 and 2026-11-11, fixed

- **The field moves to the top**, "so a person's own lines are the first thing they see when
  they type". Zone list: directly under the page header and "en <zone>". Shopping list: under
  the row with the count, the total and the filter (the owner, 2026-11-11: "Perfect").
- **The progress bar is removed from both pages.** "It is rarely used, I will find another
  place to put it. In the meanwhile, it will be removed." On the zone list that is the count
  line ("7 de 8 pendientes", the total) and the bar. On the shopping list it is the bar and
  its two ends; the row with "8 por comprar", the total and the filter stays.
- **The zone list loses "Por comprar" and "Ponerlas en orden".** "Nobody is using the sort
  feature, that's why it's being removed."
- **The bottom bar is never hidden while typing.** "The navigation won't be hidden anymore
  because it is also confusing." "I will try to find a solution for this later on."
- **The first drag of the results closes the keyboard.** A touch or pen drag past a small
  threshold (8 px in the mock) takes the focus off the field. Not on scroll events, because
  the page scrolls by itself when the keyboard opens. Touch and pen only, so a mouse and a
  hardware keyboard are never affected. The words and the results stay.

### The writer's, open to the owner

- **A. The stored positions stay, the gateway route stays, and velista loses its reorder
  write.** The smaller change: `list_lines.position` keeps the order each list has today, and
  a new line still takes the next position at the end, so "Orden de la lista" goes on meaning
  what it says for every line added from now on. Dropping or renumbering the column would be a
  migration and a backend plan for no visible gain. The route `POST /v1/lists/:id/lines/reorder`
  stays in the gateway, because an installed Android app on an older bundle can still call it
  until it updates (velista `0180`), and removing it is a backend change this velista plan
  cannot make. In velista, the write has no caller left once the screen is gone, so
  `LineService.reorder`, `LineApi.reorder`, `LineMemory.reorder`, `LineStore.reorder`, the
  doubles' `reorder`, `ReorderLinesRequest` and the `lines.reorder` operation go. The handling
  of the realtime event `line.reordered` stays in all three stores, so a reorder made from an
  older bundle still reaches every open screen.
- **B. The field is pinned, not scrolled away.** In the mock's "after the first drag" frames
  the results scroll under the field while "en Casa" and the field stay. Pinned also keeps the
  one property the foot gave the field: reachable whatever the scroll. So each page's head
  block and its dock become items of the host's column before `.page`, not rows inside it.
- **C. The zone list pins all of `lib-list-header`.** It keeps "en Casa", the viewers row and
  the stale band. The viewers row draws nothing when nobody else is there, and the stale band
  only when the list is not live, so the block is one line in the usual case. Splitting the
  component to pin only "en Casa" is a second change for one line.
- **D. The shopping list's tools block leaves the column and stays while typing.** The field
  sits under it, so a block that vanished at the first character would move the field under
  the thumb. The results are the basket's rows narrowed by the view (`resultRows` reads
  `sections()`), so the chips still describe what is shown and stay too. The tools block keeps
  its rule of being drawn only while the basket has rows (`rows().length > 0`), so an empty
  basket has the field directly under the header. The sticky position of `ListTools` has no
  scroller around it any more and goes, with the page's offset rule for it.
- **E. Where the two strips go: under the field.** The voice strip (velista `0038` section 5)
  and the refusal sentence of velista `0185` section E sat on the dock directly above the row.
  At the top, a strip above the field would push the field down each time it appears, so the
  field would not stay where the thumb learned it. Both now sit directly under the row, on the
  same dock, with their hairline at the top edge of the strip. One message at a time, as
  `0185` section 5 already says.
- **F. The drag listens on the whole column, not only the results.** The decision names "the
  results". The same keyboard covers the list when the field has focus and holds no words (an
  empty list takes focus by itself, `takeFocus`), and a person who drags the list there wants
  the keyboard gone for the same reason. The handler does nothing when the field has no focus,
  so on a list at rest it costs nothing.
- **G. `_scrollToResults` goes to the top on both pages.** It scrolled the results heading to
  the top of the column so the progress block went above the fold. The head block is pinned
  now and nothing above the results is decoration (the dropped notices, the read only
  sentence), so the column scrolls to `0` when the results first show, as the basket already
  does. Not on a return to the page, as today.
- **H. After an add, the new row is brought into view, not the end of the column.** Scrolling
  to the very end was right when the field sat after the column and the end was beside it.
  With the field at the top, the end is the far side of the screen and is not even where a new
  line lands when trips or lines at zero follow To buy. The page brings the new line's row
  into view if it is not in view, with `block: 'nearest'`, once the answer names the line. A
  drawn add shows its row on the first frame as today; the scroll follows a round trip later,
  which moves only the column and never the field.
- **I. `NavChrome` loses the composing state, and `LineComposer` loses `fieldFocused`.** They
  have no caller left. The owner's later solution is free to bring a state back with its own
  rules.
- **J. The due label becomes an `h2`.** It was an `h3` one level below "Por comprar". With that
  heading gone, an `h3` right under the page's `h1` skips a level.
- **K. The progress numbers stay in the view models.** `ListHeaderVm.wantedCount`, `lineCount`,
  `cost`, `costEstimated` and the basket's `total()` stay, because the owner "will find another
  place". Only the drawing goes. The two drawing components with no other use go:
  `ToBuyHeading` and `BasketTotalBar`. `ListHeader` stays without its progress part. Git keeps
  both deleted components.
- **L. The zone list's header filter keeps today's rule.** It is absent while the field holds
  words (`list-page.html:30` to `:32`). The mock draws it while typing; no decision covers it.
  Asked below.

## 1. The zone list page

Template (`list-page.html`):

- Move `@if (header(); as list) { <lib-list-header [header]="list" /> }` out of `main#column`
  into a new `<div class="page-top">` after `lib-page-header` and before `main`. It keeps its
  guard: drawn while `current.kind` is neither `error` nor `gone`.
- Move the whole `@if (loaded(); as page) { @if (page.abilities.canWrite) { ... } }` block (the
  dock and the add choice popover) into the same `.page-top`, after the header. Drop
  `&& !reordering()` from its condition. Inside the dock, the order is `lib-line-composer`
  first, then the voice strip.
- Remove `(fieldFocused)="onFieldFocused($event)"`.
- Remove `#resultsHeading` from the results heading.
- Put the drag directive of section 4 on `main#column`:
  `libDragReleasesField (dragged)="releaseField()"`.
- Remove `lib-to-buy-heading` (`:278` to `:290`) and its `@if`.
- The due label `h3` becomes `h2` with the same class (decision J); update its comment.
- Remove `(reorderTo)` and `[reordering]` from `lib-line-list` (`:358`, `:364`), the
  `!reordering()` from `:369`, the "Done" button (`:409` to `:413`), `!reordering()` from the
  filter (`:31`) and the settings (`:49`) conditions, and the reorder sentences in the
  comments (`:14` to `:15`, `:27` to `:28`, `:297`, `:423` to `:424`).
- Give the add choice popover `side="below"` when its anchor is the composer's plus
  (`asked.anchor` is inside `.composer-dock`), and keep `above` for a card's add button in the
  results. Add a computed `choiceSide` in the class for it.
- Rewrite the dock's comments: it is pinned under the head block; the strip sits under the row.

Class (`list-page.ts`):

- Delete `_fieldFocused`, `onFieldFocused`, `_hideChrome`, the `_chrome` injection, the
  `NavChrome` import, and the `setComposing(false)` line on destroy with its comment.
- Add `releaseField(): void`, which calls `this._composer()?.releaseFocus()`.
- `_scrollToResults` (decision G): read `this.typing()` and the column as the basket's does,
  and scroll the column to `{ top: 0, behavior: 'auto' }` once per showing, not on a return.
  Delete `_resultsHeading`. Rewrite its comment.
- The add follow (decision H): replace `_added` (a counter) with
  `_addedLine = signal<string | null>(null)`, set in `_send` after a successful answer that is
  not `merged` (both the drawn and the not drawn branch, from `outcome.line.id`), and replace
  the `afterRenderEffect` at `:1595` and `_scrollToNewest` with one that finds
  `[data-line-id="<id>"]` in the column and calls `scrollIntoView?.({ block: 'nearest',
  behavior: 'auto' })` when `rowInView` says no, then sets the signal back to null. Remove the
  two `_added.update` calls and their comments.
- `rowInView`: drop the `.composer-dock` lookup; the foot is `frame.bottom`. Rewrite its
  comment and the two comments that blame "the pinned composer at the foot" (`:1642` to
  `:1644`, `:2101` to `:2102`). Keep `block: 'center'` for a linked row and a raised row.
- Delete the reorder mode: `reordering`, `canReorder`, `_reorderable`, `_heldByLive`,
  `reorderHeld`, `startReorder`, `endReorder`, `_move`, `moveTo`, `_reorder`, the
  `moveUp`/`moveDown` cases in `act`, the reorder branch of `back()`, the guard in `openLine`,
  the `reordering:` arguments at `:600` and `:859`, the `this.reordering()` test in
  `dueSection`, `ToBuyHeading` from `imports`, `reorderWithinSlots` from the imports, and the
  class comment "Reorder is a mode, and it is page state".

Styles (`list-page.scss`):

- `.page-top`: `flex: none`, a column, inline padding equal to the column's
  (`--app-space-5`), top padding equal to the column's, and the ground background
  (`--app-surface-ground`). In the mock the field is 12 px under "en Casa" and 12 px above the
  first row: use the spacing tokens that give those gaps.
- `.composer-dock` keeps `flex: none` and `display: block`. Rewrite the comments at `:3` to
  `:12`, `:14` to `:17` and `:33` to `:42`: the host's column is the page header, the head
  block, then the scroller.
- `.voice-strip`: under the row now. Its hairline stays `border-block-start` (it is now the
  rule between field and strip). Its inline padding lines up with the field.
- Delete `.reorder-done`.
- `.results` keeps `min-block-size: 100%`, now only so the catalog's surface reaches the foot
  of the column. Rewrite its comment.

## 2. The shopping list page

Template (`basket-page.html`):

- Add `<div class="page-top">` after `lib-page-header`. Move `lib-list-tools` with its
  projected content into it, drawn when `state() === 'ready'` and `rows().length > 0`,
  whether or not the field holds words (decision D).
- Remove `lib-basket-total-bar` (`:461` to `:468`) and its comment. `lib-basket-total` stays.
- Move the dock and `lib-list-picker` (`:722` to `:763`) into `.page-top` after the tools
  block. Remove `(fieldFocused)`.
- Put `libDragReleasesField (dragged)="releaseField()"` on `main#column`.
- Pass `side` to `lib-list-picker` (a new input passed through to its `lib-anchored-popover`),
  `below` when the anchor is the composer's plus and `above` for a card's button, as on the
  zone list.
- The notes in the column (the visit notice, the stale line, the finished banner, the no prices
  note, the changes banner, the prompt) stay where they are, now under the field. Rewrite the
  comments that place them "under the bar" or "under the sticky bar".

Class (`basket-page.ts`):

- Delete `_fieldFocused`, `onFieldFocused`, `_hideChrome`, `_chrome`, the `NavChrome` import
  and the `setComposing(false)` on destroy.
- Add `releaseField()` as on the zone list.
- `_scrollToResults` keeps its behaviour (scroll to `0`); rewrite its comment, which says the
  tools bar is inside the column.

Styles (`basket-page.scss`):

- `.page-top` as on the zone list. In the mock the field is 16 px under the tools row and 8 px
  above the first row.
- Delete the `lib-list-tools` rule (`:137` to `:159`, the sticky offsets) and move its inline
  start padding onto the tools block in `.page-top`. `.chips, .total-bar` becomes `.chips`.
- Rewrite the comments at `:3` to `:7`, `:23` to `:37` and `:41` to `:52`.

`list-tools.scss`: remove `position: sticky`, `inset-block-start` and `z-index` from `:host`,
and rewrite the comment at `:1` to `:7`; `list-tools.ts:39` likewise.

`basket-total-bar.ts` and `basket-total-bar.spec.ts` are deleted, and its export in
`libs/velista/ui/src/index.ts`.

## 3. The composer

- `releaseFocus(): void`: when the field element is the document's active element, call
  `blur()` on it. Nothing else: the words, `content`, the results and the history entry stay.
- Remove the `fieldFocused` output, its two bindings in `line-composer.html:81` to `:82`, and
  its comment (decision I).
- `line-composer.scss:1` to `:15`: the row no longer sits at the foot. Remove the
  `--app-safe-bottom` term from `padding-block-end` of `.composer` and `.listening`, move the
  hairline from `border-block-start` to `border-block-end`, and drop the raised fill so the
  row sits on the ground as in the mock. The builder checks the listening row against the
  mock's surfaces with `design-taste-frontend`. Rewrite the comment.
- The voice stop of the tour (`tour-stops.ts:124`) changes `placement` to `'below'`.

## 4. The drag that releases the field

A new directive, `DragReleasesField`, in `libs/velista/ui/src/lib/list/drag-releases-field.ts`,
selector `[libDragReleasesField]`, exported from `libs/velista/ui/src/index.ts`. It knows
nothing about a field: it says that a drag happened, and the page decides what that does.

- **Output:** `dragged = output<void>()`, emitted at most once per gesture.
- **Constant:** `DRAG_RELEASE_PX = 8`, exported. A gesture counts when the straight line
  distance from its start (`Math.hypot(dx, dy)`) is **greater than** 8 CSS px.
- **Listeners**, all on the host element, all `{ passive: true }`, added in `afterNextRender`
  and removed through `DestroyRef`:
  - `pointerdown`: when `pointerType` is `touch` or `pen` and `isPrimary` is true, start a
    gesture at `clientX`, `clientY` with that `pointerId` and "not emitted". For any other
    pointer (a mouse) clear the gesture.
  - `pointermove`: only for the gesture's `pointerId`; measure.
  - `touchstart`: when `touches.length === 1` and no gesture is running, start one at the
    touch. When `touches.length > 1`, clear the gesture (a second finger is a pinch).
  - `touchmove`: measure with `touches[0]`.
  - `pointerup` of the gesture's pointer, `touchend`, `touchcancel`: clear the gesture.
  - `pointercancel` does **not** clear it. The browser cancels the pointer as soon as it takes
    the touch for scrolling, and from then on only the touch events keep coming, so they finish
    the count. That is why both families are listened to (the mock does the same).
- **Must not trigger it:** a mouse drag or click; a wheel; a `scroll` event of any kind (the
  page scrolls by itself when the keyboard opens and when `_scrollToResults` or a mark runs);
  a key; a tap that moves 8 px or less; a drag that starts outside the host (the page header,
  the head block, the field, the bar, a sheet, a popover in a CDK overlay); a second finger.
- **Never** `preventDefault`, `stopPropagation` or pointer capture.
- `holdFocus` (`mousedown` on the results) stays, so a tap on a control in the results still
  keeps the keyboard up.

A known edge, left as it is: a finger held on a stepper button in the results (velista `0188`)
that wanders more than 8 px releases the keyboard. The browser treats that movement as the
start of a scroll too, and `0188` stops its repeat on a scroll.

## 5. NavChrome

Remove `_composing`, `composing`, `setComposing` and reason 4 of the class comment. `reserved`
becomes `this._usable() && !this._chromeless()`. Remove the spec "neither draws nor reserves
the bar while somebody types into a list" (`nav-chrome.spec.ts:114` to `:130`).

## 6. The reorder chain and the progress drawing

- `ui`: delete `to-buy-heading.{ts,scss,spec.ts}` and its export. `LineList` loses
  `reordering`, `reorderTo`, the reorder note, the drag (`draggingId`, the bands, `transformOf`,
  `startDrag`, `onDrag`, `endDrag`, the cancel handler, the `lifted` and `shifting` classes)
  and their styles in `line-list.scss`. `LineRow` loses `reordering`, the grip branch of its
  template, `move`, the grip's pointer output, `moveUp`/`moveDown` from `LineRowAction`, the
  `reordering` host class and its styles, and every `reordering()` term in its conditions.
  `GripIcon` is deleted from `icons.ts` (no other user).
- `ListHeader`: delete the progress comment and block (`list-header.html:11` to `:68`),
  `percent` and the "progress moves with the thumb" paragraph of `list-header.ts`, and
  `.progress-line`, `.cost`, `.visually-hidden` (only if nothing else in the file uses it),
  `.progress`, `.progress-fill` and the reduced motion rule in `list-header.scss`. Rewrite the
  `.viewers` comment ("under the bar").
- `models`: `compose-list-groups` loses `reordering` and its branches, and
  `reorderWithinSlots`. `compose-list-view` loses `listViewHoldsReorder`. `list-view.ts` loses
  `canReorder`.
- `data-access`: `ListViewStore.holdsReorder` goes. The reorder write goes (decision A). The
  three `line.reordered` handlers stay.
- `feature-lists`: `select-list-state` loses `reordering`, `canReorder` and the
  `!input.reordering` terms; `list-error-copy` loses `lines.reorder` and its two branches.
- Copy, removed from `en.json` and `es.json`: `list.header.pending`, `list.header.done`,
  `list.header.cost`, `list.header.costExact`, `list.trips.toBuy`, the nine `list.reorder.*`
  keys, `list.line.movedTo`, `basket.total.barLabel`, `basket.total.barLabelExact`,
  `basket.total.boughtEnd`, `basket.total.leftEnd`. Before removing each, search
  `libs/velista` and `apps/velista*` for it; keep any key that has another user.
  `list.empty.short` stays (the zone card and the list row use it).

**With velista `0185`.** Either can be built first.

- If `0185` is built first, this plan meets a composer with no stepper and a `notice` input
  drawn above `.composer`. Move that sentence under `.composer`, with its hairline on its top
  edge (decision E). The list page's rule that the voice strip and the sentence never show
  together stays.
- If this plan is built first, `0185` meets a composer at the top with no `fieldFocused`. Its
  builder draws the sentence under the row, not above it, and the "above the plus" of its
  target 4 and section 5 reads "under the row".
- Velista `0188`, `0190` and `0191` change `LineRow`, `LineList` and the basket row too; the
  overlap with section 6 is textual, and the second builder rebases.

## 7. Specs

- **New** `drag-releases-field.spec.ts` (`ui`). jsdom has no `PointerEvent`, so build pointer
  events from `MouseEvent` with `pointerId`, `pointerType` and `isPrimary` defined on them, as
  `libs/velista/ui/src/lib/entry/sheet-shell.spec.ts:354` to `:370` does, and touch events from
  `Event` with `touches` defined. Cases: a touch moved 9 px emits once; 8 px emits nothing; a
  pen moved 9 px emits; a mouse moved 50 px emits nothing; two moves past the threshold emit
  once; a second gesture emits again; `pointerdown`, `pointercancel`, then `touchmove` past the
  threshold emits; a second touch clears the gesture; `wheel` and `scroll` emit nothing; every
  listener is added with `passive: true` (spy on `addEventListener`); no event it sees has
  `defaultPrevented`.
- `line-composer.spec.ts`: `releaseFocus()` blurs a focused field and keeps its value; it does
  nothing to an unfocused field. "says when the field gains and loses focus" (`:735`) goes.
  "keeps the keyboard up: a press leaves focus in the field" (`:810`) asserts
  `document.activeElement` instead of `fieldFocused`.
- `list-page.spec.ts`:
  - "gives the bar's room to the page while the field has focus or holds words" (`:2605`) is
    replaced by: a drag on the column with the field focused and holding "le" blurs the field,
    keeps "le", keeps `#list-results`, and navigates nothing; a drag with the field not focused
    changes nothing.
  - "puts the strip and the field in one dock" (`:640`): the strip now **follows** the
    composer; and `.page-top` holds `lib-list-header` and the dock, and precedes `main`.
  - The results first shown scroll the column to `0`; a return does not.
  - After a typed add that makes a new line, `scrollIntoView` is called once on that row with
    `block: 'nearest'` when the row is out of view (stub `getBoundingClientRect`).
  - The add choice popover gets `side="below"` when the plus anchors it.
  - Reorder specs go: "ends reorder mode from the header's back" (`:952`), "takes both actions
    away in reorder mode" (`:1028`), `describe('rule L4: reorder is a mode')` (`:1601`), the
    reorder half of "draws the filter in the page header" (`:2188`), `describe('reorder waits
    for the list order')` (`:2717`), "shows To buy alone in reorder mode" (`:2951`), the reorder
    half of "draws no section in reorder mode" (`:3149`), and the `lib-to-buy-heading`
    assertions at `:2941` and `:2992` and the `toBuyHeading` helper (`:2183`).
  - No `lib-to-buy-heading`, no `.progress-line`, no `.progress` on a loaded list; the due label
    is an `h2`.
- `basket-page.spec.ts`:
  - "gives the bar's room ..." (`:2061`) becomes the drag spec of the zone list on
    `#basket-results`; the `navChrome` double (`:457`, `:466`, `:2174`) goes.
  - "hides the tools row while the results show" (`:1921`) becomes "keeps the tools row and
    the chips while the results show".
  - "scrolls in its own column ..., with the composer after it" (`:1828`): the dock is in
    `.page-top`, before `main`, with `flex: none`.
  - "sticks the tools bar over the start padding of its column" (`:1843`) goes.
  - The total specs (`:5068` to `:5150`): no `lib-basket-total-bar` anywhere; the number stays
    before the filter; the number stays while the field holds words; the no prices note is the
    first item of the column (its previous sibling is no longer `lib-list-tools`); the gutter
    spec drops `.total-bar`.
  - `lib-list-picker` gets `side="below"` when the plus anchors it.
- `list-header.spec.ts`: the progress specs go; "starts on the progress line while the group is
  not known" (`:59`) asserts the first element is the viewers or nothing.
- `nav-chrome.spec.ts`: section 5.
- `line-list.spec.ts`, `line-row.spec.ts`, `compose-list-groups.spec.ts` (`reorder mode (test
  12)` and `reorderWithinSlots`), `compose-list-view.spec.ts` (`the badge and the reorder
  hold`, keep the badge half), `list-view-store.spec.ts` (`:192`), `select-list-state.spec.ts`,
  `line-store.spec.ts`, `list-error-copy.spec.ts`: the reorder cases go. The `line.reordered`
  event specs of the stores stay.
- `tour-store.spec.ts:87`, if it pins the voice stop's placement, follows section 3.

## 8. e2e

No existing step changes (Context). Add one test to `apps/velista-luna-e2e/src/shop.spec.ts`,
on lines it makes itself, in two steps:

1. **Zone list.** Open a list page with at least two lines. Expect the composer field's
   bounding box to end above the first row's. Fill "egg" (or a word of one of its lines).
   Expect `getByRole('navigation', { name: 'Main sections' })` visible. Focus is in the field.
   Through a CDP session (`page.context().newCDPSession(page)`), enable
   `Emulation.setTouchEmulationEnabled({ enabled: true, maxTouchPoints: 1 })` and send
   `Input.dispatchTouchEvent` `touchStart` inside `#list-results`, three `touchMove` steps 40 px
   up, and `touchEnd`. Expect the field not focused, its value still "egg", `#list-results`
   visible and `?search=1` still on the URL.
2. **Shopping list.** The same on the basket with `#basket-results`, and expect `.tools-bar`
   visible while the field holds words.

Desktop Chrome has no on screen keyboard, so the test proves the blur, not the keyboard. If the
emulated drag does not blur reliably, stop and ask (Action boundaries).

## 9. Acceptance criteria

- [ ] On both pages the field is above the first row and stays put while the column scrolls.
- [ ] The zone list draws no count line, no cost and no bar; the basket draws no total bar;
      its count, total and filter row stays, also while typing.
- [ ] No "Por comprar" heading, no "Ponerlas en orden", no grip, no reorder mode, and no
      velista code that calls the reorder route; `line.reordered` still updates an open list.
- [ ] The bottom bar is drawn and keeps its room while the field has focus or holds words;
      `NavChrome` has no composing state.
- [ ] A touch or pen drag of more than 8 px that starts in the column blurs a focused field and
      keeps the words, the results and `?search=1`; a mouse, a wheel, a scroll, a key and a
      tap of 8 px or less never do.
- [ ] The voice strip, and the refusal sentence of velista `0185` once built, sit under the row.
- [ ] The results first shown start at the top of the column; a new line is brought into view.
- [ ] The add choice and the list picker open below the plus.
- [ ] Every removed key is gone from both locales and has no user left.
- [ ] `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e test
      of section 8 passes on a slot.

## What was measured, and what was not

Measured in the mock, with a 320 px keyboard on a 390 by 844 frame:

| | at rest | typing, keyboard open | after the first drag |
| --- | --- | --- | --- |
| zone list | 8 whole rows | results 270 px: 1 row of the list, 1 whole product | 590 px: 1 row, 4 products |
| shopping list | 8 whole rows | results 252 px: 1 row, 1 whole product | 572 px: 1 row, 4 products |

The mock emulates the keyboard; it does not run on a phone. Not verified:

- **iPhone browsers.** iOS Safari does not honour `interactive-widget=resizes-content`; it
  moves fixed elements and overlays the keyboard. Whether the bar then sits above the keyboard,
  under it, or scrolls, and whether the pinned head block stays on screen while typing, was not
  checked on a device.
- **The bar's bottom padding with the keyboard open on a real phone.** The bar pads its foot
  with `max(--app-space-6, env(safe-area-inset-bottom))` (`_semantic.scss:502`). With the
  keyboard up, a gap of that size may sit between the tabs and the keyboard. Not measured.
- **That `100svh` follows the resized layout viewport** on Chrome for Android under
  `resizes-content`, which the column needs for the bar to sit on the keyboard.
- **A pen** on a real device, and how far Chrome for Android lets a touch move before it
  cancels the pointer (the touch events cover both, by design).
- Real keyboard heights (about 260 to 340 px) against the mock's 320.

## Not in this plan

- **Another place for the progress.** The owner's, later.
- **A way to hide the bar while typing.** The owner's, later.
- **Removing the gateway's reorder route** or the `position` column (decision A).
- **The stepper, the shopping list's amount cell and sheet, the compact row, the add rules.**
  Velista `0188`, `0190`, `0191`, `0185` and backend `0260`.

## Questions for the owner

1. The stored positions stay and new lines keep going to the end, so "Orden de la lista" now
   means the order the lines were added in, plus whatever order a list had before today. Is
   that the order you want, or should the label change, or should the order become "newest
   first"? (decision A)
2. Should the gateway's reorder route be removed later, once no installed Android bundle older
   than this plan is in use? That is a backend backlog plan. (decision A)
3. The zone list's filter button in the page header disappears while the field holds words, as
   today; the mock draws it while typing. Keep it on screen while typing? (decision L)
4. The drag also releases the keyboard when the field is focused and empty over the list, not
   only over the results. Is that what you want? (decision F)
5. After an add, the page brings the new line into view where it landed rather than jumping to
   the end of the list. Is that right now that the field is at the top? (decision H)
6. On the shopping list the tools row and the chips stay while typing, above the field, as the
   mock draws them. Confirm. (decision D)
