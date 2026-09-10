> **PR:** [#337](https://github.com/IchirokuXVI/nx-portfolio/pull/337)

# 0105 A scope says how specific it is

A price scope is the set of shops a chain charges the same in. Today a shop points at exactly one of
them, so no code ever has to choose between two, and nothing stores which of two would win.

That is about to stop being true. Mercadona prices by warehouse, and a warehouse is not the only
grouping it prices by: measured against the live API on 2026-09-10, six warehouses agreed on the
price of 1,480 of 1,541 shared products, and the differences were a real tax region (the four Catalan
provinces, on packaged sugary drinks) plus fresh produce sold by weight. A chain like that wants a
national scope for what it charges everywhere, a region scope for the places that differ, and a store
scope for a shop somebody prices by hand. One shop then sits under three of them and something has to
say which one a shopper is quoted.

This plan adds that something. **A scope carries a priority, a shop may hold several scopes, and the
most specific scope that has a price is the price.** It changes no fetching and no crawl.

`0108` depends on this one. `0080` is the rule this plan does not touch: several sources write side
by side and `price_policies` decides between them, and that decision happens _inside_ one scope,
after this plan has already chosen the scope.

## 1. What is true today

Measured by reading `dev` at `f60a1c87`.

### 1.1 `kind` decides almost nothing

`PriceScopeKind` has four values (`libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts:27`)
and exactly two consumers:

| Where                                     | Uses it for                                        |
| ----------------------------------------- | -------------------------------------------------- |
| `price-scope.entity.ts`, `uq_price_scope` | uniqueness on `(supermarketId, kind, externalKey)` |
| `scope-resolver.service.ts:225`           | finding the chain's `NATIONAL` scope               |

Rung one of the resolver never reads it. It goes postal code to location to `location.priceScopeId`
and stops (`scope-resolver.service.ts:137`). So the enum is already close to a label, and the
ordering everybody assumes it implies is written nowhere.

### 1.2 A shop has exactly one scope

`SupermarketLocation.priceScopeId` is a single non-null uuid column with a `ManyToOne` and
`onDelete: 'RESTRICT'` (`supermarket-location.entity.ts:41`). Its own comment says every location has
one, and that a chain with no obtainable data gets a `STORE` scope of its own so hand entered
supermarkets need no special case.

**The item side is already plural.** `supermarket_items` is unique on `(itemId, priceScopeId)`
(`supermarket-item.entity.ts:28`), so one product priced in 255 scopes is 255 rows and the schema has
always allowed it. The singular half is the shop, and only the shop.

### 1.3 The tie break that exists is "cheapest", and it answers a different question

When the resolver returns several scope ids, `getMany` attaches `bestOffer` as the cheapest row
across exactly those scopes (`item.service.ts:340`). That is correct and must stay correct: those
scopes belong to **different shops and different chains**, and comparing them is what the product is
for.

It is the wrong rule inside one shop's own stack. A national fallback that happens to be cheaper than
the regional price the shop actually charges would win, and the shopper would be quoted a number no
till will ring up. The two selections are the same code path today only because a shop has one scope
and the situation cannot arise.

## 2. A priority, beside the kind and not instead of it

### 2.1 The column

```ts
/**
 * How specific this scope is. Lower is more specific, and the most specific
 * scope that has a price for a product is the price that shop charges.
 *
 * An integer and not an enum position, so a tier nobody anticipated is a number
 * rather than a migration: a chain that prices by province fits at 250 with no
 * new kind, no contract change and no back office release.
 */
@Column({ type: 'integer' })
priority!: number;
```

Gaps of 100, and **existing rows are never renumbered**. A number that moved would silently re-rank
every shop that held the scope.

### 2.2 The defaults, derived from the kind at creation

```ts
export const DEFAULT_SCOPE_PRIORITY: Record<PriceScopeKind, number> = {
  [PriceScopeKind.STORE]: 100,
  [PriceScopeKind.POSTAL_CODE]: 200,
  [PriceScopeKind.REGION]: 300,
  [PriceScopeKind.NATIONAL]: 1000,
};
```

A creator that states no priority takes the default for its kind, which is what makes the migration a
single `UPDATE` and every existing caller correct without being touched.

### 2.3 The kind stays, and this is what it is for

Replacing `kind` with the number is the tempting version of this plan and it is wrong, for one
reason: **the number does not say how to read `externalKey`.** A warehouse code, a postal code and a
store id are not interchangeable, and a run that declares scopes of three kinds at once (`0108`) has
to attach shops to each one differently. `priority` says how a scope competes, and `kind` says what
it is. Two facts, two columns.

The unique index is unchanged: `(supermarketId, kind, externalKey)`. Priority is not part of
identity.

## 3. A shop holds several scopes

### 3.1 The join table

```sql
CREATE TABLE "supermarket_location_price_scopes" (
  "supermarketLocationId" uuid NOT NULL REFERENCES "supermarket_locations" ("id") ON DELETE CASCADE,
  "priceScopeId"          uuid NOT NULL REFERENCES "price_scopes" ("id")          ON DELETE RESTRICT,
  PRIMARY KEY ("supermarketLocationId", "priceScopeId")
);
```

`RESTRICT` on the scope side is kept from the column it replaces: a scope with prices written against
it must not vanish under them.

### 3.2 The old column becomes the seed, then goes

The migration inserts one row per existing location from `priceScopeId`, then drops the column. Every
shop therefore starts with exactly the stack it has today, of size one, and every read below returns
what it returned before the migration ran.

**A shop with no scopes at all is not a state this plan creates.** The import path already gives a
location a `STORE` scope when it names none (`discovered-place.service.ts:330`), and that stays the
floor of the stack.

## 4. Choosing, in two places that must not be confused

| Question                                | Rule                                 | Where                            |
| --------------------------------------- | ------------------------------------ | -------------------------------- |
| Which price does _this shop_ charge?    | lowest `priority` that has a row     | new                              |
| Which of my shops is cheapest for this? | lowest price across the resolved set | `item.service.ts:340`, unchanged |

The first runs before the second. Resolution answers, per shop, with one scope id, and the cross-shop
comparison then does exactly what it does today over that answer.

**"Has a row" is per product, not per scope.** A region scope that prices 400 of a chain's 4,000
products is normal and correct: those 400 come from the region and the other 3,600 fall through to
national. Choosing a scope once per shop and using it for every product would blank the other 3,600.

## 5. The resolver

`ScopeResolverService` keeps its three rungs and its 60 second cache. Two changes:

- Rung one returns the shop's whole stack rather than one id, so `ResolvedScopeView` carries the
  scopes of a shop and their priorities, and `priceScopeIds` is their union.
- Rung two keeps looking up `kind = NATIONAL`, because a chain with no shop near the caller has no
  stack to walk. It is a fallback for a missing shop, not a tier of a stack.

Rung three (`supermarket.defaultPriceScopeId`) is untouched.

## 6. What changes

| File                                                       | Change                                           |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `libs/luna-shopper/contracts/.../catalog.enums.ts`         | `DEFAULT_SCOPE_PRIORITY` beside `PriceScopeKind` |
| `catalog/.../entities/price-scope.entity.ts`               | `priority` column                                |
| `catalog/.../entities/supermarket-location.entity.ts`      | `priceScopeId` becomes a `ManyToMany`            |
| `catalog/.../entities/supermarket-location-price-scope.ts` | the join entity                                  |
| `catalog/.../db/migrations/<ts>-PriceScopePriority.ts`     | column, backfill, join table, seed, drop         |
| `catalog/.../catalog/scope-resolver.service.ts`            | rung one returns a stack                         |
| `catalog/.../catalog/effective-price.ts`                   | pick by priority within a shop                   |
| `catalog/.../catalog/supermarket.service.ts`               | create and update accept `priority`              |
| `libs/luna-shopper/contracts/.../catalog.messages.ts`      | `priority` on the scope views and writes         |
| `libs/luna-shopper-admin/feature-catalog/price-scopes.ts`  | the column, and the label per priority band      |

The back office shows a label, not the number: "this shop", "postal code", "region", "everywhere".
The number is the backend's and the label is the frontend's, which is the split that lets a chain sit
at 250 without the back office knowing the word for it.

## 7. Order of work

1. `DEFAULT_SCOPE_PRIORITY` and the contract changes.
2. The migration, in one file: add, backfill, create, seed, drop.
3. The resolver and `effective-price`.
4. `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.
5. The back office column.

## 8. Tests

- `scope-resolver.service.spec.ts`: a shop with three scopes resolves to its stack. A chain with no
  local shop still reaches `NATIONAL`. A caller who excluded every shop still resolves to nothing.
- `effective-price.spec.ts`: within one shop, priority 100 beats 300 even when 300 is cheaper. A
  product priced only at 1000 resolves to 1000. A product priced nowhere in the stack is null.
- `item.service.spec.ts`: across two shops, the cheaper price still wins. This is the test that fails
  if somebody applies priority to the wrong question.
- A migration test on a throwaway Postgres, asserting every pre-migration location holds exactly one
  scope afterwards and that its id is unchanged.

## 9. Decisions

- **D1. `priority` is stored, not derived from `kind`.** Deriving it means a new tier is an enum
  value plus a migration plus a contract change plus a back office release. Catalonia is a real tier
  that is neither a warehouse nor national, so this is not hypothetical.
- **D2. `kind` stays.** It says how `externalKey` is read and how a shop attaches. `0108` declares
  three kinds in one run and needs the distinction.
- **D3. Lower is more specific.** So a scope added later at a tier nobody named sits between two
  existing numbers rather than beyond the end.
- **D4. Cheapest still wins across shops.** Priority resolves inside a shop and never between shops.
  Conflating them quotes prices no till charges.
- **D5. The old column is dropped in the same migration that seeds the table.** Leaving both would
  give two answers to one question for however long the second migration took to arrive.

## 10. What this plan does not do

- It writes no scope for any chain. Mercadona's are `0108`'s.
- It does not touch `price_policies` or the `ADMIN` row's protection window. Those decide within a
  scope and run after this plan has chosen one.
- It does not change `bulk_price` handling, which stays verbatim and is never recomputed.
- It adds no per chain environment variable, per the rule from `0083`.
