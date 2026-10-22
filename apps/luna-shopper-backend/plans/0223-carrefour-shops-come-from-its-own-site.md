# 0223: carrefour shops come from its own site

> Carrefour shops reach the catalog today only through OpenStreetMap. Plan `0090` section 2
> looked for a store list, tested `salepoints/v1/stores-location/es`, found that it answers
> one store, and concluded that the chain publishes none. The public store finder on
> carrefour.es reads a different route: one XML document that names all 1,974 of the
> chain's points of sale in Spain and Andorra, with coordinates, a postal code, an address,
> a phone, hours and the format on every one. This plan adds a store discovery case for
> `carrefour-web` that reads that document through the browser the adapter already drives,
> reports the grocery shops of the formats the source row names, and records on each
> hypermarket or Market which online sale point is that shop.
>
> Prerequisite reading: `0090` (the browser, the cookie rule, sections 2, 4 and 9), `0089`
> section 9 (store discovery dispatched on `adapterKey`), `0103` section 6.4, `0106`
> section 4 (the postal code filter), `0107` sections 3 and 8 (the trusted import), `0169`
> section 3 (the El Jamón shop list, the closest model), `0193` (a place links to the shop
> it is), `0222` (the DEZA half, written beside this one), and in the code
> `store-discovery.runner.ts`, `store-discovery-runner.ts`,
> `eljamon-store-discovery.runner.ts`, `carrefour-catalog.runner.ts`,
> `discovered-place.service.ts` and `libs/luna-shopper/carrefour/src/lib/carrefour.client.ts`.

## Brief for the agent

### Objective

Add a `STORE_DISCOVERY` case for the `carrefour-web` adapter. It loads the store finder's
XML and the drive list through `CarrefourClient`, reports one `ObservedPlace` per grocery
shop of the formats the source row allows, tags each shop that is also an online sale
point with that sale point, and changes no catalog row by itself. Mark `carrefour-web` as a
source that lists its own stores. Sections 1 to 8 describe the whole job.

### Context

Every statement below was read on `dev` on 2026-10-22.

- `StoreDiscoveryRunner` (`harvester/src/app/harvest/store-discovery.runner.ts:39`)
  dispatches on `source.adapterKey` through a table (`:50` to `:55`). `carrefour-web` is not
  in it, so it takes the OpenStreetMap case (`:83` to `:85`). The comment at `:80` says that
  `carrefour-web` publishes no store list. Section 9 shows that it does.
- `ElJamonStoreDiscoveryRunner` (`eljamon-store-discovery.runner.ts:35`) is the model: chain
  required (`:46`), one list, a filter on the shop's own postal code (`:55` to `:59`), a
  warning under a measured count (`:72` to `:79`), one place per shop with its own provider
  (`:89` to `:110`), a run report (`:114` to `:124`), a protected `createClient` seam
  (`:131`).
- `CarrefourClient` (`libs/luna-shopper/carrefour/src/lib/carrefour.client.ts:170`) drives
  headless Chromium because Cloudflare refuses Node's TLS (`:9` to `:31`). Every load goes
  through the private `load` (`:289`): the pacing floor of `CARREFOUR_MIN_DELAY_MS`, 2 s
  (`types.ts:234`), the run's bucket, and the refusal count that throws
  `CarrefourBlockedError` on the third 403 or 429 in a row (`:138`). Before each navigation
  `PlaywrightSession.goto` (`:436`) drops the `__cf*` and `cf_*` cookies and keeps the rest,
  `salepoint` among them. `goto` answers the status and `window.__INITIAL_STATE__`, never
  the body.
- **This plan lands after plan `0215`.** That plan replaces the refusal count inside `load`
  with a shared guard, deletes `CarrefourBlockedError`, and makes the third refusal in a row
  throw `SourceBlockedError` (`@portfolio/luna-shopper/source-guard`). Every mention of
  `CarrefourBlockedError` below means `SourceBlockedError` once plan `0215` is on `dev`. The
  new runner passes `context.guard` to its client, as plan `0215` makes the other runners do.
  Make `load` generic on top of plan `0215`'s version, and keep its guard calls.
