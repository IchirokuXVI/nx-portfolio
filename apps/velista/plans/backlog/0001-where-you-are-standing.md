# 0001 (backlog) Where you are standing

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Parked on 2026-09-27 while the shop map series was planned (`0121` to `0123`, backend
> `0168`, the `shop-map` libraries). The user asked whether the app can tell a shopper what
> to get next from where they stand, marked it low priority, and asked for it in the backlog.

> **Update, 2026-09-29:** the series was rewritten around a map in metres
> (`shop-map/plans/0002`) with no product pins, and the viewer lost `setHighlight`. Scanning
> a product to say where you stand no longer works, and "you are here" becomes a point in
> metres. Rewrite the Context and Target state against `0121` and the editor's current API
> when this plan is picked up.

A shopper on the map page (`0121`) says where they are, and the app reorders what is left
by distance from there. Saying where they are is a tap on the map, or a scan of any product
on the shelf beside them, because a pinned product's cell is a position. Nothing senses the
phone: no browser can position it in a shop, and the assessment of 2026-09-27 records why.

## Brief for the agent

### Objective

Let a shopper set their position on the shop map by a tap or a scan, and reorder the
remaining rows of the basket at that shop by the walk from that position, replanned as a
whole rather than nearest next.

### Context

- The model library answers `distancesFrom(doc, cell)` and `walkOrder` from any start.
  The viewer takes `setHighlight({ cell })` for "you are here".
- The basket at a shop knows each product's sections (backend `0167`) and each section's
  anchor on the map.
- A scan resolves to a product through `lookup` by EAN (backend `0168`), and a pinned
  product's anchor names a cell.

### Target state, in outline

- A "You are here" tool on the map page: tap a floor cell, or scan. The pin is drawn and
  kept on the device for the life of the shop choice.
- The basket offers "From where I am" beside the aisle grouping. On, the remaining
  sections are ordered by a replanned walk from the pin to the checkout, and the order is
  recomputed when the pin moves, never when a row settles.
- Nothing is sent to the server.

## Open questions

- Whether the reorder is a grouping of its own or a flag on the aisle grouping.
- Whether a scan also settles the scanned row when it is on the list.
