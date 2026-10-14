# 0142: a line bought from another shopping list

> Asked for by the owner on 2026-10-11: "If someone is buying things from a different list,
> you see that as bought and can't remove it. It's fine that you can't remove it because
> it's a change from a different shopping list, but the line should just say it was updated
> and now it needs less amount."
>
> His rules, in his words:
>
> - "If a line is settled from a different shopping list, you don't see that buy, the line
>   is crossed out just like when it is deleted from a zone list."
> - "If a line is partially settled from a different shopping list, the amount in your list
>   goes down accordingly."
> - "If, in a different shopping list, a buy is reverted, the amount in your shopping list
>   will go up accordingly, going from settled to partial buy if needed."
> - "In any case, a notification is shown at the top, just like when lines are edited from
>   a zone list. You can see who modified the line, but the shopping list name won't be
>   shown, just the owner of that list (for example the message should be something like
>   'Modified from a shopping list of XXXX')."
> - "This doesn't apply to other users using your shopping list, if they buy something, it
>   must be reflected accordingly in your shopping list."
>
> His answers of the same day: a guest sees "Someone". A buy made on the zone list reads
> "Bought from the list by X". A row that this shopping list bought part of, and somebody
> else finished, "moves to Done". "Buys from other baskets don't count toward anything in
> your shopping list (prices, remaining lines...)". "Deleted lines will also stay for 6
> hours."
>
> **Needs backend plan `0203` first.** It serves the state `BOUGHT_ELSEWHERE`, the two new
> kinds of change and `origin` on a change. If its contract is not on your base branch,
> say so and stop.
>
> **This plan reverses plan `0131`**: its targets 3, 4 and 6 (the look of a done row, the
> caption "Bought on another basket", the count read from `boughtElsewhere`), and the sum
> of plan `0132` that prices the units somebody else bought.
>
> **There is no mock, and none is needed as this plan is written.** It reuses the crossed
> out row of plan `0093` and the entry of the changes sheet, with new words. See "Action
> boundaries".
>
> Prerequisite reading: backend `0203` in full, velista `0131`, `0093` (marks, the banner,
> the changes sheet, when a client acknowledges), `0092` (nothing is removed), `0132` (the
> total), `0139` if it is on your base branch,
> `libs/velista/models/src/lib/basket-view.ts`, `enums.ts`, `basket-changes.ts`,
> `basket-total.ts`, `compose-basket-view.ts`,
> `libs/velista/data-access/src/lib/mapping/basket-mappers.ts`,
> `baskets/basket-memory.ts`, `baskets/basket-change-store.ts`,
> `libs/velista/feature-shopping-lists/src/lib/basket-row/`, `row-entries/`,
> `settle-sheet/`, `changes-sheet/`, and `libs/velista/ui/src/lib/basket/change-entry.ts`.

## What the build decided

The build of 2026-10-14 made the choices below. Each is a choice of the builder that the
owner can overturn. Where this section and a later section disagree, this section is right.

1. **The base had backend `0203` and velista `0139`.** The stop gap of `0139` is removed, not
   kept beside the new look: `basketElsewhere()`, `BasketElsewhere`, `basketDrawnDone()`,
   `elsewhereCaption()`, the `elsewhere` input of the row, `BasketViewRow.elsewhere` and the
   key `basket.elsewhere.caption`. The files and functions this plan names are where `0139`
   left them, except that `0139` added `basketDrawnDone()`, which went with the rest.
2. **One predicate decides what is crossed out.** `isCrossedOutRow` in `basket-view.ts`
   answers true for `REMOVED` and `BOUGHT_ELSEWHERE`. `countableBasketRows`, the sink, the
   search, the list filter, the usual filter and `basketRowsProgress` all ask it. So the
   tools bar, "all done" and the total leave such a row out, as section 3 asks.
3. **The total prices `bought` and `left`.** A row nothing is left of that this shopping list
   bought none of is also out of `lines`, because `countableBasketRows` leaves it out.
4. **The reads of `boughtElsewhere` that stay.** The row mapper and the entry mapper read it
   off the wire. `basket-row-fold.ts` sums it over the entries when it rebuilds a row from a
   write answer, so the rebuilt row carries the number the server would send. The memory
   twin computes it because it stands in for the server. No count and no sum reads it.
5. **A crossed out row draws no "Changed" tag.** It is the template of a `REMOVED` row, which
   draws none. Its mark still makes the row a seen target, so the reader's look at it is
   what acknowledges the change.
6. **Under a list heading, an entry bought elsewhere is crossed out** even when its row still
   asks for something on another list. The entry carries no note, so it reads "Already
   bought".
