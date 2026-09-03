# 0001 (backlog) Filtering the basket

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order,
> and nothing in them has been built. They carry their own numbering starting at `0001`,
> separate from the sequence in `plans/`. When one is picked up it moves into `plans/` and
> takes the next free number there, so parking a design never burns a number in the build
> sequence.
>
> **This is a placeholder, not a design.** It exists so the problem is not rediscovered,
> and it records the one finding that makes the obvious version wrong.

A bar at the top of the basket page filtering its lines, by content, by product, by chain,
and by individual shop. The basket renders `lines()` straight today and has no filter of
any kind.

## What is easy

Content and product. Both are client side over what the page already holds: `BasketLine.content`
and the `products()` map it already resolves names from. `line-list-sheet` has the house
pattern to copy, a search field that appears only once there is more than a screenful.

## What needs the thinking

**Chain and shop cannot be answered from the basket read as it is shaped today.**

- `BasketProduct.offer` is **one** offer: the cheapest across all of the run's scopes
  (`0062`). So `offer.priceScopeId` says _where this is cheapest_, not _which chains sell
  it_. A chain filter built on it silently drops every product a chain stocks but is
  cheaper elsewhere, which is wrong in a way nobody would notice.
- **A price scope is not a shop.** It is the set of stores a chain charges the same in.
  `SupermarketItemService.listByLocation` resolves a location to its scope and pages the
  scope's rows, so "by individual shop" collapses to "by that shop's price scope"
  everywhere in the system, by construction rather than by omission. Two shops in one
  scope are indistinguishable, and there is no per shop stock data anywhere.

So a truthful chain filter needs per scope prices per product, which the basket read does
not carry. `GET /v1/catalog/items/:id/offers` (`listByItem`) is the right primitive and is
paged per item, which is one request per product. The two candidate directions:

1. A batch read: offers for these items across these scopes, in one round trip.
2. Widen the basket read to carry every scope's offer per product instead of the cheapest.

Both are contract changes with a server half, which is why this is parked rather than
planned. Decide the shape before designing the bar.

## Also worth remembering

- Prices are null in staging and production on purpose, because the harvester is off in
  both clusters. A chain filter is an empty control in both environments, so whatever
  ships has to draw sensibly with no offers at all.
- Filtering by chain hides lines with no pick and no offer. Whether those belong in the
  result, or below it, or nowhere, is a design question and not an implementation detail.
