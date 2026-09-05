import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * What the harvester screens show with nothing listening.
 *
 * Every data domain in this workspace ships an in-memory implementation, and
 * this one carries more weight than most: the harvester is switched off in both
 * clusters on purpose (plan 0006, section 4), so for anybody who is not sitting
 * in front of the compose stack this seed is the only version of these screens
 * that ever renders.
 *
 * So it is built to exercise the states the screens exist for rather than to
 * look tidy. One run still going with a known total, one that failed for a
 * reason this app cannot translate, one aborted. Places that are near duplicates
 * of each other, which is the case the review queue is for. A ref whose source is
 * gone beside one that was never resolved.
 */

/** Fixed, so that a spec asserting on a row can name it. */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

const NOW = '2026-09-03T10:00:00.000Z';

export const HARVEST_RUN_SEED: readonly Wire.HarvestHarvestRunView[] = [
  {
    id: 'run-catalog-running',
    supermarketId: MERCADONA,
    sourceId: 'source-mercadona',
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'RUNNING',
    requestedAt: '2026-09-03T09:42:00.000Z',
    startedAt: '2026-09-03T09:42:04.000Z',
    finishedAt: null,
    heartbeatAt: NOW,
    totalPlanned: 4383,
    processed: 1907,
    created: 812,
    updated: 640,
    unchanged: 401,
    notFound: 38,
    skipped: 0,
    failed: 16,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: 'seed-correlation-1',
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
  },
  {
    // A failure this app cannot explain, which is the common case and the one
    // the run screen shows in the server's own words. It used to be a storefront
    // refusal; backend plan 0083 deleted the variable that produced one, and a
    // chain that is switched off is now refused at the spawn and never becomes a
    // run at all.
    id: 'run-catalog-failed',
    supermarketId: MERCADONA,
    sourceId: 'source-mercadona',
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'FAILED',
    requestedAt: '2026-09-02T18:10:00.000Z',
    startedAt: '2026-09-02T18:10:02.000Z',
    finishedAt: '2026-09-02T18:10:02.000Z',
    heartbeatAt: '2026-09-02T18:10:02.000Z',
    totalPlanned: null,
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    skipped: 0,
    failed: 0,
    stage: null,
    stageLabel: null,
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: 'The storefront stopped answering after 41 requests (ECONNRESET).',
    report: {},
    correlationId: 'seed-correlation-2',
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
  },
  {
    // A run whose prices were taken back (backend plan 0082). It is here so the
    // reverted chip and the reverted state of the run screen render with
    // nothing listening, which for these screens is the usual case.
    //
    // Its status is still COMPLETED, and that is the point rather than an
    // oversight: the status says how the run ended and a revert does not change
    // that, so the row carries two chips.
    id: 'run-catalog-reverted',
    supermarketId: CARREFOUR,
    sourceId: 'source-carrefour',
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'COMPLETED',
    requestedAt: '2026-08-31T07:00:00.000Z',
    startedAt: '2026-08-31T07:00:05.000Z',
    finishedAt: '2026-08-31T07:18:44.000Z',
    heartbeatAt: '2026-08-31T07:18:44.000Z',
    totalPlanned: 1204,
    processed: 1204,
    created: 214,
    updated: 0,
    unchanged: 981,
    notFound: 9,
    skipped: 0,
    failed: 0,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: 'seed-correlation-4',
    requestedByUserId: null,
    revertedAt: '2026-09-01T11:20:00.000Z',
    revertedByUserId: '44444444-4444-4444-8444-444444444444',
    revertedPriceCount: 214,
  },
  {
    // A finished run of a price writing mode that still stands, so the revert
    // control on the run screen has something to appear on.
    id: 'run-refresh-completed',
    supermarketId: MERCADONA,
    sourceId: 'source-mercadona',
    mode: 'REFRESH',
    trigger: 'MANUAL',
    status: 'COMPLETED',
    requestedAt: '2026-09-02T06:00:00.000Z',
    startedAt: '2026-09-02T06:00:02.000Z',
    finishedAt: '2026-09-02T06:09:31.000Z',
    heartbeatAt: '2026-09-02T06:09:31.000Z',
    totalPlanned: 4232,
    processed: 4232,
    created: 118,
    updated: 0,
    unchanged: 4092,
    notFound: 22,
    skipped: 0,
    failed: 0,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    warnings: [],
    documentSha256: null,
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: 'seed-correlation-5',
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
  },
  {
    id: 'run-store-aborted',
    supermarketId: null,
    sourceId: null,
    mode: 'STORE_DISCOVERY',
    trigger: 'MANUAL',
    status: 'ABORTED',
    requestedAt: '2026-09-01T08:00:00.000Z',
    startedAt: '2026-09-01T08:00:03.000Z',
    finishedAt: '2026-09-01T08:14:11.000Z',
    heartbeatAt: '2026-09-01T08:14:11.000Z',
    totalPlanned: 812,
    processed: 344,
    created: 61,
    updated: 0,
    unchanged: 283,
    notFound: 0,
    skipped: 0,
    failed: 0,
    stage: 'query-overpass',
    stageLabel: 'Querying OpenStreetMap',
    warnings: [],
    documentSha256: null,
    abortRequestedAt: '2026-09-01T08:13:52.000Z',
    error: null,
    report: {},
    correlationId: 'seed-correlation-3',
    requestedByUserId: null,
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
  },
  {
    /**
     * A leaflet import that finished (backend plan 0081; admin plan 0010,
     * section 5).
     *
     * The run whose warnings the run screen exists to draw, and the one no
     * crawl can stand in for: it has a `documentSha256`, a `skipped` count, and
     * one warning per decision it made without asking. `sourceId` is null and
     * always is, because an upload fetches nothing and a chain that publishes
     * only leaflets has no source row at all.
     *
     * The four codes here are the four an operator has to be able to tell
     * apart. A loyalty gated tile was dropped, a second unit tile with no
     * single unit price was queued rather than written at a price nobody can
     * pay for one, a string the owner already rejected was skipped without
     * being asked again, and the extractor's own lost tile is carried through
     * so that what the extractor lost and what the import dropped are read in
     * one table.
     */
    id: 'run-leaflet-completed',
    supermarketId: DEZA,
    sourceId: null,
    mode: 'LEAFLET_IMPORT',
    trigger: 'MANUAL',
    status: 'COMPLETED',
    requestedAt: '2026-09-03T07:20:00.000Z',
    startedAt: '2026-09-03T07:20:01.000Z',
    finishedAt: '2026-09-03T07:20:09.000Z',
    heartbeatAt: '2026-09-03T07:20:09.000Z',
    totalPlanned: 48,
    processed: 48,
    created: 31,
    updated: 0,
    unchanged: 6,
    // Offers put in front of a person, which is what the queue link counts.
    notFound: 5,
    // Offers a rule dropped, which is what the fourth counter is for.
    skipped: 6,
    failed: 0,
    stage: null,
    stageLabel: null,
    warnings: [
      {
        code: 'LOYALTY_REQUIRED',
        offerId: 'p36-o01',
        page: 36,
        name: 'Champu Elvive 380 ml.',
        message:
          'Skipped: the price is for loyalty card holders (descuentos ifamilia).',
      },
      {
        code: 'CONDITIONAL_PRICE',
        offerId: 'p05-o07',
        page: 5,
        name: 'Cerveza Radler Cruzcampo lata 33 cl.',
        message:
          'Queued: the headline price is the second unit and the tile states no single unit price.',
      },
      {
        code: 'REJECTED_ALIAS',
        offerId: 'p31-o04',
        page: 31,
        name: 'Lote degustacion 60 aniversario',
        message:
          'Skipped: this printed name was rejected on an earlier import.',
      },
      {
        code: 'EXTRACTOR',
        offerId: null,
        page: 2,
        name: null,
        message: 'tile has no readable price',
      },
    ],
    documentSha256:
      'f62fa7ac367008e1dd00871292e9b6be1b5d1c8cca840c40a6541cec3a58f2ea',
    abortRequestedAt: null,
    error: null,
    report: {},
    correlationId: 'seed-correlation-4',
    requestedByUserId: null,
    // Standing, not reverted (backend plan 0082). It has to be: the dedupe
    // index ignores a reverted run, so a reverted seed run would let the same
    // document be imported again and the upload screen's 409 would be
    // unreachable with nothing listening.
    revertedAt: null,
    revertedByUserId: null,
    revertedPriceCount: null,
  },
];

