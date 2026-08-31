# 0004 (backlog) Basket pricing, substitution, and the worth the trip rule

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

The optimizer that backlog 0001 section 3.5 deliberately refused to design, now that the pieces
it needs exist. Given a generated list (0050) and a set of price scopes (0049),
decide **what to buy, where**, and refuse to send anyone to a second shop for two cents.

Depends on backlog 0001 (effective prices per scope, normalized unit prices, product groups,
scope aware search) and 0050 (the generated list this writes its answer into). Nothing
here is buildable without 0001; that is the whole reason it is a separate plan.

## 1. Two kinds of line, and one that cannot be priced

The distinction the user asked for, stated precisely: **a line names either a specific product or
a kind of product, and the two search differently.**

| Line resolution | Set by | What is priced | Example |
| --- | --- | --- | --- |
| `ITEM` | `itemId` on the line | that exact product, in every eligible scope | "Pascual whole milk 1 L" |
| `GROUP` | `productGroupId` on the line | every member of the group, ranked by unit price | "Milk" |
| `UNPRICED` | neither is set | nothing | "something for dinner" |

`GeneratedListLine` gains `resolution` (`LineResolution` enum) and, for `GROUP` lines, the
`chosenItemId` the optimizer picked, alongside the `itemId` and `productGroupId` that backlog
0003 section 1 already carries.

The two named cases are not variations of one search. `ITEM` asks "where is this cheapest",
`GROUP` asks "which of these is cheapest, and where", and only the second one is allowed to
change what ends up in the basket. Conflating them is how a user who asked for Pascual comes home
with Hacendado.

### 1.1 Unpriced lines stay in the basket

A line with no item and no group is shown, unpriced, in an "anywhere" section, and it counts
toward nothing. It is not an error and not a warning: free text lines are legitimate and 0007
guarantees a line never has to carry an item. What the client must not do is hide them, because
the user still has to buy the thing.

### 1.2 Resolving free text, without doing it silently

Most lines will be typed as text, so the value of this feature depends on how many of them get an
item or a group attached. The resolver runs the scope aware search from backlog 0001 section 3.4
over the line text and proposes a match with a confidence, and **a proposal is not an assignment**:

- High confidence exact matches on a group name or synonym ("leche", "milk") may be applied
  automatically, recorded as `resolvedAutomatically` so the UI can show it as a guess.
- Anything else is a suggestion the user confirms, on the line, once, after which the `itemId` or
  `productGroupId` is written back to the **zone** line (subject to the write back rule in
  0050 section 5, since it changes shared data) so the next run does not ask again.
- Nothing is ever resolved to an item when a group would do. A user who typed "milk" and gets
  Pascual pinned to their zone line has been quietly robbed of the whole feature.

## 2. What "best price" means

For each priced line, over the scope set from 0049:

- `ITEM` lines: the item's effective price (backlog 0001 section 2.4) in each eligible scope.
- `GROUP` lines: every group member's effective price in each eligible scope, ranked by
  **normalized unit price** (0001 section 3.3), not by pack price. A 6 x 1 L pack that is cheaper
  per litre and dearer at the till is a real trade off; the basket shows both numbers and ranks
  by the unit price, since that is what "cheaper milk" means.
- A scope with no price for the line is not a scope offering it for free. Missing is missing, and
  section 4 treats it as such.
- Every priced line carries the `effectiveSourceKind` and `effectiveObservedAt` that produced its
  number, so a community reported price from nine days ago is visible as exactly that.

Quantity multiplies at the end, on the chosen item, never during the ranking: unit prices decide
what is cheapest, quantities decide what it costs.

## 3. The shape of the problem

Minimising a basket across shops is not a query. Every extra shop is real cost in time that the
system cannot see, and the naive answer, "buy each line wherever it is cheapest", produces a
five stop trip to save one euro seventy. The user's own framing is the specification: **two cents
is not worth a trip, four euros might be, and only they can say where the line is.**

So the computation is not "minimise cost". It is:

> Start from the cheapest single shop that can serve the basket. Add another shop only when
> moving lines to it saves more than the user's threshold.

That framing has a property worth keeping: **the answer is always explicable.** Every extra stop
comes with the sentence that justified it ("Lidl for these four lines saves 3.80 euros"), and a
suggestion a user cannot argue with is a suggestion they will not trust.

## 4. The algorithm

Deliberately a greedy heuristic with a stable tie break, not an exact solver. The exact problem is
an uncapacitated facility location variant and is NP hard; at basket sizes of thirty lines and
under ten scopes the greedy answer is nearly always the optimal one, and when it is not, the
difference is smaller than the price staleness already in the data.

1. **Candidate stores.** The scopes from 0049, each carrying its locations.
2. **Per store basket.** For every store, price every line it can serve, choosing per line the
   cheapest eligible member for `GROUP` lines. Record coverage: how many lines it cannot serve.
3. **The baseline.** The single store with the lowest total for the lines it covers, tie broken
   by coverage first, then by the user's preference order (0049, `position` on the postal
   code and the chain preference), then by store id so the result is deterministic. **Coverage
   beats price in the baseline**, because a baseline shop that serves nine of twenty lines is not
   a shopping trip.
