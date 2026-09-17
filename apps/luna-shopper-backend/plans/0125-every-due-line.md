> **PR:** [#406](https://github.com/IchirokuXVI/nx-portfolio/pull/406)

# 0125: every due line

> Client half: `apps/velista/plans/0089`. Amends `0123` section 5.
>
> `0123` answers the lines a list suggests, capped at 20 rows. The cap kept the zone list
> section short, and nothing else needed it. The client design changed: the zone list now
> draws 3 suggestions and a "Show more suggestions" button draws all of them. The client
> keeps the section short on its own now, and "all of them" has to mean all. This plan
> removes the cap. The route answers every due line, in the same order, with the same
> shape.
>
> Prerequisite reading: `0123` sections 2 to 5, and `core/src/app/lists/suggestions/suggestions.service.ts`.

## Brief for the agent

### Objective

Remove the 20 row cap from `GET /v1/lists/:id/suggestions`, so that the answer carries
every due line in the order `0123` section 5 defines, and regenerate the OpenAPI document
and the wire types.

### Context

- The service reads every candidate of the list, runs both rules over every one of them,
  sorts the result and cuts it to `SUGGESTION_MAX` rows as its last step.
- The number 20 lives in three places: `LINE_SUGGESTION_MAX` in the contracts, the
  schema's `maxItems`, and `SUGGESTION_MAX` in core, which names the contract's value.
- The client already holds every line of the list. `LineStore` loads all of them, and a
  suggestion names one of those lines by `lineId`.
- The product owner decided on 2026-09-17: no cap, no new query parameter, the shape stays
  `{ items }`.

### Target state

Every acceptance criterion in section 6 holds and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
is green with `openapi.json` and the wire types regenerated.

### Scope

- Work only in: `core/src/app/lists/suggestions/`, `gateway/src/app/lists/list.controller.ts`
  (one doc comment), `libs/luna-shopper/contracts` (the constant, the page's doc comment,
  its schema), the generated files, and one note under the table in `0123` section 5.
- Do NOT touch: velista, any client library, the two rules, the SQL, any migration.

### Constraints

- The order of the answer does not change.
- No constant replaces the cap. A limit that exists only on paper is a cap that someone
  later enforces by accident.
- `openapi.json` and `wire-types.ts` are written by their generators only.

### Action boundaries

- Proceed with in scope edits, specs and the generators.
- Stop and ask if removing the cap needs a new query or a change to the rules.

### Progress evidence

Report after the integration spec runs against a real database with twenty five due lines.

## 1. What is being built

| Piece                                     | Change                                   |
| ----------------------------------------- | ---------------------------------------- |
| `LINE_SUGGESTION_MAX` (contracts)         | deleted                                  |
| `SUGGESTION_MAX` (core)                   | deleted                                  |
| `list.LineSuggestionPage` schema          | `items` loses `maxItems`                 |
| `SuggestionsService.list`                 | answers the whole ranked array           |
| `suggestions.integration.spec.ts` test 11 | twenty five due lines answer twenty five |

## 2. The change and why

The cap was a layout decision made on the server. The zone list showed every suggestion it
received, so the server kept the count low. Velista `0089` now shows 3 and offers the rest
behind a button, so the layout decision is back on the client, where it belongs. A cap of
20 under a button labelled "Show more suggestions" hides lines without saying so.

The cut costs nothing to remove:

1. **The candidates are already all read.** `SUGGESTION_CANDIDATES_SQL` reads every line of
   the list at zero that no live basket holds. It has no `LIMIT`.
2. **All four statements already run over every candidate.** Purchases, recent trips and
   last asked quantities each take the full `lineIds` array (`lineId = ANY`). The rules
   then run in memory over every candidate.
3. **The slice was the last step.** It ran after the sort, on rows already computed. Removing
   it adds no query, no join and no rule evaluation.
4. **A row is small.** A `LineSuggestionView` is a uuid, an enum and five numbers, well under
   200 bytes of JSON.
5. **The answer is bounded by what the client already holds.** Every row names a line of the
   list, and `LineStore` loads every line of the list with far more fields per line. A
   list whose suggestions are heavy has a line list that is heavier.

## 3. What does not change

- **Order.** `PERIOD` rows first, the most overdue first, then `STAPLE` rows by `tripsWith`
  descending, then the line's `position` (`0123` section 5).
- **Rules and thresholds.** `PURCHASE_MERGE_MS`, `SUGGESTION_MIN_PURCHASES`,
  `SUGGESTION_WINDOW_SHARE`, `STAPLE_TRIPS` and `STAPLE_MIN_TRIPS` keep their values.
- **Shape.** The response is `{ items: LineSuggestionView[] }`. No field is added.
- **No paging, no query parameter, no event, no migration.**
- **Access.** The read starts with `listAccess.requireRead`.

## 4. Compatibility

A client built against `0123` received at most 20 rows. It now receives every row, in the
same order, so its first 20 are the rows it received before. The wire types carry no
length, so their generated file does not change.

## 5. Tests

Integration, real database:

1. `0123` test 11 becomes: twenty five due lines answer twenty five, the most overdue
   first. The spec compares the whole ordered array of line ids.

Every other `0123` test stays as it is.

## 6. Acceptance criteria

- [ ] `LINE_SUGGESTION_MAX` and `SUGGESTION_MAX` no longer exist in any source file under `libs`, `apps`
      or `tools`.
- [ ] The `list.LineSuggestionPage` schema has no `maxItems`.
- [ ] A list with twenty five due lines answers all twenty five, the most overdue first.
- [ ] No query, rule or migration is added.
- [ ] `openapi.json` and the wire types are current.
- [ ] `0123` section 5 carries a note that this plan amends it.

## 7. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx run luna-shopper-backend-core:test-integration --testFile=suggestions.integration.spec.ts
```

Run the integration spec against a throwaway database or an ephemeral slot, then give it
back.