/**
 * The printed names one chain's leaflets could not resolve (backend plan 0081,
 * sections 2 and 3; admin plan 0010, section 3).
 *
 * Every row here is a question only a person can answer, because **no automated
 * path ever binds a printed name to a product**. A fuzzy hit inserts a
 * `CANDIDATE` and writes no price; a miss inserts an `UNRESOLVED`. So the seed
 * carries one of each, which are the two shapes of the queue: a row with a
 * product to agree with, and a row with nothing to agree with at all.
 *
 * The third row is a rejection, which the queue does not show and which exists
 * so that a spec asking for `REJECTED` by name finds one. The fourth is
 * `ACTIVE`, an alias somebody has already accepted, which is what a resolved
 * name looks like once it stops being a question.
 *
 * The offer columns are the leaflet's own numbers, carried on the alias from
 * the run's stored document so the queue can show what the row was queued for
 * without re-reading a 300 KB document per row.
 */
export const SOURCE_ALIAS_SEED: readonly Wire.HarvestSourceAliasView[] = [
  {
    id: 'alias-radler',
    supermarketId: DEZA,
    aliasKey: 'cerveza radler cruzcampo|lata 33 cl',
    printedName: 'Cerveza Radler Cruzcampo',
    printedFormat: 'lata 33 cl.',
    printedBrand: 'Cruzcampo',
    itemId: null,
    // Nothing in the catalog looked like it, so there is nothing to agree with
    // and the operator either finds the product or creates it.
    candidateItemId: null,
    candidateEntryId: null,
    status: 'UNRESOLVED',
    matchedBy: 'NAME_SIZE',
    confidence: 0,
    timesSeen: 1,
    firstSeenAt: '2026-09-03T07:20:05.000Z',
    lastSeenAt: '2026-09-03T07:20:05.000Z',
    firstRunId: 'run-leaflet-completed',
    lastRunId: 'run-leaflet-completed',
    offerPrice: 0.79,
    offerCurrency: 'EUR',
    offerUnitPrice: 1.97,
    offerUnitPriceLabel: 'l',
    offerPage: 5,
    offerRawText: ['-50% 2a Unidad', 'la segunda unidad le sale a: 0,39 EUR'],
    offerConfidence: 0.97,
  },
  {
    // The fuzzy rung proposed a product and stopped there, which is the rule
    // and the reason: a bad match writes a wrong price onto a real product that
    // people then shop on, which is worse than having no price.
    id: 'alias-aceite',
    supermarketId: DEZA,
    aliasKey: 'aceite de oliva virgen serie oro coosur|garrafa 5 litros',
    printedName: 'Aceite de Oliva Virgen Serie Oro Coosur',
    printedFormat: 'Garrafa 5 litros',
    printedBrand: 'Coosur',
    itemId: null,
    candidateItemId: 'item-milk',
    candidateEntryId: null,
    status: 'CANDIDATE',
    matchedBy: 'NAME_SIZE',
    confidence: 0.81,
    timesSeen: 3,
    firstSeenAt: '2026-08-14T07:00:00.000Z',
    lastSeenAt: '2026-09-03T07:20:05.000Z',
    firstRunId: 'run-leaflet-completed',
    lastRunId: 'run-leaflet-completed',
    offerPrice: 19.95,
    offerCurrency: 'EUR',
    offerUnitPrice: 3.99,
    offerUnitPriceLabel: 'l',
    offerPage: 1,
    offerRawText: [],
    offerConfidence: 0.97,
  },
  {
    // Not a product he tracks. The row stays rather than being deleted, so the
    // next leaflet that prints the string skips it with a warning.
    id: 'alias-rejected',
    supermarketId: DEZA,
    aliasKey: 'lote degustacion 60 aniversario|',
    printedName: 'Lote degustacion 60 aniversario',
    printedFormat: null,
    printedBrand: null,
    itemId: null,
    candidateItemId: null,
    candidateEntryId: null,
    status: 'REJECTED',
    matchedBy: 'MANUAL',
    confidence: 1,
    timesSeen: 2,
    firstSeenAt: '2026-08-14T07:00:00.000Z',
    lastSeenAt: '2026-09-03T07:20:05.000Z',
    firstRunId: 'run-leaflet-completed',
    lastRunId: 'run-leaflet-completed',
    offerPrice: null,
    offerCurrency: null,
    offerUnitPrice: null,
    offerUnitPriceLabel: null,
    offerPage: 31,
    offerRawText: [],
    offerConfidence: null,
  },
  {
    // Accepted, and still carrying what the leaflet printed. Renaming the
    // product does not stop the next leaflet resolving, which is the whole
    // point of storing the printed name rather than the catalog's.
    id: 'alias-leche',
    supermarketId: DEZA,
    aliasKey: 'leche entera hacendado|brik 1 l',
    printedName: 'LECHE ENTERA HACENDADO',
    printedFormat: 'brik 1 l.',
    printedBrand: 'Hacendado',
    itemId: 'item-milk',
    candidateItemId: null,
    candidateEntryId: null,
    status: 'ACTIVE',
    matchedBy: 'MANUAL',
    confidence: 1,
    timesSeen: 7,
    firstSeenAt: '2026-06-02T07:00:00.000Z',
    lastSeenAt: '2026-09-03T07:20:05.000Z',
    firstRunId: 'run-leaflet-completed',
    lastRunId: 'run-leaflet-completed',
    offerPrice: 0.89,
    offerCurrency: 'EUR',
    offerUnitPrice: 0.89,
    offerUnitPriceLabel: 'l',
    offerPage: 31,
    offerRawText: [],
    offerConfidence: 0.99,
  },
];