7. **The sheet of a `BOUGHT_ELSEWHERE` row is the title and the lists, and nothing else.**
   The price line, the rename field, the history link and "Add it to another list" are not
   drawn either. This is the plain reading of "and nothing else" in section 1.
8. **An entry bought elsewhere leads its caption with "Already bought"**, as in "Already
   bought · Weekly shop · Rope". The caption is cut at its end, and the browser walk showed
   a long line name cutting the words off when they came last.
9. **Every person in the changes sheet is named the same way:** from the participants of the
   basket, then from the zone members (`MemberNames`) of the list the change is on. Section
   4 says the owner "is resolved like an actor". Actors were named from participants alone,
   so Alice read "alice" on her buy and "Someone" on the line she added just before it. The
   sheet asks `MemberNames.ensure` once for each zone it needs, when it opens. A guest is
   served no list, so a guest asks nothing and is told "someone". This replaces the
   deferral that velista `0093` wrote in `basket-change-store.ts`.
10. **The reader is "you" by either key**: the participant id, or the account id. A buy on the
    list page names the account, never the participant.
11. **The changes sheet loads once the basket is known** (found in the walk). On a cold load
    of `…/sheet/changes` the page had not read the basket yet, `load()` returned with
    nothing, and the sheet drew its skeleton for good. This was on `dev` before this plan.
12. **The Spanish sentences quote a name with «»**, as every other sentence in `es.json`
    does, and not with the quotes of the table in section 4.
13. **The words fit on one line at 390 pixels** in both languages, so the long forms stay.
    Measured in the walk: "Bought from another shopping list" is 183 px wide and "Comprado
    desde otra lista de la compra" 213 px, each one line of 16 px.
14. **The memory twin seeds no new change.** Several specs count its change log. Its knob
    `buyElsewhere(lineId, quantity, origin)` writes the `BOUGHT` change and the note of the
    origin, and `revertElsewhere` writes `BUY_REVERTED`. A buy that moves no quantity writes
    no change, as backend `0203` point 9 says.
15. **`member.spec.ts` step 4 watches the banner from inside the page.** The page
    acknowledges a marked row after it has been on screen for 1.5 s, so "1 change" stands
    only for that long. The step waits for the earlier additions to be acknowledged, then
    polls the banner every frame from before the buy.

## Brief for the agent

### Objective

Draw a row that somebody bought outside this shopping list as crossed out, count it
toward nothing, and say in the changes sheet who it came from.

Use the `nx-portfolio-angular-developer`, `antislop` and `antislop-copywriting` skills.
Read the velista UI rules in `CLAUDE.md` before you touch a template.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **Such a row is a done row today.** `basketElsewhere()` (`basket-view.ts`) answers
  `{ count, closed }`. `basket-row.ts` uses `_closedElsewhere` to hide the reel and to
  make the status glyph a plain mark. The caption is `basket.elsewhere.caption`, "Bought
  on another basket".
