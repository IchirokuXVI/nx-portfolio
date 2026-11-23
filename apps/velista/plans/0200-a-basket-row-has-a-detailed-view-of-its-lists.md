> **PR:** [#1083](https://github.com/IchirokuXVI/nx-portfolio/pull/1083)

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
> Amended on 2026-11-22 after the owner approved the mock: layout A (the ask stepper at the
> right of the name block); a description under the title on every visit; the row's product
> at the top as a small product sheet, with "Change for all lists" in that block; each list
> row shows its own product on one line, in the quiet amber when it is not the row's
> product, and the word "Change" at the end of that line is the only way to change it; every
> picture opens the picture viewer; an entry whose ask the reader may not change draws a
> disabled stepper that explains itself in a popover when pressed.
>
> Amended again on 2026-11-22: the disabled stepper is `aria-disabled`, never the `disabled`
> attribute, so it stays focusable and a press, Enter or Space opens its popover; its reason
> is also linked with `aria-describedby`. And the ask stepper sends the list's whole ask:
> backend `0274` makes the demand route (`BasketStore.setDemand`) take `quantity` as what
> the list asks for in total (what the line holds plus what this basket already bought
> toward it), no longer the line's `left`, and the release raises `minClientVersion` so
> that old clients stop. So this view shows and sends `entry.asked` (read from the wire,
> velista `0201`), and every other caller of `setDemand` in velista changes or goes (Scope).
>
> **The mock is approved**: `apps/velista/plans/mocks/basket-row-buys/`, published at
> https://claude.ai/artifact/BfjSwJoGP4hyuG3DXTEiy6. Take every look and word from its
> boards (section 1 lists them) and the notes in its `canvas.json`.
>
> Linked plans: velista `0201` (the row sheet records buys) cannot be released without this
> plan, because after it the row sheet has no way to change a list's ask or product.
> **Release `0200`, `0201` and backends `0273` and `0274` together** (`0274` changes what
> the demand route's `quantity` means, so this view and the basket page's card holdings
> cannot ship apart from it). Velista `0204` (the reel in the
> compact view) leaves this view as it is: it has typing, so it keeps the button stepper in
> both views. The ask stepper of this view takes no second snap point (velista `0195`): it
> keeps the default stop at 1000 only.
>
> Amended on 2026-11-22 a third time: the owner ruled that a popover about one control
> points at it. The disabled stepper's popover (target state 8) uses the pointer of velista
> `0206`, so **build velista `0206` before this plan**. `0206` can be released alone and
> earlier.
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
> `sheetSegments`). On `dev` at `3f26ae3d3`:
> `libs/velista/ui/src/lib/list/quantity-stepper.scss:76` to `:80` (an end with
> `aria-disabled` fades to 0.35, nothing else changes); `libs/velista/ui/src/lib/list/anchored-popover.ts`;
> `libs/velista/ui/src/lib/list/product-picture.ts`; `libs/velista/ui/src/lib/photo/photo-viewer.ts`;
> `libs/velista/ui/src/lib/catalog/product-row.scss` (the product card's compact row the
> mock copies); `libs/velista/ui/src/lib/styles/_themes.scss:127` and `:234`
> (`--app-action-quiet-fg`). On this branch:
> `libs/velista/ui/src/lib/list/quantity-stepper.ts:179` (the `disabled` input) and
> `quantity-stepper.html:27`, `:51`, `:60`, `:88` (the ends and the field already carry
> `aria-disabled` and `readOnly`, never `disabled`); `libs/velista/models/src/lib/basket-view.ts:1336`
> to `:1350` (`BasketDemandRequest`: `quantity` "What that list asks for from now on", `from`
> "The entry's `left` the person was looking at"); the callers of `setDemand`:
> `settle-sheet.ts:300` to `:304` (`demandRuns`), `:943` and `:960` to `:965` (`raise`, the
> other lists path), `:1010` to `:1013` (`_fromNow`, `from: entry.left`), `:1573` (`demand`);
> `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts:2514` to `:2517`
> (`holdingsOf`, a card holding's amount is `entry.left`) and `:2589` to `:2600`
> (`_sendHolding`, `setDemand({ lineId, quantity: run.to, from: run.from })`);
> `libs/velista/feature-shopping-lists/src/lib/row-entries/row-entries.ts:319` to `:321`
> (`asks` and `shown` read `entry.left`); `libs/velista/data-access/src/lib/baskets/basket-memory.ts:1423`
> (the fake's `setDemand`).

## Brief for the agent

### Objective

Add a sheet that shows each list of a basket row in a larger row (what was bought, read
only; what the list asks for, editable; the list's product and its change), with the row's
product at the top, open it from a text button in the row sheet, and take the product change
and "Change for all lists" out of the row sheet.

### Context

- An entry is `changeable` when the sheet may change its product (velista `0140`); its ask
  is editable when the server says `demandEditable`. A guest usually has neither.
- The change sheets exist: `rows/:rowKey/change/:lineId` for one line and
  `rows/:rowKey/change` for every line the reader may change.
- Changing the ask is `BasketStore.setDemand`, which the row sheet calls today through
  `demandRuns`. It writes to the household's list, not to the basket. Today its `quantity`
  is the line's new `left` and its `from` the `left` the reader saw. After backend `0274`
  its `quantity` is the list's whole ask (what the line holds plus what this basket already
  bought toward it), and `from` is what that plan documents for the route. Old clients are
  cut off by a raised `minClientVersion` at release, so no client sends the old meaning to
  the new server.
- A sheet is a child route under the `sheet` segment, through `sheet()` (CLAUDE.md, "Sheets
  are addressed under a `sheet` segment"). Its cancel uses `SheetNavigation.dismiss` with a
  fallback URL.
- The stepper's disabled ends today only fade (`opacity: 0.35` on `aria-disabled`); its
  border, its fill and its number keep the enabled colours. The mock needs a stepper that
  looks disabled as a whole.

### Target state

1. **The route.** `rows/:rowKey/lists`, through `sheet()`, beside the settle sheet. Its
   back and its cancel return to the row sheet, with the row sheet's URL as the fallback.
2. **The way in.** A text button in the heading row of the row sheet's lists, where "Change
   for all lists" was: "Lists and amounts" / "Listas y cantidades". It is drawn when at
   least one entry is `changeable` or has an editable ask; otherwise it is absent, so a
   guest who can change nothing sees no page of read only numbers. The owner confirmed this
   rule when he approved the mock (board Guest).
3. **The description.** Under the title, on every visit, one paragraph in the sheet's
   secondary text (`--app-text-secondary`, 14 px), with no box and no icon: "Here you
   change the amount and the product of each list. What you bought goes on the previous
   screen." / "Aquí cambias la cantidad y el producto de cada lista. Lo que has comprado se
   apunta en la pantalla anterior."
4. **The product at the top.** The row's product as a small product sheet, about three
   lines, laid out as the mock draws it from the product card's compact row: its picture
   (52 px), its name, its brand and size, its price. A long product name wraps to two lines
   in this block. "Change for all lists" / "Cambiar en todas las listas" sits in this block,
   under the product, when two entries or more are `changeable`, and opens
   `rows/:rowKey/change`. It is no longer in the heading of the rows.
5. **The heading over the rows**: "What each list asks for" / "Lo que pide cada lista".
6. **The rows of the detailed view**, one per entry, larger than the row sheet's, in layout
   A of the mock:
   - the list's name (or "Another list" / "Otra lista") and "zone · line" under it, both cut
     when long;
   - what this basket bought for that line in this trip, read only, with the ask
     ("Bought 2 of 3" / "Comprado 2 de 3"; "Bought 0,5 of 1,5 kg" for a weight), from
     `entry.bought` and `entry.asked`. It is plain text and takes no colour, and it is never
     cut;
   - at the right of the name block, what the list asks for: the typed stepper of velista
     `0188` (`sheet-narrow` for a count, `sheet` for a weight, as the mock draws them). **It
     shows and sends the list's whole ask**: its value is `entry.asked` (read from the wire,
     velista `0201`), and a run sends `setDemand` with `quantity` the run's `to`, which is
     the new whole ask, and `from` as backend `0274` documents it for the route. The timing
     is the one `demandRuns` has today (a typed amount at once, presses after the quiet
     beat), but the numbers are not: it never sends `entry.left`. A list asking 3 with 2
     bought shows 3, and a plus sends 4. It passes no `snaps` (velista `0195`), so only the
     stop at 1000 applies;
   - **the list's product, on one line** under it: a small picture (28 px), the product
     name, then " · brand size" ("Leche semidesnatada · Hacendado 1 L"). The brand and size
     are never cut; the name is cut first. The line is drawn also when every list has the
     same product. When the list's product is not the row's product (the one at the top),
     the line's text is `--app-action-quiet-fg`, the quiet amber;
   - **"Change" / "Cambiar"** at the end of that line, drawn only when the entry is
     `changeable`, with a 44 px tall target. It is the only control that opens
     `rows/:rowKey/change/:lineId` for that list. The line itself is not a control. It
     replaces this plan's earlier "Change product".
7. **Pictures.** Every picture, the one at the top and each row's, opens the picture viewer
   (`photo-viewer`) when pressed, with the product's name as its accessible name. A product
   with no photo draws the app's default product icon on the sunken fill, and is not a
   button.
8. **An ask the reader may not change.** An entry without `demandEditable` still draws the
   stepper, disabled, showing the ask. A press on it opens an `AnchoredPopover` in its note
   frame (280 px), which may open above or below the stepper, and says why. It passes
   `pointer` true and the entry's row as `keepInSight` (velista `0206`), so its pointer is on
   the stepper's centre and it covers neither the stepper nor the row:
   - for a list in a group the reader is not in: "This list belongs to a group you are not
     in. Only its members can change what it asks for." / "Esta lista es de un grupo del que
     no formas parte. Solo sus miembros pueden cambiar lo que pide.";
   - for a list of the reader's own group that they may not change: "Only members of
     <group> can change what this list asks for." / "Solo los miembros de <group> pueden
     cambiar lo que pide esta lista."
   This replaces "otherwise the number in the exact form".
   **The reason is also linked with `aria-describedby`** from the stepper to a visually
   hidden element that holds the same words, so a screen reader hears why when it reaches
   the stepper, without opening anything. The popover shows the same words for a sighted
   reader.
9. **The disabled stepper.** `QuantityStepper` gains a whole stepper disabled state, drawn
   when its `disabled` input is true: no raised fill, the hairline (`--app-border-subtle`) in
   place of the strong border, the number in `--app-text-muted` at its usual size and
   weight, both glyphs in `--app-text-muted` at 60% opacity. The mock's note measures the
   number at 5.33 to 1 on Day and 6.66 to 1 on Night on the sheet.
   **It is `aria-disabled="true"`, never the `disabled` attribute.** It stays in the tab
   order and takes a press: a press, Enter or Space on it opens the popover of target state
   8 and changes nothing (no `stepped`, no `valueChange`, no write). The `disabled`
   attribute would take it out of the tab order and swallow the press, so the reader could
   never learn why. The stepper already marks its ends and its field with `aria-disabled`
   and `readOnly` (`quantity-stepper.html:27`, `:51`, `:60`, `:88`); the whole stepper state
   keeps that, and gives the host one output for a press while disabled, which the detailed
   view uses to open the popover. It also takes the id of the reason element as an input
   and puts it in `aria-describedby`.
10. **The row sheet loses** each entry's swap icon and "Change for all lists". Its steppers
    are unchanged by this plan; velista `0201` turns them into buys.
11. The change sheets return to the view they were opened from: the detailed view.
12. Keys under `basket.lists` in `en` and `es`, with the mock's words.

### Scope

- Work in `feature-shopping-lists` (row entries, the settle sheet, the new detailed view,
  the basket page's card holdings), `feature-shell` (the route), `models` (the doc comments
  of `BasketDemandRequest`), `data-access` (the fake's `setDemand`), the i18n files.
- In `libs/velista/ui/src/lib/list/quantity-stepper.*`, add the whole stepper disabled state
  of target state 9 and nothing else. Other lanes touch the same files: velista `0193` and
  `0194` (the hold), `0195` (the `snaps` input and the step words), `0201` (the `target`
  input). Rebase onto whichever of them lands first.
- **Every caller of `setDemand` in velista sends the whole ask, or goes.** After backend
  `0274` a `quantity` of `left` lowers the list's ask by what this basket bought. The
  callers on this branch, and the plan that changes each:
  - the row sheet's `demandRuns` and its send `demand` (`settle-sheet.ts:300` to `:304`,
    `:1564` to `:1577`, with `_fromNow` at `:1010`): velista `0201` removes them from the
    row sheet (its target state 9). This plan's detailed view is the new caller, with the
    whole ask;
  - the row sheet's other lists path, `raise` (`settle-sheet.ts:921` to `:965`), which calls
    `setDemand` for a list that holds the product at zero and calls `demand` with
    `from: entry.left` for a list that already asks: velista `0201` removes it (its target
    state 9, a buy for another list goes through `buyForList`);
  - the card holdings on the basket page (`basket-page.ts:2514` to `:2517`, the amount drawn
    is `entry.left`, and `:2589` to `:2600`, `_sendHolding` sends the run's `to` and `from`):
    **this plan**. Neither plan scoped them before; they are an ask stepper like this view's,
    so the holding's amount becomes `entry.asked` and the run sends the whole ask, with
    `from` as backend `0274` documents it. The sentence after a refused write keeps its
    words;
  - the fake (`basket-memory.ts:1423`) and its specs: **this plan**. Its `setDemand` reads
    `quantity` as the whole ask and sets the line's `left` from it by backend `0274`'s rule
    (target state 5 there: an ask below what the basket's buys met leaves `left` at 0).

  `BasketDemandRequest` (`basket-view.ts:1336` to `:1350`) says so in its doc comments:
  `quantity` is the list's whole ask, and `from` is what backend `0274` documents. The
  store's `setDemand` passes the body through and does not change.
- Do NOT change the change sheets, the settle actions, or what the row sheet's steppers do.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless.
- Rule E1 and the sheet rules: the detailed view is a route under the marker; no hand
  written `sheet` segment; the back control names its fallback.
- The look from the approved mock only; rule T1, the hygiene and contrast specs (the amber
  product line and the muted number of the disabled stepper on the sheet, Day and Night).
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop and ask if the mock shows something on a row this plan does not list.
- Stop if backend `0274` is not built, or if its route documentation does not say what
  `from` is for a whole ask (a stand in for its answers is fine while it is being built).
- Stop and ask if a caller of `setDemand` exists that the Scope does not name.
- Stop if velista `0206` is not built: the disabled stepper's popover needs its pointer.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot at 390 by 844, Day and Night: open the detailed view from the row sheet, change one
list's ask and see it on the zone list, change one list's product with "Change" and see its
line turn amber, open a picture, press the disabled stepper of another group's list and read
the popover, come back to the row sheet with the back control and with the browser back.

## 1. The mock's boards

The boards of `apps/velista/plans/mocks/basket-row-buys/`, each Day in English beside Night
in Spanish:

1. `Today.dc.html`: the row sheet as it is on `dev`, for comparison.
2. `RowSheet.dc.html`: the row sheet with "What you bought", the "Lists and amounts" button
   and no swap icons (this plan's way in, velista `0201`'s heading).
3. `Guest.dc.html`: a guest who can change nothing: no "Lists and amounts".
4. `Detail.dc.html`: the detailed view with the description, the product at the top, and
   three lists on one product, one of them `changeable`, so no "Change for all lists".
5. `DetailAll.dc.html`: "Change for all lists" in the product block, and one list on another
   product, its line in amber.
6. `Popover.dc.html`: "Another list" with its disabled stepper pressed and the popover open.
7. `LongDetail.dc.html`: a long list name and a long product name cut, the numbers never; a
   product with no photo.
8. `LongName.dc.html` and `OtherList.dc.html`: velista `0201`'s frames.

## 2. Specs

1. The button draws when one entry is changeable or editable, and not for a guest with
   neither.
2. The detailed view draws the description under its title on every visit.
3. The product block draws the row's picture, name, brand and size and price; "Change for
   all lists" draws in it with two changeable entries or more, and not with one.
4. The detailed view draws one row per entry with "Bought N of M" in plain text, and the
   stepper on every entry: enabled where the ask is editable, disabled elsewhere.
5. Each row draws its product line with picture, name and " · brand size"; the line has the
   quiet amber class when its product is not the row's product, and not when it is.
6. "Change" draws only where the entry is changeable, and it is the only element of the line
   that navigates; a click on the line's text does nothing.
7. A typed ask is sent once through `setDemand`; presses wait the quiet beat.
8. The ask stepper shows `entry.asked`, not `entry.left`: an entry asking 3 with 2 bought
   (`left` 1) shows 3, and one plus sends `setDemand` with `quantity: 4`, never `2`.
9. A card holding on the basket page shows `entry.asked`, and a run on it sends `quantity`
   the new whole ask. No caller of `setDemand` in velista sends `entry.left` as `quantity`
   (a spec over the store double asserts it for the detailed view and for the card).
10. The fake's `setDemand` with the whole ask leaves the entry's `asked` at that number and
    its `bought` unchanged.
11. "Change" and "Change for all lists" navigate to the change sheets; their back returns to
    the detailed view.
12. A press on a disabled stepper opens the popover with the words for a group the reader is
    not in, and with the group's name for the reader's own group; it sends nothing.
13. A picture with a photo opens the picture viewer; a product with no photo draws the
    default icon and no button.
14. In `quantity-stepper.spec.ts`: with `disabled` true the host carries the whole stepper
    disabled state and a press emits no `stepped`.
15. With `disabled` true no element of the stepper has the `disabled` attribute; the
    stepper carries `aria-disabled="true"` and stays in the tab order.
16. With `disabled` true, a click, Enter and Space each emit the press output once and no
    `stepped` or `valueChange`; in the detailed view each opens the popover and sends
    nothing.
17. The disabled stepper's `aria-describedby` names an element whose text is the popover's
    reason, for a group the reader is not in and for the reader's own group, before any
    press.
18. The disabled stepper's popover has `pointer` true and `keepInSight` the entry's row: its
    pointer's centre is on the stepper's centre, and neither the popover nor the pointer
    intersects the row.
19. The row sheet draws no swap icon and no "Change for all lists".
20. `routes.spec.ts` still passes: the new route is under the marker.

## 3. Acceptance criteria

- The product of a list can be changed only from the detailed view, and only through
  "Change" or "Change for all lists".
- A list's ask can be changed from the detailed view.
- A reader sees why an ask cannot be changed, and a screen reader hears it at the stepper.
- Every write of an ask from velista sends the list's whole ask.
- The row sheet keeps one job: recording buys (with velista `0201`).

## Not in this plan

- The buy steppers, the "What you bought" heading and the colours (velista `0201`).