/**
 * Two places on the same street corner, which is the whole reason this queue
 * exists. A place matching neither the provider ref nor the same brand within
 * fifty metres is offered as new, so near duplicates arrive as two rows and only
 * a person can say whether they are one shop.
 */
export const DISCOVERED_PLACE_SEED: readonly Wire.HarvestDiscoveredPlaceView[] =
  [
    {
      id: 'place-dia-1',
      runId: 'run-store-aborted',
      provider: 'osm',
      externalRef: 'node/1234567',
      brandKey: 'Q925132',
      brandName: 'Dia',
      name: 'Dia Market',
      latitude: 40.4168,
      longitude: -3.7038,
      street: 'Calle Mayor 14',
      city: 'Madrid',
      postalCode: '28013',
      country: 'ES',
      website: 'https://www.dia.es',
      openingHours: 'Mo-Sa 09:00-21:30',
      tags: { shop: 'supermarket', brand: 'Dia' },
      status: 'NEW',
      supermarketLocationId: null,
      firstSeenAt: '2026-09-01T08:02:00.000Z',
      lastSeenAt: '2026-09-01T08:02:00.000Z',
    },
    {
      id: 'place-dia-2',
      runId: 'run-store-aborted',
      provider: 'osm',
      externalRef: 'node/7654321',
      brandKey: 'Q925132',
      brandName: 'Dia',
      name: 'Maxi Dia',
      latitude: 40.4169,
      longitude: -3.7039,
      street: 'Calle Mayor 16',
      city: 'Madrid',
      postalCode: '28013',
      country: 'ES',
      website: null,
      openingHours: null,
      tags: { shop: 'supermarket', brand: 'Maxi Dia' },
      status: 'NEW',
      supermarketLocationId: null,
      firstSeenAt: '2026-09-01T08:02:00.000Z',
      lastSeenAt: '2026-09-01T08:02:00.000Z',
    },
    {
      id: 'place-carrefour-1',
      runId: 'run-store-aborted',
      provider: 'osm',
      externalRef: 'way/998877',
      brandKey: 'Q217599',
      brandName: 'Carrefour Express',
      name: 'Carrefour Express',
      latitude: 40.42,
      longitude: -3.71,
      street: 'Gran Via 30',
      city: 'Madrid',
      postalCode: null,
      country: 'ES',
      website: null,
      openingHours: 'Mo-Su 08:00-22:00',
      tags: { shop: 'convenience', brand: 'Carrefour Express' },
      status: 'NEW',
      supermarketLocationId: null,
      firstSeenAt: '2026-09-01T08:03:00.000Z',
      lastSeenAt: '2026-09-01T08:03:00.000Z',
    },
  ];