4. **Improvement rounds.** For each other store, compute the saving from moving to it every line
   where it is cheaper, plus every line the baseline cannot serve at all. That is the store's
   marginal value. Take the best one; if its marginal value clears the threshold (section 5),
   accept it as a stop, remove those lines from the pool, and repeat.
5. **Stop** when no remaining store clears the threshold, or at a hard cap on stops (a user
   setting, defaulting to three; more than three shops is a day out, not a shop).
6. **Leftovers.** Lines no chosen store serves are grouped as "not available at your shops" with
   the cheapest place that does have them, if any, so the user can decide for themselves. They
   are never silently dropped.

Cost of the run is bounded: lines times scopes lookups against the materialized effective price
from backlog 0001 section 2.4, which is why that column exists.

## 5. The threshold, and what it is measured against

The user's rule, made precise. `minSavingCents` (and the optional `minSavingPercent`) from
0049 is **per extra stop, not per line and not per basket**.

- Per line is wrong: it rejects the case the user described, five items saving eighty cents each,
  which is exactly the trip worth making.
- Per basket is wrong in the other direction: it lets a fifth stop in for two cents once the
  first four have already cleared it.
- Per stop is the unit that matches the real cost, which is going to another shop.

The saving is measured **against the baseline store**, and only over lines the baseline can
actually serve. A line the baseline does not stock is not a saving, it is a necessity, and it
counts toward coverage rather than toward the threshold. Otherwise a store carrying one thing
nobody else has would look like a bargain.

Both thresholds apply when both are set, and the stop must clear both. The percentage is measured
against what those same lines cost at the baseline, not against the whole basket, for the same
reason.

`minSavingCents = 0` means "always split", which is a legitimate choice and stays available.

## 6. What the run writes down

Pricing writes onto the generated list from 0050 rather than into a new structure:

- Per line: `chosenItemId`, `chosenScopeId`, `unitPriceCents`, `lineTotalCents`,
  `priceSourceKind`, `priceObservedAt`, `savingVsBaselineCents`.
- Per list: a `BasketPlan` child rows set, one per stop, each with the store, the lines assigned
  to it, its subtotal, and **the saving sentence that justified the stop**.
- Per list totals: basket total, baseline single store total, total saving, number of stops, and
  the counts of unpriced and unavailable lines. A total that does not say what it is compared
  against is a number the user cannot check.

Everything is a **snapshot**, consistent with 0050 section 4. Prices move; a basket
priced on Tuesday says so and does not silently change on Wednesday. `generatedList.reprice`
produces a new priced revision, and the old one stays in history as what the user actually paid
against.

## 7. Honesty rules

These are requirements, not polish. A price comparison that overstates its confidence is worse
than none.

- A price older than its policy's `maxAgeDays` (backlog 0001 section 2.4) is not eligible and
  does not enter the computation. Nothing in the basket is priced from data the policy considers
  stale.
- Community sourced prices are labelled per line, so a saving that rests entirely on one
  stranger's report is visible as such.
- A store the optimizer chose but for which the whole basket is leaflet priced inside a validity
  window that ends tomorrow gets that fact surfaced.
- The basket never invents a substitute for an `ITEM` line. If Pascual is nowhere, the line is
  unavailable, with the group's alternatives offered separately for the user to accept.

## 8. Where it runs

Core owns the generated list; catalog owns prices. The pricing pass is a **core operation that
calls catalog** with the line set and the scope set, in one batched message
(`catalog.priceBasket`), rather than one message per line. One round trip per run keeps the
NATS traffic proportional to runs and not to basket size, and keeps the optimizer where the list
lives.

Rejected: doing the optimization in catalog. Catalog would then need the generated list, the user
preferences and the write path, which is most of core.

## 9. Open decisions

- Whether `GROUP` lines should respect per user "never buy this brand" exclusions. Cheap to add
  as a preference, and probably needed the first time somebody is allergic to a brand's recipe.
- Whether stop count should have its own threshold curve (a second stop needs 3 euros, a third
  needs 6) rather than a flat one per stop. Leaning flat until someone complains.
- Distance. The obvious next input is how far the second shop actually is, which needs location
  coordinates (0012 has them) and a distance from the user's postal code. Deferred on purpose:
  it turns the threshold into a per store number and needs geocoding of the user's location,
  which is a privacy decision, not just a feature.
- Whether the automatic high confidence text resolution in section 1.2 is on by default.

## 10. Exit criteria

- A line naming a specific item is priced for that item only; a line naming a product group is
  priced across the group's members and ranked by normalized unit price; a line naming neither is
  shown unpriced and never hidden.
- Free text is resolved to an item or a group by suggestion, and a confirmed resolution is
  written back to the zone line through the ordinary write back rule.
- The plan starts from the cheapest single store that covers the basket, and every additional
  store is justified by a saving over that baseline.
- No extra stop is proposed unless it clears the user's threshold, measured per stop, against the
  baseline, over lines the baseline can serve.
- The user sees the total, the baseline total, the saving, the stops and, per stop, the sentence
  that justified it.
- Every priced line shows where the price came from and when it was observed, and no ineligible
  or stale price enters the computation.
- Items the chosen stores do not carry are surfaced with somewhere that does, never dropped.
- Repricing creates a new revision and leaves the previous basket intact.
- The pricing pass is one batched call into catalog per run.
