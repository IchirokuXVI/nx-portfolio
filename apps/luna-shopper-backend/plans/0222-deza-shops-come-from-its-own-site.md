# 0222: deza shops come from its own site

> DEZA shops reach the catalog today only through OpenStreetMap. The chain publishes its own
> shop list on `https://www.dezacalidad.es/centros/`, and that page and the ten shop pages
> behind it state what OpenStreetMap does not: the postal code of every shop, its phone, and
> **the shop code** (`T1` to `T7`, `Z1`, `C1`, `C2`) that the product popups use. This plan
> adds a store discovery case for `deza-web` that reads those pages, reports one place per
> shop keyed on that code, and lets the shop queue propose the catalog shop of a code by the
> code itself rather than by a name match.
>
> Prerequisite reading: `0084` section 6 (source locations), `0085` (the DEZA walk, the
> popup codes), `0089` section 9 (store discovery dispatched on `adapterKey`), `0103`
> section 6.4 (a runner reports, the orchestrator writes), `0106` section 4 (the postal code
> filter), `0107` sections 3 and 8 (the trusted import and its check), `0154` (DEZA shop
> candidates), `0169` section 3 (the El Jamón shop list, the closest model), `0193` (a place
> links to the shop it is), and in the code `store-discovery.runner.ts`,
> `store-discovery-runner.ts`, `eljamon-store-discovery.runner.ts`,
> `dia-store-discovery.runner.ts`, `source-location.service.ts`,
> `discovered-place.service.ts` and `libs/luna-shopper/deza/src/lib/deza.client.ts`.

## Brief for the agent

### Objective

Add a `STORE_DISCOVERY` case for the `deza-web` adapter. It reads the shop directory and the
shop pages of `dezacalidad.es`, reports one `ObservedPlace` per shop with the shop code as
its `externalRef`, and changes no catalog row by itself. Mark `deza-web` as a source that
lists its own stores. Make the DEZA shop queue put the catalog shop that a place with the
same code is linked to first among the candidates of an `UNMAPPED` row, marked as a code
match. Sections 1 to 8 describe the whole job.

### Context

Every statement below was read on `dev` on 2026-10-22.

- `StoreDiscoveryRunner` (`harvester/src/app/harvest/store-discovery.runner.ts:39`)
  dispatches on `source.adapterKey` through a table (`:50` to `:55`): `lidl-api`,
  `mercadona-api`, `eljamon-web`, `dia-api`. Everything else takes the OpenStreetMap case
  (`:83` to `:85`). The comment at `:80` says that `deza-web` publishes no store list. That
  is false, and section 9 of this plan is the evidence.
- `ElJamonStoreDiscoveryRunner` (`eljamon-store-discovery.runner.ts:35`) is the model. It
  requires a chain (`:46`), reads the list, filters on the shop's own postal code (`:55` to
  `:59`), warns when the count falls far under the measured one (`:72` to `:79`), reports
  each shop with its own provider string (`:89` to `:110`), and writes a run report (`:114`
  to `:124`). Its client comes from a protected `createClient` seam (`:131`).
- `DiaStoreDiscoveryRunner` narrows a list that has no postal code by distance to the
  centroid of each wanted code before it reads any detail
  (`dia-store-discovery.runner.ts:72` to `:82`, `libs/luna-shopper/dia/src/lib/stores.ts:163`).
  It reads the centroids from `@portfolio/luna-shopper/postal-codes/dataset`
  (`dia-store-discovery.runner.ts:16`, `:435`).
- `ObservedPlace` (`harvest/run-report.ts:20` to `:65`) has no phone field. `tags` holds the
  source's own fields verbatim.
- `DiscoveredPlaceService.observe` (`discovered-place.service.ts:368`) upserts on
  `(provider, externalRef)` (`:400` to `:402`). With `autoImport` it imports a `NEW` place
  that passes `placeImportBlockers`, unless `suggestLocations` finds a shop of the chain
  near it (`:475` to `:484`). Then the place stays in the queue for a person.