export const SOURCE_ENTRY_SEED: readonly Wire.HarvestSourceCatalogEntryView[] =
  [
    {
      id: 'entry-milk',
      supermarketId: MERCADONA,
      externalId: '12345',
      name: 'Leche entera',
      brand: 'Hacendado',
      ean: '8480000123456',
      unitSize: 1,
      sizeFormat: '1 L',
      price: 0.89,
      unitPrice: 0.89,
      unitPriceLabel: 'per litre',
      categoryPath: ['Lacteos', 'Leche'],
      url: 'https://tienda.mercadona.es/product/12345',
      lastSeenAt: NOW,
    },
    {
      id: 'entry-bread',
      supermarketId: MERCADONA,
      externalId: '23456',
      name: 'Pan de molde integral',
      brand: 'Hacendado',
      ean: null,
      unitSize: 460,
      sizeFormat: '460 g',
      price: 1.25,
      unitPrice: 2.72,
      unitPriceLabel: 'per kilo',
      categoryPath: ['Panaderia'],
      url: null,
      lastSeenAt: NOW,
    },
  ];

/**
 * One ref that was never resolved beside one whose source has gone.
 *
 * They are different problems with different remedies, which is why the queue
 * has to be able to tell them apart: a `CANDIDATE` came from a fuzzy name match
 * and is waiting for somebody to agree, while a ref whose product has vanished
 * from the storefront cannot be confirmed by anybody.
 *
 * The second is `lastResolvedAt` set and `lastSeenAt` no newer than it, which is
 * what a settled ref that has stopped appearing looks like. There is no `GONE`
 * status to seed: `ItemSourceRefStatus` is ACTIVE, CANDIDATE, REJECTED and
 * MANUAL, so the state is derived rather than stored.
 */
