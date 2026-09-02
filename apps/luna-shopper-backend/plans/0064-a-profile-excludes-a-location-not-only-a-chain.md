# 0064 A profile excludes a location, not only a chain

`ProfileSupermarketPreference` is emphatic about its own scope:

> **It names the chain and never a location.** "No DIA" means no DIA anywhere, and which stores a
> chain reaches is the resolver's business rather than the user's. There is deliberately no per
> location preference anywhere in this plan, including on the page that edits it.

That was right for a profile whose only geography was a postal code. It stops being right the
moment `apps/velista/plans/0059` puts a list of actual shops in front of somebody, because the
question that screen asks is per shop: not "do you shop at DIA" but "do you go to _that_ DIA, the
one with no parking".

This plan adds the finer axis. It does **not** remove the coarser one, and section 2 is why.

Depends on `0049` (the profile and its chain preferences) and `0061` (without which the screen has
nothing to list). Backend only; the screen is `apps/velista/plans/0059`.

## 1. The new table

**`ProfileLocationPreference`** (core):

- `id`, `profileId`
- `supermarketLocationId` (uuid, opaque catalog reference, **no foreign key**, exactly as
  `supermarketId` is opaque on the chain table: catalog is a separate service with its own
  database)
- `excluded` (boolean, default false)
- unique (`profileId`, `supermarketLocationId`)

**A blacklist, and for the reason already written on its sibling.** An allowlist would mean a store
that opens next month, or a store an admin imports next week, is silently missing until the user
notices and adds it. Absence means included, so the default for anything new is that the user can
see it, which is the failure the user can actually detect.

## 2. Why the chain axis stays

With a "deselect all" control on the screen, chain level exclusion looks redundant. It is not, and
the difference is entirely about stores that do not exist yet.

| The user does                         | A DIA opens near them next month                                |
| ------------------------------------- | --------------------------------------------------------------- |
| Excludes the four DIA locations shown | It appears, included, because a blacklist has never heard of it |
| Excludes the DIA chain                | It never appears                                                |

Both are things people mean. "Not that shop" is about parking, a bad experience, a route home.
"Not DIA" is about the brand, and it should keep being true without maintenance. Collapsing them
into one mechanism loses whichever meaning was not chosen.

### 2.1 Precedence

**An excluded chain hides every one of its locations, whatever their individual rows say.** The
finer axis never re admits what the coarser one refused, and location rows under an excluded chain
are inert rather than deleted, so un excluding the chain restores exactly the selection the user
last had.

### 2.2 What "deselect all" writes

It writes the **chain** exclusion, because "I am done with this brand" is what a person means when
they clear a whole franchise in one gesture, and because the alternative silently commits them to
maintaining a list forever.

Individual deselection stays the finer tool underneath. One consequence to carry into the screen:
deselecting every location by hand is **not** the same as pressing deselect all, and the franchise
button therefore has three states rather than two: chain excluded, some locations excluded, none.
`apps/velista/plans/0059` owns how that reads.

## 3. What exclusion actually changes

Worth being precise, because "excluded" could plausibly mean three different things and only two
of them are true here.

- **The store screen** stops offering it. Obvious and intended.
- **Scope resolution** narrows. `ScopeResolverService`'s first rung finds the locations sitting in
  the caller's postal codes and takes their scopes; that query now considers only locations this
  profile has not excluded. Without this, exclusion is cosmetic: a user could exclude every
  Mercadona near them and still be quoted Mercadona's local price.
- **The catalog does not shrink.** An excluded chain or store removes prices from consideration,
  never items from the catalog. That is `0049`'s rule and `apps/velista/plans/0059` restates it for
  the screen. A user who excludes everything sees every product and no prices, which is the same
  state as a user with no postal code, and the client already renders it.

The basket generator in `0050` and backlog `0004` inherits the narrowed scope set with no change of
its own.

## 4. The doc that has to stop being wrong

The block quoted at the top of this plan is on `ProfileSupermarketPreference` in code, and after
this plan it describes behaviour the system no longer has. **Rewriting it is part of the work, not
a follow up.** The replacement says what is now true: the chain preference is the durable statement
about a brand, including brands' future stores, and the location preference beside it is the
specific one.

`0049` itself is a historical record of a decision made then and is not edited. It gains a pointer
to this plan at the section that is now superseded, which is how a reader of the old plan finds
out that it was.

## 5. Contracts and endpoints

`ProfileLocationPreferenceView`, and routes to set and clear one, mirroring the chain preference
routes rather than inventing a second shape. A bulk write is worth having from the start: the
screen's natural gesture is several toggles at once, and one request per checkbox is a poor fit for
a phone on a bus.

`ResolvePriceScopesRequest` gains `excludedSupermarketLocationIds` beside the chain list it already
carries.

**Regenerate the OpenAPI document** and commit it in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 6. Migrations

Core: create `profile_location_preferences` with its unique index. Nothing to backfill; an empty
blacklist is the correct starting state for every existing profile and means their behaviour does
not change on deploy.

## 7. Exit criteria

- Excluding a location removes it from the store read and from rung one of scope resolution, with a
  test for each.
- Excluding a chain hides its locations regardless of their own rows, and un excluding it restores
  the previous per location selection intact.
- A location imported after a user excluded four of that chain's stores is included by default.
- Deleting a profile cascades its location preferences.
- The doc on `ProfileSupermarketPreference` no longer claims there is no per location preference,
  and `0049` carries a pointer here.
- A user who excludes every location still receives the full catalog, with no prices.
- `openapi.json` regenerated and committed; `npx nx run-many -t build test -p luna-shopper-backend-core,luna-shopper-backend-catalog,luna-shopper-backend-gateway` passes.
