# 0193: a place links to the shop it is

> Asked for by the owner on 2026-10-07, while he read the first catalog in the back office.
> "Places" and "Shops" in the harvester section look alike, many places are shops the
> catalog already holds, and most El Jamón shops have coordinates and nothing else.
>
> Admin half: `apps/luna-shopper-admin/plans/0061` (a place says which shop it may be). It
> needs this plan merged first.
>
> Prerequisite reading: plan `0152` (the link, the three rungs, the 409), plan `0154` (the
> candidates of the shop queue, worked out on read), plan `0107` section 3 (the trusted
> import), plan `0169` section 3 (the El Jamón shop list), plan `0061` and plan `0097`
> section 3 (a derived postal code), `k8s/catalog-import/README.md` and k8s plan `0012`
> (what the dumps are held to), and
> `harvester/src/app/harvest/discovered-place.service.ts`, `place-matching.ts`,
> `place-import-check.ts`, `source-location.service.ts` and
> `eljamon-store-discovery.runner.ts`.

A place and a catalog shop are often the same building, and today only a refused import
lets a person say so. This plan makes the link reachable for every place, lets it carry the
address a shop lacks, and repairs the places that lost their mark.

**The difference between the two queues, in two sentences.** A place is a shop that a store
discovery found, on OpenStreetMap or in a chain's own shop list, and it can become a
catalog shop or be linked to one. A source shop is the code that a chain's website uses for
one of its shops (`T1` at Deza), and it is only ever mapped to a catalog shop, so that what
the chain says about that code lands on the right shop.

## Brief for the agent

### Objective

Let a person link any undecided place to a catalog shop that already exists, fill the
fields that the shop lacks from the place, show on the list read which shop a place
probably is, and give one bulk act for the places whose shop carries their own reference.
Then, with the owner's word, run the two data steps of section 4.

### Context

Every statement below was read in the file it names, on `dev` at `b67f6f94`.

**The two tables.**

- `discovered_places` (`harvester/src/app/entities/discovered-place.entity.ts`) is unique
  on `(provider, externalRef)` (`:18`). Its status is `NEW`, `IMPORTED` or `REJECTED`
  (`harvest.enums.ts:310`). It holds `street`, `city`, `postalCode`, `postalCodeSource`,
  `country`, `website`, `openingHours`, `tags` and `supermarketLocationId`, which is
  "written back on import" (`:140`). The column is not unique, so several places can name
  one shop.
- `source_locations` (`entities/source-location.entity.ts`) is unique on
  `(supermarketId, externalId)` and its status is `UNMAPPED`, `ACTIVE` or `IGNORED`.
  `SourceLocationService` (`source-location.service.ts`) has `observe`, `map`, `unmap`,
  `ignore` and `unignore`. None of them calls `createLocation`. `map` (`:191`) binds the
  row to a shop that exists and then sends the stored availability.

**The link, as it is.**

- `POST /v1/admin/harvest/places/:id/link` (`gateway/src/app/harvest/harvest.controller.ts:424`)
  takes `supermarketLocationId` (`harvest.dto.ts:359`) and answers a `DiscoveredPlaceView`.
- `DiscoveredPlaceService.link` (`discovered-place.service.ts:747`) refuses an `IMPORTED`
  place (`:750`). It does not refuse a `REJECTED` one. `import` (`:694`) is the same.
- It refuses when the place does not resolve to the chain of the shop (`:757` to `:767`).
  `matchChain` (`:160`) asks the brand key, then `brandName ?? name` as an exact chain
  name. A place with no brand, or with a brand the catalog files under no chain, thus
  links to nothing, also when the person named the shop.
