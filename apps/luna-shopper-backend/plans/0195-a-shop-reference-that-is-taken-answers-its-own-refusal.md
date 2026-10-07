> **PR:** [#665](https://github.com/IchirokuXVI/nx-portfolio/pull/665)

# 0195: a shop reference that is taken answers its own refusal

> Asked for by the owner on 2026-10-07 ("the other small plan (implement it) for the
> defect"). The defect was found in the walk of plan `0193` on a real catalog (PR #660), and
> that plan records it under "A reference that another shop holds: a 500 that this plan did
> not cause".
>
> Prerequisite reading: plan `0193` (the link, the bulk link, section "What was decided
> while building"), plan `0152` sections 2 and 3 (the three rungs, the fill), plan `0185`
> (`item_ean_held`, the same shape of refusal for a barcode), plan `0112` section 2 (which
> details reach a client), `k8s/catalog-import/first-catalog.manifest`, and
> `catalog/src/app/catalog/supermarket-location.service.ts`,
> `harvester/src/app/harvest/discovered-place.service.ts`, `place-link-fields.ts`,
> `place-matching.ts` and `libs/luna-shopper/platform/src/lib/errors/`.

The catalog holds one shop for each external reference. A write that gives a shop a
reference that another shop holds was answered by the database, and the person saw a server
error with no reason. This plan makes catalog answer it, with a code of its own and the
name of the shop that holds the reference, and it says what a link and an import do then.

## Brief for the agent

### Objective

Answer 409 `location_external_ref_taken`, with the shop that holds the reference, on each
write that gave a 500 before. Let a link of a place go through with the reference left
empty. Add no migration.

### Context

Every statement below was read in the file it names, on `dev` at `d3a054f9`.

**The index.** `1756100000000-PriceScopesAndSourceProvenance.ts:112` creates
`uq_locations_external_ref`, a unique index on `supermarket_locations ("externalRef")
WHERE "externalRef" IS NOT NULL`. It reads the reference alone: not the chain, and not
`externalProvider`. The entity (`supermarket-location.entity.ts:122`) does not declare it,
so only the migration names it.

**The 500.** `SupermarketLocationService` wrote the reference with no read first.

- `create` (`supermarket-location.service.ts:114`) put `req.externalRef` on the draft
  (`:149`) and saved it inside `audit.write` (`:162`).
- `update` (`:295`) assigned `req.externalRef` (`:341`) and saved the row (`:356`).

Postgres refused the statement with `23505`. TypeORM threw a `QueryFailedError`, which is
no `DomainException`. `GlobalExceptionFilter.classify`
(`platform/src/lib/errors/global-exception.filter.ts`) thus answered `internal`, and the
gateway answered 500. The transaction rolled back, so nothing was written.

**The ways to reach it.**

1. `POST /v1/admin/catalog/supermarkets/:id/locations` with a reference that is taken.
2. `PATCH /v1/admin/catalog/locations/:id` with a reference that is taken.
3. `POST /v1/admin/harvest/places/:id/link`, when the shop named has no reference and
   another shop holds the reference of the place. `missingFields`
   (`place-link-fields.ts:89`) puts `externalRef` in the patch for a shop that has none,
   and `bind` (`discovered-place.service.ts:926`) sends it.
4. `POST /v1/admin/harvest/places/:id/import`. `promote` (`:984`) always sends the
   reference of the place (`:1014`). The check before it (`matchLocations`, `:749`) reads
   the shops of **one chain**, and `locationsCarryingRef` (`place-matching.ts:95`) drops a
   shop that names another provider. The index reads neither. So the import met the index
   in two cases: with `force`, when a shop of the chain holds the reference, and
   **without `force`**, when the holder is a shop of another chain or names another
   provider.
5. A trusted run (`autoImport`, `:425`) calls the same `promote`. It catches every
   failure, logs it and leaves the place in the queue, so the run went on. The log line
   said only that catalog failed.

**The bulk link does not reach it.** `linkByRef` (`:844`) links a place to the one shop
that already carries its reference. `missingFields` thus never puts the reference in the
patch. A spec holds that.

**What a refusal with details looks like here.** `ItemEanHeldException` (plan `0185`) and
`SectionSlugTakenException` (plan `0167`): a code in `error-codes.ts` with its status in
`ERROR_STATUS`, a sentence in English and Spanish in `error-catalog.ts`, a class in
`domain-exception.ts` with `exposesDetails = true`, and a constant for each key of the
details. `section.service.ts` checks first and also turns the `23505` of its index into
the same refusal (`asViolation`).

**How a refusal of catalog reaches the harvester.** It crosses NATS as the problem object
that the filter of catalog built, bare or nested under `error`, and not as an `Error`
(`describe-error.ts`). A refusal that the harvester does not catch reaches the gateway as
that same object, and the gateway answers it as it came (`extractRemoteProblem`).

### The decision on the index

**The index stays as it is in this plan. The right index is on the provider and the
reference, and that is a follow up with a migration.**

- Two chains can print one string. `osm-places` writes `node/1156230891` and El Jamón
  writes `14010:avenida de cadiz 68`, and those cannot meet. But Mercadona writes the bare
  `id` of its store (`libs/luna-shopper/mercadona/src/lib/stores.ts:135`) and DIA writes
  the bare `tiendaCodigo` (`libs/luna-shopper/dia/src/lib/stores.ts:94`). A Mercadona shop
  and a DIA shop with the same number are two shops, and the index holds only one of them.
  The harvester already reads a reference with its provider: `discovered_places` is unique
  on `(provider, externalRef)`, and rung 1 and the bulk link do not count a shop that names
  another provider.
- Nothing shows the index wrong on the data of today. The first catalog holds 42 shops,
  and all but the hand made T7 shop hold a reference. The index itself holds that no two
  of them share one.
- A new index is a migration. `k8s/catalog-import/first-catalog.manifest` counts 29
  catalog migrations and 21 harvester migrations, and the restore refuses a count that
  differs. A migration thus means a new manifest, for a case that no shop of today is in.
- This plan removes the cost of the case. A reference that collides answers a refusal
  that names the holder, and an import with `force` creates the shop with no reference.

**The follow up, not built here:** a migration that replaces the index with a unique index
on `(COALESCE("externalProvider", ''), "externalRef") WHERE "externalRef" IS NOT NULL`, a
`where` in `refHolder` that names the provider too, and a new manifest. It only loosens
the rule, so each row that is valid today stays valid. After it `SEVERAL_SHOPS` of the
bulk link can happen for real, and the code already answers it.

### The rule for a link and for an import

**A link leaves the reference empty and links.** The reference is one of seven fields that
a link fills if the shop lacks it. A field that it cannot fill is no reason to refuse the
other six or the mark. The place names its shop through `supermarketLocationId`, and a
later run finds the place by its own `(provider, externalRef)` row, not by the shop. The
other choice, to refuse the link with the code of catalog, leaves the person with no way
to link a place to the shop that they named until they edit a third shop. The answer of
the link says what happened: `filled` lacks `EXTERNAL_REF`, and `refHeldBy` names the shop
that holds the reference.

**An import refuses, and `force` creates the shop with no reference.** An import creates a
shop. A second shop for a reference that a shop already holds is most often a duplicate,
so the person must see the holder first: the answer is the 409 of catalog, passed through
with its details, and nothing is written. `force` already means "create a new shop
anyway", and with it the shop is created with no reference and no provider. The provider
goes with the reference, because a later link fills a reference under the provider that
the shop already names (`place-link-fields.ts:91`).

**A trusted run never creates a shop with no reference.** It has nobody to ask. The place
stays in the queue, the log line carries the sentence of catalog, and the run goes on.

### Target state

1. Catalog refuses a reference that another shop holds with `LocationExternalRefTakenException`:
   code `location_external_ref_taken`, status 409, details `externalRef` and `heldBy`.
   `heldBy` is a `LocationRefHolder`: `supermarketLocationId`, `supermarketId`,
   `supermarketName`, `label`, `address`, `city`, `externalProvider`.
2. `create` and `update` check before the write. `update` checks only a reference that
   the write changes, and a shop is never its own holder.
3. `create` and `update` also turn the `23505` of `uq_locations_external_ref` into the
   same refusal, and read the holder then. A holder that is gone by that read is
   `heldBy: null`. Any other failure of the database stays as it came.
4. A link sends the patch. On that refusal it sends the patch again with no `externalRef`
   and no `externalProvider`, marks the place, and answers `refHeldBy`.
5. An import passes that refusal through. With `force` it creates the shop with no
   reference and no provider.
6. The gateway documents the code on the three routes that can answer it, and the link
   result carries the optional `refHeldBy`.
7. The back office has a sentence for the code.

### Scope

- `libs/luna-shopper/platform/src/lib/errors/`: the code, its status, its two sentences,
  the class and the two detail keys.
- `libs/luna-shopper/contracts`: `LocationRefHolder`, `PlaceLinkResult.refHeldBy`, and the
  two schemas.
- `catalog/src/app/catalog/supermarket-location.service.ts`.
- `harvester/src/app/harvest/discovered-place.service.ts`: `bind`, `promote`, `import`.
- `gateway`: `api-problem-responses.decorator.ts` (`locationRefTaken`), the two shop
  routes and the import route, then `openapi.json` and `wire-types.ts`, generated in that
  order.
- `libs/luna-shopper-admin/feature-resource/src/lib/gateway-error-key.ts` and one string
  in `libs/luna-shopper-admin/ui/assets/i18n/en.json`.

### Constraints

- **No migration.** The manifest counts stay 29 and 21.
- **Nothing that has a value is overwritten.** The holder keeps its reference. The shop
  linked keeps each field it held.
- **Nothing is written by a refused write.** The store scope of a new shop is created in
  the same transaction, and it goes with the shop.
- **The details are public.** Only an admin, or the harvester as a service actor, reaches
  a route that raises the code, and each field of `heldBy` is one that the shop list
  already shows an admin.
- A blank reference is not changed here. The form of the back office sends null for an
  empty field (`toWireValue` in `resource-draft.ts`), and the partial index does not
  read a null.

### Action boundaries

- Do not edit `libs/luna-shopper-admin/feature-harvest/src/lib/places-queue-page.ts` or
  the harvest data access files. Admin plan `0061` is being built there.
- Do not edit `openapi.json` or `wire-types.ts` by hand, and do not format them.
- Do not change `force` on the import route in any other way. Plan `0193` records that
  `"force": "false"` is read as true by the pipe, and that stays its own defect.

### Progress evidence

- `nx test` of catalog, harvester, gateway, platform, contracts and the two admin
  libraries, and `nx lint` of the same.
- `nx build` of the three services and of `luna-shopper-admin`.
- The integration spec of section "Tests", on a real Postgres.

## What must not happen

- A 500 for a reference that is taken, on any of the five paths.
- A link that fails because of the reference.
- A link or an import that takes the reference from the holder, or that writes a field
  the shop already held.
- A trusted run that stops at one such place, or that creates a shop with no reference.
- A refusal with a holder of another reference, or of the shop that is being written.
- A new migration, or a manifest count that moves.

## Tests

- `supermarket-location.service.spec.ts`, "external reference": the refusal on create and
  on update with the holder in the details, the `where` that the check sends (the
  reference alone on create, and not the shop itself on update), no check for a shop with
  no reference or for an edit that leaves the reference alone, the `23505` of the index on
  both paths, a holder that is gone, and another unique violation left as it came.
- `location-external-ref.integration.spec.ts`, on a real Postgres with the 29 migrations:
  the check refuses across chains and providers. With the check switched off, as for the
  write that loses a race, the index refuses a create and an update, the service answers
  the same code with the same holder, and no shop and no store scope is left. A holder
  keeps its own reference through an edit, shops with no reference do not collide, and a
  reference that was let go is free again.
- `discovered-place.link.spec.ts`, "a reference another shop holds": the link goes
  through with the other fields and `refHeldBy`, for the bare problem object and for
  the one nested under `error`. The second write carries no reference and no provider. A
  shop that lacked only the reference gets the mark and one call. Any other refusal still
  fails the link and leaves the place `NEW`. The bulk link never sends a reference. An
  import passes the refusal through, also with `force: false`, and with `force` creates
  the shop with no reference.
- `discovered-place.auto-import.spec.ts`: a run goes past such a place, imports the next
  one, and sends a reference with each shop it creates.
- `location-external-ref.http.spec.ts` in the gateway: the problem object of catalog
  answers 409 with its code and `details.heldBy` on the create route, the update route
  and the import route, and a link answers `refHeldBy`.
- `gateway-error-key.spec.ts`: the code has its own sentence.

## What was decided while building

- **`refHeldBy` is optional on the link result.** It is present only when a reference was
  left empty. A required field would break the in memory harvest service of the back
  office, which admin plan `0061` is editing now.
- **The bulk link answers no `refHeldBy`.** It cannot reach the case, so its rows did not
  change.
- **An import with `force` says nothing more in its answer.** It answers the place, as
  before. The shop it names has no reference, and the harvester logs a warning with the
  holder.
- **The check on `update` compares the row before and after.** The form of the back office
  sends the whole record back, with the reference the shop holds. A check on each request
  that names a reference would read the table for each such save.

## Left for other plans

- **The index on the provider and the reference**, as written under "The decision on the
  index". It needs a migration and a new manifest.
- **The Places queue of the back office.** With no edit it shows the sentence of the code
  when an import is refused. It does not yet name the holder from `details.heldBy`, it
  offers `force` only after `place_matches_location`, and it does not say that a link
  left the reference empty (`refHeldBy`). Those are screens of admin plan `0061` or of a
  plan after it.
- **The shop form of the back office** shows the sentence and does not link to the holder.