- `CarrefourSession` (`types.ts:175` to `:180`) is the test seam: `goto(url)` and `close()`.
  `CarrefourClientOptions.openSession` (`types.ts:208`) lets a spec hand in a fake.
- `CarrefourCatalogRunner` builds its client in a protected `createClient`
  (`carrefour-catalog.runner.ts:151`) and closes it in a `finally` (`:137` to `:140`).
- `capture-fixtures` (`libs/luna-shopper/carrefour/project.json`) runs
  `libs/luna-shopper/carrefour/tools/capture-fixtures.ts`, which launches Chromium and writes
  page states verbatim through the public `captureState` (`carrefour.client.ts:221`).
- `ADAPTER_CAPABILITIES['carrefour-web']` (`libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts:438`
  to `:447`) has `listsItsOwnStores: false`. The spawn reads it (`harvest-run.service.ts:840`
  to `:851`) and the postal code queue reads it (`postal-code-discovery.service.ts:218` to
  `:233`). The schema publishes the table as a `const`
  (`libs/luna-shopper/contracts/src/schemas/messages/harvest.schemas.ts:1909`).
- `ObservedPlace` (`harvest/run-report.ts:20` to `:65`) has no phone and no format field.
  `tags` holds the source's own fields.
- `DiscoveredPlaceService.observe` (`discovered-place.service.ts:368`) upserts on
  `(provider, externalRef)` and, with `autoImport`, imports a `NEW` place that passes the
  check and has no catalog shop of the chain near it (`:475` to `:484`).
  `PROVIDER_ADAPTERS` (`:88` to `:94`) does not name Carrefour.
- The catalog stores the chain's identity as a Wikidata QID, and the QID of `Carrefour`
  differs from the QID of `Carrefour Express`
  (`libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts:744` to `:749`,
  `catalog/src/app/catalog/supermarket.service.ts:112` to `:117`).
- `uq_harvest_run_active` allows one active run per supermarket
  (`db/migrations/1756200000000-InitialHarvesterSchema.ts:109` to `:113`), and
  `uq_harvest_run_active_store_discovery` one store discovery in the whole database
  (`db/migrations/1756700000000-LeafletImport.ts:183`).

### Target state

Every criterion in the acceptance section holds, the specs of the tests section pass, and
`openapi.json` and `wire-types.ts` are regenerated.

### Scope

- Work only in:
  - `libs/luna-shopper/carrefour/src/lib/` (a new `stores.ts`, a new `drives.ts`, their
    specs, `types.ts`, `carrefour.client.ts` and its spec, the fixtures),
    `libs/luna-shopper/carrefour/src/index.ts` and
    `libs/luna-shopper/carrefour/tools/capture-fixtures.ts`.
  - `apps/luna-shopper-backend/harvester/src/app/harvest/`: a new
    `carrefour-store-discovery.runner.ts` and its spec, `store-discovery.runner.ts`,
    `harvest.module.ts` and `discovered-place.service.ts` (`PROVIDER_ADAPTERS` only).
  - `libs/luna-shopper/contracts` (the `carrefour-web` capability) and the two generated
    files.
- Do NOT touch: the catalog walk and the detail backfill of Carrefour, the cookie rule, the
  pacing floor, the refusal count, price scopes, the sink, the trusted import, the postal
  code worker, the capabilities of any other adapter, catalog, and
  `apps/luna-shopper-admin`.

### Constraints

- `@portfolio/luna-shopper/carrefour` stays framework free apart from Playwright, which it
  already has. Parse the XML with a regular expression over `<marker .../>` and its
  attributes. Add no XML dependency.
- Every load goes through `load`, so the store run obeys the cookie rule, the 2 s floor and
  the refusal count exactly as the walk does. Do not add a second path to the browser and do
  not add concurrency.
