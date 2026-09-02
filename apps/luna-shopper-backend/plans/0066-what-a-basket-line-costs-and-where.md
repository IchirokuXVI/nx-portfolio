# 0066 What a basket line costs, and where

> Client half: `apps/velista/plans/0062`, which draws every number this plan answers.
>
> Depends on `0048` (scoped search, `ItemOfferView` and the `bestOffer` field this reuses whole),
> `0049` (the profile to scope resolution the gateway already runs), `0051` (the basket read and
> its redaction rule) and `0061` (without which most locations have no postal code and cannot be
> named as a place).

The basket screen names the product on every line and quotes no price for any of them. The pick
sheet, which exists so somebody at a shelf can swap one product for another, lists the candidates
by name and brand and says nothing about what any of them costs. That is the one question being
asked at that moment.

The data has been there since `0038` harvested it. `SupermarketItem` holds a price, a unit price, a
currency, an observation time and a source kind, per item per price scope. `0048` built the scoped
read that finds the cheapest of them and put it on `ItemView.bestOffer`. `0049` built the profile
to scope resolution, and the gateway already runs it on the basket's own suggest route. Every piece
exists. Nothing joins them on the read the basket screen actually makes.

## 1. What is being built

| Piece                                                 | Where                       |
| ----------------------------------------------------- | --------------------------- |
| `item.getMany` accepts scopes and answers `bestOffer` | catalog                     |
| The basket read prices its products                   | gateway, `productsOf`       |
| The basket read says what a scope **is**              | gateway, a new composition  |
| Who may see a price, and who may see a place          | gateway, the redaction rule |

**No new route, no new NATS subject, no core change and no migration.** One catalog request grows a
field, one gateway composition grows a call, and the basket response grows two things a client may
ignore entirely.

## 2. Catalog: `item.getMany` takes scopes

`GetItemsRequest` is `{ ids: string[] }` today, and `ItemView.bestOffer` is documented as absent on
every read that has no scopes to price against, `item.getMany` included. That is exactly the
sentence this plan changes:

```ts
export interface GetItemsRequest {
  ids: string[];
  /** Price the results at these scopes. Absent leaves `bestOffer` absent, as today. */
  priceScopeIds?: string[];
}
```

**Absent and empty are the same here**, and both mean "do not price", which is not the convention
`0048` chose for `item.search` (there, absent is unscoped and empty is a caller whose profile
resolved to nothing). The difference is deliberate and is the reason to write it down: search has
to distinguish an admin listing everything from a user who shops nowhere, because the two want
different result sets. A lookup by id returns the same items either way, so the only question is
whether a price is attached, and one branch answers it.

The implementation is the one `item.searchOffers` already runs: the cheapest `SupermarketItem` row
across the requested scopes, per item, by `price`. It is a join and a group, not a new algorithm,
and `bestOffer` is populated by the same mapper. Unknown ids stay absent from the answer, unchanged.

### 2.1 Cheapest by price, not by unit price

`bestOffer` picks the lowest `price`, which is what the till charges. Ranking by `unitPrice` is the
better answer to "which milk is cheaper" and is **backlog 0004 section 2**, together with the
threshold rule that makes it usable. Doing half of it here, on one field, with no explanation
attached to the number, would produce a screen recommending the six pack because it is cheaper per
litre while the shopper wanted one bottle.

`unitPrice` and `unitPriceLabel` still travel on the offer, because a client showing "2.19 EUR,
1.46 EUR/L" is showing two facts rather than making a recommendation. Neither is ever recomputed
here: `0038` section 2.4's rule stands, the source's own figure is stored verbatim and disagrees
with the obvious derivation on 110 of 4,232 products.

## 3. The gateway prices the basket

`productsOf` in `generated-list-sharing.controller.ts` is the whole seam. It already collects every
item id any line names, in one round trip, and already degrades to an empty array when catalog is
unreachable.

It gains the scopes, resolved the same way the suggest route beside it resolves them:

1. Ask core what the run was composed against: `GeneratedListBasketScope`, which carries the
   basket's `ownerUserId` and its `profileId`.
2. Turn that into scope ids through `ScopeResolutionService.forRead`, which is cached in Redis for
   a minute and invalidated on every profile write.
3. Pass them to `item.getMany`.

**The scope is the run's and never the reader's**, which is the rule the suggest route already
states and the one thing here that must not be softened. A registered participant's own profile is
refused as firmly as a guest's absent one. Pricing somebody else's basket against your own shops
answers a question nobody asked and quietly tells the owner's guests where the guest shops.

### 3.1 Failing to price is not failing to read

Every branch that cannot produce a scope set produces **no scopes**, and the read proceeds unpriced:

- The basket names no profile, which is a run the caller scoped by hand.
- The profile has no postal code and no chain, so `forRead` throws `CATALOG_SCOPE_REQUIRED`.
- The profile has since been deleted.
- Redis is down, core is slow, catalog is unreachable.

A basket in an aisle is worth more than a price, and the existing comment on `productsOf` says so
about names. It now says it about prices too. Nothing on this path may turn a missing price into a
failed screen.

### 3.2 The harvester is off outside development

`lunaShopperBackend.harvester.enabled` is false in both clusters, on purpose, and stays false. So
in staging and in production there are no harvested prices, every `bestOffer` comes back null, and
this feature renders exactly what the screen renders today.

That is not a reason to defer it. It is a reason to state the acceptance criterion honestly: **this
plan is demonstrable only against a locally seeded catalog**, and the client half is written so
that "no price" is the ordinary case rather than an error state. An `ADMIN` sourced price typed in
by hand also flows through this, unchanged, which is the one way a cluster could ever show a
number.