- `missingFields` (`:262`) fills coordinates, `externalRef` with `externalProvider`, the
  postal code and `footprintM2`, each only when the shop has none. It never sends
  `address`, `city`, `country` or `label`. `UpdateSupermarketLocationRequest`
  (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts:1743`) accepts all
  four, and catalog's `update` (`catalog/src/app/catalog/supermarket-location.service.ts:295`)
  writes each one that is not `undefined`.
- `postalCodeFields` (`:237`) sends a postal code only when the source stated it. A
  `DERIVED` code is never sent.
- The postal code test in `missingFields` is `!location.postalCode` (`:277`). Catalog
  fills an absent code from the nearest centroid and records it as `DERIVED`
  (`fillPostalCodeFromCentroid`, called at `supermarket-location.service.ts:353`). A shop
  with a guessed code thus counts as filled, and a code that a chain states never reaches
  it.
- An import writes a label from the name of the place (`:841`). The El Jamón runner
  reports the name the chain prints, and `stores.ts:44` keeps only the records whose name
  is the banner. Every El Jamón place thus has the same name.

**The matcher.** `matchLocations` (`harvest/place-matching.ts:72`) is pure and has three
rungs. The first that finds a shop answers.

1. The shop carries the `externalRef` of the place, and its provider is the same or null.
2. A shop within `SAME_SHOP_METRES`, which is 50 (`:13`).
3. A shop with no coordinates, at the same postal code, whose address equals the street of
   the place after `normalizeName` (`:100` to `:112`). `normalizeName` (`matching.ts:44`)
   folds case, accents and punctuation, and no word. "Avda. de Cádiz 68" and "Avenida de
   Cádiz 68" are thus two addresses.

It is called in two places: `import` (`:712`), which answers 409 `place_matches_location`
with the candidates, and the trusted path `autoImport` (`:449`), which leaves a place with
a candidate in the queue. **Its answer is stored nowhere, and the list read does not call
it.** The shop queue already does the other thing: `SourceLocationService.list` works its
candidates out on every read (`:139` to `:143`, plan `0154`).

**The El Jamón shop list.** `ElJamonStoreDiscoveryRunner`
(`harvest/eljamon-store-discovery.runner.ts`) reads every shop in one request and reports
each with the provider `ELJAMON` (`:149`), street, city, a postal code marked `SOURCE`
(`:102`), the opening hours as one line of text (`:106`) and the province as a tag
(`:155`). Its `externalRef` is `<postalCode>:<normalized street>`
(`libs/luna-shopper/eljamon/src/lib/stores.ts:85`). The run takes `postalCodes` as a
filter (`store-discovery-runner.ts:31`). `supermarket_sources.autoImportPlaces` decides
whether the run imports by itself, and its default is false
(`entities/supermarket-source.entity.ts:63`).

**What catalog can hold.** `supermarket_locations` has `label`, `address`, `city`,
`country`, `postalCode`, `postalCodeSource`, `latitude`, `longitude`, `externalRef`,
`externalProvider` and `footprintM2` (`catalog/src/app/entities/supermarket-location.entity.ts`).
It has no column for opening hours, a phone number or a website.

**The data, as the investigation of 2026-10-07 counted it.** These numbers were read on
the first catalog by the investigation that led to this plan. This plan did not read a
database, so the builder reads them again in section 4 before a write.

- 85 places, 84 `NEW` and 1 `IMPORTED`. `docs/initial-catalog-2026-10.md` states the same
  (`:1093`).
- 27 `NEW` places carry the `externalRef` of a catalog shop: 19 of El Jamón and 8 of Deza.
  They are the places those shops were imported from. The harvester database was replaced
  after the imports, and the marks went with it. `k8s/catalog-import/README.md` (`:46` to
  `:51`) describes the same loss for a cluster.
- 39 `NEW` places lie within 250 m of the shop they are. Two real shops sit at 54.9 m and
  61.8 m from their place, just outside rung 2.
- 3 of the 42 catalog shops have no place.
- Four real shops cannot be linked because of the chain test: "Supercash Sector Sur" and
  "Supercash Las Quemadas" (Deza), "Piedra" and "El Jamón (Proxi)" (El Jamón).
- All 19 El Jamón shops came from OpenStreetMap. 13 of them have no address, no city and
  no postal code. The chain's own list states all three, and the opening hours, for all
  19, each within 19 m, and names 33 more shops in the city. No El Jamón store discovery
  has run on this data.
- All 42 shops hold coordinates (`k8s/catalog-import/README.md:319`). Rung 3 reads only
  shops with none, so it can fire for no shop of the first catalog.

**A defect found on the way.** `GET /v1/admin/harvest/places` declares `country` and
`postalCode` in its query DTO (`harvest.dto.ts:730` and `:739`) and the harvester filters
on both (`discovered-place.service.ts:588` to `:597`). The controller forwards neither
(`harvest.controller.ts:361` to `:368`). The places queue that the postal code page opens
thus shows every place.

### Target state

1. **The link fills what the shop lacks, and nothing else.** `missingFields` also sends
   `address` from `street`, `city` and `country`, each only when the shop holds null or
   only white space. The four fields it fills today keep their rule.
2. **A guessed postal code counts as empty.** When the shop holds a `DERIVED` code and the
   place holds a code that its source stated, the link sends the stated code with
   `postalCodeSource: SOURCE`. A `SOURCE` or `MANUAL` code on the shop is never replaced.
   `postalCodeFields` stays the only door, so a derived code of a place is still never
   sent.
3. **The link answers what it wrote.** The NATS answer and the gateway answer become
   `PlaceLinkResult { place: DiscoveredPlaceView; filled: PlaceLinkField[] }`. The enum
   `PlaceLinkField` is `COORDINATES`, `EXTERNAL_REF`, `POSTAL_CODE`, `FOOTPRINT`,
   `ADDRESS`, `CITY` and `COUNTRY`. An empty list is a link that wrote only the mark.
4. **The shop that a person names decides the chain.** In `link`:
   - The place resolves to the chain of the shop: link, as today.
   - The place resolves to no chain: link. The named shop is the statement.
   - The place resolves to another chain: 409 `place_names_another_chain`, with
     `details.chain` holding the id and the name of that chain, and nothing written.
     `acrossChains: true` on the request links anyway. This mirrors `force` on import.
5. **The list read says which shop a place may be.** `DiscoveredPlaceView` gains
   `candidates: PlaceLocationCandidate[]`. It is filled for a `NEW` place on `list`, and
   it is empty for every other status and on every other read. The candidates are worked
   out on the read and stored nowhere (decision 2A). `PlaceLocationCandidate` gains
   `supermarketId`, `city` and `metres` (a whole number, null for a shop with no
   position). Per page, catalog is asked once for the chains and once for the shops of
   each chain that a place of the page needs, as `ChainLocations` already does for a run.
6. **A fourth rung, for the hint only.** `PlaceMatchRung.SAME_CHAIN_NEAR` is a shop of the
   same chain farther than `SAME_SHOP_METRES` and within `NEAR_SHOP_METRES`, which is 250.
   A new pure function beside `matchLocations` answers the three strict rungs first and
   this one after them, best first.
   - The 409 of `import` reads the three strict rungs only, as today.
   - `autoImport` leaves a place in the queue when any of the four finds a shop. A person
     then looks, which costs nothing.
   - Nothing links on it. No code path links on a distance.
7. **A place with no chain still finds the shop made from it.** For a `NEW` place that
   resolves to no chain, the list read tries rung 1 against the shops of every chain. A
   reference of the same provider is an identity, and it needs no chain. Rungs 2 to 4 need
   a chain and are not tried.
8. **One bulk act links the places that shops were made from.**
   `POST /v1/admin/harvest/places/link-by-ref` with `{ apply?: boolean }`. Without
   `apply` it changes nothing and answers what it would do. It reads every `NEW` place and
   links one when exactly one catalog shop carries its `externalRef` and that shop names
   the same `externalProvider`. It answers `linked` (place, shop, `filled`) and `skipped`
   (place, reason: `SEVERAL_SHOPS` or `PROVIDER_NOT_NAMED`). Each link is the code of
   target 1 to 3. The chain test does not apply, because the shop was created from this
   place. A second call finds nothing to link.
9. **An import writes no label that is the banner.** A small table beside
   `PROVIDER_ADAPTERS` names the providers whose every record prints the chain and not the
   shop (`ELJAMON` today). `promote` writes a null label for a place of such a provider.
   The link never writes a label (decision 2C).
10. **The places list honours its two filters.** The controller forwards `country` and
    `postalCode`.
11. **The address rung reads street words.** Out of this plan (section 1).

### Scope

- In: the harvester (`discovered-place.service.ts`, `place-matching.ts`,
  `harvest.mappers.ts`, the harvest controller of the service, their specs),
  `libs/luna-shopper/contracts` (`DiscoveredPlaceView`, `PlaceLocationCandidate`,
  `PlaceMatchRung`, `LinkDiscoveredPlaceRequest`, `PlaceLinkResult`, `PlaceLinkField`, the
  bulk request and answer, the new pattern), `libs/luna-shopper/platform` (the new
  exception and its detail key), the gateway (`harvest.controller.ts`, `harvest.dto.ts`,
  the error code table), and the two generated files.
- Out: catalog (no entity, no migration, no handler changes), `source_locations` and the
  shop queue, the El Jamón library and its runner, the OpenStreetMap runner, velista, and
  every screen (admin plan `0061`).

### Constraints

- **No second shop.** `link` and the bulk act never call `createLocation`. The bulk act
  links on rung 1 only, and only when one shop answers.
- **No overwritten edit.** A field with a value keeps it. The one exception is target 2,
  and a `DERIVED` code is a guess that catalog made, never something a person typed.
- **No derived postal code sent.** Plan `0152` section 4 stands.
- **No decision reopened.** A run never changes `status`. The candidates, the bulk act and
  `autoImport` read `NEW` places only. A link of an `IMPORTED` place stays a 409.
- **No link on distance alone.** A distance makes a candidate that a person reads.
- **No migration, in either service.** The dumps of the first catalog are held to 29 and
  21 migrations (`k8s/catalog-import/first-catalog.manifest`), and a new one moves the
  restore.
- A catalog write of the harvester carries `HARVESTER_ACTOR_ID`, as every write of
  `CatalogClient` does. The audit row of a link thus names the harvester.
- Do not edit `openapi.json` or `wire-types.ts` by hand.

### Action boundaries

- Proceed with code, specs and an ephemeral Luna slot.
- **Do not write slot 1.** It holds the catalog that ships, and it is down and locked
  (`k8s/catalog-import/README.md:331`). Section 4 is the owner's to start. Rehearse it on
  copies of the two dumps in an ephemeral slot, and report the counts.
- Do not start a harvest run against a storefront from a cluster.
- Stop and ask if a place of the 27 has two shops with its reference, or if the count of
  same reference places on the copy is not 27.

### Progress evidence

- A spec on `missingFields` with a table of cases: each field empty, blank and filled, a
  `DERIVED`, a `SOURCE` and a `MANUAL` code on the shop against a `SOURCE`, a `DERIVED`
  and an absent code on the place.
- A spec on `link`: the three chain cases of target 4, `acrossChains`, the `filled` list,
  and an `IMPORTED` place refused.
- A spec on the matcher: the three strict rungs unchanged, a shop at 54.9 m as
  `SAME_CHAIN_NEAR`, a shop at 251 m as nothing, and the order of the answer.
- A spec on `list`: candidates on a `NEW` place, none on an `IMPORTED` or `REJECTED` one,
  rung 1 for a place with no chain, and one catalog read per chain for a page.
- A spec on `autoImport`: a shop at 60 m keeps the place in the queue and creates nothing.
- A spec on the bulk act: the dry answer writes nothing, `apply` links, two shops with one
  reference are skipped, a second `apply` links nothing.
- A spec on `promote`: an `ELJAMON` place gets a null label, a `LIDL` place keeps its own.
- A gateway spec: `country` and `postalCode` reach the NATS request.
- An integration run on an ephemeral slot with copies of the two dumps: the dry answer of
  the bulk act names 27 places, `apply` leaves 57 `NEW`, and no count of the manifest
  moved.
- `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 1. Not in this plan

- **The address rung.** Its defect is real: it compares whole normalized strings, so an
  abbreviated street type never matches. It reads only shops with no coordinates, and the
  first catalog has none. A fix needs a table of Spanish street words and its own cases.
  It is a follow up, for the day a seeded shop with no position meets a place. Write it as
  a backlog plan when that day is near.
- **A change of `SAME_SHOP_METRES`.** It stays 50. Two shops of one chain 60 m apart
  exist (a small format beside a large one), and a wider strict rung makes every import
  near one of them ask for `force`. Target 6 gives the two real shops at 54.9 m and
  61.8 m their hint with no change to the 409.
- **Opening hours, a phone number and a website on a shop.** Catalog has no column for
  them (decision 2D).
- **A shop with no place.** Three shops have none. Nothing is wrong with them, and a link
  starts from a place.
- **Undoing a link.** A linked place is `IMPORTED`. Today nothing sets it back, for an
  import either. If the owner wants it, it is a plan of its own with the fields that the
  link filled as the hard part.

## 2. Decisions

Each has a recommendation, and the brief above is written to it. The owner can reverse any
of them before the build.

**A. Candidates on the list: computed on read, or stored.**

- 2A, recommended: computed on read. A stored answer is stale after any link, import,
  shop edit or new shop, and something must then recompute it. The shop queue already
  computes its candidates on read for this reason (plan `0154`). It also needs no column
  and no migration, so the dumps of the first catalog stay valid. The cost is one catalog
  read per chain on a page of the queue.
- 2B: a `candidateLocationId` column that a run writes. It makes a filter "has a
  candidate" cheap and a count possible on the rail. It needs a migration, and a sweep
  after every catalog write to shops.

**B. A place of another chain.**

- Recommended: the 409 with `acrossChains`, target 4. A place that names no chain links
  with no question, and a place that names another chain asks once. Whether each of the
  four blocked shops resolves to no chain or to another one was not read for this plan.
  Either way all four can be linked.
- The other choice: no chain test at all when a shop is named. One slip then links a
  Mercadona place to a DIA shop with no question.

**C. The label of a shop.**

- 2C, recommended: the link never writes a label, and an import writes none for a
  provider that prints the banner on every record (target 9). Only the 3 Lidl shops carry
  a label, and velista draws the address under the chain name for a shop with none. A
  person types a label on the record page of the shop.
- The other choice: fill an empty label from the name of the place. Every El Jamón shop
  then reads "Supermercados El Jamón", under a chain of that name.

**D. Opening hours, phone and website.**

- 2D, recommended: no column now. The place keeps `openingHours`, `website` and its tags,
  and after a link it names its shop, so a later plan can copy them with no new harvest.
  Opening hours are one line of free text that plan `0169` decided never to parse, and no
  screen of velista shows hours.
- The other choice: three nullable text columns on `supermarket_locations`, filled by the
  link under the same rule. That is a catalog migration, so it moves the restore manifest.
  If the owner wants hours in velista, that plan should also decide a parsed shape.

**E. A person links a rejected place.**

- Recommended: leave it as it is. `link` and `import` accept a `REJECTED` place today. No
  screen offers one, because the queue lists `NEW` only. Nothing automatic touches one.
- The other choice: a 409 for a `REJECTED` place on both routes, and a new "back to the
  queue" act.

**F. The 33 El Jamón shops that the catalog lacks.** Section 4, step 4.

## 3. Build order

1. Contracts and the platform exception: the view, the candidate, the rung, the link
   request and answer, the bulk request and answer, `place_names_another_chain`.
2. The harvester: `missingFields` and target 2, the chain rule of `link`, the fourth rung,
   candidates on `list`, `autoImport`, the bulk act, the label rule.
3. The gateway: the link answer, `acrossChains`, the bulk route, the two forwarded
   filters, the error code.
4. Regenerate, in this order, and commit both files:

   ```sh
   npx nx run luna-shopper-backend-gateway:openapi
   npx nx run luna-shopper-admin/models:wire-types
   ```

5. The admin back end double and the one call site of `linkPlace` must still compile,
   because the answer of the link changed shape. Change `harvest-api.ts`,
   `harvest-memory.ts` and the `link` method of `places-queue-page.ts` to read
   `result.place`, and nothing more. `nx test` does not type check, so run
   `npx nx build luna-shopper-admin`. The screens are admin plan `0061`.
6. The rehearsal of section 4 on an ephemeral slot.

## 4. The data, after the code is merged

**This is a data step on the curated slot, and not a release task.** CLAUDE.md asks for a
release task when a change deletes rows that a person or a harvest wrote. These steps
delete nothing: they set a mark, fill empty fields and add places. Neither cluster holds
the first catalog yet. The restore task is disarmed and the dumps are not uploaded
(`k8s/release-tasks/tasks/0003-restore-the-first-catalog/task.env`,
`k8s/catalog-import/README.md:119`). The dumps travel to both clusters as two whole
databases, so a repair made on slot 1 before the dumps are taken travels with them.

**The cost is new dumps.** Any write to slot 1 means the procedure of "When slot 1 is
final" in `k8s/catalog-import/README.md`: new dumps, new checksums and new counts in
`first-catalog.manifest`, and the same numbers in `docs/initial-catalog-2026-10.md`. The
owner has not said that slot 1 is final. The owner thus decides whether these steps run
before the dumps ship.

**If the dumps ship first**, the same steps run once in each cluster from the back office,
by a person, after the restore. Step 1 is one button with a preview. That is still no
release task.

Every step goes through the gateway as an admin. No step is SQL.

1. **The 27 places.** Call the bulk act with no `apply` and read the answer. It names 27
   places: 19 of El Jamón and 8 of Deza. Then call it with `apply`. Expected: 57 `NEW`
   and 28 `IMPORTED` places, no new shop, no new price scope. A link here fills nothing
   but what the shop lacks, and each of these shops was created from its place, so most
   answers have an empty `filled`.
2. **One El Jamón store discovery.** First read the El Jamón row of
   `supermarket_sources`: `enabled` is true and `autoImportPlaces` is false. Start a
   `STORE_DISCOVERY` that names the chain, with `postalCodes` set to the codes of the city
   that the owner confirms. Without the filter the run writes all 366 shops of the chain
   into the queue. Expected: 52 new `ELJAMON` places, all `NEW`, and no write to catalog.
3. **The 19 links.** Each of the 19 El Jamón shops now has an `ELJAMON` place within
   19 m, which is a rung 2 candidate on the list. A person links each one. Expected for
   the 13 bare shops: `ADDRESS` and `CITY` filled, and `POSTAL_CODE` filled where the shop
   held none or a derived one. The 6 other shops keep what they hold. The shop keeps the
   OpenStreetMap reference it has, and two places then name it.
4. **The 33 other shops (decision F).**
   - Recommended: import them. The chain states each one itself, with a street, a city
     and its own postal code. El Jamón has one price list for every shop (plan `0169`
     section 2), so a new shop shows real prices at once through the national scope. A
     shopper in the city then finds the shop nearest to home. Do it with the trusted path
     that exists: after step 3, set `autoImportPlaces` on the El Jamón row and run the
     same discovery again. It imports each place with no candidate and leaves every place
     within 250 m of a shop in the queue for a person. Then set the flag back if the owner
     wants each later shop reviewed.
   - The cost: 33 shops and 33 `STORE` scopes. `EXPECT_PRICE_SCOPES` moves from 105 to at
     most 138, and the shop count from 42 to at most 75.
   - The other choices: leave the 33 in the queue as `NEW`, which changes no count, or
     import only the ones in the postal codes where a zone exists.
5. **The rest of the queue.** The investigation counted 39 places within 250 m of their
   shop, 27 of them in step 1. The others show a candidate on the list after this plan,
   and the four shops with no usable brand link through the picker of admin plan `0061`.
   A person decides each one. Nothing in this plan links them.
6. **Take the dumps again**, if the owner ran these steps on slot 1, and bring the
   manifest and the two documents to the new state. That work follows plan `0192`,
   stage 3.

## 5. What must not happen, and what stops it

| It must not happen                          | What stops it                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A second shop for one building              | A link never creates. The bulk act needs one shop with the same reference and provider. `autoImport` waits on any of the four rungs. |
| An edit of the owner overwritten            | `missingFields` sends a field only when the shop holds none. A `MANUAL` or `SOURCE` code stays. |
| A derived postal code sent as a statement   | `postalCodeFields` is the only door, and it sends nothing for a `DERIVED` code.                 |
| A rejected or imported place reopened       | No run writes `status`. Candidates, the bulk act and `autoImport` read `NEW` only.              |
| A link by distance with nobody looking      | A distance makes a candidate. Only a person, or an equal reference, makes a link.               |
| A label that is the name of the chain       | The link writes no label. An import writes none for a provider that prints the banner.          |

## 6. What was built, and what the owner must decide

Targets 1 to 10 are built, with the recommended answer of decisions A to E. Target 11 is
out of the plan. Section 4 and decision F are data steps and were not run: no slot that
holds data was read or written. The points below are the choices the builder made where
the plan left room, and what only the owner can settle.

### The routes, as calls

- `POST /v1/admin/harvest/places/:id/link` with `{ "supermarketLocationId": "<uuid>" }`,
  and `"acrossChains": true` to link a place that resolves to another chain. The message
  is `place.link`. The answer is `PlaceLinkResult`: `place` and `filled`.
- `POST /v1/admin/harvest/places/link-by-ref` with `{}` for the dry answer and
  `{ "apply": true }` to write. The message is `place.linkByRef`. The answer is
  `LinkPlacesByRefResult`: `applied`, `linked` and `skipped`.
- `GET /v1/admin/harvest/places` answers `candidates` on each item, and now honours
  `country` and `postalCode`.

### Where the rule of the fields lives

`missingFields` and `postalCodeFields` moved out of `discovered-place.service.ts` into
`place-link-fields.ts`. The function is pure and answers the patch together with the
`filled` list, so the hand link, the bulk link and the dry answer of the bulk link read one
rule. Its table of cases is `place-link-fields.spec.ts`.

Three readings the plan did not spell out:

- A field of the place that is itself null or blank is never sent. A shop with no city and
  a place with no city is a link that fills no city.
- A `DERIVED` code on the shop is replaced also when the stated code of the place is the
  same code. The link then changes only the provenance, and it reports `POSTAL_CODE`.
- A place row written before the provenance column has a code and a null source.
  `postalCodeFields` reads that as stated, as it does for an import, so such a code does
  replace a `DERIVED` one.

### What "best first" means

`suggestLocations` in `place-matching.ts` answers what `matchLocations` answers, then the
shops of the fourth rung. Each part is ordered by distance, nearest first, and a shop with
no position comes after every shop that has one. A shop is named once: a shop that the
strict part found is not repeated in the near part. `matchLocations` itself keeps the order
it had, so the 409 of an import did not change.

The fourth rung is exactly the band of the plan: farther than 50 m and at most 250 m. When
rung 1 answers, a second shop within 50 m is thus in neither part. That is the existing
rule of plan `0152` (the first strict rung that finds a shop answers alone), and this plan
does not change it.

`supermarketId`, `city` and `metres` are on the type `PlaceLocationCandidate`, so the
candidates in the details of `place_matches_location` carry them too.

### The bulk link, where the plan left room

- **The answer.** `applied` says whether the call wrote. `linked[].shop` is a
  `PlaceLocationCandidate` with the rung `EXTERNAL_REF`. `skipped[]` carries `shops`, the
  candidates that made the act stop, beside `place` and `reason`. The plan asks the data
  stage to stop when a place has two shops, and the answer then names both.
- **The dry answer shows a place as it is**, with the status `NEW` and no shop, and
  `filled` says what the link would write. With `apply` the same row comes back `IMPORTED`.
- **"A shop carries its reference"** is read as rung 1 reads it. A shop that names
  another provider is not a shop of that place: it is neither linked nor listed as
  skipped. One shop that names no provider is `PROVIDER_NOT_NAMED`.
- **A catalog write that fails stops the call with its error.** The links made before it
  stay, because each one is complete by itself, and a second call continues with the
  places that are still `NEW`. The plan names two skip reasons, and a failed write is not
  a third.
- The act reads the chains once and the shops of each chain once, for any number of
  places.

**For the owner: `SEVERAL_SHOPS` cannot happen on the catalog as it is.** Catalog has the
unique index `uq_locations_external_ref` on `externalRef` alone, across chains and
providers. Two shops with one reference thus cannot exist. The reason stays in the
contract and in the code as the guard the plan asks for, and it costs nothing.

### A reference that another shop holds: a 500 that this plan did not cause

The same index has a consequence for a hand link, and it was found in the walk on a real
catalog. A link fills `externalRef` on a shop that has none. When another shop already
holds that reference, the catalog update violates the index and the gateway answers 500
`internal`. Nothing is written and the place stays `NEW`.

Plan `0152` built that fill, and an import with `force` meets the same index on create.
This plan makes the case easier to reach, because a place can now be linked to a shop of
any chain. The repair is in catalog (a refusal with its own code in place of the 500),
and catalog is out of this plan.

**For the owner:** say whether that refusal is a plan of its own. The data steps of
section 4 do not meet the case: the bulk act links a place to the shop that already holds
its reference, and each El Jamón shop of step 3 already holds an OpenStreetMap reference,
so the link fills none.

### A trusted run waits on its own new shops too

`autoImport` matches a place against the shops of the chain, and that list includes each
shop the same run created a moment before (plan `0152`). With the fourth rung, a trusted
chain whose list names two shops within 250 m of each other imports the first and leaves
the second in the queue. That is the rule of target 6 applied with no exception, and the
person who looks imports the second one with one press.

**For the owner:** say so if a shop that the same run created must count on the strict
rungs only.

### The chain question

- `details.chain` is `{ id, name }`, and `name` is the localized name of the chain as
  catalog holds it (`{ "es": "Dia" }`), not one string.
- With `acrossChains` the link does not read the chains at all.
- A rejected place links as before (decision E).

### A flag in a body is refused unless it is a boolean

The validation pipe converts implicitly, and its conversion of a boolean is
`Boolean(value)`. The string `"false"` thus arrives as `true`. `apply` and `acrossChains`
carry a transform that hands the validator the value as it was sent, so `"false"`, `"true"`,
`0` and `1` answer 400. `places.http.spec.ts` holds the cases.

**For the owner:** `force` on `POST .../places/:id/import` has the same defect and was
left alone, because that route is not in this plan. `"force": "false"` creates a second
shop today.

### The list read asks catalog, so it can fail with it

A page that holds a `NEW` place reads the chains and the shops from catalog. When catalog
does not answer, the list read fails, as the shop queue of plan `0154` does. A page with
no `NEW` place asks catalog nothing.

### The admin, as far as it had to change

The three files of build order 5 changed, and `harvest-seed.ts` with them: the generated
type of a place now requires `candidates`, so the five seeded places carry an empty list.
The label of the rung `SAME_CHAIN_NEAR` and the sentence for `place_names_another_chain`
are screens, and they are admin plan `0061`. Until then the back office has no label for
the new rung and no sentence of its own for the new code.

### What was proved, and how

- Unit specs for every rule of section 5: `place-link-fields.spec.ts`,
  `place-matching.spec.ts`, `discovered-place.link.spec.ts`, and cases added to
  `discovered-place.auto-import.spec.ts`, `discovered-place.import.spec.ts` and the
  gateway's `places.http.spec.ts`.
- `place-link.integration.spec.ts` on a real harvester database: the bulk act reads `NEW`
  rows only, a rejected and an imported row keep every column, the list filters on
  `country` and `postalCode`, and each catalog write carries `HARVESTER_ACTOR_ID`.
- A walk over the gateway of an ephemeral slot with the gateway, auth, catalog and the
  harvester, on a catalog built for it (3 chains, 5 shops, 10 places): the candidates on
  the list, the dry answer, the apply, a second apply that found nothing, a derived code
  replaced by a stated one, the 409 and `acrossChains`. The counts of shops, price scopes
  and chains did not move across the dry call and the apply, and the audit rows of the
  links name the service actor.

**Not done: the rehearsal on copies of the two dumps** (build order 6 and the last line of
"Progress evidence"). The stage that runs section 4 does it, with the dumps. The numbers
27, 57 and "no count of the manifest moved" are thus not yet read by this build.