- The runner closes the client in a `finally`.
- The run declares no price scope and writes no price. `scopeKey` is null on every place.
- No automated step links a place to a catalog shop. The trusted import runs only when the
  row's `autoImportPlaces` is true (plan `0107`).
- Fixtures are written by `capture-fixtures` only, verbatim.
- Regenerate `openapi.json` and the wire types with their generators, never by hand.
- No dash as punctuation in a comment or a message. Reword the sentence.

### Action boundaries

- Proceed with in scope edits, specs, the capture run (two more loads than today, paced),
  and the generators.
- Stop and ask if `locations.aspx` answers anything but XML with `<marker` elements, or if a
  load through Chromium is refused. Do not try another client.
- Stop and ask before you declare a price scope from a sale point, or change the default
  formats of section 5.
- Stop and ask before a run against a cluster. Do not turn `autoImportPlaces` on for
  Carrefour anywhere.

### Progress evidence

Report after each of these, with the spec output:

1. The two fixtures captured, and `stores.spec.ts` and `drives.spec.ts` passing on them.
2. The session and client methods, with a fake session (section 3).
3. The runner and the dispatch entry, with `carrefour-store-discovery.runner.spec.ts`
   (sections 4 to 7).
4. The capability and the regenerated files.

## 1. What is being built

| Piece                                          | Where                                              |
| ---------------------------------------------- | -------------------------------------------------- |
| Parse the store finder XML                     | `libs/luna-shopper/carrefour/src/lib/stores.ts`    |
| Parse the drive list, join it to the shops     | `libs/luna-shopper/carrefour/src/lib/drives.ts`    |
| Read a body through the browser                | `CarrefourSession.fetchText`, `CarrefourClient`    |
| Two new fixtures                               | `capture-fixtures.ts`, `__fixtures__/`             |
| The store discovery case                       | `harvest/carrefour-store-discovery.runner.ts`      |
| The dispatch entry                             | `store-discovery.runner.ts`                        |
| `CARREFOUR` as a provider of `carrefour-web`   | `discovered-place.service.ts`                      |
| `listsItsOwnStores: true` for `carrefour-web`  | `harvest.messages.ts`                              |

## 2. The library: the store finder

### 2.1 What the document is

`GET /tiendas-carrefour/buscador-de-tiendas/locations.aspx` answers `text/xml` with one
`<markers>` root and one self closing `<marker>` per point of sale. The store finder page
(`/tiendas-carrefour/buscador-de-tiendas/`) loads it whole, with no query string, through
`jquery.storelocator` (`'dataType': 'xml'`, `'dataLocation': '/tiendas-carrefour/buscador-de-tiendas/locations.aspx'`),
and filters it in the browser. Section 9 has the counts.

The attributes: `name`, `lat`, `lng`, `category`, `address`, `address2`, `city`, `state`,
`ccaa`, `postal`, `country`, `phone`, `web`, `hours1`, `hours2`, `hours3`, `features`,
`featured`, `codsa`, `codat`, `tcm`. The last three, and `ccaa`, `hours3` and `featured`, are
absent on some records.

### 2.2 The parser

```ts
export type CarrefourFormat =
  | 'HIPERMERCADO'
  | 'MARKET'
  | 'EXPRESS'
  | 'EXPRESS_CEPSA'
  | 'BIO';

export interface CarrefourStore {
  /** The `tcm` attribute, e.g. `tcm:5-3850`. The one key that is unique. */
  externalRef: string;
  format: CarrefourFormat;
  /** The `category` attribute, verbatim. */
  category: string;
  name: string;
  latitude: number;
  longitude: number;
  street: string;
  city: string | null;
  province: string | null;
  postalCode: string;
  phone: string | null;
  web: string | null;
  /** `hours1`, `hours2`, `hours3`, verbatim, absent ones left out. */
  hours: string[];
  features: string[];
  codsa: string | null;
  codat: string | null;
}

export interface CarrefourDroppedRecord {
  name: string;
  category: string;
  reason:
    | 'NOT_GROCERY'
    | 'OUTSIDE_SPAIN'
    | 'NO_REFERENCE'
    | 'BAD_COORDINATES'
    | 'BAD_POSTAL_CODE';
}

export interface CarrefourStoreList {
  recordsRead: number;
  stores: CarrefourStore[];
  dropped: CarrefourDroppedRecord[];
}

export function parseStoreLocator(xml: string): CarrefourStoreList;
```

