# 0058: the screen that picks the shops

> Server halves: `apps/luna-shopper-backend/plans/0063` (a profile excludes a location, not only a
> chain), `0060` (without which two thirds of these shops have no postal code and never appear) and
> `0061` (the codes the list is drawn from).
>
> A profile knows which postal codes its owner shops in. Catalog knows which shops sit in them.
> Nothing puts the two in front of a person, and the only control that exists is a list of chain
> names, which cannot say "not that one, the one with no parking".
>
> This is that screen. It is the first place in velista where a user sees an actual shop.
>
> Prerequisite reading: `0046` (the profiles page it is reached from) and backend `0063` in full,
> which owns every rule about what an exclusion means.

## 1. What is being built

A page at **`account/profiles/:profileId/supermarkets`**, reached by a button on the profiles page,
listing the shops in that profile's postal codes and letting the user switch each one off.

**A page, not a sheet**, by the test `0009` section 4.1 set and `0015` reused: it is deep linkable,
it has its own scroll, and it is somewhere a person goes deliberately. It is also **not a child of
`account/profiles`**, which renders its children into a sheet outlet at the bottom of its own
scroll; a child route here would draw the whole thing under the profile rows instead of instead of
them.

It is therefore a sibling, and it is **declared before `account/profiles`** in `routes.ts`. The
router would backtrack to it anyway once `account/profiles`' sheet children declined the remainder,
and the existing comment in that file says exactly why that is not good enough: stating the order
makes it a decision rather than a piece of luck about how backtracking works.

Back from this page is `PageNavigation.back('/account/profiles')`. The fallback is required and
this page is deep linkable, so the argument is doing real work rather than satisfying a lint rule.

## 2. Two things it never does

- **It shows no prices.** Not per shop, not per chain. This is a screen about where you are willing
  to go, and a price here would invite the reading that excluding a shop is how you get a cheaper
  number.
- **It does not filter the catalog.** Excluding every shop leaves every product visible and every
  price absent, which is the same state as a profile with no postal code and is already what the
  client renders. Backend `0063` section 3 owns that rule; this screen must not contradict it with
  a warning that implies otherwise.

## 3. The shape

### 3.1 The search bar, always

At the top, on load, before anything is picked, and still there after a franchise is chosen. It
searches **across every franchise**, not within the chosen one, because somebody typing "Ronda de
los Tejares" is looking for a shop and not for a shop of a particular brand. A result therefore
says which chain it belongs to; a location name alone is not enough to identify it.

It matches on: **shop name, chain name, address, city, postal code.** Chain and location name are
separate fields on purpose, because "Mercadona" is the brand and "Mercadona Ronda de los Tejares"
may be the shop, and a user will type either. City and address are already columns on the location.

### 3.2 The franchise buttons, on load

One per chain with at least one shop in this profile's codes, plus **OTHER**.

OTHER is not a rounding error. `groupByBrand` in `osm-places` returns places with no brand tag
under a `null` key, and `0038` measured **35 of the 75** places in one city radius as independent
shops with no chain at all. It is the largest button on the screen for many users, and it is the
neighbourhood grocer people actually walk to.

Each button carries three states, which is `0063` section 2.2's consequence rather than a design
flourish:

| State          | Meaning                                             |
| -------------- | --------------------------------------------------- |
| Chain excluded | "no DIA", including DIA shops that do not exist yet |
| Some excluded  | specific shops are off; new ones will arrive on     |
| None excluded  | everything, now and later                           |

The middle and the top are genuinely different promises, so they must not look the same.

### 3.3 Inside a franchise

The shops of that chain in this profile's postal codes, **grouped by postal code**.

Grouping rather than a flat list, because a profile can hold several codes and they are not near
each other. Home in Córdoba and work in Madrid produce one franchise's shops from two cities, and a
flat list interleaves them with nothing to tell them apart. There is no single point to sort by
distance from either, because there are two centres, so distance is not the axis: the postal code
is.

Each group is headed by `ProfilePostalCode.label` ("home", "the office") **falling back to the
postal code** when there is none, which is the same rule `0057` applies to the code list itself.

**Select and deselect all** sits on the group's franchise, not on each postal code group. Per
`0063` section 2.2 deselect all writes the **chain** exclusion, so it is a different action from
switching off every row by hand and the label must not pretend otherwise: it reads as excluding the
brand.

### 3.4 Toggling

Immediate, optimistically, with the row reverting if the write fails. `0063` provides a bulk write,
which the select and deselect all control uses; a single toggle is a single request.

## 4. The empty states, which are most of the early life of this screen

Three, and they say different things.

- **No postal code on the profile.** The screen cannot be drawn at all. It says so and offers the
  way to fix it, which is `0057`'s screen. This is the only empty state with an action.
- **Postal codes, no shops.** We have never looked, or we looked and nobody has imported what we
  found. The honest sentence is **"we don't have supermarkets for that postal code yet"**, with no
  estimate and no promise, because backend `0062` fills a review queue and an admin decides, and
  nothing in the system can say when.
- **Shops, but the search matched none.** Ordinary, and distinct from the second, because a user
  who cannot find "Lidl" needs to know whether Lidl is missing or their spelling is.

For a long time after launch the second state is the common one. It is worth designing properly
rather than treating as an edge case.

## 5. Attribution is not optional

Every shop on this screen came from OpenStreetMap, whose data is ODbL, and `OSM_ATTRIBUTION` exists
as an exported constant so the obligation travels with the data rather than living in a comment.
**This screen is the place that obligation finally lands**, because it is the first place a user
sees the data.

It renders wherever the shops do, from the constant and never as a typed string. Where a postal
code grouping is drawn from a code that was derived rather than given (`0060`), GeoNames' CC BY
attribution applies alongside it.

## 6. Conventions this screen must not break

- Any icon comes from `libs/shared/ui` as a component. Check the directory rather than the barrel:
  `save-icon`, `close-icon` and `edit-icon` exist unexported. Never inline raw `<svg>`.
- Nothing here imports `@angular/core/rxjs-interop`. Not `toSignal`, not `takeUntilDestroyed`.
- Any date is formatted with `Intl` in the selector and reaches the view as a string. There are no
  dates on this screen today, and the rule is written down so that adding one does not reach for
  `DatePipe`.
- A confirmation drawn over this page is a sheet under it, addressed through `sheet()`.

## 7. Accessibility

The franchise buttons are buttons with text, and their three states are conveyed by more than
colour. The search field is labelled and its result count is announced, because a search that
silently empties the screen is indistinguishable from one that broke. Group headings are real
headings, so the postal code structure is navigable rather than only visible.

## 8. Acceptance criteria

- The page is reachable at its own URL, renders standalone from a cold load, and its back control
  returns to the profiles page from a deep link.
- The route is declared before `account/profiles` and a spec asserts it, in the spirit of the
  existing ordering assertions in `routes.spec.ts`.
- The search bar is present before a franchise is chosen and matches on all five fields, with a
  spec per field.
- A search result names its chain.
- OTHER appears whenever unbranded shops exist in the profile's codes and lists them.
- A franchise with some shops excluded renders differently from one excluded entirely, and deselect
  all produces the latter.
- Shops are grouped by postal code, headed by the label, falling back to the code.
- All three empty states render, and only the first offers an action.
- `OSM_ATTRIBUTION` is rendered from the constant wherever shops are shown.
- No file in the feature imports `rxjs-interop`, asserted by the existing scope scan pattern.
- `npx nx run-many -t lint test -p velista,velista-feature-account,velista-data-access` passes, and
  the velista e2e suite runs against a slot with every remote served.
