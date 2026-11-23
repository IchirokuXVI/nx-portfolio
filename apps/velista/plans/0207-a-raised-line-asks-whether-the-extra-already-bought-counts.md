> **PR:** [#1089](https://github.com/IchirokuXVI/nx-portfolio/pull/1089)

# 0207: a raised line asks whether the extra already bought counts

> Superseded in part on 2026-11-23 by velista `0208` (`0208-every-raise-asks-about-the-extra-and-the-amount-set-stands.md`):
> the default is now the amount the person set, and the extra is counted only on the
> explicit answer.
>
> Decided by the owner on 2026-11-22. A list's line was bought above its ask in an open
> shopping trip: the list asked 3 and Marta bought 4, so 1 unit is extra. A person then
> raises that line on the zone list page. Without a question, the list asks for the new
> amount on top of the extra, and the household buys too much. The owner's rulings:
>
> - The question opens in a popover with a pointer on the row's amount control (the button
>   stepper in the default view, the reel in the compact view), only after the control's
>   quiet beat has passed **and** the save has answered.
> - Its words, ES: "Marta ya compró 1 de más. ¿Sigues necesitando 2 o solo 1?" with the
>   answers "Sigo necesitando" 2 uds and "Contar lo comprado de más" 1 ud. EN: "Marta
>   already bought 1 extra. Do you still need 2, or just 1?" with "Still need" 2 units and
>   "Count the extra" 1 unit. When the extra covers the raise it never prints 0: "¿Sigues
>   necesitando 1 o con eso basta?" with "Sigo necesitando" 1 ud and "Con eso basta"; "Do
>   you still need 1, or is that enough?" with "Still need" 1 unit and "That's enough". The
>   sentence prints a count bare; the answers carry "ud" / "uds" and "unit" / "units". A
>   weight carries its unit everywhere ("500 g", "1,5 kg").
> - Who is named: the person who bought the extra. For a guest's buy, it is the owner of the
>   shopping list (the basket) the guest bought in. In the owner's words: if a guest buys
>   milk in Maria's shopping list, the zone list shows Maria's name, because the milk was on
>   her shopping list, the guest is unknown there, and it is Maria's responsibility. Two
>   buyers: "Marta y Luis ya compraron 2 de más." / "Marta and Luis already bought 2
>   extra." Two buyers where one is the reader: "Tú y Luis ya comprasteis 2 de más." / "You
>   and Luis already bought 2 extra." Two buyers where one has no name: "Luis y otra persona
>   ya compraron 2 de más." / "Luis and someone else already bought 2 extra." Three or more:
>   "3 personas ya compraron 2 de más." / "3 people already bought 2 extra." The reader: "Ya
>   compraste 1 de más." / "You already bought 1 extra." No name: "Alguien ya compró 1 de
>   más." / "Someone already bought 1 extra." **The owner reviews this wording after the
>   build.**
> - **What stands when nobody answers is the smaller amount.** Closing the popover or
>   leaving the page keeps what is still needed after the extra is counted. "Still need" is
>   the answer that changes something: it puts the line at the amount the person set.
> - After "Still need" the line does not ask again while the person stays on the page. A
>   later raise asks again only while extra units remain that nobody counted.
> - A row out of view when the answer comes is scrolled to by the page, then the popover
>   opens, and the row and the popover flash in the accent colour.
> - A reel asks after it closes on its value, never while its tape is up. A lowering never
>   asks. Only the zone list rows ask: the line page, the line sheet, the catalog and the
>   product page do not.
> - The owner's answers to the plan's open points, on 2026-11-22:
>   - When the question opens, focus starts on "Count the extra" ("That's enough" when the
>     extra covers the raise), the answer that changes nothing.
>   - A press on the row's amount control while its question is open closes the question,
>     keeps the smaller amount, and then steps as usual.
>   - A second line's question while one is open replaces the open one. The first line
>     keeps its smaller amount.
>   - The due rows do not ask and do not send the flag. To add a due row is not a raise of
>     a line bought above its ask in this trip.
>   - A line the extra covers is hidden as any line at 0 (velista `0192`).
>   - A dropped write that the person sends again carries the flag again.
>
> The count itself is the server's (backend `0275`): the zone list's raise carries
> `countExtra: true`, core counts the extra inside that write, and its answer says how much
> was extra, how much it counted and who bought it. This page only asks, and sends one more
> raise for "Still need". So a person who leaves before the answer has the smaller amount,
> as the owner ruled, with nothing left for this page to do.
>
> **Release rule: release this plan and backend `0275` together, after the set of velista
> `0200` and `0201` and backends `0273` and `0274`.** It depends on velista `0206` (the
> pointer), backend `0275` (the flag and its answer), backend `0274` (what "above the ask"
> is) and velista `0201` (the wire `asked`, which the same release brings). It touches
> `list-page.ts` and `line-row.*`, which velista `0199`, `0202`, `0203` and `0205` also touch:
> **build it after those four**, on top of them.
>
> **The mock is approved**: the board `OverBought.dc.html` in
> `apps/velista/plans/mocks/compact-reel/`, published at
> https://claude.ai/artifact/U74Z1MyvcxEK6PN3CRn8N6, with the notes `ob-words`, `ob-frame`,
> `ob-pointer` and `ob-when` in its `canvas.json`. Where a note and the rulings above
> disagree, the rulings win: the note `ob-frame` says Escape and a press outside close the
> popover like its first answer, and the note `ob-doubts` item 2 says the amount set stands.
> Both were written before the ruling that the smaller amount stands. The board's note that
> puts focus on the first answer ("Still need") is replaced too: focus starts on "Count the
> extra". And `ob-doubts` item 8, which draws a covered line as the stepper at 0, is replaced
> by the ruling that hides it.
>
> Code anchors, on `dev` at `3f26ae3d3`: `libs/velista/feature-lists/src/lib/list-page/list-page.ts:1823`
> (`quantityRuns`), `:1833` (`_writeRun`, also reached at teardown and when the page is
> hidden, through `quantityRuns`), `:2003` (`changeQuantity`), `:1250` (the replay of a
> dropped write, velista `0159`), `:1814` (`_teardown`); `list-page.html:170` to `:178` (the add
> choice popover of velista `0170`, the page level popover this one copies) and `:348`,
> `:435`, `:478`, `:494` (the rows); `leaving-row-focus.ts` (rows found by their
> `data-line-id`); `libs/velista/platform/src/lib/quantity-runs.ts` (the quiet beat, and the
> flush at destroy and on `visibilitychange`); `libs/velista/data-access/src/lib/lines/line-store.ts:933`
> (`addQuantity`, optimistic, the overlay on `quantity`), `line-service.ts:185`,
> `line-api.ts:267` (`POST lines/:id/quantity`), `line-memory.ts:634`;
> `libs/velista/ui/src/lib/list/line-row.{ts,html}` (the stepper, and the reel after velista
> `0203`); `libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.ts:162`
> and `:533` (`MemberNames.nameOf(zoneId, userId)`) and `:164` (`SessionStore`);
> `libs/velista/platform` (`shortAmount`, the short form words of an amount);
> `libs/velista/ui/src/lib/styles/_themes.scss:127`, `:138`, `:234`, `:245`
> (`--app-action-quiet-fg`, `--app-action-quiet-bg`); `libs/velista/ui/assets/i18n/{en,es}.json`.

