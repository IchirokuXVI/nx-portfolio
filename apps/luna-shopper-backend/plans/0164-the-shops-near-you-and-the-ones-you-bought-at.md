> **PR:** [#481](https://github.com/IchirokuXVI/nx-portfolio/pull/481)

# 0164: the shops near you and the ones you bought at

> Frontend half: velista `0103`, the shop picker that finds you. Needs `0163` first: the
> recent shops are read from the shop a settle records, which `0163` starts to record.
>
> Prerequisite reading: `0068` section 3.3, which this plan reverses in one place; velista
> `0058` (the device says where you shop: coordinates travel in a body and are never kept);
> `0060` to `0062` (postal code centroids, `nearest`, `nearby`); `0064` (a profile can
> exclude a shop); `0142` (a person's purchases).

Two answers feed a shop picker that does not make a person search:

1. **Which shops are near this point**, and whether one of them is clearly the shop the
   person is standing in. This reverses `0068` section 3.3 ("distance is not the axis") for
   one purpose only: choosing where to buy now. The shop lists of a profile stay by postal
   code.
2. **Which shops this person bought at recently.** A shop is recent when the person marked
   something bought there in the last 60 days. That is the only rule.

## Brief for the agent

### Objective

Add a nearby shops answer with an automatic pick, for a signed in person and for a basket
participant, and a recent shops answer for a signed in person, without storing or logging a
coordinate.

### Context

- **Shops** are `supermarket_locations` in catalog
  (`catalog/src/app/entities/supermarket-location.entity.ts`), with `latitude` and
  `longitude` as nullable `double precision` and no spatial index. There is no PostGIS and no
  `earthdistance`, and none is needed.
- **Distance code exists.** `distanceMetres` (haversine) is exported from
  `libs/luna-shopper/osm-places/src/lib/normalize.ts`, and `boundingBox` from
  `libs/luna-shopper/postal-codes/src/lib/bounding-box.ts`. `PostalCodeService.nearby` in
  `catalog/src/app/catalog/postal-code.service.ts` (around lines 172 to 235) already combines
  them for centroids. Reuse them. Do not write a second haversine.
- **Coordinates in a body** is the pattern of `POST /v1/account/postal-code-lookups`
  (`gateway/src/app/account/account.controller.ts`, around line 374).
- **A profile's postal codes and exclusions** are read the way `GET /v1/catalog/shops` reads
  them (`gateway/src/app/catalog/catalog.controller.ts`, around lines 255 to 339).
- **A person's purchases** are the union in `core/src/app/purchases/purchases.sql.ts`
  (around lines 50 to 78): baskets they own, their list page settles, their participant rows.
- `inProfile` is defined in `0163` section 3.

### Target state

- `POST /v1/catalog/shops/nearby` for a signed in person, body
  `{ latitude, longitude, accuracyMetres, profileId? }`. The profile is the one named, else
  the caller's default.
- `POST /v1/baskets/:id/shops/nearby` for any participant, same body without `profileId`. The
  profile is the basket's pricing profile. On a basket with its own shop it answers
  `BASKET_SHOP_LOCKED` (409), because there is nothing to pick.
- Both answer `NearbyShopsView` (section 2).
- `GET /v1/account/recent-shops` answers the caller's recent shops (section 4).
- An index on `supermarket_locations (latitude, longitude)`.
- The OpenAPI document and the admin wire types are regenerated.

### Scope

Work only in:

- catalog: a nearby query and the pure pick function with its spec, one migration for the
  index, and the message handlers
- core: one query for the caller's recent shop ids, and its message handler
- gateway: the three routes, their DTOs, and the composition of shop views
- `libs/luna-shopper/contracts` for the requests, views and messages
- the regenerated `openapi.json` and `wire-types.ts`

Do not touch: velista, the admin app, the postal code lookup, profile shop lists, how a
settle is written, or the basket read.

### Constraints

- **A coordinate is never stored, cached, logged or put in an error.** Make sure that the
  gateway's request logging does not print the body of the two nearby routes, and write a
  spec that proves it.
- **The pick is a pure function** with the thresholds as named constants in one place
  (section 3), so a later change of a number is one line and one table of tests.
- **A shop with no coordinates is never a candidate.**
- **Recent means 60 days and nothing else.** No ranking by frequency, no minimum count.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- adding PostGIS or any other extension
- storing a coordinate for any reason, including a cache
- returning recent shops for anybody other than the caller
- changing a threshold from section 3

### Progress evidence

After each step, state what was built and paste the output that proves it:

- The pick function's table spec, one row per case in section 3.
- A catalog spec against an ephemeral Luna slot: candidates within 750 m in distance order, a
  shop with null coordinates left out, the index used (`EXPLAIN`).
- A gateway spec: the body of a nearby request never appears in a log line.
- A core spec: recent shops from the three purchase routes, 60 days, reverted and
  `NOT_AVAILABLE` settles left out, newest first.
- The regenerated documents.

## 1. The query

Take a bounding box of 750 m around the point, select the located shops inside it, compute
`distanceMetres` for each, and keep those at 750 m or less. Order by distance, then by id.
There are a few thousand shops, so the index on the two columns is enough.

Every candidate carries the shop view of `0163` (id, chain id and name, label, address, city,
postal code), `distanceMetres` rounded to the metre, `inProfile`, and `excluded` (the profile
excludes it, `0064`).

## 2. The answer

```ts
interface NearbyShopsView {
  candidates: NearbyShopView[]; // nearest first, at most 750 m
  pick: { locationId: string; distanceMetres: number } | null;
  noPick: 'NONE_NEARBY' | 'LOW_ACCURACY' | 'AMBIGUOUS' | 'OUTSIDE_PROFILE' | null;
}
```

Exactly one of `pick` and `noPick` is set. The client shows the pick with a message that
names it, so the person can check it, and otherwise shows the candidates.

## 3. The pick

The rule, as the user set it on 2026-09-24:

| Case | Result |
| ---- | ------ |
| `accuracyMetres` over 150 | no pick, `LOW_ACCURACY` |
| no candidate | no pick, `NONE_NEARBY` |
| one candidate, under 500 m | pick it |
| one candidate, 500 m or more | no pick, `AMBIGUOUS` |
| several, the nearest under 250 m and every other at 500 m or more | pick the nearest |
| several, any other case | no pick, `AMBIGUOUS` |
| the shop that the rows above pick has `inProfile` false | no pick, `OUTSIDE_PROFILE` |

The candidates are all returned in every case, including the ones outside the profile. A
shop outside the profile can be chosen by hand and is priced correctly by `0163` section 2.

**Assumption to confirm:** a shop the profile excludes is still a candidate, but it is never
picked automatically (`AMBIGUOUS`). The user did not decide this.

Constants: capture radius 750 m, single candidate limit 500 m, clear nearest limit 250 m,
others at least 500 m, accuracy limit 150 m.

## 4. Recent shops

`GET /v1/account/recent-shops` answers
`{ shops: { shop: ShopView, lastBoughtAt: string }[] }`, newest first.

Core selects, over the caller's purchases, the distinct `supermarketLocationId` of settles
with outcome `BOUGHT`, `revertedAt` null, a shop recorded, and `settledAt` in the last 60 days,
with the latest `settledAt` of each. The gateway turns the ids into shop views. A shop that no
longer exists is left out.

It is per person, never per household: it says where this person stands, which is the
reason `0143` keeps a shop private. A person with no account behind them (a link visitor
guest) has no recent shops, and velista does not ask.

It starts empty. `0163` records the first shops.
