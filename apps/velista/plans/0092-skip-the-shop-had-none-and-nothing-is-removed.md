> **PR:** [#439](https://github.com/IchirokuXVI/nx-portfolio/pull/439)

# 0092: skip, the shop had none, and nothing is removed

> Needs velista `0090`. Backend halves: `apps/luna-shopper-backend/plans/0137` (skip),
> `0136` (the add that names its list, the demand route, the product sent with a settle)
> and `0131` (who is allowed to change what a list asks for). The record of the series is
> backend `0130`. **No mock exists.** Every control here goes into a place the basket
> already has: the settle sheet's actions, the entries under it, the row's status slot and
> the composer dock. Sections 3 to 7 say what is drawn, in words.
>
> A shopper standing at a shelf has five things to say about a row, and the basket used to
> blur them. "I got it." "They had none." "Not today." "We need more of this, or fewer."
> "We also need batteries." The third had no control at all, so people dragged a number to
> zero or settled a line they had not bought. The fourth wrote to a private copy, or to a
> list, depending on which sheet was open. The fifth made a line that lived nowhere until
> somebody sent it somewhere. After this plan each is one gesture with one meaning, every
> one of them is recorded against a list or against the trip, **and none of them removes
> anything from a basket**, because a basket has nothing of its own to remove.
>
> Prerequisite reading: backend `0130` sections 3, 4, 5 and 11, backend `0137`, `0131` and
> `0136`, velista `0090`, velista `0052` section 6.3 (states by shape), `0054` sections 4
> and 6 (`from`, and what zero is never allowed to mean), `0053` and backend `0055`
> section 3 (the composer a guest was given, which this plan takes away),
> `libs/velista/feature-shopping-lists/src/lib/settle-sheet/` and `basket-row/` in full.

## Brief for the agent

### Objective

Build the skip gesture and its two drawn states, keep `NOT_AVAILABLE`, a skip and zero
visibly different, bring the composer back with a required target list, make what a list
asks for a gated control on an entry, and turn the product pane into one choice that
travels with the settle.

### Context

- After velista `0090` a row has `state` (`WANTED`, `PARTLY`, `DONE`, `NOT_AVAILABLE`,
  `SKIPPED`, `REMOVED`), `note` (`SKIPPED_EARLIER` or `null`), `pending`, `optionIds` and
  `entries`, all decided by the server. `SKIPPED` is drawn as `WANTED` there, the composer
  is not drawn, the "asks for" number under an entry is text, and the split is gone with
  its pane's arithmetic.
- The settle sheet's panes are `'settle' | 'quantity' | 'product' | 'history' | 'merge'`
  (`settle-sheet.ts:103`), and its three actions are `settleAll`, `settleSome` and
  `settleNone` (`:987` to `:1003`).
- The composer is `lib-line-composer` in a dock at the foot of the page
  (`basket-page.html:465`), gated by `canAdd` (`basket-page.ts:950`), with catalog
  suggestions from `BasketStore.suggest`.
- Velista's icons are components over `libs/velista/ui/src/lib/icons/` (`icons.ts`).
  `clock-icon`, `x-circle-icon`, `check-icon` and `slash-circle-icon` exist.
- The list page learns what its reader is allowed to do from `ShoppingList.myPermissions`
  (`models/src/lib/domain.ts:215`), folded into `canDecide` and its siblings
  (`models/src/lib/list-view.ts:230`). **The basket cannot use that.** Backend `0130`
  section 5 asks the demand rule of the basket's **owner**, not of the reader, and a
  reader never learns the owner's permissions. Section 6 names the one field that carries
  the answer.
- `SETTLEMENT_OUTCOMES` is `['BOUGHT', 'NOT_AVAILABLE']` and its comment
  (`models/src/lib/enums.ts:98`) says there is deliberately no `SKIPPED` member. That
  stays true. A skip is a state of a row and never an outcome of a settle (backend `0130`
  section 11, decision 3).

### Target state

Every acceptance criterion in section 13 holds.
`npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell`
and `npx nx build velista` are green.

### Scope

- Work only in: `libs/velista/models/src/lib/basket-view.ts` (two request types and two
  fields), `libs/velista/data-access/src/lib/generated-lists/` (`basket-service.ts`,
  `basket-api.ts`, `basket-memory.ts`, `basket-store.ts`, a new `basket-target-store.ts`),
  `.../mapping/basket-mappers.ts`, `libs/velista/platform/src/lib/storage-keys.ts` (one
  key), `libs/velista/feature-shopping-lists/src/lib/` (`basket-row/`, `settle-sheet/`,
  `row-entries/`, `basket-page/`, a new `target-list-sheet/`, `basket-paths.ts`,
  `basket-labels.ts`, `basket-error-copy.ts`), `libs/velista/feature-shell/src/lib/
  routes.ts` and its spec, and the two translation files.
- Do NOT touch: any backend project, `lib-line-composer`'s own behaviour beyond one new
  input, the zone list pages, the view pipeline's order and filter, the share and people
  sheets, `apps/velista-luna-e2e`.

### Constraints

- Load the `nx-portfolio-angular-developer` skill, and the `design-taste-frontend` skill
  for the two skipped states, the target chip and the target sheet.
- A state is told apart by **shape**, never by colour alone (velista `0052` section 6.3).
  A name is never struck through (velista `0043`).
- Amber is not attention. A skip is not a warning and takes no warning role.
- Every date on the screen is one the server sent, formatted with `Intl`. The client
  never decides that twelve hours have passed.
- Rule D4 for every new field. Rule D1: only the page and the sheets inject stores.
- The memory gateway learns every route in the same commit as the HTTP one.
- Check `libs/velista/ui/src/lib/icons/` before adding an icon. This plan needs none.
- Only make the changes this plan names. **No control that removes a row is added,
  anywhere.**

### Action boundaries

- Proceed with in scope edits, specs and a slot.
- Stop and ask when backend `0136` does not serve `demandEditable` on an entry
  (section 6), or when an add
  does not answer the row it landed on.
- Stop and ask before giving a guest any way to add a line, whatever a test seems to
  need.

### Progress evidence

Report after the store and gateway methods with their specs, after the row's states,
after the sheet's actions and the product pane, after the entries' demand control, and
after the composer with its target sheet. Each report names the run.

## 1. What is being built

| Piece                                                  | Where                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `skip`, `unskip`, `setDemand`, `addLine`                | `BasketServiceI`, `BasketApi`, `BasketMemory`, `BasketStore`  |
| The `SKIPPED` row and the `SKIPPED_EARLIER` caption     | `feature-shopping-lists` `basket-row/`                        |
| "Not today" in the settle sheet, and taking it back     | `settle-sheet/`                                               |
| What a list asks for, as a gated control                | `row-entries/`                                                |
| The product pane as one choice                          | `settle-sheet/`, `BasketStore.chosen`                         |
| The composer with a required list                       | `basket-page/`, `target-list-sheet/`, `BasketTargetStore`     |
| `add/list` as a sheet route, on both basket routes      | `feature-shell` `routes.ts`                                   |

## 2. Five gestures, and what each one writes

| The shopper means              | Control                                        | What is written                                             |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------- |
| I got it, or some of it        | the row's reel, "Got it", "Got some"           | a `BOUGHT` settlement on the list lines, naming the basket   |
| They had none                  | "They had none"                                | a `NOT_AVAILABLE` settlement. The list does not move         |
| Not today                      | "Not today"                                    | a skip, on the trip. The list does not move                  |
| The list needs more, or fewer  | the "asks for" control under an entry          | the list line's quantity, for everybody                      |
| We also need this              | the composer, with a list                      | a new line on that list                                      |

There is no sixth. **Nothing is removed from a basket**: the page, the row and the sheet
hold no delete, no hide and no "take off this list" control, and this plan adds none.
Removing a line is an act on a list, on the list page, behind that page's own rule. A
`REMOVED` row is how the basket shows that somebody did it, and drawing that row is
velista `0093`.

## 3. Skip

### 3.1 The gesture

- A fourth action in the settle sheet's `settle` pane, last, in the quiet button role:
  `basket.skip.action` ("Not today"). It is drawn on an open basket for a row in
  `WANTED` or `PARTLY`. Every participant gets it, a guest included (backend `0130`
  section 5).
- It calls `BasketStore.skip(rowKey)`, which is `PUT /v1/baskets/:id/rows/:rowKey/skip`,
  answers a `BasketRowResult`, and is folded like any row write. The sheet then dismisses
  through `SheetNavigation.dismiss(basketUrl)`.
- On a `SKIPPED` row the same pane leads with `basket.skip.undo` ("Back on the list"),
  which calls `BasketStore.unskip(rowKey)`, `DELETE` on the same route. The three buying
  actions stay below it: a person who skipped the bread and then found it buys it, and
  the server ends the skip with the purchase.
- `from` travels where backend `0137` asks for it. Backend `0130` section 8 says every
  row write carries it and names no exception.

### 3.2 The `SKIPPED` row

The status slot, where a done row has its tick and an unavailable row its cross, holds
`clock-icon`. Under the name, in the secondary text role: `basket.skip.caption`
("Skipped for now"). The reel is **not drawn**, which is the shape that tells it from a
wanted row at arm's length. The price stays. The name keeps its ordinary weight and is
never struck through. Tapping the row opens the settle sheet, as any row does.

- The row **stays where it is**. It does not sink. A row that jumps the moment a sheet
  closes is an order moving under a thumb (velista `0053` section 7), and the person who
  skipped it knows where it was.
- A `SKIPPED` row is still pending: it counts in `basket.pending` and toward no `done`.
  The server says so and the client recounts nothing.
- Under `grouping: 'list'` every entry row of a skipped row draws the same way. A skip
  covers the row.

### 3.3 After the window

Twelve hours later, by the server's clock, the row arrives as `WANTED` with
`note: 'SKIPPED_EARLIER'`. It is an ordinary row with its reel, and one quiet caption:

- `basket.skip.earlierOn` with the date, when the row carries `noteAt`.
- `basket.skip.earlier` without one, when it does not.

`noteAt` is the server's `skippedAt`. Backend `0130` names the note and no date, so
section 9 lists the field as one this plan needs. The date goes through `Intl` with
`dateStyle: 'medium'` in the reader's locale. The note leaves with the first purchase,
because the server stops sending it.

## 4. They had none, a skip, and zero

Velista `0054` section 6: "a number dragged to zero must never be able to mean the shop
had none." It gains a sibling: it is never allowed to mean "not today" either.

| What happened           | Control                        | Status slot     | Caption                          | Reel     |
| ----------------------- | ------------------------------ | --------------- | -------------------------------- | -------- |
| bought all of it        | the reel to zero, or "Got it"  | `check-icon`    | "`bought` of `asked`"            | at zero  |
| the shop had none       | "They had none", nothing else  | `x-circle-icon` | `basket.line.notAvailable`       | hidden   |
| not today               | "Not today", nothing else      | `clock-icon`    | `basket.skip.caption`            | hidden   |

- The reel commits a `BOUGHT` settle and nothing else, at every value including zero.
- `NOT_AVAILABLE` keeps its glyph, its caption and its revert exactly as velista `0044`
  section 4.2 left them.
- On a `LIVE` basket a `NOT_AVAILABLE` row returns to `WANTED` when the server's window
  passes, with **no note**. Backend `0130` has a note for a skip and none for this. The
  shop not having bread yesterday says nothing about today.

## 5. The product, chosen once and sent with the settle

The `product` pane stops being a way to split a row and becomes one question: **"Which
did you get?"**

- It lists `row.optionIds` in the server's order, each with its name and, when a shop is
  chosen, that shop's price through `offerAt`. One is selected. Selecting one closes the
  pane and returns to `settle`.
- The choice is `BasketStore.chosen: Signal<ReadonlyMap<string, string>>`, `rowKey` to
  product id, **in memory for the visit and never stored**. Backend `0136` deleted the
  stored pick, and this is what replaces it on the screen: the row draws the chosen
  product's name and price once somebody chose, and "No product chosen"
  (`basket.line.free`) with no price while nobody has and the row has several options. A
  row with exactly one option draws that option.
- Every `BOUGHT` settle from the sheet and from the reel sends `itemId` when the row has a
  chosen or a single option, and omits it otherwise.
- **Two products on one row are two settles.** Two whole milks and one skimmed is "Got
  some, 2" with the whole milk chosen, then "Got it" with the skimmed. Each settlement
  names one product, which is backend `0094`'s own opening argument, and the purchase
  history ends up truer than a split ever made it.
- Deleted copy: `basket.product.hint`, `hintNone`, `rest`, `noneRest`, `units`, `less`,
  `more`, `apply`, `notBought`, `split`. `basket.product.title`, `change`, `cheapest`,
  `noPrice` and `none` stay.

## 6. What a list asks for

### 6.1 The field that gates it

`BasketRowEntry.demandEditable: boolean`, decided by the server: the basket's owner holds
`DECIDE` or `MANAGE` on the entry's list when the line is `APPROVED`, or `WRITE` when it
is `PENDING` (backend `0130` section 5, backend `0131`). It is on the entry because the
rule is asked per list and per line. **No client rule can replace it.** The list page
reads `myPermissions`, which are the reader's own. Here the question is about somebody
else, the owner, and a guest has no permissions at all. Mapped from `unknown`, `false`
when absent.

### 6.2 The control

In `lib-row-entries` (velista `0090` section 9.2) the "asks for `left`" text becomes a
reel and an explicit `basket.demand.apply` button, for an entry where **all** of these
hold:

- the basket is open,
- `entry.demandEditable`,
- the entry's list was served to this reader (`entry.listId !== null`), **or** the row has
  exactly one entry. A reader who cannot tell two entries apart is never asked to choose
  between them, which is backend `0130`'s "single entry rows only".

So `lib-row-entries` is now drawn when the row has more than one entry, or its one entry
is served, or its one entry is `demandEditable`. A single unserved entry is labelled
`basket.demand.label` ("The list asks for").

- The reel runs from `0` to the house maximum and **does not commit on release**. The
  button does. This control rewrites a household's list for everybody, the gesture is
  rare, and a number that a thumb brushed is not a decision. Under the reel, once it
  moved: `basket.demand.everybody`.
- It calls `BasketStore.setDemand(rowKey, { lineId, quantity, from: entry.left })`, which
  is `POST /v1/baskets/:id/rows/:rowKey/demand`, and folds the `BasketRowResult`.
- **Zero is allowed and is not a removal.** The line stays on its list, asking for
  nothing, which is backend `0047`'s "stocked". The row leaves the basket when nothing
  of it is left to buy and nothing was bought this trip, and then the answer's `row` is
  `null`: the store drops it and the page says `basket.demand.nothingLeft` once.
- A `stale_quantity` refusal reads again and says `basket.error.staleLine`. A forbidden
  answer (the owner's standing moved between the read and the tap) reads again and says
  `basket.demand.refused`.
- An entry that fails the three conditions keeps the plain text. Nothing explains why a
  control is absent.

## 7. The composer, with a list

### 7.1 Who gets one

`canAdd` becomes: the basket is open, `basket.me` has an account (`kind` is `OWNER` or
`REGISTERED`), and `basket.lists` is not empty. `basket.lists` holds the covered lists the
**reader** can write (backend `0130` section 6), which is exactly the lists backend `0130`
section 5 lets that reader add to. A guest gets no dock, no field and no sentence about
it: velista `0038` section 2.1 refuses to draw an invitation that cannot be accepted, and
the product rule that a guest is never pushed to register forbids the sentence.

### 7.2 The target

- Above the field, inside the dock: a chip button, `basket.add.to` with the list's name
  ("To: Weekly shop"), or `basket.add.choose` while none is chosen. It opens the target
  sheet.
- `lib-line-composer` gains one input, `submitDisabled`, true while no target is chosen.
  The field stays usable, so a person can type first and choose second.
- With one list in `basket.lists` it is chosen and the chip is text, not a button.
- `BasketTargetStore`, a fourth route provider beside the three on **both** basket routes:
  `target: Signal<BasketListRef | null>`, `choose(listId)`, `restore(basket)`. It
  remembers one list id per basket on the device, under
  `basketTargetKey(basketId)` = `basket-target:<app>:<basketId>` in
  `libs/velista/platform/src/lib/storage-keys.ts`. `restore` drops a remembered id that is
  not in `basket.lists`, silently, and keeps the record. It is per basket where the view
  memory is per device (velista `0091` section 7), because a list belongs to a basket's
  coverage and a reading preference does not. It never expires: it is a convenience, and
  the chip shows its value before every add.
- `BasketPage` clears it in its teardown with the other three.

### 7.3 The target sheet

`TargetListSheet`, routed at `add/list` through `sheet()` on both basket routes (add it to
`basketSheetRoutes()`), so its URL is `…/sheet/add/list`. One radio group, the lists of
`basket.lists` under their group's name, in the server's order. Choosing one calls
`choose` and dismisses with `SheetNavigation.dismiss(basketUrl)`. It writes nothing.

### 7.4 The add

- `BasketStore.addLine({ targetListId, content, quantity, itemIds })` is
  `POST /v1/baskets/:id/lines` and answers a `BasketRowResult`. The add goes through the
  list's ordinary rules on the server, so it can land on a line the list already held
  (backend `0091`), and the answer is whichever row it landed on. The store folds it, and
  the polite region says `basket.added.announced` once, as today.
- A suggestion carries its product ids as `itemIds`, as the list page's composer does.
- A list that does not auto approve answers a row with `pending: true`. It is drawn in the
  basket with `basket.row.awaiting` ("Waiting for approval"), it is buyable, and nothing
  else about it differs. The person who typed "batteries" sees batteries.
- The field clears after a success and keeps its text after a failure, with the failure
  said through `basket-error-copy.ts`.

## 8. Rules this plan reverses

- Velista `0053` section 2, mirroring backend `0055` section 3.1: a guest was given the
  composer because "An added line has no target, so it changes nothing shared." Every
  line has a target now, so the safety argument is gone and the control goes with it.
- Velista `0056` section 4, and `0068` after it: sending a line to a list was a second,
  confirmed step. It is the first step, and there is no second.
- Velista `0073` section 3.2: the lists summary was "the only way an added line reaches
  a household". An added line is on a household's list before it is on the screen.
- Velista `0069`: the split, its announcement (`basket.product.split`) and
  `BasketStore.lastSplit`. Velista `0090` removed the code. This plan removes the pane's
  purpose and gives it another.
- Velista `0054` section 2 let a row's number rise above what the lists asked. Backend
  `0104` already stopped that. Section 6 is the only way a number rises, and it rises on
  the list.

## 9. Models and mapping

```ts
export interface BasketDemandRequest {
  readonly lineId: string;
  readonly quantity: number;
  /** The entry's `left` the person was looking at. */
  readonly from: number;
}

export interface BasketAddLineRequest {
  readonly targetListId: string;
  readonly content: string;
  readonly quantity: number;
  readonly itemIds?: readonly string[];
}
```

- `BasketRowEntry.demandEditable: boolean` (section 6.1).
- `BasketRow.noteAt: string | null`, an ISO instant, `null` when absent or malformed.
- `BasketSettleRequest.itemId` already exists (velista `0090`).
- `BasketServiceI` gains `skip(basketId, rowKey)`, `unskip(basketId, rowKey)` (a skip
  carries no `from`: backend `0137` section 5 says why, and refuses a row whose `left` is
  zero instead),
  `setDemand(basketId, rowKey, body)` and `addLine(basketId, body)`, each answering
  `BasketRowResult`.
- `BasketMemory` implements all four to backend `0130`'s rules: a skip younger than its
  window makes the row `SKIPPED`, an older one leaves `SKIPPED_EARLIER`, a purchase ends
  it, an add merges by the merge key, and `setDemand` refuses with `stale_quantity` on a
  wrong `from`. Its clock is injected, so a spec moves it past the window.

## 10. Copy

| Key                          | English                                                      | Spanish                                                          |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `basket.skip.action`         | Not today                                                    | Hoy no                                                           |
| `basket.skip.undo`           | Back on the list                                             | Volver a ponerlo                                                 |
| `basket.skip.caption`        | Skipped for now                                              | Saltado por ahora                                                |
| `basket.skip.earlierOn`      | Skipped on {{date}}                                          | Saltado el {{date}}                                              |
| `basket.skip.earlier`        | Skipped earlier                                              | Saltado antes                                                    |
| `basket.skip.state`          | skipped for now                                              | saltado por ahora                                                |
| `basket.demand.label`        | The list asks for                                            | La lista pide                                                    |
| `basket.demand.askLabel`     | {{name}}, asks for                                           | {{name}}, pide                                                   |
| `basket.demand.apply`        | Change the list                                              | Cambiar la lista                                                 |
| `basket.demand.everybody`    | This changes the list for everybody.                         | Esto cambia la lista para todos.                                 |
| `basket.demand.nothingLeft`  | {{name}} is no longer asked for.                             | Ya no se pide {{name}}.                                          |
| `basket.demand.refused`      | Only somebody who approves lines on that list can change it. | Solo quien aprueba líneas en esa lista puede cambiarlo.          |
| `basket.add.to`              | To: {{list}}                                                 | Para: {{list}}                                                   |
| `basket.add.choose`          | Choose a list                                                | Elige una lista                                                  |
| `basket.add.sheetTitle`      | Which list is this for?                                      | ¿Para qué lista es?                                              |
| `basket.row.awaiting`        | Waiting for approval                                         | Pendiente de aprobación                                          |

`basket.skip.state` is the words a row's accessible name uses. Reuse `basket.units.pending`
for `basket.row.awaiting` if a grep shows it says the same thing, and delete the
duplicate. Both files live in `libs/velista/ui/assets/i18n/`, beside `src`.

## 11. Accessibility

- A `SKIPPED` row is named by its content, then `basket.skip.state`, and the clock glyph
  is decorative because the words say it.
- "Not today" and "They had none" are two buttons with two names, never one toggle.
- The demand reel is labelled `basket.demand.askLabel` with the list's name, or
  `basket.demand.label`. `basket.demand.everybody` is tied to the button with
  `aria-describedby`, so the warning is read when the button is reached, not only when it
  is seen.
- The target chip is a button named by its whole text. The target sheet is a radio group
  with a legend, and group names are its option groups' labels.
- The dock's polite region still says one thing at a time. The split's sentence is gone
  from it.
- `basket.demand.nothingLeft` and a refusal go through the page's polite status element,
  once.
- The sheet's initial focus follows velista `0081`: the panel, not "Not today".

## 12. Tests

1. `skip` and `unskip` call `PUT` and `DELETE` on `…/rows/:rowKey/skip`, fold the answer,
   and never patch a state.
2. "Not today" is offered on `WANTED` and `PARTLY` only, to every kind of participant,
   and not on a finished basket. "Back on the list" leads on a `SKIPPED` row.
3. A `SKIPPED` row draws the clock, the caption and no reel, keeps its place in the
   section, and its name is not struck through.
4. `SKIPPED_EARLIER` draws the dated caption with `noteAt` and the undated one without,
   through `Intl` in the locale, and the row has its reel.
5. The three rows of section 4 draw three glyphs and three captions, and the reel at zero
   sends `BOUGHT` and never anything else.
6. The product pane selects one option, the choice survives closing the sheet and not a
   reload, and a `BOUGHT` settle carries that `itemId`. A row with several options and no
   choice sends none and draws no price.
7. The demand control appears only under the three conditions of section 6.2, for a guest
   on a single entry row included, and never for a guest on a row with two entries.
8. The demand reel does not write on release. The button sends `lineId`, `quantity` and
   `from`. A `null` row in the answer drops the row and says the sentence once.
9. `stale_quantity` and a forbidden answer each read again and say their own sentence.
10. `canAdd` is false for a guest, for an account with no served list, and on a finished
    basket. No dock is in the DOM in any of the three.
11. With no target the composer's submit is disabled and the field is not. With one list
    the chip is text. A remembered target outside `basket.lists` is ignored and kept.
12. An add sends `targetListId` and `itemIds`, folds a merged row in place, and draws a
    pending row as buyable with its caption.
13. `routes.spec.ts`: `add/list` is under the `sheet` marker on both basket routes.
    `BasketTargetStore` is a provider of both, and `BasketPage` clears it.
14. `BasketMemory`, with an injected clock: a skip, the window passing, a purchase ending
    it, and an add that merges.
15. No template in `feature-shopping-lists` holds a control that deletes or hides a row.
    One spec greps the templates for the delete and trash icons and for the removed store
    methods, and names any file that has one.

## 13. Acceptance criteria

- [ ] "Not today" marks a row without touching any list, for anybody on the basket, and
      one tap takes it back.
- [ ] A skipped row, a row the shop did not have and a row bought down to zero cannot be
      mistaken for one another in either theme, in greyscale.
- [ ] Twelve hours later the row is ordinary again and says when it was skipped, by the
      server's date, until it is bought.
- [ ] What a list asks for changes only where the server said it is allowed to, only
      after an explicit button, and the screen says it changes the list for everybody.
- [ ] A line is added only with a list, only by somebody with an account who can write
      that list, and appears in the basket at once, approved or not.
- [ ] The product somebody got is recorded on the purchase, and nothing is stored about
      it before the purchase.
- [ ] Nothing on the basket removes a row.

## 14. Verification

```sh
npx nx run-many -t lint test -p velista/models velista/data-access velista/ui velista/feature-shopping-lists velista/feature-shell
npx nx build velista
tools/dev/ng-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
tools/dev/ng-slot.sh --up --apps shell,velista
```

On the slot, with an owner, a named person who holds `WRITE` only, and a guest on a link:
skip a row as the guest and take it back as the owner. Record "They had none" on a second
row and buy a third down to zero, and compare the three in both themes. Add "batteries"
as the named person to a list that does not auto approve, and buy it while it waits.
Check that the guest has no dock. Change what a list asks for as the guest on a row with
one entry, then open a basket whose owner holds `WRITE` only on an approved line and check
that everybody on it sees text where the first basket had a control. Give the slots back.
