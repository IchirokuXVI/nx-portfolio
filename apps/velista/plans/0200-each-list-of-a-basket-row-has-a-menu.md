# 0200: each list of a basket row has a menu

> Decided on 2026-11-22. In the basket's row sheet (the settle sheet, velista `0139` and
> `0190`), each list that holds the row draws a swap icon that changes the catalog product
> for that list (velista `0140`, section 1). The owner replaces it with a menu icon that
> opens a small menu with two choices (the words are not final): "Change catalog product"
> and "Change requested amount". The second is needed because velista `0201` turns each
> list's stepper into the record of what was bought, so the sheet needs another way to
> change what a list asks for.
>
> **Blocked until the owner approves a mock.** The owner asked for a mock of the menu before
> it is built. It is the next session's work, in `apps/velista/plans/mocks/basket-row-buys/`,
> with the frames this plan names in section 1. Build nothing of this plan before the mock
> is approved, and take every look from it.
>
> Linked plans: velista `0201` (the buy stepper) cannot be released without this plan,
> because after it the sheet has no other way to change a list's ask. This plan can be
> released alone: the stepper still changes the ask until `0201` lands, and the menu's
> second choice does the same thing in its own sheet. **Release `0200`, `0201` and backend
> `0273` together**, or this one first.
>
> Code anchors, on `dev` at `e06813139`:
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.html:35` to `:45`
> (the swap button) and `:47` to `:59` (the stepper that asks);
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.ts:102` to `:107`
> (the Change rule), `:181` to `:190` (`changeable`, `changed`, `demanded`);
> `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts:299` to `:304`
> (`demandRuns`), `:1573` (`setDemand`); `libs/velista/feature-shell/src/lib/routes.ts:351`
> to `:375` (the settle sheet and the two change sheets, under `sheet()`);
> `libs/velista/ui/src/lib/zone/member-row.html:25` to `:70` (a menu trigger and a
> `role="menu"` list to copy); `libs/velista/ui/src/lib/list/anchored-popover.ts` (the top
> layer popover); `libs/velista/ui/src/lib/icons/icons.ts` (`SwapIcon` at `:1111`,
> `EllipsisIcon`).

## Brief for the agent

### Objective

Replace each list's swap icon in the basket row sheet with a menu trigger that opens a
small menu of two choices, and add the sheet the second choice opens, where a person changes
what that list asks for.

### Context

- An entry is `changeable` when the sheet may change its product (velista `0140`), and its
  ask is editable when the server says `demandEditable`. The two are separate permissions.
- The change sheets exist: `rows/:rowKey/change/:lineId` for one line.
- Changing the ask is `BasketStore.setDemand`, which the sheet already calls through
  `demandRuns`. It writes to the household's list, not to the basket.
- A sheet is a child route under the `sheet` segment, through `sheet()` (CLAUDE.md, "Sheets
  are addressed under a `sheet` segment"). Its cancel uses `SheetNavigation.dismiss` with a
  fallback URL.

### Target state

1. **The trigger.** An entry draws a menu trigger where the swap icon was, when it has at
   least one choice. Its icon comes from the mock (a new "menu" or "bars" icon in
   `libs/velista/ui/src/lib/icons/icons.ts`, or the existing `EllipsisIcon` if the mock
   uses it). Its accessible name names the list. `aria-haspopup="menu"`,
   `aria-expanded`.
2. **The menu.** An `AnchoredPopover` holding a `role="menu"` list, one `menuitem` per
   choice the entry allows, each a line of text with the icon the mock gives it:
   - "Change catalog product" when the entry is `changeable`; it opens
     `rows/:rowKey/change/:lineId` as the swap icon did.
   - "Change requested amount" when the entry's ask is editable; it opens the new sheet of
     target state 3.
   Escape and a press outside close it and focus returns to the trigger. Arrow keys move
   between the items. Keys `basket.entries.menu.product` and `basket.entries.menu.asks` in
   `en` and `es`, with the mock's words.
3. **The ask sheet.** A new sheet at `rows/:rowKey/ask/:lineId`, through `sheet()`: the list's
   name, the line, and the typed stepper of velista `0188` at the `sheet` variant with the
   list's current ask. It saves through `setDemand` exactly as `demandRuns` does today (a
   typed amount at once, presses after the quiet beat) and dismisses with a fallback to the
   settle sheet.
4. "Change for all lists" in the heading's row is unchanged.
5. The stepper of each entry is unchanged by this plan (it still asks). Velista `0201`
   changes it.

### Scope

- Work in `feature-shopping-lists` (row entries, the settle sheet, the new ask sheet),
  `feature-shell` (the route), `ui` (the icon, if new), the i18n files.
- Do NOT change the change sheets, the settle actions, or what the entry's stepper does.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless.
- Rule E1 and the sheet rules: the ask sheet is a route under the marker; no hand written
  `sheet` segment.
- The look from the approved mock only; rule T1, the hygiene and contrast specs.
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop if the mock is not approved.
- Stop and ask if the mock shows a choice this plan does not list.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot at 390 by 844, Day and Night: open the menu, pick each choice, change an ask in the new
sheet, see it on the zone list.

## 1. Frames the mock must have

1. The row sheet with two lists, one trigger each.
2. The menu open over one entry, with both choices.
3. The menu of an entry that allows only one choice.
4. The ask sheet with the typed stepper.

## 2. Specs

1. An entry with neither permission draws no trigger; with one draws a menu of one item;
   with both, two items in the order of target state 2.
2. Each item navigates to its route; Escape closes the menu and focuses the trigger.
3. The ask sheet calls `setDemand` with the typed amount once, and dismisses to the settle
   sheet.
4. `routes.spec.ts` still passes: the new route is under the marker.

## 3. Acceptance criteria

- No swap icon remains in the row sheet.
- Both choices work from the menu, each only when allowed.

## Not in this plan

- The buy stepper, the label with the asked amount and the colours (velista `0201`).