## Brief for the agent

Load the "Angular conventions" of CLAUDE.md and the `design-taste-frontend` skill.

### Objective

On the zone list page, send every raise of a row's amount with `countExtra: true`, and when
the answer says that units bought above the ask were counted, open a question in an
`AnchoredPopover` with a pointer on the row's amount control, with the owner's words, two
answers, a scroll to the row and a flash, in both views.

### Context

- A row's presses go into one run per line (`quantityRuns`) and are written after the quiet
  beat as one delta by `_writeRun` and `changeQuantity`, through `LineStore.addQuantity`,
  which patches the row at once and claims `quantity` until the answer. A page that goes
  away or is hidden writes its open runs.
- After backend `0275`, a raise with the flag can answer a line lower than the client drew:
  the server moved the extra into the ask and raised the line only by the rest. The answer's
  `extra` carries `above` (the extra before the write), `counted` and `buyers`
  (`{ userId: string | null }` each, a guest already replaced by the owner of the basket the
  guest bought in, no names).
- A reel (velista `0203`) writes its step at once when its tape closes.
- Velista names a user through `MemberNames.nameOf(zoneId, userId)`, and the reader's own id
  is `SessionStore.userId()`.
- A line at 0 that was bought leaves To buy (velista `0192`); velista `0199` keeps a line
  drawn while it holds it in a set.

