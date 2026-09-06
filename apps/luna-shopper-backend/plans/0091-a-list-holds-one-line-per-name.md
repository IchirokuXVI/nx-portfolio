# 0091: a list holds one line per name

> Somebody types "Milk" into a list that already has a line called Milk, and today the list
> gets a second Milk. It happens from the list page, from the assistant, and from a basket that
> sends a line home. Nobody wants two lines with the same name, and the household then has two
> quantities, two histories and two things to delete for one thing they buy.
>
> This plan makes the rule one sentence: **a zone list holds one line per normalized name, and
> adding a name that is already there raises that line.** It is the ground the next three plans
> stand on, because `0092` sends a basket line into a list that may already hold it.
>
> Prerequisite reading: `0047` sections 2 and 7 (quantity is the state, and a quantity change
> never re-triggers approval), `0050` section 3 (the run's own deduplication rule, which this
> plan borrows its normalization from) and `0065` section 3 (the products a line carries are
> not invented). Velista needs no plan of its own for this: the list page already merges a
> line it receives by id.

## 1. The rule

> **Adding a line whose normalized content matches a line already on the list raises that
> line's quantity by the amount added, and creates nothing.**

Normalized means what `normalizeContent` in `generated-lists/line-dedup.ts` already means:
NFD, combining marks removed, case folded, trimmed, inner whitespace collapsed. "Milk",
"milk" and "MILK" are one name, and so are "Jamón" and "jamon". Nothing else folds: "milk"
and "whole milk" stay two lines, for the reason `0050` section 3 gave, which is that merging
two things a person meant separately is the worse failure.

The function moves to `lists/line-content.ts` and both callers import it from there. The run
and the add must fold the same way, or a basket line composed from "Jamón" would fail to land
on the "jamon" line the add just merged into.

## 2. Where it applies

Every add into a zone list goes through `LineService.add` in `lists/line.service.ts`, and the
rule lives there and nowhere else.

| Caller                                            | What changes for it                                  |
| ------------------------------------------------- | ---------------------------------------------------- |
| the list page, `POST /v1/lists/:id/lines`         | may answer an existing line instead of a new one     |
| the batch add, `POST /v1/lists/:id/lines/batch`   | the same, per item, and duplicates inside one batch fold into one |
| the assistant's `upsert_lines`                    | keeps its own resolution by name, which now agrees with the server's, and it can drop it later |
| `GeneratedListLineService.promote` (`0058`, `0055`) | must read which line it landed on, section 4       |

The basket is **not** a zone list and does not take this rule as written. Its own rule is
`0094` section 5, which compares the product as well as the name, because a basket line holds
a pick and a split deliberately produces siblings that share a name.

## 3. What a merge does, and does not do

| Thing                | On a merge                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `quantity`           | raised by the amount added, through the atomic delta path `0040` built, capped at `LINE_QUANTITY_MAX` |
| `version`            | bumped, as every quantity write bumps it                                   |
| `itemIds` in the request | **ignored**. The merged line keeps its own products                     |
| `productGroupId`     | ignored, for the same reason                                               |
| `approvalStatus`     | untouched. A pending line stays pending, an approved one stays approved (`0047` section 7) |
| the event            | `line.updated` on the zone room, never `line.added`                        |
| the bought indicator | clears by itself when a line at zero is raised, which is the kept list doing its job (`0047` section 2.2) |

The products are the decision most worth stating. A person who types "milk" onto a list whose
Milk names eleven products has not said anything about products, and a basket line that
sends "Milk" with two products home has not either. Replacing or unioning the set on the
strength of a name would write products into a household's list the way `0065` section 3
refuses to. This may change later, and the plan says so in section 7 rather than pretending
the question is closed.

### 3.1 A rejected line is not a merge target

A line with `approvalStatus = REJECTED` is a decision the household made. Adding the same
name again is a new request, so it creates a new line beside the rejected one and the
household decides again. Merging into the rejected line would raise a quantity on a line the
list will never buy, and re-requesting through it would need approval logic this plan does
not want to own. The match therefore skips rejected lines.

### 3.2 Two adds at once

Two phones adding "milk" in the same second must not both create. The add takes a row lock on
the `shopping_lists` row for the duration of its transaction, which serializes adds per list.
A unique index on the normalized name would be the stronger answer, but the fold uses
`normalize` and case folding that Postgres cannot promise are immutable, and a lock on one
row per add costs nothing at this scale.

## 4. The answer says which

`line.add` answers a new shape, because a caller that created and a caller that merged do
different things next:

```ts
export interface AddLineResult {
  line: LineView;
  merged: boolean;
}
```

The gateway route answers the same body. Velista's `ListApi.addLine` maps `line` and the
store upserts it by id, which it already does for every `line.updated` it hears, so a merge
lands on the screen as the existing row moving rather than a new row appearing.

`promote` is the caller that needs `merged`. It writes the basket line's origin row with the
id it was answered, whether that line is new or old, and with `quantity` equal to the amount
it added rather than the line's total. `0092` builds on exactly that, and this plan changes
`promote` only that much.

## 5. What is not migrated

Lists that already hold two lines with one name keep them. A migration that summed their
quantities would have to choose which one survives, and the loser's settlements, comments and
products would go with it. The next add of that name lands on the earliest of them by
position, and the household deletes the other when it notices. That is one deletion per
duplicate, done by somebody who can see both, against a migration done by nobody.

## 6. Contracts, events, migrations

- `AddLineResult` in `libs/luna-shopper/contracts`, answered by `line.add` and by the gateway
  route. The batch route answers an array of them.
- `normalizeContent` moves to `lists/line-content.ts`, and `line-dedup.ts` re-exports it.
- Events: `line.updated` on a merge, `line.added` on a create, unchanged in shape.
- **No migration.** No column changes, and section 5 says why no data does either.
- The OpenAPI document and the admin wire types are regenerated, per `CLAUDE.md`.

## 7. Open decisions

- **Whether a merge must union the request's products into the line.** Leaning no for now,
  section 3, and the question comes back the moment a basket sends a line whose pick the list
  does not name. When it does, the answer belongs in `0065`'s promotion and not here.
- Whether the batch add must answer one `merged` per item or a count. Leaning per item,
  since the assistant reads the answer back to a person and "two of those were already there"
  is a sentence it can say.
- Whether the lock in section 3.2 becomes a unique index once the fold is expressed in
  SQL. Leaning yes eventually, and not in this plan.

## 8. Tests

In `line.service.spec.ts` and `line-quantity-delta.integration.spec.ts`:

1. Adding "Milk" to a list holding "milk" at 2 answers the existing line at 3, `merged: true`,
   and emits `line.updated`.
2. Adding "Jamón" to a list holding "jamon" merges, and adding "whole milk" beside "milk" creates.
3. A merge ignores the request's `itemIds` and the line's products are unchanged.
4. A merge into a pending line leaves it pending, and a merge into a line at zero clears the bought
   indicator.
5. A rejected line is skipped and a new line is created beside it.
6. Two concurrent adds of one name produce one line at the summed quantity.
7. `promote` writes its origin row against the merged line's id with the added amount.

## 9. Exit criteria

- No add can leave a zone list holding two lines whose normalized content is equal, except
  where one of them is rejected.
- A merge raises the existing line, keeps its products and its approval, and emits an update.
- The answer says whether it merged, and `promote` uses it.
- Existing duplicates are untouched and the next add lands on the earliest of them.
- The OpenAPI document and the wire types reflect `AddLineResult`.