- **The crossed out row exists.** `basket-row.html` draws a row with the state `REMOVED`
  as `.row.is-removed`: the name with a strike, and `basket.line.removed` ("No longer on
  the list") under it, for a reader who does not see a line through text. It has no
  control. `compose-basket-view.ts` puts `REMOVED` rows last, lets them pass every
  filter, and leaves them out of every count.
- **The total prices outside buys.** `basket-total.ts` adds
  `bought + boughtElsewhere` to `boughtCents`.
- **The banner is a count.** `ChangesBanner` shows `basket.changes.banner_one` and
  `banner_other` ("{{count}} changes on your lists") and opens the changes sheet.
- **The changes sheet names people.** `ChangeEntry` draws one sentence for each kind
  (`basket.changes.entry.*`), then who, then `basket.changes.entry.inList`. `_who` in
  `changes-sheet.ts` answers "You", a name, or "Someone".
- **An unknown kind of change is drawn** with `basket.changes.entry.unknown`.
- **After backend `0203`**: a row and an entry can have the state `BOUGHT_ELSEWHERE`. The
  note of a row is `BOUGHT_ON_ANOTHER_BASKET` for a buy through another shopping list and
  `BOUGHT_ON_THE_LIST` for a buy on the zone list page. A
  change can have the kind `BOUGHT` or `BUY_REVERTED`, and `origin`, which is
  `{ kind: 'ANOTHER_BASKET', owner }`, `{ kind: 'LIST' }` or null. A `REMOVED` row can
  arrive with no mark.

### Target state

1. A row with the state `BOUGHT_ELSEWHERE` is drawn crossed out, with its own words
   (section 1).
2. A row that outside buys only lowered looks like any row that changed (section 2).
3. No count and no sum of the page uses an outside buy (section 3).
4. The changes sheet has a sentence for the two new kinds, and a line that says where the
   buy came from (section 4).
5. A crossed out row with no mark is drawn (section 5).

### Scope

- `libs/velista/models`: `enums.ts`, `basket-view.ts`, `basket-changes.ts`,
  `basket-total.ts`, `compose-basket-view.ts`, their specs.
- `libs/velista/data-access`: `mapping/basket-mappers.ts`, the mapper of a change,
  `baskets/basket-memory.ts`, their specs.
- `libs/velista/feature-shopping-lists`: `basket-row/`, `row-entries/`, `settle-sheet/`,
  `changes-sheet/`, their specs.
- `libs/velista/ui/src/lib/basket/change-entry.ts` and its spec.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- `apps/velista-luna-e2e/src/member.spec.ts`: the step that plan `0131` added.

### Constraints

- **Rule D4.** The new state, the new note, the two kinds and `origin` are mapped from
  `unknown` into the models and enums of velista. A missing `origin` is null. An unknown
  state or note keeps the fallback of today.
- **No number is computed here that the server sent.** This plan removes a sum. It adds
  none.
- **No clock on the client.** A row leaves when a read no longer holds it.
- **The name of the other shopping list is never drawn.** The server does not send it.
- **A guest is never shown a name it was not served.** A null owner is "Someone".
- **The CSS budget of the basket page is nearly full.** Reuse `.row.is-removed` and the
  styles of an entry of the changes sheet. Add no new block of styles.
- **Copy is for people not at home with apps.** The page says "shopping list" and "list".
  It never says "basket", "row" or "line".
- Translation assets are in `libs/velista/ui/assets/`, not under `src/`.

### Action boundaries

- **Stop and ask before a new visual treatment**: an icon, a color, a badge, a new
  caption style, or a banner that prints a name. Those need a mock first, and the owner
  reviews mocks before plans.
- Do not change `BasketStore`, the socket or the refresh. Plan `0143` owns them.
- Do not change the zone list page or the backend.
- Do not build plan `0143`.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists velista/ui`
  pass.
- A browser walk at 390 pixels, in English and Spanish, with two accounts on one slot,
  each with the shopping list open. Put the screenshots in the pull request:
  1. A buys a product to zero. The row of B is crossed out with "Bought from another
     shopping list" on one line, the count of B drops by one row, the banner counts one
     change, and the sheet names A. Then A buys another product on the zone list page,
     and the row of B says "Bought from the list".
  2. A buys one of three. The row of B asks for two and carries the mark of a change.
  3. A takes the buy back. The row of B asks for three again.
  4. B buys two of three and A buys the last. The row of B is done and reads "2 of 2".
  5. A second person on the shopping list of B buys a product. B sees an ordinary done
     row with that person on it, and no change.
  6. A guest on the link of B opens the changes sheet. It says "Someone".

## 1. A row somebody else bought

A row with the state `BOUGHT_ELSEWHERE` is drawn with the template of a `REMOVED` row:
the name with a strike, and one line of words under it.

- **The words say where it was bought**, as the owner asked on 2026-10-11. They replace
  "No longer on the list" for this state only, and they come from the note of the row:

  | Note | English | Spanish |
  | --- | --- | --- |
  | `BOUGHT_ON_ANOTHER_BASKET` | "Bought from another shopping list" | "Comprado desde otra lista de la compra" |
  | `BOUGHT_ON_THE_LIST` | "Bought from the list" | "Comprado desde la lista" |
  | any other note | "Already bought" | "Ya está comprado" |

  The row does not say who. The changes sheet does.
- **The words stay on one line at 390 pixels** in both languages, beside a long product
  name. If they do not, use "Bought from another list" and "Comprado desde otra lista",
  and say so in the pull request.
- **Its place** is the place of a `REMOVED` row: last, through every filter. Read
  `compose-basket-view.ts` and add the state beside every test of `'REMOVED'` there.
- **It has no circle and no reel.** Nothing on it buys or takes back.
- **It still opens its sheet**, because a list can ask for the product again. The sheet
  shows the entries with the quantity control of today where `demandEditable` allows it,
  and no button that buys, skips or takes back. With plan `0139` on the base branch, that
  is the list of "Asked for on N lists" with its quantities, and nothing else.
- An entry with the state `BOUGHT_ELSEWHERE` inside a row that still asks for something
  (two lists ask for one product, and one of them was bought elsewhere) is drawn in the
  sheet with a quantity of 0 and "Already bought". An entry carries no note.
- The name of a product row comes from the product, as plan `0139` draws it. The strike
  applies to it the same way.

## 2. A row that only went down or up

With something left, an outside buy changes one thing on the row: the number.

- The caption `basket.elsewhere.caption` is not drawn any more. Remove the key and
  `_closedElsewhere`, and remove `basketElsewhere()` if nothing else reads it.
- The row carries the mark `CHANGED` that the server sends, drawn as plan `0093` draws it.
- The count of a done row reads `bought` and `asked`, as every done row does. A row that
  asked for three, of which this shopping list bought two and somebody else one, reads
  "2 of 2".
- The reel and the circle act on what is left, as today. A take back gives back the units
  this shopping list bought and no more. The server refuses the rest.

## 3. What an outside buy counts toward

Nothing.

- **The progress** comes from the server, which leaves these rows out. The sections of
  `compose-basket-view.ts` leave them out wherever they leave a `REMOVED` row out.
- **The total** (plan `0132`): `basket-total.ts` prices `bought` and `left`. It does not
  add `boughtElsewhere`. Rewrite the comment that explains the sum, and the spec.
- Search every other read of `boughtElsewhere` in `libs/velista` and remove it, or say in
  the pull request why it stays.

## 4. The changes sheet

Two sentences, in `basket.changes.entry`:

| Kind | English | Spanish |
| --- | --- | --- |
| `BOUGHT`, something left | "“{{name}}” was bought. You need {{after}} now" | "Se compró “{{name}}”. Ahora necesitas {{after}}" |
| `BOUGHT`, nothing left | "“{{name}}” was bought. You do not need it now" | "Se compró “{{name}}”. Ya no lo necesitas" |
| `BUY_REVERTED` | "A buy of “{{name}}” was undone. You need {{after}} now" | "Se deshizo una compra de “{{name}}”. Ahora necesitas {{after}}" |

`{{after}}` is `quantityAfter`. The name is resolved as it is for a change of quantity.

One line under the sentence says where the buy came from. It replaces both the "who" and
the "in {{list}}" of the other kinds:

| `origin` | English | Spanish |
| --- | --- | --- |
| `ANOTHER_BASKET`, the owner can be named | "Modified from a shopping list of {{name}}" | "Modificado desde una lista de la compra de {{name}}" |
| `ANOTHER_BASKET`, the owner is this reader | "Modified from another shopping list of yours" | "Modificado desde otra de tus listas de la compra" |
| `ANOTHER_BASKET`, the owner is null | "Modified from a shopping list of someone" | "Modificado desde la lista de la compra de alguien" |
| `LIST`, the buyer can be named | "Bought from the list by {{name}}" | "Comprado desde la lista por {{name}}" |
| `LIST`, the buyer is this reader | "Bought from the list by you" | "Comprado desde la lista por ti" |
| `LIST`, the buyer is null | "Bought from the list by someone" | "Comprado desde la lista por alguien" |
| null (a buy of this shopping list) | the "who" of today, and no list | |

- **The owner is resolved like an actor**: from the zone members the client holds, by
  `userId`. A `userId` it cannot resolve is "someone".
- A `LIST` entry does not print the name of the list either, so the two lines read as one
  family.
- The model gains `origin` on `BasketChange`, with its own type. The mapper builds it.
- The banner is unchanged. Its count now includes these changes, because the server
  counts them. The acknowledgement of plan `0093` is unchanged.

## 5. A crossed out row with no mark

After backend `0203` a `REMOVED` row stays for six hours, and the server sends
`mark: null` once the reader acknowledged it. Draw it crossed out with no mark of a new
change. Read the template and `ChangeAcknowledger` for a place that assumes a `REMOVED`
row always has a mark, and fix it.

## 6. Tests

- Mappers: the new state, the two kinds, each shape of `origin`, a missing `origin`, a
  malformed one.
- Models: the total does not price `boughtElsewhere`. `compose-basket-view` puts a
  `BOUGHT_ELSEWHERE` row where a `REMOVED` row goes and counts it nowhere.
- The row: the strike and the words of each of the three notes for the new state, no
  circle and no reel, no caption on a row that only went down, "2 of 2" on the mixed row.
- The sheet of a row: the quantity can be raised where `demandEditable` is true, and
  nothing buys or takes back.
- `ChangeEntry`: each sentence, each line of `origin`, in both languages. A guest gets
  "someone".
- The memory twin produces a row of each kind and the two kinds of change.
- `member.spec.ts`: the owner buys a line from the owner's shopping list, and the
  member's open shopping list shows the row crossed out with the words and one change in
  the banner. Run it on a slot and say in the pull request what it printed.

## 7. Not in this plan

- How fast the change arrives (plan `0143`).
- A way to take back a buy that somebody else made.
- A notification outside the app.
- The zone list page. A bought line leaves "To buy" there, and that is correct.
