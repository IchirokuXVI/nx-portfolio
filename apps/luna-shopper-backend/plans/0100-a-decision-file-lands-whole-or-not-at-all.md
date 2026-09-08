> **PR:** [#293](https://github.com/IchirokuXVI/nx-portfolio/pull/293)

# 0100 A decision file lands whole or not at all

## Where this starts

The curation toolchain (the four plans under `libs/luna-shopper/curation-*`)
separates deciding from applying. A rehearsal run produces a decisions file;
applying that file to the real catalog is a replay with no model in it. The
admin routes that exist today decide one row per request, so a replay through
them is N requests that can fail halfway and leave the queue half worked. The
user's requirement is the opposite: a stale or contradicted file is rejected
with nothing written.

This plan gives each service one bulk route, both under the admin guard, both
capped at **1,000 operations** per request, a whole file in one call. A file
larger than the cap is rejected, never chunked, because chunks break the
all or nothing promise.

## The harvester route: bulk entry decisions

One route on the gateway beside the existing per row queue routes, backed by
one NATS pattern into the harvester. The request is an ordered list of
operations over source entries:

- `accept`: `{ entryId, itemId | itemRef, expect }`
- `createItem`: `{ entryId, ref, item: { name, brand, ean, unitSize, category, defaultUnit }, expect }`

`ref` names an item created inside this same request, so a later `accept` can
bind a second entry of the same product to it (`itemRef`), which is how a
rehearsal's run created items are expressed before they have a real id.

`expect` is the optimistic check the decisions file recorded at decide time:
the entry's `status` and `lastSeenAt`. An entry that no longer exists, is no
longer queued, or does not match its `expect` fails the whole batch.

The application order is the one the user chose (four steps, and the split is
deliberate):

1. **Validate everything, write nothing.** One harvester transaction locks the
   named entries and checks every `expect`. Any mismatch answers a per
   operation error list and ends the request with zero writes anywhere.
2. **Create all items.** One `item.createMany` call into catalog (added below),
   atomic on the catalog side, answering real ids for every `ref`. A failure
   here ends the request; nothing was bound, and catalog created nothing.
3. **Bind all entries.** One harvester transaction re-checks the `expect`s and
   binds every entry (`ACTIVE`, `matchedBy MANUAL`, confidence 1), all or
   nothing, the same writes `SourceEntryService.bind` makes today. If this
   step fails after step 2 succeeded, the just created items are unbound
   orphans: the service deletes them best effort and reports what it could not
   delete.
4. **Write prices, per entry, skipping failures.** The same per scope price
   writes `accept` performs today. A price write that fails skips that entry's
   prices only and is reported in the response; the binds stand. This is the
   one place the route is not atomic, decided in review: prices are recoverable
   and cross service rollback is not worth a saga.

The response names, per operation, what happened: applied, or the check that
failed, plus the price skips from step 4.

## The catalog routes

Two additions:

- **`item.createMany`**: the atomic multi insert step 2 needs. Internal to the
  bulk flow but exposed as an ordinary admin route for symmetry with `item.create`.
- **Bulk group assignment**: the groups decider's replay. Operations:
  `createGroup { ref, name, slug, referenceUnit, synonyms }` and
  `assignItem { itemId, groupId | groupRef, expect }`, where `expect` asserts
  the item still has no `productGroupId`. One catalog transaction, truly all or
  nothing: group creation and item assignment live in one database, so no
  price shaped exception exists here. Slug collisions and duplicate checks run
  inside the same transaction.

- **Group search by query, if missing.** The groups decider matches candidates
  through the same search production answers, so the group listing route must
  accept a `query` parameter backed by the `search_es`/`search_en` vectors
  from plan 0048. If the public or admin listing already accepts one, this
  item is a no op; the implementer verifies before writing anything.

## Contracts and generated output

New request and result shapes in `libs/luna-shopper/contracts`, new NATS
patterns beside `SOURCE_ENTRY_PATTERNS` and the catalog item patterns, and the
two committed generated files regenerated in the same change:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## What this does not change

The per row `accept`, `createItem` and `reject` routes stay as they are; the
back office keeps using them. Nothing here touches the matching ladder, the
price model (plan 0080), or the rule that a decision never rewrites an entry's
name (plan 0086 D8). The bulk routes are the same writes the per row routes
make, grouped behind one validation gate.

## Verification

Service level tests for the four step flow: a clean batch lands whole; one bad
`expect` rejects everything with zero writes; a step 3 failure deletes the
step 2 items; a price failure skips only that entry's prices and is reported.
Gateway tests for the routes and the cap. The regenerated `openapi.json` and
`wire-types.ts` are committed, and their staleness specs stay green.
