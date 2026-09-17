> **PR:** [#385](https://github.com/IchirokuXVI/nx-portfolio/pull/385)

# 0117: an expired price falls through to the next scope

> A shop's stack is Single shop, Local area, Chain region and Nationwide (plan 0116). Today the
> resolution picks the narrowest scope per source kind **before** it asks whether that scope's
> price is still valid, so a warehouse walked once months ago hides the region price written this
> morning, and the shopper reads the old one flagged stale. This plan makes the narrowest **valid**
> price win, and moves the filtering into the query so an expired row is never loaded to be
> thrown away.
>
> Prerequisite reading: `0080` sections 4 to 7 (the effective price), `0105` section 4 (the
> stack), `effective-price.ts` and `effective-price.service.ts` in full, `item-price-writer.ts`,
> and `effective-price.spec.ts` with `item-prices.integration.spec.ts`.

## Brief for the agent

### Objective

Change the effective price resolution so a row that is outside its validity window or older than
its policy's `maxAgeDays` is skipped and the next scope in the stack answers, with that filtering
done in SQL, as sections 2 to 6 describe.

### Context

- `resolveEffectivePrice` (`catalog/src/app/catalog/effective-price.ts:97`) runs, in order:
  `narrowestPerKind` over every current row, then the enabled filter, then eligibility
  (`validFrom`, `validUntil`, `maxAgeDays`, an ADMIN row protected and disputed), then the policy
  ranking with a protected ADMIN row first, then a stale fallback that returns the newest enabled
  candidate of any age.
- `narrowestPerKind` (:214) keeps one row per `sourceKind`: the lowest scope priority, then the
  scope being computed, then the newest `lastObservedAt`.
- `boundaryOf` (:266) is the earliest future instant among `validFrom`, `validUntil`, an ADMIN
  `protectedUntil` and `lastObservedAt + maxAgeDays`, over all candidates. It becomes
  `supermarket_items.nextBoundaryAt`, which the sixty second sweep
  (`effective-price.sweep.ts`) selects on.
- `currentPriceRows` (`effective-price.service.ts:29`) is `DISTINCT ON (itemId, priceScopeId,
  sourceKind)` ordered by `observedAt DESC, id DESC`, served by `ix_item_prices_current
  (itemId, priceScopeId, sourceKind, observedAt)`. Its callers are `recomputeEffectivePrices`
  (:172) and `item-price-writer.ts:79`.
- Shoppers read the materialized `supermarket_items` row. The resolution runs on a price write, on
  `inheritLessSpecific`, and in the sweep, in chunks of 500 items per scope.
- `snapshotOf` in `item-price-writer.ts:252` picks the ADMIN snapshot per automated kind by query
  order (scope uuid), not by priority, which is wrong once a stack has more than two tiers.
- `price_policies`: `sourceKind` unique, `priority`, `maxAgeDays` (null never ages), `enabled`.

### Target state

Every acceptance criterion in section 9 holds, the unit and integration specs cover sections 2
to 6, and a recorded `EXPLAIN ANALYZE` shows the new query uses `ix_item_prices_current`.

### Scope

- Work only in: `catalog/src/app/catalog/effective-price.ts`, `effective-price.service.ts`,
  `item-price-writer.ts`, a catalog migration if section 5 needs an index, and their specs.
- Do NOT touch: the sweep's interval or batch size, `price_policies` columns, the materialized
  `supermarket_items` columns, the gateway, any harvester code.

### Constraints

- The resolution stays a pure function over rows the query hands it, so `effective-price.spec.ts`
  keeps testing it without a database.
- Idempotence stays: recomputing a key twice writes nothing the second time.
- No new index without the `EXPLAIN ANALYZE` that shows the existing one is not used.

### Action boundaries

- Proceed with in-scope edits and specs.
- Stop and ask before adding a migration, and if the ADMIN dispute rule of section 4 cannot be
  kept without loading ineligible rows.

### Progress evidence

Report after the pure resolution change with its unit specs, after the query with its integration
spec and the `EXPLAIN ANALYZE` output, and after the writer's snapshot fix.

## 1. The defect

A Mercadona shop holds its store scope (100), warehouse `4661` (200) and a chain region (300).
The owner walks `4661` on 1 September and the region every week after that. `OFFICIAL_API` has a
`maxAgeDays` of 14.

On 20 September `narrowestPerKind` keeps the `4661` row for `OFFICIAL_API`, eligibility drops it
for age, nothing else of that kind is left, and the stale fallback returns the 1 September price
flagged stale. The region's 18 September price is never considered.

**The narrowest scope wins only among prices that are valid now.** That is the whole rule.

## 2. The order of the steps

1. **Current row** per (item, scope, kind): the newest `observedAt`, exactly as today.
2. **Eligible**: the kind's policy is enabled, `validFrom` is null or `<= now`, `validUntil` is
   null or `> now`, `maxAgeDays` is null or `lastObservedAt > now - maxAgeDays`.
3. **Narrowest per kind among the eligible**: lowest scope priority, then the scope being
   computed, then the newest `lastObservedAt`.
4. **ADMIN protection and dispute**, section 4.
5. **Ranking across kinds** by policy priority, a protected ADMIN row first, ties to the newest
   `lastObservedAt`, exactly as today.
6. **Nothing eligible**: the stale fallback, section 3.

**Step 1 comes before step 2, and that order is load bearing.** Filtering first lets an
older row stand in for a current one that is not yet valid: a leaflet row whose `validFrom` is
next Monday is skipped, and last week's leaflet at the same scope and kind comes back as
current. The current row is the source's latest statement. When it is not valid, the scope has
nothing to say for that kind, and the next scope answers.

## 3. The stale fallback stays, as a second query

When no row is eligible, the shopper still sees the newest enabled current row across the stack,
flagged stale, which is today's behaviour. **It is loaded only for the items that need it**: the
first query answers the eligible rows for a chunk, and the items with no eligible row get one
more query for their newest enabled current row. A chunk whose items are all priced costs one
query, which is the common case the owner asked to optimize.

## 4. ADMIN protection

A protected ADMIN row is ineligible when it is **disputed**, meaning an automated kind has said
something the ADMIN row's snapshot does not match (`isDisputed`, :168).

**A source disputes an ADMIN row only with an eligible price.** Today the comparison runs against
the narrowest candidate of each automated kind whatever its age. After this plan it runs against
the narrowest eligible row of each automated kind. A source that has not spoken within its max age
has said nothing new, so it cannot displace a hand correction. This is a deliberate change and it
gets its own unit spec.

`snapshotOf` in the writer takes the same set: the narrowest eligible automated row per kind, by
priority. That also fixes the query order defect named in the brief, because the writer and the
resolution now read one function.

## 5. The query

One statement per chunk, for the item ids of the chunk and the scope ids of the stack, with the
policies passed as a parameter or joined:

```sql
WITH current AS (
  SELECT DISTINCT ON (p."itemId", p."priceScopeId", p."sourceKind") p.*
    FROM "item_prices" p
   WHERE p."itemId" = ANY($1) AND p."priceScopeId" = ANY($2)
   ORDER BY p."itemId", p."priceScopeId", p."sourceKind", p."observedAt" DESC, p."id" DESC
), eligible AS (
  SELECT c.*, s."priority" AS "scopePriority"
    FROM current c
    JOIN "price_policies" pol ON pol."sourceKind" = c."sourceKind" AND pol."enabled"
    JOIN "price_scopes" s ON s."id" = c."priceScopeId"
   WHERE (c."validFrom" IS NULL OR c."validFrom" <= $3)
     AND (c."validUntil" IS NULL OR c."validUntil" > $3)
     AND (pol."maxAgeDays" IS NULL OR c."lastObservedAt" > $3 - make_interval(days => pol."maxAgeDays"))
)
SELECT DISTINCT ON (e."itemId", e."sourceKind") e.*
  FROM eligible e
 ORDER BY e."itemId", e."sourceKind", e."scopePriority", (e."priceScopeId" = $4) DESC, e."lastObservedAt" DESC
```

The shape is a guide, not a contract. What is fixed: at most one row per (item, kind) comes back,
it is the narrowest eligible one, and the TypeScript resolution does steps 4 and 5 over those few
rows. The scope priorities come from the join rather than a map built in memory, so a priority an
admin changed is read as it is now.

**Measure before indexing.** Run `EXPLAIN ANALYZE` against a slot with a full Mercadona walk
loaded (about 4,200 items) for a chunk of 500 items and a stack of four scopes, and record the
plan and timing in the PR. `ix_item_prices_current` matches the `DISTINCT ON` order, so no new
index is expected.

## 6. The next boundary

`nextBoundaryAt` has to name the moment the answer can change without a write:

- the expiry of each **chosen** row: its `validUntil`, or `lastObservedAt + maxAgeDays`, whichever
  comes first.
- a chosen ADMIN row's `protectedUntil`.
- the earliest future `validFrom` among the **current** rows of the stack, because a row that
  becomes valid can win.

A wider eligible row that was not chosen cannot change the answer by expiring, and a narrower row
that expired cannot come back without a write, which recomputes the key anyway. So the boundary is
computed from the chosen rows plus one `MIN("validFrom")` over current rows with
`"validFrom" > now`, which the same statement can return.

The stale fallback's row sets no expiry boundary, only the future `validFrom` term, since it is
already expired.

## 7. What this plan does not do

- It does not change the materialized columns, the sweep cadence or how a write finds its affected
  keys.
- It does not change the ranking between source kinds.
- It does not change a policy's `maxAgeDays` values. Whether 14 days suits a weekly region walk is
  the owner's setting.

## 8. Tests

- **Unit, `effective-price.spec.ts`**, a new describe "an expired price falls through (plan 0117)":
  - a narrow row past `maxAgeDays` yields the wider eligible row of the same kind.
  - a narrow row past `validUntil` yields the wider row.
  - a narrow current row with a future `validFrom` yields the wider row, and an older valid row at
    the narrow scope does **not** come back.
  - no eligible row anywhere yields the newest enabled current row flagged stale.
  - an ADMIN row is not disputed by an expired automated row, and is disputed by an eligible one.
  - `nextBoundaryAt` is the chosen row's expiry, or an earlier future `validFrom`.
  - The existing describes stay green unchanged, except any case that asserted the old
    "narrowest first, then stale" answer, which is rewritten and named in the PR.
- **Integration, `item-prices.integration.spec.ts`**: the section 1 scenario end to end. Write the
  warehouse price with an old `observedAt`, write the region price now, recompute, and assert the
  shop's materialized row is the region price and not stale. Then move the clock past the region's
  expiry and assert the sweep returns the stale fallback.
- **Writer**: an ADMIN write's snapshot takes the narrowest eligible automated row when two tiers
  hold one.

## 9. Acceptance criteria

- [ ] The narrowest **eligible** row per source kind is chosen, and an expired narrow row falls
      through to the next scope.
- [ ] Current is decided before eligibility, so an older row never stands in for a newer invalid
      one.
- [ ] A chunk whose items all have an eligible row costs one query.
- [ ] The stale fallback still answers when nothing is eligible.
- [ ] An expired automated row cannot dispute an ADMIN row.
- [ ] The writer's ADMIN snapshot follows priority, not scope id order.
- [ ] `nextBoundaryAt` covers the chosen rows' expiry and the next future `validFrom`.
- [ ] The PR carries the `EXPLAIN ANALYZE` of the new query.

## 10. Verification

```sh
npx nx test luna-shopper-backend-catalog -t "effective"
npx nx test luna-shopper-backend-catalog
npx nx affected -t lint test
```

Run `item-prices.integration.spec.ts` through the catalog's integration target against an
ephemeral slot.