Every record is a shop or a dropped record with its reason, as in the El Jamón parser, so a
count that moves between runs is explained by the report.

- **The format** maps `category`: `Hipermercado` to `HIPERMERCADO`, `Supermercado Carrefour
  Market` to `MARKET`, `Supermercado Carrefour Express` to `EXPRESS`, `Supermercado Carrefour
  Express CEPSA` to `EXPRESS_CEPSA`, `Supermercado Carrefour BIO` to `BIO`. Every other
  category is `NOT_GROCERY`: `Agencia de Viajes`, `Estación de Servicio` and `Hipermercado
  Outlet` today, and any category the chain adds later.
- **The postal code** is the attribute with its spaces trimmed. 21 records carry a trailing
  space. A code that is not five digits is `OUTSIDE_SPAIN` when it begins `AD`, and
  `BAD_POSTAL_CODE` otherwise. The 11 Andorran shops say `country="es"`, so the country
  attribute is not read.
- **The reference** is `tcm`. A record with none is `NO_REFERENCE`. Section 6.2 says why.
- **The street** is `address`, followed by `address2` when it is not blank.
- Attribute values are decoded for the five XML entities and numeric references, as
  `html.ts` decodes text in the DEZA library.

## 3. The library: the drive list, and what a sale point is

### 3.1 The document

`GET /cloud-api/salepoints/v1/drives` answers JSON: `{ groups: [{ name, sale_points: [...] }] }`.
Each sale point has `sale_point_id`, `store_id`, `name`, `latitude`, `longitude`,
`postal_code`, `city`, `province` and a street. The page state of every storefront page
names the service (`config.endpoints.drive.client`).

```ts
export interface CarrefourDrive {
  salePointId: string;
  storeId: string;
  name: string;
  latitude: number;
  longitude: number;
  postalCode: string | null;
}

export function parseDrives(json: unknown): CarrefourDrive[];

/**
 * The sale point of each shop, by the shop's `externalRef`: the drive whose
 * coordinates are nearest the shop, within `maxMetres`, among the shops of the
 * `HIPERMERCADO`, `MARKET` and `BIO` formats.
 */
export function salePointsByShop(
  stores: readonly CarrefourStore[],
  drives: readonly CarrefourDrive[],
  maxMetres?: number // 150
): Map<string, CarrefourDrive>;
```

`parseDrives` reads from `unknown` and skips an element whose id or coordinates are missing.

### 3.2 Why the join is by position

The drive list carries no key of the store finder. Its `store_id` (`800002`) is neither
`codsa` (`0070`) nor `codat` (`005D`), and contains `codsa` for 8 of 179 drives only. The
coordinates agree: 168 of the 179 drives sit at 0 metres from a store finder record, and the
farthest at 107 metres. One drive's nearest record is a petrol station of the same site,
which is why the join reads only the grocery formats that have drives. 150 metres takes every
measured drive and no second shop.

### 3.3 What this answers about `salepoint`

The cookie the walk keeps (`carrefour.client.ts:48` to `:51`) read `005290||28232|A_DOMICILIO|0`
on a fresh session on 2026-10-22. `GET /cloud-api/salepoints/v1/` named it `COL PINAR`,
`region_id` `5289`, `werks_id` `0731`, delivery `A_DOMICILIO`, postal code `28232`. The drive
list names `005290` as `Drive Hiper El Pinar`, and the store finder record at the same point
is the hypermarket `Carrefour El Pinar`. So **a sale point is a shop with an online service**,
179 of them, all hypermarkets or Markets. The walk's prices are the online prices of the El
Pinar hypermarket, for delivery to 28232. An Express shop has no sale point.