### Target state

1. **The flag.** `_writeRun` sends `countExtra: true` with every run whose delta is positive,
   unless the line is in the page's `stillNeeded` set (target state 10). This covers the
   teardown write and the write when the page is hidden, which go through `_writeRun`. A
   negative delta never sends it. No other page or control sends it: the line page, the line
   sheet, the catalog, the product page and the basket keep their calls as they are.
   - The due rows of the zone list page (velista `0089`, `0203`) never send it and never
     ask. To add a due row is not a raise of a line bought above its ask in this trip.
   - A dropped write that the person sends again (velista `0159`, "Send it again", the
     replay at `list-page.ts:1250`) carries the flag again when the dropped write carried
     it, and its answer asks by target state 3 as any other answer.
2. **The data layer.** The flag and the answer travel without changing the other callers:
   - `LineService` gains a call that sends `countExtra: true` and answers the line and the
     extra, for example `raiseCountingExtra(lineId, delta, unit): Promise<{ line: Line;
     extra: CountedExtra }>`. `LineApi` maps `extra` from `unknown` (rule D4): a field that
     is not a non negative integer, or a buyer that is not `{ userId: string | null }`,
     maps to no question (`extra` null), never to a guess.
   - `LineMemory` answers `extra` with `above: 0`, `counted: 0`, `buyers: []`, and its spec
     double can be told to answer another `extra`.
   - `LineStore` gains the same write with its overlay and its dropped write record (velista
     `0159`), answering the outcome and the extra, for example `raiseCountingExtra(lineId,
     delta, options)`. On `succeeded` the line is patched from the answer, so the row draws
     the server's amount.
   - `CountedExtra` (`above`, `counted`, `buyers`) is a model in `libs/velista/models`.
3. **When it asks.** The page opens the question when all of these hold:
   - the write answered `succeeded` with `extra.counted > 0`;
   - the page is not being torn down (`_teardown.destroying` is false);
   - no newer run of the same line is open or was sent after this one. A newer run replaces
     the question: the earlier count stands, and the newer answer asks on its own;
   - the line's control is at rest: in the compact view the reel's tape is down. If the tape
     is up when the answer comes, the question waits until it closes, and is dropped if that
     close sends a new run.
   No other answer opens anything. In particular a raise with `counted: 0` opens nothing.
   One question is open at a time. When another line's question is to open while one is
   open, the new one replaces the old one: the old popover closes as after "Count the
   extra", so its line keeps the smaller amount `Z`, and the new one opens.
4. **The numbers.** From the answer: `X` is `extra.above`, `Z` is the answered line's
   `quantity` (what is still needed after the count), and `Y` is `Z + extra.counted` (the
   amount the person set). `Y` is read from the answer, not from the run, so a write of
   another person that landed in between is not undone.