- `PROVIDER_ADAPTERS` (`discovered-place.service.ts:88` to `:94`) names `OSM`, `LIDL`,
  `MERCADONA`, `ELJAMON` and `DIA`. A provider it does not name answers null for the
  adapter (`:96` to `:98`).
- `ADAPTER_CAPABILITIES['deza-web']` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:428`
  to `:437`) has `listsItsOwnStores: false`. The spawn reads that capability to let a store
  discovery run without a postal code (`harvest-run.service.ts:840` to `:851`), and the
  postal code queue reads it to choose the chains it asks (`postal-code-discovery.service.ts:218`
  to `:233`). The capability is published as a `const` in the schema
  (`libs/luna-shopper/contracts/src/schemas/messages/harvest.schemas.ts:1909`), so a change
  reaches `openapi.json` and `wire-types.ts`.
- The DEZA walk states availability per popup code: `deza-catalog.runner.ts:182` to `:188`
  sends a claim with `shopCode` and `shopName`. The sink observes those codes through
  `SourceLocationService.observe` (`run-report.sink.ts:554`). `observe`
  (`source-location.service.ts:82`) creates a row on first sight and binds it only on an
  exact name match (`:111` to `:130`). A row seen again keeps its mapping (`:103` to `:109`).
- `SourceLocationService.views` (`source-location.service.ts:261` to `:293`) works out the
  candidates of an `UNMAPPED` row on every read with `rankLocations` (plan `0154`). Nothing
  maps a row without a person (`map`, `:191`).
- `SourceLocationCandidate` (`harvest.messages.ts:1038` to `:1045`) has
  `supermarketLocationId`, `label`, `address`, `postalCode`, `score` and `strong`.
- `DezaClient` (`libs/luna-shopper/deza/src/lib/deza.client.ts:63`) reads only
  `/productos/`. It gates every request on the run's bucket (`:281`), retries 429 and 5xx
  (`:195` to `:244`), and has a public `fetchDocument` for the capture tool only (`:167`).
  `parseShops` (`rows.ts:125`) reads the code from the `id` of `wpdz-precio-ok` and the
  printed name from the next `<strong>`.
- `capture-fixtures` (`libs/luna-shopper/deza/project.json`) runs
  `libs/luna-shopper/deza/tools/capture-fixtures.ts`, which writes pages verbatim with an
  honest User-Agent at one request per 500 ms.
- `uq_harvest_run_active_store_discovery` allows one `STORE_DISCOVERY` run in the whole
  database at a time (`db/migrations/1756700000000-LeafletImport.ts:183`).
- **This plan lands after plan `0215`.** That plan adds a `guard` option to `DezaClient`
  beside `acquire`, and every runner passes `context.guard` to the clients it builds. The new
  runner does the same, so a shop page that the chain refuses counts toward the run's stop.
- Plan `0223` adds the Carrefour case to the same dispatch table, `PROVIDER_ADAPTERS` and
  capability table. Whichever of the two lands second adds its own entry beside the other's.

### Target state

Every criterion in the acceptance section holds, the specs of the tests section pass, and
`openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work only in:
  - `libs/luna-shopper/deza/src/lib/` (a new `shops.ts`, its spec, `types.ts`,
    `deza.client.ts`, the fixtures and their `README.md`), `libs/luna-shopper/deza/src/index.ts`
    and `libs/luna-shopper/deza/tools/capture-fixtures.ts`.
  - `apps/luna-shopper-backend/harvester/src/app/harvest/`: a new
    `deza-store-discovery.runner.ts` and its spec, `store-discovery.runner.ts`,
    `harvest.module.ts`, `discovered-place.service.ts` (`PROVIDER_ADAPTERS` only),
    `source-location.service.ts` and its spec.
  - `libs/luna-shopper/contracts` (the `deza-web` capability, the candidate field), and the
    two generated files.
- Do NOT touch: the DEZA catalog walk, the sink, `matching.ts`, the trusted import, the
  postal code worker, `ADAPTER_CAPABILITIES` of any other adapter, catalog, the gateway
  beyond what regeneration writes, and `apps/luna-shopper-admin`.

### Constraints