This plan records the sale point on the shop it belongs to and does nothing else with it.
Whether prices differ between sale points is still unmeasured (plan `0090` section 9).

## 4. The client

`CarrefourSession` gains one method:

```ts
/** Navigate to `url` and answer the status and the response body as text. */
fetchText(url: string): Promise<{ status: number; body: string | null }>;
```

`PlaywrightSession.fetchText` drops the Cloudflare cookies, navigates with the same deadline
and options as `goto`, and reads `response.text()` under its own deadline. It answers a null
body for any status but 200.

`load` becomes generic over what it reads, so the pacing, the bucket, the refusal count and
the session reset stay in one place. The state read and the text read are its two callers.
`CarrefourClient` gains:

```ts
/** The store finder's XML, parsed. One load. */
async readStoreLocator(): Promise<CarrefourStoreList>;

/** The drive list, parsed. One load. */
async readDrives(): Promise<CarrefourDrive[]>;

/** The raw body of one path, for the capture tool only. */
captureText(path: string): Promise<string | null>;
```

A 200 whose XML holds no `<marker` is an error that names the path. Export
`CARREFOUR_STORE_LOCATOR_PATH` and `CARREFOUR_DRIVES_PATH` from `types.ts`.

`capture-fixtures.ts` adds `store-locator.xml` (about 1.1 MB, 1,974 records) and `drives.json`
(about 61 KB) through `captureText`. A capture is two more loads at the 2 s floor.

## 5. The formats a run reports

The source row decides, through `source.config.storeFormats`: an array of `CarrefourFormat`
names. An absent or empty array means `['HIPERMERCADO', 'MARKET']`. An unknown name refuses
the run with a message that lists the valid names, before any load.

The default leaves out Express, Express CEPSA and BIO for three reasons:

- The walk reads one online assortment at one sale point (section 3.3). An Express shop is a
  franchise with no online service, and nothing measured says that its shelf prices are the
  online ones.
- The runner stamps the run's chain on every place, and OpenStreetMap files Express under its
  own QID. Reporting about 1,220 Spanish Express shops under the Carrefour chain decides a question the
  catalog leaves to the owner (`supermarket.service.ts:112` to `:117`).
- 365 shops is a queue a person can work. About 1,585 is not, while `autoImportPlaces` is off.

## 6. The runner

### 6.1 Steps

`CarrefourStoreDiscoveryRunner` implements `StoreDiscoveryRunner`, in
`harvest/carrefour-store-discovery.runner.ts`:

1. Require a chain. Read and check `storeFormats`.
2. `STORES` stage: `readStoreLocator()`.
3. Keep the stores of the allowed formats. Then, when codes were asked for, keep the stores
   whose own postal code is one of them, exactly. The document holds every postal code, so
   no radius is needed.
4. `DRIVES` stage: `readDrives()` and `salePointsByShop`. A failure here is not the run's: it
   adds a warning, and the places carry no sale point. A `SourceBlockedError` still ends
   the run, because it means the address is refused.
5. `UPSERT` stage: report one place per kept store (section 6.2), flush, write the report
   (section 6.4).
6. Close the client in a `finally`.

`createClient` is a protected seam, built as `CarrefourCatalogRunner` builds its client, from
the harvester's `userAgent`, `context.acquire`, `context.guard` (plan `0215`) and
`context.signal`.

### 6.2 One place per shop

| `ObservedPlace` field   | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `provider`              | `CARREFOUR`                                                   |
| `externalRef`           | `tcm`, e.g. `tcm:5-3850`                                      |
| `brandKey`, `brandName` | `input.chain`                                                 |
| `name`                  | `name`, e.g. `Carrefour Actur Zaragoza`                       |
| `latitude`, `longitude` | `lat`, `lng`                                                  |
| `street`, `city`        | section 2.2                                                   |
| `postalCode`            | trimmed `postal`, with `postalCodeSource: SOURCE`             |
| `country`               | `es`                                                          |
| `website`               | `web`                                                         |
| `openingHours`          | null                                                          |
| `tags`                  | section 6.3                                                   |
| `scopeKey`              | null                                                          |

