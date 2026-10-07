> **PR:** [#607](https://github.com/IchirokuXVI/nx-portfolio/pull/607)

# 0188: a line bought through another basket stays a row

> Reported by the owner on 2026-10-04, as the first thing to build. Two or more people
> shop the same zone list, each from their own basket. One of them buys a line. The row
> disappears from every other basket. The buyer keeps it. The owner's rule: the rows of a
> basket come from the covered lists **and** from the recent purchases, so a line that was
> bought lately is a row even at zero.
>
> Prerequisite reading: plan `0130` sections 4 and 6 (what a row is, what a reader is allowed to
> see), plan `0134` (a purchase names its basket), plan `0135` (what a trip asked, written
> down when it ends), plan `0136` (the open basket is a view of its lists), plan `0137`
> (a skip and its window), `core/src/app/baskets/basket-read.sql.ts` (`BASKET_SESSION_SQL`,
> `coveredLinesSql`, `BASKET_SETTLEMENTS_SQL`), `basket-read.service.ts`, `basket-rows.ts`
> (`progressOf` and the state table), `basket-revert.service.ts`,
> `basket-trip-rows.service.ts`, and `libs/luna-shopper/contracts/src/lib/enums/basket.enums.ts`.
> Velista `0131` is the half that draws the row.

## Brief for the agent

### Objective

Make the basket read keep a covered line that somebody bought lately through **another**
basket, or through no basket, and say on the row that it was bought there.

### Context

Read from the code on 2026-10-04, on `dev` at `73fb7ce9`. **Nobody reproduced the defect
on a running stack yet.** Reproduce it first (step 1 of "Order of work").

- **Each person has one `LIVE` basket.** It covers every list that person can write. Two
  members of one zone hold two baskets over the same lines.
- **A line at zero is a row only for the basket that bought it.** `coveredLinesSql`
  keeps a line when `quantity > 0`, or when a standing purchase of it exists with
  `s."basketId" = $2`, inside the session of that basket. Its comment says why the second
  half exists: "Without it a settle would make its own row vanish". For every other
  basket it does vanish.
- **The other baskets learn about the settle and read again.** The velista basket store
  re-reads the whole basket on `basket.linesChanged`, so the row leaves the screen within
  about two seconds.
- **`BASKET_SETTLEMENTS_SQL` reads this basket's purchases only**, so a row has no
  field that says "somebody else bought this".
- **A purchase with no basket exists.** A buy made on the zone list page is a loose buy,
  and its `basketId` is null.
- **The window that already means "lately"** is `PURCHASE_SESSION_GAP_MS`, six hours, in
  `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts`.

### Target state

1. **A covered line is selected when any of these is true:** `quantity > 0`, a standing
   purchase of this basket in scope (as today), or a standing purchase with outcome
   `BOUGHT` that is **not** of this basket and whose `settledAt` is inside
   `PURCHASE_SESSION_GAP_MS` of the database's `now()`. "Not of this basket" includes a
   null `basketId`.
2. **The read loads those purchases** in one more query, for the selected lines only:
   the line, the quantity and `settledAt`. It never loads who made them.
3. **A row says what was bought elsewhere.** `BasketRowView` and `BasketRowEntryView`
   gain `boughtElsewhere: number`, the sum of those quantities. Zero when there is none.
   `bought`, `left` and `asked` keep their meaning: they count this basket's purchases.
4. **A new note.** `BasketRowNote.BOUGHT_ON_ANOTHER_BASKET`, with `noteAt` set to the
   newest such purchase. `SKIPPED_EARLIER` wins when both apply. Do not name it
   `ELSEWHERE`: `BasketRowUsualState.ELSEWHERE` means a different thing.
5. **The state of a row.** With something left, the state is what the table of `0130`
   section 4 gives today. With nothing left and no purchase of this basket, the state is
   `DONE`.
6. **Progress.** A row that is `DONE` through another basket counts in `total` and in
   `done`, so the reader's progress does not fall when somebody else buys.
7. **Nobody is named.** The row carries no participant, no account and no basket id of
   the purchase. `touchedBy` and `touchedAt` stay about this basket's own acts. A guest
   on a link receives the same row a member receives.
8. **A revert from this basket still refuses a purchase of another basket.** That is
   what `basket-revert.service.ts` does today. Add a test, change nothing.
9. **A demand change still works.** Raising the line above zero makes the row `WANTED`
   again, by the existing `demandEditable` rule.
10. **A finished basket is unchanged.** The freeze of `0135` writes this basket's own
    rows. A line present only through another basket's purchase is never written to
    `basket_trip_rows`.
11. **Both kinds.** The rule holds for `LIVE` and for `GENERATED` baskets while they are
    open.
12. **No new event.** When the six hours end, the row leaves on the next read, as a
    skip does when its window ends (`0137`).

### Order of work

1. **Reproduce** on a Luna slot of your own, with the integration recipe or two tokens
   over the gateway: two members of one zone, one list, one line. Member A buys the line
   through A's live basket. Read member B's live basket before and after. Record both
   answers in the pull request. If B's read still holds the row, stop and report.
2. Contracts first: the enum value, the two fields, the JSON Schemas. Then regenerate
   `openapi.json` and the admin wire types, and push, so velista `0131` can build.
3. The SQL and the read service, with the integration specs.
4. `progressOf` and the state, with the unit specs.

### Scope

- `apps/luna-shopper-backend/core/src/app/baskets/`: `basket-read.sql.ts`,
  `basket-read.service.ts`, `basket-rows.ts`, `basket.mappers.ts`, and their specs.
- `libs/luna-shopper/contracts`: `basket.enums.ts`, `basket.messages.ts`,
  `schemas/messages/basket.schemas.ts`.
- The generated `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`.
- An index on `line_settlements`, **only if** the measurement below asks for one.

### Constraints

- **The clock is the database's.** Compare `settledAt` with `now()` in SQL, as
  `BASKET_SESSION_SQL` does. No application clock decides what is recent.
- **Measure the new predicate.** Run `EXPLAIN (ANALYZE)` on the covered lines query
  against a list with a few hundred lines and a long purchase history, and put the plan
  in the pull request. `ix_settlements_basket_live` leads with `basketId`, so it does not
  serve a search by line alone. Add a partial index in a new core migration when the
  query scans.
- **Redaction is by omission.** Do not load a column that the row must not serve.
- **Never edit `openapi.json` or `wire-types.ts` by hand.** Run
  `npx nx build luna-shopper-admin` after the regeneration.
- **A fixture never covers a whole zone** (`listId: null`), and a `LIVE` basket fixture
  gets its own zone per owner. See the fixture rules in plan `0149`.
- The row resolver (`SET` and `TEXT` narrowing of `coveredLinesSql`) gets the same
  predicate, or a write on such a row answers "not found".

### Action boundaries

**Stop and ask before** any of these:

- A window other than `PURCHASE_SESSION_GAP_MS`. The owner said "recent". Six hours is
  this plan's reading.
- Naming the person who bought, on any reader's row.
- Letting one basket revert a purchase of another basket.
- Writing a row of another basket's purchase into `basket_trip_rows`.

### Progress evidence

- The before and after reads of step 1.
- The specs below, red before and green after.
- The `EXPLAIN` output.
- `npx nx affected -t lint test build` is green, and so is the core integration suite.

## Tests

1. Integration, `basket-read`: two `LIVE` baskets over one list. A buys the line to zero.
   B's read holds the row as `DONE`, with `boughtElsewhere` equal to the quantity, the
   note, `bought: 0`, and no person. A's read is what it is today.
2. A purchase older than the gap gives no row. Move the clock through the row's
   `settledAt`, not through a mocked `Date`.
3. A reverted purchase gives no row.
4. A loose buy (null `basketId`) gives the row.
5. A partial buy: the line keeps one unit. B's row has `left: 1`, the state of today,
   `boughtElsewhere` set and the note.
6. `progressOf`: the row counts in `total` and `done`.
7. A revert sent from B on that row is refused, and A's purchase stands.
8. A demand raised from B makes the row `WANTED`.
9. Finishing a `GENERATED` basket writes no trip row for a line it never bought.
10. A guest's read carries the same fields as a member's and no id of the other basket.
11. `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## What this plan does not do

- It draws nothing. Velista `0131` does.
- It does not change the zone list page. A bought line leaves "To buy" there, which the
  owner confirmed is right.
- It does not fix the finished basket screen or the list edit that can overwrite a
  purchase (plan `0171`, section 3.1).