- `@portfolio/luna-shopper/deza` stays framework free: no Nest, no TypeORM, no database, no
  new dependency. Parse with the helpers in `html.ts` and plain regular expressions, as
  `rows.ts` does.
- Every request goes through the existing `request` path of `DezaClient`, so the run's
  bucket, the retry rule and the abort signal apply to it.
- The client fetches a shop page only when its URL is on the client's own origin and under
  `/centros/`. A link the directory names elsewhere is reported as dropped and never fetched.
  The directory is third party markup and the runner treats it as data.
- No automated step maps a source location. The code match is a candidate. `map` stays the
  only act that binds a row (plan `0154`).
- The run creates nothing in catalog except through the trusted import that already exists,
  and only when the row's `autoImportPlaces` is true (plan `0107`).
- Fixtures are written by `capture-fixtures` only, verbatim. Nobody edits one by hand.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the capture run (eight requests in total, paced), and
  the generators.
- Stop and ask before you change the capabilities of any adapter other than `deza-web`.
- Stop and ask if the live `/centros/` page no longer carries the `markers : [` array that
  section 9 describes. Do not switch to a different source of shops on your own.
- Stop and ask before a run against a cluster. Do not turn `autoImportPlaces` on for DEZA
  anywhere. The owner decides that row.

### Progress evidence

Report after each of these, with the spec output:

1. The fixtures captured, and `shops.spec.ts` passing on them (section 2).
2. The client methods with a fake fetch (section 3).
3. The runner and the dispatch entry, with `deza-store-discovery.runner.spec.ts` (sections 4
   to 6).
4. The code candidate in the shop queue, the capability, and the regenerated files (sections
   7 and 8).

## 1. What is being built

| Piece                                               | Where                                           |
| --------------------------------------------------- | ----------------------------------------------- |
| Parse the directory and a shop page                 | `libs/luna-shopper/deza/src/lib/shops.ts`       |
| Read the code of a shop from two signals            | `shops.ts`, `readShopCode`                      |
| Fetch the directory and a shop page                 | `DezaClient.fetchShopDirectory`, `fetchShopPage` |
| Four new fixtures                                   | `capture-fixtures.ts`, `__fixtures__/`          |
| The store discovery case                            | `harvest/deza-store-discovery.runner.ts`        |
| The dispatch entry                                  | `store-discovery.runner.ts`                     |
| `DEZA` as a provider of `deza-web`                  | `discovered-place.service.ts`                   |
| The code candidate                                  | `source-location.service.ts`, the contract      |
| `listsItsOwnStores: true` for `deza-web`            | `harvest.messages.ts`                           |

## 2. The library: what the pages say

`shops.ts` holds two pure parsers and one pure rule. None of them fetches.

### 2.1 The directory

```ts
/** One pin of the map on `/centros/`, as the page states it. */
export interface DezaDirectoryEntry {
  /** The WordPress post id of the pin, e.g. `32`. Stable, and never shown. */
  postId: string;
  /** The title of the pin, e.g. `Tienda 1` or `SuperCash (Sector Sur)`. */
  title: string;
  latitude: number;
  longitude: number;
  /** The `Dir:` line of the pin, verbatim. */
  mapAddress: string | null;
  /** The `Teléfono:` line of the pin, verbatim. */
  phone: string | null;
  /** The first link whose text begins `Ver Tienda`, or null. */
  shopPageUrl: string | null;
  /** The text of the first `ver-tienda` link, e.g. `Ver Almacen`. */
  linkText: string | null;
  /** A category slug of the form `t1`, `c1` or `z1`, upper cased, or null. */
  categoryCode: string | null;
}

export interface DezaDirectory {
  entries: DezaDirectoryEntry[];
  /** The link text of each page under the `Centros` menu, by URL. */
  menuTitles: Map<string, string>;
}

export function parseShopDirectory(html: string): DezaDirectory;
```