## 4. A price needs a place, and a scope is not one

`ItemOfferView` names its `priceScopeId`, which is a uuid. A price scope is the set of stores a
chain charges the same in: it is the right key for a price and is not something to show a person.

So the basket response gains a **scope description**, one entry per scope id that appears on any
offer it carries:

```ts
interface BasketPriceScopeView {
  priceScopeId: string;
  supermarketId: string;
  /** The chain, both locales, resolved by the client. */
  supermarketName: LocalizedText;
  /** The shops of this scope the run's profile still includes. May be empty. */
  locations: BasketScopeLocationView[];
}

interface BasketScopeLocationView {
  supermarketLocationId: string;
  label: LocalizedText | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}
```

The locations come from `supermarketLocation.list` by scope, filtered by the profile's own
exclusions once `0064` ships, so a shop the owner has switched off is never offered as the place to
go and buy something. Before `0064` the filter is a no op and the list is every store in the scope.
The names come from `supermarket.list`, which the gateway can ask for once per response.

Both reads are cheap and both are cacheable, and neither is per line: a basket of thirty lines
across two chains describes two scopes.

### 4.1 A scope with no locations still describes a price

`0061` gives locations their postal codes and is a prerequisite for this being useful, not for it
being correct. A scope whose stores we cannot place answers with an empty `locations` array and its
chain name, and the client says "Mercadona" with no address. That is a smaller answer, and it is
still the answer to "where".

## 5. Who sees what

Two different questions, and they get two different answers.

**The price reaches every participant, guests included.** `0055` section 5.2 already settled the
class: catalog items and product groups are public product facts, which is why a guest's typeahead
is priced against the run's scopes today. What a tin of tomatoes costs at Mercadona is not a fact
about anybody's household. A guest who is being asked to go and buy fourteen things and cannot see
what any of them costs has been handed a worse tool than a paper list.

**The individual shop reaches only a reader who passes the all or nothing rule.** `supermarketName`
goes to everybody; `locations` is populated only when `seesZoneData` is true, and is an empty array
otherwise, which is the shape section 4.1 already makes the client handle.

The reason is that a street address is the owner's geography rather than a product fact. "Cheapest
at Mercadona" is what a shopper needs in order to act, and they are standing in the shop. "Ronda de
los Tejares 32, 14008" tells somebody who found a forwarded link which neighbourhood the owner
lives in, which is the kind of disclosure `0051` spent a whole plan refusing to make by accident.
The chain is actionable; the address is only actionable to somebody who was going there anyway.

This is one condition in one composition, so it is one line to revisit if the owner decides the
address should be shared with the people they invited. It is deliberately **not** a new flag on the
basket, a setting, or a per participant permission: `0051` section 11 already names the per line
version of this question as the target, and a second axis added here would have to be redesigned
alongside it.

### 5.1 It is redacted in the response, never in a broadcast

Prices are not on any realtime event and must not be. A price does not change because somebody
settled a line, and the basket's broadcasts are redacted to the least privileged reader in the room
precisely because a broadcast cannot be projected per socket. A price attached to a broadcast would
be sending an owner's shop list to every guest in the room by the shortest available path.

Prices refresh when the basket is refetched, which is often, and that is enough.

## 6. What this plan does not do

- **It does not change which product a run picks.** `GeneratedListService.resolvePick` still takes
  the first option added, and its comment still says why. Section 4 of `0050` asks for the best
  priced option and this plan finally makes that computable, which is genuinely tempting and is
  still the wrong moment: changing what a basket is composed of is a change to what people carry
  around a shop, and it should land after somebody has looked at real prices on a real screen for a
  week. The pick sheet now shows the prices, so a shopper can see that the default is not the
  cheapest and change it in one tap, which is the useful half and carries none of the risk.
- **It does not total the basket.** A sum implies a trip, a trip implies a shop, and choosing the
  shop is the whole of backlog `0004`. A per line price is a fact; a total is a recommendation.
- **It does not rank the options for the client.** The pick sheet's order stays the line's own
  option order, and the client marks which one is cheapest rather than reordering. Reordering a
  list somebody is reading at a shelf, because a price changed, moves the row under their thumb.
- **It does not filter unavailable products.** `SupermarketItem.available` is carried on the offer
  and is the client's to draw. A product the shop has stopped stocking is still on the list and
  still has to be dealt with.

## 7. Tests

Catalog:

1. `item.getMany` with no `priceScopeIds` answers items with `bestOffer` absent. This is the
   regression guard for every existing caller.
2. With scopes, each item carries the cheapest of its rows across exactly those scopes.
3. An item with rows only in other scopes answers `bestOffer` null rather than a price from a scope
   the caller did not ask about.
4. `unitPrice` comes back verbatim, matching its stored value and not a recomputation.

Gateway:

5. The basket read prices against the run's profile, and a registered participant's own profile
   changes nothing about the answer.
6. A basket whose profile resolves to no scopes answers the basket, unpriced, with a 200.
7. Catalog throwing answers the basket, unpriced, with a 200 and no offers, exactly as it answers
   with no names today.
8. A guest's read carries `supermarketName` and an empty `locations`; an owner's carries both.
9. The scope descriptions cover exactly the scope ids the offers reference, with no extras.

## 8. Regenerate the OpenAPI document

Response shapes change on `GET /v1/generated-lists/:id/basket`, so this one really does move.
Before the PR:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```
