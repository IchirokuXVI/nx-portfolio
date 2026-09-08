> **PR:** [#259](https://github.com/IchirokuXVI/nx-portfolio/pull/259)

# 0094: a line split by the product that was got

> A basket line says "Milk", five, and names one pick out of eleven milks. At the shelf the
> shopper takes three skimmed and two whole. Today the line can record one of those products,
> and the other three units are settled as the wrong milk or as no milk at all.
>
> The first draft of this feature put several products with quantities on one line. It was
> rejected on one fact: **a settlement names one product, and everything downstream of a
> settlement assumes a line does too.** So a line keeps one product, and choosing several
> **splits** the line: the original keeps its product and the balance, and one sibling per other
> product appears right under it, identical in every way but the product and the amount. The
> shopper then settles each row as they already do.
>
> Prerequisite reading: `0050` section 1 (the pick and the options), `0051` sections 6.1 and
> 6.2 (the product swap, and the allocation rule that this plan applies at split time instead
> of settle time), `0056` section 3.2 (the stale guard this write copies), `0057` section 5 (the
> origin rows that split with the units), `0055` section 3 (the basket add, which gains the
> merge rule in section 5) and `0093` (the waiting rows a merge must re-point). Velista `0069`
> is the other half.

## 1. The rule

> **A basket line holds one product. Assigning units to other products creates one sibling per
> product under the line, moves the units and their origins to it, and the original keeps what
> is left.**

The split is not a purchase. Nothing here writes a settlement, moves `settledQuantity` or
touches a zone line. It redistributes what this basket will buy across rows that each name
one product, so that the settle, which has one product per act, stays exactly as it is.

## 2. The write

`GENERATED_LIST_SHARING_PATTERNS.splitLine`, and
`POST /v1/generated-lists/:id/lines/:lineId/products`, under `ParticipantGuard`, open to
every participant, guests included, because the products are catalog data and the origins
that move with them are never shown to anybody who could not see them already.

```ts
export interface SplitGeneratedListLineRequest {
  generatedListId: string;
  lineId: string;
  participantId: string;
  /** The outstanding amount the client believed. Refused on a mismatch. */
  from: number;
  /** Units for products other than the line's own. The line's own product takes the rest. */
  shares: Array<{ itemId: string; quantity: number }>;
}
```

It replaces `setPick` and `POST …/pick`, because moving every outstanding unit to another
product is this write with one share, and two ways of choosing a product would be two rules
about which product a settlement records.

### 2.1 What is refused

| Refusal                                            | Why                                                      |
| -------------------------------------------------- | -------------------------------------------------------- |
| `from` is not the current outstanding amount       | `0056` section 3.2. Two phones splitting one line must not double it |
| a share names a product not in the line's options  | `resolvePick`'s rule, unchanged: a swap is only to an option |
| a share names the line's own product               | it is the balance, and naming it twice says two things   |
| shares sum to more than the outstanding amount     | there is nothing to give                                 |
| a share of zero                                    | folded out before anything else, not an error            |
| the basket is finished                             | `0055` section 3.3's code                                |

Shares sum to **at most** the outstanding amount. The balance goes to the original's product
and is never typed, which is what makes a stale or hand edited request land somewhere honest.

### 2.2 The balance, and a line whose product is null

The original keeps its `itemId` and `quantity - sum(shares)` outstanding units on top of what
it already settled. A group added line (`0055` section 3) has options and a null pick, and the
split leaves it so: the original keeps null and the balance, and each share gets a product.
That is the case where "which one did you get?" is answered by the split itself, one sibling
at a time.

**When the balance is zero**, two cases:

- The original has no settled units. It is **reassigned** to the first share's product and
  quantity rather than deleted, and that share creates no sibling. Its id, its position, its
  "who put this here" and any waiting rows (`0093`) survive, and the shopper sees the same
  thing they would have seen: the old product gone, the new ones there.
- The original has settled units. It stays, at `quantity = settledQuantity`, finished, with
  the product those units were settled as. History is not rewritten because a later unit was
  a different milk.

## 3. Siblings

A sibling is created for each share whose product has no sibling yet (section 5 says what
happens when it has). It is the original copied:

| Field                       | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| `content`                   | the original's                                            |
| `itemId`                    | the share's product                                       |
| `quantity`                  | the share's units                                         |
| `settledQuantity`           | 0                                                         |
| `origin`, `targetListId`    | the original's                                            |
| `createdByParticipantId`    | the original's. The person who put milk here put this milk here |
| `lastEditedBy…`             | the acting participant, now                               |
| `position`                  | the midpoint between the original (or the last sibling created by this act) and the next line, so siblings sit directly under the original in share order and nothing else moves |
| options                     | the original's, copied                                    |

### 3.1 The origins split with the units

This is where the allocation rule runs, and it runs once, here, rather than at every settle.

For each share in request order, and within it for the original's origins oldest first
(`allocateOldestFirst`'s order), an origin gives units up to its own room, which is
`contribution - settledHere` on the original. The sibling gets an origin row per origin it
drew from, with that many units, the same `lineId`, `listId`, `zoneId` and `lineVersion`. The
original's row is lowered by the same number, and dropped when it reaches zero with nothing
settled against it.

The zone lines do not move. The lists asked for what they asked for, and the split changed
only which basket row will buy it. Claims do not move either: a zone line is claimed while
any carrier has outstanding units, and the claim query is already per zone line.

The excess case cannot arise: shares sum to at most the outstanding, and the outstanding of a
line is at most the sum of its origins' room plus `0056`'s extra, which stays on the original
because it belongs to no origin.

## 4. Two siblings on one zone line

After a split, two basket lines in one basket carry origin rows on the same zone line. The
unique constraint is per basket line, so the rows coexist. Three places assumed one carrier
and must not:

- `0092`'s claimed check excludes this basket's own lines.
- `settledPerOrigin` is per basket line already, so a sibling's floor is its own.
- The run's overlap rule is about another basket and is unchanged.

Each sibling settles on its own, with its own product recorded, through the unchanged settle.
Reopening one reverts only its rows. Sending one to a list (`0092`) sends the units it holds,
and if the other sibling is sent to the same list they merge there by name (`0091`) into one
zone line with two origins, each settlement naming its own milk, which is the history the
household wanted.

## 5. The basket's own merge rule

Siblings share a name on purpose, so the basket cannot merge by name alone. Its rule:

> **Two basket lines merge when their normalized content is equal and their products are
> equal or one of them has none.**

It applies in two places: `GeneratedListLineService.addLine` (`0055`), where a typed "Milk"
now lands on the Milk that is there, and this write, where a share for a product that already
has a sibling raises that sibling instead of creating a second one, which is what lets a
shopper move units back.

### 5.1 Which line, when several match

1. A line with the same product.
2. Else, when the incoming has no product, the line with no product.
3. Else the earliest by position.

Case 2 before 3 is deliberate: a typed "Milk" beside "Milk, Skimmed" and "Milk" lands on the
product free line, so nothing chooses a milk the shopper did not.

### 5.2 What a merge does

The **earlier** line by position survives. Into it: quantities sum, `settledQuantity` sums,
origin rows on the same zone line sum and others are moved, options union, waiting rows
(`0093`) re-point their `generatedListLineId`, standing settlements re-point the same way so a
reopen finds them. A survivor with no product takes the incoming product. The later line is
deleted and announced exactly as `deleteLine` announces one today.

A merge sums two `settledQuantity`s and two `quantity`s, so the survivor's outstanding is the
sum of the two, which is right, and its indicator state follows.

## 6. Contracts, events, migrations

- `SplitGeneratedListLineRequest` and `SplitGeneratedListLineResult` in
  `libs/luna-shopper/contracts`. The result carries `line` (the original, or its
  reassignment), `created` (the siblings, in position order), `merged` (siblings raised) and
  `removed` (ids folded away), each a full `GeneratedListBasketLineView`, so the client
  reconciles by id and draws nothing it was not told.
- `SetGeneratedListPickRequest`, `GENERATED_LIST_SHARING_PATTERNS.setPick` and the `/pick`
  route are deleted.
- Events on the basket room and to the owner: `generatedList.lineUpdated` for the original and
  each raised sibling, `generatedList.lineAdded` for each created one, and the removal
  announcement for each folded one. No zone event, ever.
- **No migration.** Siblings are ordinary lines, origins are ordinary rows, and the merge rule
  is a query.
- The OpenAPI document and the admin wire types are regenerated.

## 7. Tests

In a new `generated-list-split.spec.ts` and in `generated-list-basket-add.spec.ts`:

1. Milk 5 (skimmed) with shares whole 3, lactose free 2 becomes skimmed 0 reassigned to whole 3
   with a sibling lactose free 2 under it, both carrying the original's attribution.
2. Milk 5 with one share whole 1 keeps skimmed 4 and creates whole 1 at the midpoint position.
3. Origins flat 2 (older) and parents 3, share whole 3: whole gets flat 2 and parents 1, the
   original keeps parents 2, and no zone line moved.
4. A partly settled line splits only its outstanding units and keeps its settled ones with
   their product.
5. A share for a product that already has a sibling raises it, and moving every unit back
   folds the sibling away with its origins and settlements on the survivor.
6. A stale `from`, an unknown product, the line's own product and an over sum are refused and
   nothing is written.
7. `addLine` "Milk" lands on Milk with no product before Milk, Skimmed, and "Milk" with skimmed
   lands on the skimmed one; a survivor with no product takes the incoming product.
8. A guest can split, and the answer they get carries no origins.

## 8. Open decisions

- Whether reassigning the original (section 2.2) should instead delete it and create the first
  share as a sibling. Leaning reassignment, for the ids and the attribution it keeps.
- Whether the split should be offered on a `DERIVED` line whose options came from several
  lists with different sets. It is, since the origins split by the same rule, and the sheet
  offers the union.
- Whether a sibling created here should be flagged as such for the row to say "split from
  Milk". Leaning no: the rows sit together and share a name, which says it.

## 9. Exit criteria

- A line holds one product before and after any split.
- Choosing several products produces one row per product under the original, in order, with
  the original keeping its product and the balance, and no zone line or settlement touched.
- Origins move with the units, oldest first, and claims are unchanged.
- Two siblings on one zone line settle, reopen and reach lists independently.
- The basket merges by name and product, with a product free line as the fallback, and a
  merge keeps the earlier line and everything attached to both.
- The pick route is gone and the OpenAPI document covers the split.