The page renders its pins as a JSON array in an inline script, after the text `markers : `.
The parser finds that text, reads one JSON array from that point with a decoder that stops at
the end of the array, and reads each element. An element that lacks a number in `latitude`
or `longitude` is skipped and counted. The `details` field is HTML. The parser strips its
tags to read `Dir:` and `Teléfono:`, and reads the `href` and the text of each anchor with
class `ver-tienda`. A missing `markers : ` text is an error that names the page, because a
directory with no pins is a changed page and not an empty chain.

`categoryCode` comes from `categories[].slug`. A slug that matches `^[tcz][0-9]+$` with no
case is the code. `tiendas` is the parent category of every pin and is not a code.

### 2.2 A shop page

```ts
/** What one `/centros/<slug>/` page states about its shop. */
export interface DezaShopPage {
  /** The `<title>` with the site suffix removed. */
  title: string;
  /** The address lines above the postal code line, joined with a space. */
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  /** The code at the start of the main photo's file name, e.g. `C2`. */
  photoCode: string | null;
}

export function parseShopPage(html: string): DezaShopPage;
```

The facts sit in `<div id="datos-centro">`, as lines separated by `<br />`. The line that
matches `^(\d{5})\s*-\s*(.+)$` gives the postal code and the city. The lines before it are
the street. The first `<strong>` after it is the phone. `photoCode` comes from the `src` of
`<img id="foto-principal">`: the file name, read up to the first `_`, when it matches
`^[TCZ][0-9]+$`. A page with no `datos-centro` answers every field null and is not an error.

### 2.3 The code of a shop

```ts
export type DezaCodeOutcome =
  | { code: string; basis: 'BOTH' | 'MAP' | 'PHOTO' }
  | { code: null; reason: 'NO_CODE' | 'CODES_DISAGREE' };

export function readShopCode(
  entry: DezaDirectoryEntry,
  page: DezaShopPage | null
): DezaCodeOutcome;
```

Two signals carry the code, and section 9 measured both. The map category names 8 of the 10
shops. The photo file name names all 10. Both agree on all 8 shops that have both. The rule:

| Map category | Photo code | Outcome                       |
| ------------ | ---------- | ----------------------------- |
| `X`          | `X`        | `X`, basis `BOTH`             |
| `X`          | none       | `X`, basis `MAP`              |
| none         | `X`        | `X`, basis `PHOTO`            |
| `X`          | `Y`        | no code, `CODES_DISAGREE`     |
| none         | none       | no code, `NO_CODE`            |

A photo file name is an accident of how the chain names its uploads, and the plan relies on
it only because the chain gives nothing better for `C1` and `C2`. That is why a disagreement
reports no code instead of picking one.

## 3. The client

Two methods on `DezaClient`, beside the product methods:

```ts
/** `/centros/`, parsed. One request. */
async fetchShopDirectory(): Promise<DezaDirectory>;

/** One shop page, parsed. One request. Refuses a URL off this origin or outside `/centros/`. */
async fetchShopPage(url: string): Promise<DezaShopPage>;
```

Both use the private `get`, so they share the gate, the retry and the signal. The refusal in
`fetchShopPage` throws an error the runner catches and records as a dropped entry. Export
`DEZA_SHOPS_PATH = '/centros/'` beside `DEZA_PRODUCTS_PATH`.

The shop pages need no session cookie, so one client serves the whole run. That is the
opposite of the product walk, where one client is one query (`deza.client.ts:19` to `:26`),
and the class comment says so in one sentence.

## 4. The runner

`DezaStoreDiscoveryRunner` implements `StoreDiscoveryRunner`, in
`harvest/deza-store-discovery.runner.ts`. It follows `ElJamonStoreDiscoveryRunner` step by
step:

1. Require a chain, with the same message.
2. `STORES` stage: read the directory.
3. Keep the entries whose `linkText` begins `Ver Tienda` and whose `shopPageUrl` is not
   null. Every other entry is dropped with its title and the reason `NOT_A_SHOP`. On
   2026-10-22 that drops `Almacén 1`, `Almacén 2` and `Pan Obrador`.
4. Narrow by postal code (section 5).
5. Read the page of each entry that is left, one at a time. A page that fails is recorded in
   `failedShops` with the error, counted with `context.report({ failed: 1 })`, and the run
   goes on. An abort ends the loop.
