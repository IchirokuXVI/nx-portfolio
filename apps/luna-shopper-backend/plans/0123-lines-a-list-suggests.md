> **PR:** [#400](https://github.com/IchirokuXVI/nx-portfolio/pull/400)

# 0123: lines a list suggests

> Client half: `apps/velista/plans/0089`. Build `0122` first.
>
> A bought line stays on its list at zero, holding its history (`0047`). That history can
> say when the household is about to want the line again, and nothing reads it that way.
> A comment in `settlement.service.ts` promises "you buy this about every eleven days", and
> the only code that computes such a number is the client's line sheet, for one line at a
> time. This plan adds a read that answers, for a whole list, which lines at
> zero are due. A suggestion is never a new line. It is an existing line offering to come
> back.
>
> Prerequisite reading: `0047` section 6.3 (why two purchases are not a rate), `0122`
> (what a basket trip of a list is), `core/src/app/lists/settlement.sql.ts`, and
> `estimateFrom` in `libs/velista/feature-lists/src/lib/line-detail-sheet/select-line-detail.ts`,
> which is the rule section 3 moves to the server.

## Brief for the agent

### Objective

Build `GET /v1/lists/:id/suggestions` as sections 2 to 6 describe it, with the two rules as
pure functions under unit specs and the candidate query under an integration spec, and
regenerate the OpenAPI document and the wire types.

### Context

- A line's purchases are its live `BOUGHT` rows in `line_settlements` (`revertedAt IS
NULL`). `NOT_AVAILABLE` rows have quantity 0 and are not purchases.
- One trip often writes several settlements for one line seconds apart: one per origin,
  one per sibling basket line (`0094`), one per partial settle. Read as they are, they put
  gaps of zero into any interval statistic.
- Zones carry no time zone, and the product owner does not want one. Every rule here is
  elapsed time, never a calendar day.
- `0122` defines a basket trip of a list: a basket with at least one origin row in the
  list. This plan counts ended ones only.
- A line is held by a live basket when it has an origin in a basket that
  `isLiveGeneratedList` and is inside the claim window. That is **wider than `claimed`**,
  which turns false the moment the basket line is fully settled.

### Target state

Every acceptance criterion in section 8 holds and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
is green with `openapi.json` and the wire types regenerated.

### Scope

- Work only in: a new `core/src/app/lists/suggestions/` folder (service, SQL file, the two
  pure rules, specs), `gateway/src/app/lists/` (one route), `libs/luna-shopper/contracts`
  (the view, its schema), and the generated files.
- Do NOT touch: the settle services, `LineView`, the client, any migration. This plan
  stores nothing.

### Constraints

- The read starts with `listAccess.requireRead`.
- The thresholds in section 5 are named constants in one file beside the rules. They are
  not environment variables.
- The two rules take plain arrays and a `now`, and never read a clock themselves.
- No fixed calendar dates in specs (memory note on time bombs). Build every date from a
  `now` the spec owns.

### Action boundaries

- Proceed with in scope edits, specs and the generators.
- Stop and ask if the candidate query needs an index that does not exist.

### Progress evidence

Report after the two pure rules with their specs, and after the route with its integration
spec.

## 1. What is being built

| Piece                             | Where                                          |
| --------------------------------- | ---------------------------------------------- |
| `GET /v1/lists/:id/suggestions`   | gateway lists controller, core `suggestions`   |
| `periodOf` and `isStaple`         | pure functions beside the service              |
| `LineSuggestionView` and its page | `contracts` `list.messages.ts` and its schemas |

## 2. Which lines can be suggested

A line of the list is a candidate when all of these hold:

- its `quantity` is 0,
- its `approvalStatus` is `APPROVED`,
- it has at least one purchase,
- **no live basket holds it**, by the origin test in the Context and not by `claimed`. A
  line Marta bought ten minutes ago is at zero and unclaimed while she is still in the
  shop, and suggesting it there is wrong. It becomes a candidate when her basket ends.

A candidate is suggested when either rule below says so. Nothing is ever dismissed in this
version: a suggestion nobody takes stays until the line is wanted again.

## 3. The period rule

`periodOf(purchaseTimes, now)`:

1. **Merge.** Sort the purchase times and fold every purchase closer than
   `PURCHASE_MERGE_MS` (12 hours) to the one before it into that one. A trip is one
   purchase however many rows it wrote.
2. **Refuse thin histories.** Below `SUGGESTION_MIN_PURCHASES` (3) merged purchases there
   is no period. Two purchases define one interval, which is a coincidence.
3. **The period** is the median gap between neighbouring purchases, in days as elapsed time
   over 24 hours, rounded, and never below 1. The median and not the mean, because one
   stock up trip moves a mean for ever.
4. **The window** is `Math.round(period * 0.25)`, halves rounding up. A period of 10 gives
   3, a period of 7 gives 2, a period of 2 gives 1 and a period of 1 gives 0.
5. **Due** when `elapsedDays >= period - window`, `elapsedDays` being the time since the
   last merged purchase over 24 hours, rounded.

No step names a calendar day, so a purchase at 23:30 and one at 00:30 a week later are
seven days apart on every server clock.

## 4. The staple rule

`isStaple(presence)`, `presence` being one boolean per trip over the list's last
`STAPLE_TRIPS` (6) **ended basket trips**, newest first, true where the trip has an origin
for the line.

- Below `STAPLE_MIN_TRIPS` (4) ended basket trips the rule answers false for every line.
- A line is a staple when it is present in at least half of those trips **and** never
  absent from two in a row. That is "every basket, or every other basket" and nothing
  looser.
- Only trips of **this list** count. A basket that drew from another list says nothing
  about this one, which keeps a pharmacy run from making milk look rare.
- A staple is suggested whenever it is a candidate, whatever the clock says. The product
  owner accepted on 2026-09-17 that it comes back right after the trip ends.
- Presence reads origins, and a deleted basket has none. Its trip is then not a basket trip
  at all (`0122` section 4), so it shortens the window and does not count as an absence.

## 5. The answer

`GET /v1/lists/:id/suggestions`, `READ` on the list, not paged: at most `SUGGESTION_MAX`
(20) rows.

```ts
interface LineSuggestionView {
  lineId: string;
  reason: 'PERIOD' | 'STAPLE'; // PERIOD wins when both hold
  periodDays: number | null; // PERIOD only
  daysSinceBought: number; // elapsedDays of section 3, for both reasons
  tripsWith: number | null; // STAPLE only, for example 5
  tripsSeen: number | null; // STAPLE only, for example 6
  quantity: number; // what to add, at least 1
}
```

- `quantity` is what the newest ended basket trip asked for this line, and where no basket
  ever asked, the units of its last merged purchase.
- Order: `PERIOD` rows first, the most overdue first by `elapsedDays - (period - window)`,
  then `STAPLE` rows by `tripsWith` descending, then the line's `position`.
- The candidate query reads every purchase time of every candidate in one statement
  (`lineId = ANY`), and presence in a second. No query per line.
- There is no event. The client reads again on the signals it already has (velista `0089`).

| Constant                   | Value    |
| -------------------------- | -------- |
| `PURCHASE_MERGE_MS`        | 12 hours |
| `SUGGESTION_MIN_PURCHASES` | 3        |
| `SUGGESTION_WINDOW_SHARE`  | 0.25     |
| `STAPLE_TRIPS`             | 6        |
| `STAPLE_MIN_TRIPS`         | 4        |
| `SUGGESTION_MAX`           | 20       |

> Amended by 0125: the answer is no longer capped.

## 6. Not in this plan

- Dismissing a suggestion. The first version has none.
- The amount bought changing the period. Twelve cartons last longer than six, and this
  version does not know it.
- A shared rule for the line sheet. The client's `estimateFrom` gains the merge step in
  velista `0089` so the two numbers agree, and stays where it is.

## 7. Tests

Unit, on the two rules, every date built from the spec's own `now`:

1. Three settlements within an hour are one purchase and give no period.
2. Gaps of 7, 7 and 30 days give a period of 7.
3. The window: 10 gives 3, 7 gives 2, 2 gives 1, 1 gives 0.
4. A period of 7 is not due at 4 elapsed days and is due at 5.
5. Purchases at 23:30 and 00:30 seven days later are 7 days apart.
6. `isStaple`: `TTTTTT` and `TFTFTF` are staples. `TTFFTT` is not, and neither is `FTFTFF`.
   Three trips answer false.

Integration, real database:

7. A line at zero with an origin in a live basket is not suggested, settled or not, and is
   suggested after the basket completes.
8. `NOT_AVAILABLE` rows and reverted rows are not purchases.
9. A pending line, a rejected line and a line above zero are never suggested.
10. `quantity` follows the newest ended basket trip, then the last purchase.
11. Twenty five due lines answer twenty, the most overdue first.
12. A caller without `READ` is refused.

## 8. Acceptance criteria

- [ ] A list answers which of its lines at zero are due, by period or as a staple.
- [ ] No rule depends on a calendar day or a time zone.
- [ ] A line in a live basket is never suggested, bought or not.
- [ ] Nothing is stored and no migration exists.
- [ ] `openapi.json` and the wire types are current.

## 9. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Run the integration specs through their own target against a slot, then give it back.