**Why `tcm`.** It is the only attribute that is unique on every record that has one: 1,749
distinct values and no repeat. `codsa` repeats on 39 values, 19 of them between two grocery
shops (`5446` is both Puente de Sanabria and Puebla de Sanabria). `codat` repeats once. The
`web` path is unique too, but a renamed page changes it, and a CMS id does not. One grocery
record has no `tcm` today, an Express CEPSA, and the default formats do not reach it.

**Why no opening hours.** The three hours attributes carry no label. On an Express record
`hours1` is `de 09:00 a 21:00` and `hours2` is `de 10:00 a 14:00`, which reads as weekdays and
Sunday, and nothing on the page confirms it. They go to tags verbatim.

`scopeKey` is null, as for El Jamón. An imported shop takes the `STORE` scope that catalog
gives a location that names none, and the walk's default scope reaches it through the stack of
plan `0116`. The sale point is a tag and not a scope key, because declaring a scope per sale
point needs the price measurement plan `0090` section 9 left open.

### 6.3 Tags

`carrefour:format`, `carrefour:category`, `carrefour:codsa`, `carrefour:codat`, `phone`,
`addr:province` (the `state` attribute), `carrefour:hours1`, `carrefour:hours2`,
`carrefour:hours3`, `carrefour:features` (the comma list, verbatim), and, for a shop with a
drive, `carrefour:salePoint` and `carrefour:driveName`. An absent attribute is no tag.

### 6.4 The run report

```ts
{
  recordsRead: number;            // 1,974 on 2026-10-22
  groceryShops: number;           // 1,597
  formats: string[];              // the formats this run reported
  shopsReported: number;          // 365 with the default formats
  shopsWithSalePoint: number;
  droppedRecords: CarrefourDroppedRecord[];  // every record left out, with the reason
  postalCodesWithNoShop: string[];
  warnings: string[];
  loads: number;                  // client.loads
}
```

`droppedRecords` lists the records the parser dropped, not the shops of a format the row left
out. Those are counted in `groceryShops` minus `shopsReported`. A run that reads fewer than
1,400 grocery shops adds a warning that names the 1,597 measured on 2026-10-22.

## 7. The cost of one run

- One Chromium launch, about a second and up to 300 MB of resident memory while it lives
  (`carrefour.client.ts:160` to `:164`), shut by the `finally`.
- Two loads at the 2 s floor: the XML, 1.09 MB as text and about 160 KB on the wire, and the
  drive list, 61 KB. A curl of the XML from a Windows machine took 0.11 s.
- About ten seconds in all, the same with and without postal codes.
- No product request, no price, no scope.

`uq_harvest_run_active` keeps a store discovery and a walk of Carrefour from running at the
same time, so two browsers for this chain never live together.

## 8. Research note, measured on 2026-10-22

Read only, with a Chrome User-Agent. Windows `curl` for `robots.txt`, the sitemap, the store
finder script and one read of the XML. Headless Chromium from the workspace's Playwright, with
the `__cf*` and `cf_*` cookies cleared before each navigation, for the store finder page, one
listing page, the XML again, the sale point root and the drive list. About 12 top level
requests, at least 2 s apart. `robots.txt` disallows none of the paths read.

- The sitemap names `/tiendas-carrefour/buscador-de-tiendas/` and one page per shop: 212
  hypermarkets, 188 Markets, 1,675 Express, 19 outlets.
- The store finder page sets up `jquery.storelocator` with
  `dataLocation: '/tiendas-carrefour/buscador-de-tiendas/locations.aspx'` and
  `dataType: 'xml'`, and draws a marker icon for seven categories.