6. Read the code with `readShopCode`. An entry with no code is not reported and is named in
   `shopsWithoutCode` with the reason. Section 6.2 says why.
7. Keep the entries whose page postal code is one of the wanted codes, exactly, when codes
   were asked for.
8. `UPSERT` stage: report one place per kept shop (section 6), flush, and write the report
   (section 6.4).

`createClient` is a protected seam, as in the El Jamón runner, built from the harvester's
`userAgent`, `source.config.baseUrl` when set, `context.acquire`, `context.guard` (plan
`0215`) and `context.signal`.

## 5. A postal code filter on a list with no postal code

The directory states coordinates and no postal code. The postal code is on the shop page.
Reading every shop page for each code the postal code queue asks would cost eleven requests
for a code in Madrid that no DEZA shop is near. So the runner narrows first, as the DIA
runner does:

- With no codes asked, every shop entry is read.
- With codes asked, an entry is read when it lies within `postalCodeRadiusMetres` of the
  centroid of one of the codes. The radius comes from `source.config.postalCodeRadiusMetres`
  when it is a positive number, and is 5,000 metres otherwise.
- A wanted code that has no centroid in the dataset makes the run read every shop entry,
  because a missed shop is worse than ten requests.
- The match that decides is the exact postal code on the shop page (step 7 of section 4).

The distance is `distanceMetres` from `@portfolio/luna-shopper/osm-places`, which the
harvester already depends on. The runner does not import the DIA library for it.

## 6. What a run writes

### 6.1 One place per shop

| `ObservedPlace` field | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `provider`            | `DEZA`                                                                 |
| `externalRef`         | the code, e.g. `T1`                                                    |
| `brandKey`, `brandName` | `input.chain`, as the El Jamón runner does                           |
| `name`                | the `Centros` menu title of the shop page, else the page title         |
| `latitude`, `longitude` | the pin                                                              |
| `street`, `city`      | the shop page                                                          |
| `postalCode`          | the shop page, with `postalCodeSource: SOURCE`, else null              |
| `country`             | `es`                                                                   |
| `website`             | the shop page URL                                                      |
| `openingHours`        | null (section 8)                                                       |
| `tags`                | `deza:code`, `deza:codeBasis`, `deza:postId`, `deza:mapTitle`, `deza:mapAddress`, `phone` |
| `scopeKey`            | null                                                                   |

The name is the menu title because it names the street, as the popup does: `Avda Jesús
Rescatado`, `SuperCash Las Quemadas`, `Supermercado Zoco`. The pin titles are `Tienda 1` to
`Tienda 7`, which name nothing a shopper knows.

`scopeKey` is null because DEZA states no price at all (plan `0085`). A shop imported from
this list takes the `STORE` scope that catalog gives a location that names none.

### 6.2 Why the code is the reference

`externalRef` is what a later run recognizes a shop by, and it is what the shop queue joins
on in section 7. The code is the key the chain itself uses in every popup, and plan `0084`
section 6 keys `source_locations` on it because it survives a rename. Keying the place on
the same string makes the join an equality.

A shop with no readable code is therefore not reported. A place keyed on its post id would
become a second place on the day its code appears, and the code is what this plan is for.
The report names the shop, so a person sees it. On 2026-10-22 every shop has a code.

### 6.3 The trusted import and OpenStreetMap's places

Nothing in the import path changes. When the DEZA row has `autoImportPlaces` true, a place
that passes the check of plan `0107` section 3.2 and has no catalog shop near it is imported.
A place with a shop of the chain within the distance `suggestLocations` reads stays `NEW`
(`discovered-place.service.ts:475` to `:484`), and a person links it (plan `0193`). The
first catalog holds DEZA shops imported from OpenStreetMap, so the first run leaves most
DEZA places in the queue with their shop as a candidate. That is the intended outcome.
Linking fills the postal code the shop lacks, through `missingFields`.

### 6.4 The run report