export const ITEM_SOURCE_REF_SEED: readonly Wire.HarvestItemSourceRefView[] = [
  {
    id: 'ref-candidate',
    itemId: 'item-milk',
    supermarketId: MERCADONA,
    externalId: '12345',
    externalUrl: 'https://tienda.mercadona.es/product/12345',
    matchedBy: 'NAME_BRAND_SIZE',
    status: 'CANDIDATE',
    confidence: 0.72,
    lastResolvedAt: null,
    lastSeenAt: NOW,
  },
  {
    id: 'ref-gone',
    itemId: 'item-bread',
    supermarketId: MERCADONA,
    externalId: '23456',
    externalUrl: null,
    matchedBy: 'EAN',
    status: 'CANDIDATE',
    confidence: 0.94,
    lastResolvedAt: '2026-08-01T09:00:00.000Z',
    lastSeenAt: '2026-08-01T09:00:00.000Z',
  },
];

/**
 * The shops one source names, in every state the queue draws (backend plan
 * 0084, section 6; admin plan 0011).
 *
 * Shaped after DEZA, which is the chain the table was built for: it labels each
 * shop `T1` to `T7`, `C1`, `C2` and `Z1` in its markup and prints a street name
 * beside it, and it publishes eighteen centres of which only ten sell anything.
 * So the fixture carries a shop the automatic name match bound, one a person
 * bound, two nobody has decided yet, and one that is a bakery.
 *
 * The addresses of the two mapped rows are the addresses in `LOCATION_SEED`, so
 * an operator clicking through the mapping picker with nothing listening finds
 * a shop whose printed name really does look like one of ours.
 */