- `locations.aspx` answered 200, `text/xml`, behind Cloudflare, both to Windows curl and to
  Chromium. 1,974 records: Express 832, Express CEPSA 398, travel agency 214, hypermarket
  204, Market 161, petrol station 147, outlet 16, BIO 2. Grocery formats: 1,597.
- Every record has `name`, `lat`, `lng`, `postal`, `address`, `city`, `phone`, `hours1` and
  `hours2`. Every coordinate parses and lies in Spain or Andorra. 11 Express records are in
  Andorra with an `AD` postal code and `country="es"`. 21 postal codes end in a space.
- `tcm` is on 1,749 records, all distinct. On the grocery records it is missing once.
  `codsa` is on 1,804 and repeats on 39 values. `codat` is on 1,804 and repeats once. `web` is
  on 1,613, all distinct.
- `Entrega a domicilio` is a feature of 186 hypermarkets, 113 Markets and 279 Express shops.
  `Carrefour Drive` is a feature of 149 hypermarkets and 20 Markets.
- A listing page set the cookie `salepoint=005290||28232|A_DOMICILIO|0` and the page state
  `header.user.sale_point = "005290"`. `/cloud-api/salepoints/v1/` answered `COL PINAR`,
  region `5289`, postal code `28232`.
- `/cloud-api/salepoints/v1/drives` answered 179 sale points in 17 regional groups: 152
  `Drive Hiper`, 23 `Drive Peatón` (Markets), 3 `Drive Mini`, 1 other. Sale point ids and
  store ids are distinct. 168 drives sit at 0 m from a store finder record and the farthest at
  107 m. Their nearest records are 156 hypermarkets, 22 Markets and 1 petrol station.
- Plan `0090` section 2 tested `salepoints/v1/stores-location/es`, which answers one store.
  The XML is another route, and it is what the public store finder uses.

## 9. What OpenStreetMap still does for this chain

- The postal code queue keeps its OpenStreetMap run for every code. A radius still finds
  Carrefour shops of every format as `OSM` places, Express included, under the QID each one
  carries. This plan adds no merge across providers (plan `0107` section 8). An `OSM` place of
  a shop that a `CARREFOUR` place brought in shows that shop as a candidate (plan `0193`).
- OpenStreetMap stays the only source of a shop's outline area (plan `0176`).
- Until the owner allows the Express formats on the row, OpenStreetMap stays the only source
  of Express shops.
- With `listsItsOwnStores` true, the queue also asks Carrefour of every due code. That is one
  browser launch and two loads per code per cooldown period, and a store discovery for
  Carrefour no longer needs a postal code or a radius at the spawn.

## 10. What this plan does not do

- **No price scope per sale point.** The sale point is a tag (section 6.2).
- **No Express under the Carrefour chain by default** (section 5).
- **No opening hours parsed** (section 6.2).
- **No shop page read.** The sitemap's per shop pages add nothing the XML lacks for a place.
- **No change to the walk.** It keeps its one sale point.
- **No run estimate for a Carrefour store discovery.** `DEFAULT_RUN_SECONDS` names no
  `carrefour-web` entry (`run-estimate.ts:18` to `:23`), so the first run shows the default of
  30 minutes until one completes.
- **No admin screen.** The format list lives in `source.config`, which the back office already
  edits as JSON. A form field for it is an admin follow up and needs a mock.

## Tests

- **`stores.spec.ts`**, on `store-locator.xml`:
  - 1,974 records read, and every record is a store or a dropped record,
  - the counts of each format and of each drop reason,
  - the 11 Andorran records are `OUTSIDE_SPAIN`,
  - a trailing space is trimmed from a postal code,
  - the Express CEPSA record with no `tcm` is `NO_REFERENCE`,
  - every `externalRef` is distinct,
  - an entity in an attribute is decoded.
- **`drives.spec.ts`**, on `drives.json` and `store-locator.xml`: 179 drives, `005290` joins to
  `Carrefour El Pinar`, no drive joins to a petrol station, a drive 200 m from every shop joins
  nothing, and an element with no id is skipped.