```ts
{
  entriesRead: number;          // pins in the directory
  shopEntries: number;          // pins that link to a shop page
  pagesRead: number;
  shopsReported: number;
  droppedEntries: Array<{ title: string; reason: 'NOT_A_SHOP' | 'OFF_SITE' | 'NO_COORDINATES' }>;
  shopsWithoutCode: Array<{ title: string; reason: 'NO_CODE' | 'CODES_DISAGREE' }>;
  addressDisagreements: Array<{ code: string; mapAddress: string; pageStreet: string }>;
  failedShops: Array<{ title: string; error: string }>;
  postalCodesWithNoShop: string[];
  warnings: string[];
  requests: number;
}
```

`addressDisagreements` lists a shop whose pin address and page street differ after
`normalizeName` and after the house number is compared alone. On 2026-10-22 that is `T4`: the
pin says `Avda. Isla Fuerteventura, 48` and the page says `Avda. Isla Fuerteventura, 21`. The
place carries the page street and the pin address in a tag, and a person decides.

A run that reads fewer than 8 shop entries adds a warning that names the 10 measured on
2026-10-22, as the El Jamón runner does with its own count.

## 7. The shop queue proposes the shop of the same code

The walk keeps creating `source_locations` rows from popup codes, as it does today. This plan
writes no `source_locations` row from a store discovery.

`SourceLocationService.views` gains one step for an `UNMAPPED` row. Before `rankLocations`, it
looks for a discovered place with provider `DEZA`, `externalRef` equal to the row's
`externalId`, and a `supermarketLocationId` that is not null. When the location is one of the
chain's locations that `chainLocations` already loaded, that location is the first candidate,
with `score: 1`, `strong: true` and `sameCode: true`. The name candidates follow, without that
location if they named it too, and the list keeps its cap of three.

```ts
export interface SourceLocationCandidate {
  // the six fields as today
  /**
   * The chain's own shop list names a shop with this row's code, and that shop
   * is linked to this location (plan 0222). A proposal, never a mapping.
   */
  sameCode?: boolean;
}
```

The providers to look under are a constant, `SHOP_CODE_PROVIDERS = ['DEZA']`: the providers
whose `externalRef` is the chain's own shop code. The check that the location is one of the
row's chain's locations is what keeps a code of one chain off the queue of another. The lookup
is one query per page of rows, on the codes of the `UNMAPPED` rows in that page, so the
service gains a repository for `DiscoveredPlace` and nothing else.

The admin queue already draws candidates in order, so the code candidate shows first with no
admin change. A mark that says "same code" needs a mock, and that is an admin follow up.

## 8. What the source does not give, and is not read

- **Opening hours.** The shop page links to `calendario/`, a page that asks the visitor to pick
  a day and fills the hours from a script. The plan reads no calendar. `openingHours` is null.
- **The REST API.** `/wp-json/wp/v2/pages` answers 404, so the shop pages are read as HTML.
- **The other centres.** The `Centros` menu also lists two cafeterias, a kiosk, a beauty salon,
  a perfumery, a bakery and two warehouses. Only the pins that link `Ver Tienda` are shops.

## 9. Research note, measured on 2026-10-22

Read only, 15 requests to `www.dezacalidad.es`, at least one second apart, with a Chrome
User-Agent. `robots.txt` disallows only `/wp-admin/` and allows `/centros/`.

- `GET /centros/` answers 200, 114 KB of UTF-8. An inline script holds `markers : [...]`, the
  data of the plugin `basic-google-maps-placemarks`: 13 pins, each with `id`, `title`,
  `latitude`, `longitude`, `details` (HTML), `categories`, `icon` and `zIndex`.
- The 13 pins are 10 shops (`Ver Tienda`), two warehouses (`Ver Almacen`) and one bakery
  (`Ver Panadería`).
- Category slugs `t1` to `t7` and `z1` sit on 8 shops. `SuperCash (Las Quemadas)` has only
  `tiendas`. `SuperCash (Sector Sur)` has no category.