export const SOURCE_LOCATION_SEED: readonly Wire.HarvestSourceLocationView[] = [
  {
    id: 'shop-t1',
    supermarketId: MERCADONA,
    externalId: 'T1',
    printedName: 'Ronda del Marrubial',
    supermarketLocationId: null,
    status: 'UNMAPPED',
    // Nothing bound it, and `NAME_SIZE` is what the automatic attempt is called
    // whether or not it hit. An `UNMAPPED` row's `matchedBy` says which rule was
    // tried, not which one succeeded.
    matchedBy: 'NAME_SIZE',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: NOW,
    firstRunId: 'run-store-aborted',
    lastRunId: 'run-catalog-running',
  },
  {
    id: 'shop-t2',
    supermarketId: MERCADONA,
    externalId: 'T2',
    printedName: 'Polígono de las Quemadas',
    supermarketLocationId: null,
    status: 'UNMAPPED',
    matchedBy: 'NAME_SIZE',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: NOW,
    firstRunId: 'run-store-aborted',
    lastRunId: 'run-catalog-running',
  },
  {
    // The exact name match, which is the only automatic one there is. It bound
    // itself and nobody has checked it, which is what the column exists to say.
    id: 'shop-c1',
    supermarketId: MERCADONA,
    externalId: 'C1',
    printedName: 'Avenida del Gran Capitán 12',
    supermarketLocationId: 'loc_cordoba_centro',
    status: 'ACTIVE',
    matchedBy: 'NAME_SIZE',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: NOW,
    firstRunId: 'run-store-aborted',
    lastRunId: 'run-catalog-running',
  },
  {
    // Bound by a person, which is the same green badge and a different
    // confidence. A queue that showed only the badge would hide the difference.
    id: 'shop-c2',
    supermarketId: MERCADONA,
    externalId: 'C2',
    printedName: 'Centro Comercial Zahira',
    supermarketLocationId: 'loc_cordoba_oeste',
    status: 'ACTIVE',
    matchedBy: 'MANUAL',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: NOW,
    firstRunId: 'run-store-aborted',
    lastRunId: 'run-catalog-running',
  },
  {
    // A place the source lists that we do not sell from. Marking it is a
    // person's act and a run never does it.
    id: 'shop-z1',
    supermarketId: MERCADONA,
    externalId: 'Z1',
    printedName: 'Obrador de panadería',
    supermarketLocationId: null,
    status: 'IGNORED',
    matchedBy: 'NAME_SIZE',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: '2026-08-30T08:00:00.000Z',
    firstRunId: 'run-store-aborted',
    lastRunId: 'run-store-aborted',
  },
  {
    // Another chain entirely, so a spec asserting the queue is chain scoped has
    // a row it must not see.
    id: 'shop-carrefour-1',
    supermarketId: CARREFOUR,
    externalId: '0421',
    printedName: 'Carrefour Sierra',
    supermarketLocationId: null,
    status: 'UNMAPPED',
    matchedBy: 'NAME_SIZE',
    firstSeenAt: '2026-08-28T08:00:00.000Z',
    lastSeenAt: NOW,
    firstRunId: null,
    lastRunId: null,
  },
];

export const SUPERMARKET_SOURCE_SEED: readonly Wire.HarvestSupermarketSourceView[] =
  [
    {
      id: 'source-mercadona',
      supermarketId: MERCADONA,
      adapterKey: 'mercadona-api',
      enabled: true,
      config: { postalCode: '28013' },
      workers: 4,
      maxRequestsPerSecond: 4,
      lastRunAt: '2026-09-03T09:42:04.000Z',
      lastSuccessAt: '2026-08-30T22:11:00.000Z',
      consecutiveFailures: 1,
    },
    {
      // The second storefront (backend plan 0085), off like every other source
      // row until somebody turns it on. It carries no `postalCode`: DEZA prices
      // nothing and scopes nothing, and what a run of it produces is candidate
      // products and per shop availability.
      id: 'source-deza',
      supermarketId: DEZA,
      adapterKey: 'deza-web',
      enabled: false,
      config: {},
      workers: 4,
      maxRequestsPerSecond: 4,
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    },
    {
      id: 'source-carrefour',
      supermarketId: CARREFOUR,
      adapterKey: 'manual',
      enabled: false,
      config: {},
      workers: 1,
      maxRequestsPerSecond: 1,
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    },
  ];