- **`carrefour.client.spec.ts`**, with a fake session: `readStoreLocator` and `readDrives` go
  through the pacing and the cookie rule, a 403 counts toward the refusal limit, a 200 with no
  `<marker` throws, and `captureText` returns the body verbatim.
- **`carrefour-store-discovery.runner.spec.ts`**, with a client built on the fixtures:
  - the default formats report 365 places with the fields of section 6.2,
  - `storeFormats: ['EXPRESS']` reports the Express shops only,
  - an unknown format refuses the run before a load,
  - a postal code filter reports exactly the shops on that code,
  - a failed drive read adds a warning and the run completes,
  - a `SourceBlockedError` fails the run with `stopReason: SOURCE_BLOCKED` (plan `0215`),
  - the client is closed after a success and after a failure,
  - a run with no chain is refused.
- **`store-discovery.runner.spec.ts`**: `carrefour-web` reaches the new case.
- **Contracts**: `harvest.messages.spec.ts` states `listsItsOwnStores: true` for
  `carrefour-web`.
- **Gateway**: `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

## Acceptance criteria

- [ ] `@portfolio/luna-shopper/carrefour` exports `parseStoreLocator`, `parseDrives`,
      `salePointsByShop` and the two path constants, and adds no dependency.
- [ ] `capture-fixtures` writes `store-locator.xml` and `drives.json` verbatim.
- [ ] Every load of a store run goes through `load`, with the cookie rule and the 2 s floor.
- [ ] A `STORE_DISCOVERY` for the Carrefour chain runs `CarrefourStoreDiscoveryRunner`.
- [ ] With no `storeFormats`, a run reports hypermarkets and Markets only.
- [ ] Every place has provider `CARREFOUR`, its `tcm` as `externalRef`, and `scopeKey` null.
- [ ] A hypermarket or Market with a drive carries `carrefour:salePoint`.
- [ ] Every record left out by the parser is in the report with its reason.
- [ ] The browser is closed after every run.
- [ ] `ADAPTER_CAPABILITIES['carrefour-web'].listsItsOwnStores` is true.
- [ ] `openapi.json` and `wire-types.ts` are regenerated.

## Verification

```sh
npx nx test luna-shopper/carrefour
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

The live check, on an ephemeral slot that a person starts (not the agent): enable the
Carrefour source row there with `autoImportPlaces` false, start a `STORE_DISCOVERY` for the
Carrefour chain with no postal code, and read the report. Expect two loads, 1,974 records
read, 365 places, and about 178 places with a sale point. Then start one for postal code
`14011` and expect `Carrefour La Sierra` alone.

## Decisions

Chosen in this plan, and open to the owner's correction:

- **The reference is `tcm`** (section 6.2). A record with none is dropped and named.
- **The default formats are hypermarket and Market** (section 5).
- **Outlets, travel agencies and petrol stations are not grocery** and are dropped.
- **Andorra is dropped**, because its postal codes are not Spanish and the record's country is
  wrong.
- **The sale point is a tag joined by position within 150 m**, and declares nothing.
- **A failed drive read does not fail the run.** A refusal does.
- **The hours are tags.** They carry no label to parse against.

**Owner** (ask, do not choose):

1. **Are Carrefour Express shops part of the Carrefour chain in the catalog?** If yes, the row
   lists `EXPRESS` and `EXPRESS_CEPSA` and their 1,219 Spanish records reach the queue under the
   Carrefour chain. If they are a chain of their own, a second `Supermarket` and a store run per
   chain are needed, and this plan does not build that.
2. **Is the postal code queue to ask Carrefour of every due code?** Turning
   `listsItsOwnStores` on does that, at one browser launch per code per cooldown period. The
   alternative is a second capability that frees the spawn and keeps the queue out.
3. **Does the owner want per sale point prices measured?** This plan finds that the walk reads
   the El Pinar hypermarket's online prices and names the 179 shops that have a sale point. A
   plan that compares two sale points would decide whether Carrefour needs a scope per sale
   point.