- Each of the 10 shop pages answers 200, about 100 KB. `<div id="datos-centro">` holds the
  street, a line `<postal code> - Córdoba`, and the phone. The main photo is named after the
  code: `T1_1-…`, `T2_1-…`, `T3_1-…`, `T4_1-…`, `T5_1-…`, `T6_1-…`, `T7_2-…`, `Z1_1-…`,
  `C1_1-…`, `C2_1-…`. The shop pages carry no coordinates.
- Postal codes from the pages: T1 14010, T2 14009, T3 14007, T4 14011, T5 14010, T6 14014,
  T7 14006, Z1 14005, C1 14014, C2 14013.
- The popup names in the product fixture (`landing-page.html`, captured 2026-09-05) are
  `Jesús Rescatado`, `Ctra. de Castro`, `Ronda del Marrubial`, `Isla Fuerteventura`, `Camino de
  la Barca`, `Avda. de Libia`, `Fuente de la salud`, `Zoco`, `SuperCash (Quemadas)` and
  `SuperCash (Sector Sur)`, for T1 to T7, Z1, C1 and C2. The menu lists the shops in the same
  order.
- The pin and the page disagree on one street: T4, `48` on the pin and `21` on the page.
  Plan `0154` quotes OpenStreetMap as `Isla de Fuerteventura 48`.
- The calendar page holds no hours in its markup. `/wp-json/wp/v2/pages?parent=40` and
  `/wp-json/wp/v2/types` answer 404.

**The cost of one run.** With no postal codes: 1 directory request and 10 shop page requests,
11 in all, at the rate of the DEZA row. With postal codes far from Córdoba: 1 request. The
pages total about 1.1 MB. The run reports 10 places.

## 10. What OpenStreetMap still does for this chain

- The postal code queue keeps its OpenStreetMap run for every code (plan `0107` section 2). A
  radius over Córdoba still finds DEZA shops as `OSM` places. This plan adds no merge across
  providers (plan `0107` section 8). An `OSM` place of a shop that a `DEZA` place brought in
  shows that shop as a candidate (plan `0193`), and a person links or rejects it.
- OpenStreetMap stays the only source of a shop's outline area (plan `0176`). Linking an `OSM`
  place to the shop still fills `footprintM2`.
- With `listsItsOwnStores` true, the queue also asks DEZA of every due code (section 5 keeps
  that to one request away from Córdoba). A store discovery for DEZA no longer needs a postal
  code or a radius at the spawn.

## 11. What this plan does not do

- **It maps no source location.** The code candidate is a proposal (plan `0154`).
- **It writes no `source_locations` row from a store discovery.** The walk stays the one
  writer.
- **It reads no opening hours** (section 8).
- **It changes no import rule.** `autoImportPlaces` stays off for DEZA until the owner turns
  it on.
- **It does not rename DEZA products.** That is plan `0221`.
- **It adds no admin screen.** The "same code" mark is an admin follow up and needs a mock.
- **It adds no run estimate for a DEZA store discovery.** `DEFAULT_RUN_SECONDS` is per
  adapter (`run-estimate.ts:18`), so the first store discovery shows the walk's 25 minutes
  until one store discovery completes and the source basis takes over.

## Tests

- **`shops.spec.ts`**, on the captured fixtures:
  - the directory yields 13 entries, 10 with a `Ver Tienda` link, and the 8 category codes,
  - `SuperCash (Sector Sur)` has no category code and a shop page URL,
  - the Zoco pin yields the shop page and not the perfumery or the salon,
  - a page with the `markers : ` text removed throws an error that names the page (a string
    built in the spec from the fixture, not a new fixture),
  - each shop page fixture yields its street, postal code, city, phone and photo code,
  - `readShopCode`, every row of the table in section 2.3.
- **`deza.client.spec.ts`**: both methods go through the gate, retry a 503, and
  `fetchShopPage` refuses another host and a path outside `/centros/` without a request.
- **`deza-store-discovery.runner.spec.ts`**, with a client built on the fixtures:
  - a run with no codes reports one place per shop with the fields of section 6.1,
  - the warehouses and the bakery are in `droppedEntries`,
  - a run for `14013` reads only the pages near it and reports `C2` only,
  - a run for `28001` reads no shop page,
  - a page that fails is in `failedShops` and the run completes,
  - a shop with no code is in `shopsWithoutCode` and is not reported,
  - `T4` is in `addressDisagreements`,
  - a run with no chain is refused.