5. **The words.** The question is one paragraph of two sentences, the title of the popover:
   - the first sentence names the buyers and `X`, by the rule of target state 6;
   - the second asks about `Y` and `Z`: `list.extra.ask` ("Do you still need {{asked}}, or
     just {{left}}?" / "¿Sigues necesitando {{asked}} o solo {{left}}?") when `Z > 0`, and
     `list.extra.askEnough` ("Do you still need {{asked}}, or is that enough?" / "¿Sigues
     necesitando {{asked}} o con eso basta?") when `Z = 0`. Nothing ever prints 0;
   - in the sentences a count is a bare number ("1", "2"); a weight or a volume is its short
     form with its unit (`shortAmount`: "500 g", "1,5 kg");
   - a non breaking space joins "just" / "solo" to the last amount, and the number to its
     unit, as the board writes it.
   The two answer rows, in this order:
   - "Still need" / "Sigo necesitando", with the amount `Y`;
   - when `Z > 0`, "Count the extra" / "Contar lo comprado de más", with the amount `Z`;
     when `Z = 0`, "That's enough" / "Con eso basta", with no amount.
   An answer's amount is a count with its word, `list.extra.units` with a count ("1 unit",
   "2 units" / "1 ud", "2 uds", plural by i18next `_one` / `_other`), or a weight's short
   form ("1,5 kg").
6. **Who is named**, from `extra.buyers`, in the language of the page:
   - one buyer whose `userId` is the reader's own: `list.extra.boughtByYou` ("You already
     bought {{amount}} extra." / "Ya compraste {{amount}} de más.");
   - one buyer whose name `MemberNames` resolves: `list.extra.boughtBy` ("{{name}} already
     bought {{amount}} extra." / "{{name}} ya compró {{amount}} de más.");
   - one buyer with a null `userId` or a name that does not resolve:
     `list.extra.boughtBySomeone` ("Someone already bought {{amount}} extra." / "Alguien ya
     compró {{amount}} de más.");
   - two buyers, both resolved and neither the reader: `list.extra.boughtByTwo` ("{{first}}
     and {{second}} already bought {{amount}} extra." / "{{first}} y {{second}} ya
     compraron {{amount}} de más."), in the order of `buyers`;
   - two buyers, one the reader and the other resolved: `list.extra.boughtByYouAndOne`
     ("You and {{name}} already bought {{amount}} extra." / "Tú y {{name}} ya comprasteis
     {{amount}} de más."), the reader always first;
   - two buyers, one resolved and neither the reader, the other with a null `userId` or a
     name that does not resolve: `list.extra.boughtByOneAndSomeone` ("{{name}} and someone
     else already bought {{amount}} extra." / "{{name}} y otra persona ya compraron
     {{amount}} de más."), the named buyer always first;
   - three buyers or more: `list.extra.boughtByMany` with the count ("{{count}} people
     already bought {{amount}} extra." / "{{count}} personas ya compraron {{amount}} de
     más.").
   Two buyers where neither can be named, or where one is the reader and the other cannot
   be named, are not ruled (see Action boundaries).
7. **The popover.** An `AnchoredPopover` drawn by the page, as the add choice of velista
   `0170` is: frame `choice` (276 px, rows to its edges), `pointer` true (velista `0206`),
   `origin` the row's amount control (the stepper's capsule or the reel's pill),
   `keepInSight` the row, `align` `end`, `side` `below` when the row is in the upper half of
   the list's visible area and `above` otherwise. Inside, as the board draws it: the
   question in 15 px, weight 600, with 16 px side padding and 12 px under it; each answer a
   48 px row with the words at its start and the amount at its end (14 px, weight 650, never
   wrapped), with the hairline between rows. No icon and no tint. It covers neither the row
   nor its control, in either view (velista `0206`).
   The row's control shows `Y` while the popover is open, as the board draws it, and the
   store holds `Z`.
   When the popover opens, focus moves to the answer that changes nothing: "Count the
   extra" when `Z > 0`, "That's enough" when `Z = 0`. Focus never starts on "Still need".
8. **The row stays drawn.** While the question is open, its line is drawn where it was, even
   at `Z = 0` where velista `0192` would take it out of To buy. After the question closes, the
   line follows velista `0192` as any other line: a line the extra covers (`Z = 0`) is
   hidden as any line at 0 (the owner confirmed it on 2026-11-22).
9. **The answers.**
   - "Still need": the page sends one raise of the line by `extra.counted` without the flag,
     through `changeQuantity` as today (optimistic, with its dropped write record), puts the
     line in `stillNeeded`, and closes the popover. The row shows `Y`.
   - "Count the extra" or "That's enough": nothing is sent. The popover closes and the row
     shows `Z`.
   - Escape, a press outside the popover and the back gesture: nothing is sent, the popover
     closes, the row shows `Z`. Leaving the page closes it the same way.
   - A press on the row's own amount control (a stepper button, or the reel): nothing is
     sent for the question. The popover closes, the line keeps `Z`, and the press then steps
     from `Z` as usual, into a new run of `quantityRuns`.
10. **Asking again.** `stillNeeded` is a set of line ids that lives as long as the page
    component. A line in it never sends the flag, so it never asks again while the person
    stays. Every other raise sends the flag and asks whenever the server counted something,
    so a line asks again only while extra units remain that nobody counted.
11. **The scroll.** When the question is to open and the row is not wholly inside the list's
    visible area (below the sticky header and search block, above the bar), the page first
    scrolls the row into that area, at the side that leaves room for the popover, then opens
    it. The scroll is smooth, and instant under `prefers-reduced-motion: reduce`. A row the
    current search or filter does not draw is not scrolled to and asks nothing.
12. **The flash.** When the popover opens, the row and the popover pulse 3 times: each pulse
    600 ms (240 ms in, 120 ms held, 240 ms out), 200 ms apart, 2.2 s in all. In the accent
    frame the row takes the wash `--app-action-quiet-bg` and an inset outline of 1.5 px in
    `--app-action-quiet-fg`, drawn on a layer that reaches 8 px past the row on each side
    with a 12 px radius (the board's `.asked::before`). The popover takes `accent` (velista
    `0206`) with `--anchored-popover-accent: var(--app-action-quiet-fg)`, so its border and
    pointer turn amber; it gets no fill. Text keeps its colours. Under
    `prefers-reduced-motion: reduce` nothing pulses: the accent frame holds for the same
    2.2 s and then goes. The durations are constants in `libs/velista/models` beside
    `QUANTITY_STEP_QUIET_MS`.
13. **Both views.** The same question, words, pointer and flash for the button stepper in the
    default view and for the reel in the compact view (velista `0202`, `0203`).
14. **The keys**, in `libs/velista/ui/assets/i18n/en.json` and `es.json`, under `list.extra`:
    `boughtBy`, `boughtByYou`, `boughtByTwo`, `boughtByYouAndOne`, `boughtByOneAndSomeone`,
    `boughtByMany`, `boughtBySomeone`, `ask`,
    `askEnough`, `stillNeed`, `count`, `enough`, and `units_one` / `units_other` ("{{count}}
    unit" / "{{count}} units"; "{{count}} ud" / "{{count}} uds"), with the words above.

### Scope

- Work in `feature-lists` (the list page), `data-access` (the line service, API, memory and
  store), `models` (`CountedExtra`, the flash constants), `ui` (the row exposes its amount
  control for the anchor, and its flash layer), and the i18n files.
- Do NOT change `AnchoredPopover` (velista `0206`), the stepper or the reel, the line page,
  the line sheet, the catalog, the product page or the basket.

### Constraints

- Angular conventions of CLAUDE.md: standalone, `OnPush`, signals, zoneless; no
  `@angular/core/rxjs-interop` in services.
- Rule D4 for the answer; rule T1, the hygiene spec and the contrast spec for the wash (the
  board's note `ob-when` measures the smallest muted text at 4.8 to 1 on the Day wash and
  6.5 to 1 on the Night wash).
- The words from the rulings only, never from the board's older notes (`ob-words` proposes
  "pc" / "pcs" and a unit on every count, which the ruling replaced).
- No dashes as punctuation in copy or comments.

### Action boundaries

- Stop and ask before you build the words for two buyers where neither can be named, or
  where one is the reader and the other cannot be named. The owner ruled the other cases of
  two buyers (target state 6), not these two.
- Stop if backend `0275` is not built or its answer differs from its plan.

### Progress evidence

The specs of section 2; `npx nx affected -t lint test`; `npx nx build velista`; a walk on a
slot against a Luna slot with backend `0275`, at 390 by 844, Day in Spanish and Night in
English, in both views: buy 4 of a line asking 3 from a basket as another member, raise the
line to 2 on the zone list and read the question; answer each way and read the row; raise
and scroll away before the answer (network on "Slow 4G") to see the scroll and the flash;
raise and leave the page, come back and see the smaller amount; the same with reduced
motion.

## 1. The board's frames

`OverBought.dc.html`, Day in Spanish and Night in English:

1. Default view, the row near the top: the popover below, its pointer on the stepper.
2. Compact view, the row near the bottom: the popover above, its pointer on the reel.
3. The extra covers the raise: "or is that enough?", the second answer with no amount.
4. A weight: "500 g extra", "1,5 kg or just 1 kg".
5. No name: "Someone".
6. The row after each answer. Its left half ("Still need") holds. Its right half, the
   smaller amount after "Count the extra", after closing and after leaving, is what the
   ruling makes the default.
7. The flash.
8. The row out of view, scrolled back before the question opens.
9. Two buyers. 10. Three buyers or more. 11. The reader is the buyer. 12. No name, in the
   popover alone.

## 2. Specs

1. A run with a positive delta sends `countExtra: true`; a negative delta does not; a line in
   `stillNeeded` does not; the teardown write and the write on `visibilitychange` send it.
2. The line page, the line sheet, the catalog and the product page never send the flag (a
   spec over the store double).
3. `LineApi` maps a well formed `extra`, and maps a malformed one to null with no question.
4. An answer with `counted: 0` opens nothing. An answer with `counted > 0` opens the popover
   with `pointer` true, `keepInSight` the row and the origin on the stepper (default view) or
   the reel (compact view).
5. A newer run of the same line before the answer drops the earlier question; the reel's
   tape up delays the question until it closes.
6. The words for one named buyer, the reader, no name, two buyers and three buyers, with
   `Z > 0` and `Z = 0`, in `en` and `es`, for a count and for a weight: each of the board's
   sentences, character for character, non breaking spaces included.
7. The answer rows: "Still need" with `Y`, "Count the extra" with `Z` or "That's enough" with
   no amount; "1 unit" and "2 units", "1 ud" and "2 uds".
8. "Still need" sends one raise by `counted` without the flag and puts the line in
   `stillNeeded`; a later raise of that line on the page sends no flag and asks nothing.
9. "Count the extra", "That's enough", Escape and a press outside send nothing and leave the
   row at `Z`.
10. While the popover is open the row is drawn, also at `Z = 0`, and its control shows `Y`.
11. A row out of the visible area is scrolled into it before the popover opens; with reduced
    motion the scroll is instant.
12. The flash runs 3 pulses in 2.2 s and then stops; with reduced motion the accent frame
    holds 2.2 s with no animation. The popover's accent reads `--app-action-quiet-fg`.
13. The contrast spec covers the muted text on the wash, Day and Night.
14. When the popover opens, focus is on "Count the extra" (`Z > 0`) or "That's enough"
    (`Z = 0`), never on "Still need".
15. A press on the row's control while its question is open closes the popover, sends
    nothing for the question, and steps from `Z` in a new run.
16. A question for a second line while one is open closes the first one with its line at
    `Z` and opens the second one.
17. The words for two buyers where one is the reader ("Tú y Luis ya comprasteis 2 de más." /
    "You and Luis already bought 2 extra.") and where one has no name ("Luis y otra persona
    ya compraron 2 de más." / "Luis and someone else already bought 2 extra."), character
    for character, with the reader or the named buyer first whatever the order of `buyers`.
18. A due row's add sends no flag and opens nothing.
19. A dropped write with the flag, sent again, carries the flag again, and an answer with
    `counted > 0` opens the question.
20. After the question closes, a line at `Z = 0` that was bought is hidden from To buy as
    velista `0192` hides any line at 0.

## 3. Acceptance criteria

- A raise on a zone list row over units bought above the ask asks the owner's question,
  pointed at that row's control, once the save has answered.
- Nobody's answer, a closed popover and a left page all leave the smaller amount.
- "Still need" puts the line at the amount the person set, and the line does not ask again
  on that visit.
- No other page asks.

## Not in this plan

- The count itself (backend `0275`).
- The pointer (velista `0206`).
- A question on the line page, the line sheet, the catalog, the product page or the basket.
