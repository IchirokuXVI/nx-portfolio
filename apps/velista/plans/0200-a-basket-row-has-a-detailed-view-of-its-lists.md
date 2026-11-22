# 0200: a basket row has a detailed view of its lists

> Decided on 2026-11-22, replacing the menu this plan first described (merged in PR #1061,
> never built). The basket's row sheet (the settle sheet, velista `0139` and `0190`) does
> two jobs today: it records what was bought, and it manages what each list asks for and
> which catalog product each list takes. The owner splits them:
>
> - **The row sheet records buys only** (velista `0201`). It says so in a heading, and its
>   steppers record what was bought for each list.
> - **A detailed view** of the row's lists, reached by a text button in the row sheet, holds
>   the rest: for each list, what was bought (read only), what the list asks for (editable),
>   and the change of catalog product. Its rows are bigger and carry more, so the view is
>   easier to understand. The product can no longer be changed from the row sheet.
>
> It replaces the swap icon of velista `0140`, section 1, and moves "Change for all lists"
> into the detailed view.
>
> **Blocked until the owner approves a mock**: `apps/velista/plans/mocks/basket-row-buys/`,
> with the frames this plan names in section 1. Build nothing visible before the mock is
> approved, and take every look and word from it.
>
> Linked plans: velista `0201` (the row sheet records buys) cannot be released without this
> plan, because after it the row sheet has no way to change a list's ask or product.
> **Release `0200`, `0201` and backend `0273` together.** Velista `0204` (the reel in the
> compact view) leaves this view as it is: it has typing, so it keeps the button stepper in
> both views.
>
> Code anchors, on `dev` at `1c57f0c9c`:
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.html` (the head with
> "Change for all lists", each entry's swap button and stepper);
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.ts:102` to `:107`
> (the Change rule), `:181` to `:190` (`changeable`, `changed`, `changedAll`, `demanded`);
> `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts:299` to `:304`
> (`demandRuns`), `:1573` (`setDemand`); `libs/velista/feature-shell/src/lib/routes.ts:351`
> to `:375` (the settle sheet and the two change sheets, under `sheet()`);
> `libs/velista/models/src/lib/basket-view.ts:535` to `:622` (`BasketRowEntry`: `asked`,
> `bought`, `demandEditable`, `listId`); `libs/velista/platform` (`SheetNavigation`,
> `sheetSegments`).

## Brief for the agent

### Objective

Add a sheet that shows each list of a basket row in a larger row (what was bought, read
only; what the list asks for, editable; the change of catalog product), open it from a text
button in the row sheet, and take the product change and "Change for all lists" out of the
row sheet.

### Context

- An entry is `changeable` when the sheet may change its product (velista `0140`); its ask
  is editable when the server says `demandEditable`. A guest usually has neither.
- The change sheets exist: `rows/:rowKey/change/:lineId` for one line and
  `rows/:rowKey/change` for every line the reader may change.
- Changing the ask is `BasketStore.setDemand`, which the row sheet calls today through
  `demandRuns`. It writes to the household's list, not to the basket.
- A sheet is a child route under the `sheet` segment, through `sheet()` (CLAUDE.md, "Sheets
  are addressed under a `sheet` segment"). Its cancel uses `SheetNavigation.dismiss` with a
  fallback URL.

### Target state

1. **The route.** `rows/:rowKey/lists`, through `sheet()`, beside the settle sheet. Its
   back and its cancel return to the row sheet, with the row sheet's URL as the fallback.
2. **The way in.** A text button in the heading row of the row sheet's lists, where "Change
   for all lists" was ("Lists and amounts" / "Listas y cantidades", or the mock's words). It
   is drawn when at least one entry is `changeable` or has an editable ask; otherwise it is
   absent, so a guest who can change nothing sees no page of read only numbers.
3. **The rows of the detailed view**, one per entry, larger than the row sheet's, laid out as
   the mock draws them:
   - the list's name (or "Another list") and "zone · line" under it;
   - what this basket bought for that line in this trip, read only, with the ask
     ("Bought 2 of 3" / "Comprado 2 de 3"), from `entry.bought` and `entry.asked`;
   - what the list asks for: the typed stepper of velista `0188` (`sheet-narrow` or
     `sheet`, as the mock fits) when the ask is editable, saved through `setDemand` exactly
     as `demandRuns` does today (a typed amount at once, presses after the quiet beat);
     otherwise the number in the exact form;
   - "Change product" / "Cambiar producto" when the entry is `changeable`, opening
     `rows/:rowKey/change/:lineId`.
4. **"Change for all lists"** sits in the detailed view's heading when two entries or more
   are `changeable`, opening `rows/:rowKey/change`.
5. **The row sheet loses** each entry's swap icon and "Change for all lists". Its steppers
   are unchanged by this plan; velista `0201` turns them into buys.
6. The change sheets return to the view they were opened from: the detailed view.
7. Keys under `basket.lists` in `en` and `es`, with the mock's words.

### Scope

- Work in `feature-shopping-lists` (row entries, the settle sheet, the new detailed view),
  `feature-shell` (the route), the i18n files.
- Do NOT change the change sheets, the settle actions, or what the row sheet's steppers do.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless.
- Rule E1 and the sheet rules: the detailed view is a route under the marker; no hand
  written `sheet` segment; the back control names its fallback.
- The look from the approved mock only; rule T1, the hygiene and contrast specs.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if the mock is not approved.
- Stop and ask if the mock shows something on a row this plan does not list.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot at 390 by 844, Day and Night: open the detailed view from the row sheet, change one
list's ask and see it on the zone list, change one list's product, come back to the row
sheet with the back control and with the browser back.

## 1. Frames the mock must have

1. The row sheet with the "Lists and amounts" button and no swap icons.
2. The detailed view of a row with three lists: one changeable with an editable ask, one
   with an editable ask only, one "Another list" with neither.
3. The detailed view with "Change for all lists" in its heading.
4. A list name long enough to be cut, in the detailed view.

## 2. Specs

1. The button draws when one entry is changeable or editable, and not for a guest with
   neither.
2. The detailed view draws one row per entry with "Bought N of M", the stepper only where the
   ask is editable, and "Change product" only where the entry is changeable.
3. A typed ask is sent once through `setDemand`; presses wait the quiet beat.
4. "Change product" and "Change for all lists" navigate to the change sheets; their back
   returns to the detailed view.
5. The row sheet draws no swap icon and no "Change for all lists".
6. `routes.spec.ts` still passes: the new route is under the marker.

## 3. Acceptance criteria

- The product of a list can be changed only from the detailed view.
- A list's ask can be changed from the detailed view.
- The row sheet keeps one job: recording buys (with velista `0201`).

## Not in this plan

- The buy steppers, the "What you bought" heading and the colours (velista `0201`).