- **`store-discovery.runner.spec.ts`**: `deza-web` reaches the new case, and a run with no
  source still reaches OpenStreetMap.
- **`source-location.service.spec.ts`**: an `UNMAPPED` `T1` with a linked `DEZA` place `T1`
  has that location first with `sameCode: true`, a place linked to another chain's location
  adds nothing, an `ACTIVE` row gets no candidates, and an `OSM` place with the
  `externalRef` `T1` adds nothing.
- **Contracts**: `harvest.messages.spec.ts` states `listsItsOwnStores: true` for `deza-web`.
- **Gateway**: `openapi-document.spec.ts` passes after regeneration, and `wire-types.spec.ts`
  passes after the second generator.

## Acceptance criteria

- [ ] `@portfolio/luna-shopper/deza` exports `parseShopDirectory`, `parseShopPage`,
      `readShopCode` and `DEZA_SHOPS_PATH`, and imports no framework.
- [ ] `capture-fixtures` writes `centros.html` and three shop pages (T1, C2, Z1) verbatim, and
      the fixture `README.md` names the case each one exists for.
- [ ] A `STORE_DISCOVERY` for the DEZA chain runs `DezaStoreDiscoveryRunner`.
- [ ] A run with no postal codes makes 11 requests and reports 10 places on the fixtures.
- [ ] Every place has provider `DEZA` and its shop code as `externalRef`.
- [ ] A shop with no code or with two codes that disagree is reported nowhere and is named in
      the report.
- [ ] No shop page off the site or outside `/centros/` is fetched.
- [ ] The run writes no `source_locations` row and maps none.
- [ ] An `UNMAPPED` source location whose code names a linked `DEZA` place proposes that
      place's location first, with `sameCode: true`.
- [ ] `ADAPTER_CAPABILITIES['deza-web'].listsItsOwnStores` is true.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/deza
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-harvester
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx test luna-shopper-backend-gateway
npx nx test luna-shopper-admin/models
npx nx build luna-shopper-backend-harvester
npx nx affected -t lint test
```

`nx test` does not type check. The build line does.

The live check, on an ephemeral slot that a person starts (not the agent): run
`bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>`, enable the DEZA source
row there with `autoImportPlaces` false, start a `STORE_DISCOVERY` for the DEZA chain with no
postal code, and read the run report and the places queue. Expect 10 `DEZA` places, 3 dropped
entries, `T4` in `addressDisagreements`, and 11 requests.

## Decisions

Chosen in this plan, and open to the owner's correction:

- **The shop code is the `externalRef`** (section 6.2). A shop with no readable code is named
  in the report and not written.
- **The photo file name is a second signal for the code**, because the map names no code for
  `C1` and `C2`. Two signals that disagree give no code.
- **The street comes from the shop page**, which also holds the postal code. The pin address
  is a tag, and a disagreement is in the report.
- **The name is the `Centros` menu title**, not the pin title.
- **A postal code run narrows by a 5 km radius around the centroid first** (section 5), and a
  code with no centroid reads every shop.
- **The code match is a candidate and never a mapping**, by plan `0154`'s rule.
- **No opening hours.** The calendar is filled by a script, and reading it is a separate cost.

**Owner** (ask, do not choose):

1. **May a code match map a source location by itself?** The code is the chain's own key on
   both pages, so it is an identity and not a fuzzy name. Plan `0154` says that no automated
   match maps a shop. A yes would add a `matchedBy` value and an automatic map on link or
   import. This plan builds the proposal only.
2. **Is the postal code queue to ask DEZA of every due code?** Turning `listsItsOwnStores` on
   does that. The cost away from Córdoba is one request per code per cooldown period. The
   alternative is a second capability that keeps DEZA out of the queue and only frees the
   spawn from the postal code.
3. **Which street is right for T4**, `21` on the shop page or `48` on the pin and in
   OpenStreetMap. The plan writes the page street and reports the disagreement.
