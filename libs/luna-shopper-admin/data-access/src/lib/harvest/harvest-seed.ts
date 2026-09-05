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

/**
 * The scopes a price belongs to, fixed so a spec can name one.
 *
 * A price row is keyed on (`entryId`, `priceScopeId`) since backend plan 0086
 * section 3.2, so a seed that wanted to show two regional leaflets on one
 * product needed two scopes to point at.
 */
const MERCADONA_NATIONAL = '55555555-5555-4555-8555-555555555551';
const DEZA_NATIONAL = '55555555-5555-4555-8555-555555555552';
const DEZA_CORDOBA = '55555555-5555-4555-8555-555555555553';

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
    // A finished walk that still stands, so the revert control and the export
    // action on the run screen both have something to appear on.
    //
    // It used to be a `REFRESH`, which was the mode that existed only because a
    // walk threw its prices away. A walk writes them now (backend plan 0086), so
    // the mode is gone and this is the walk itself.
    id: 'run-catalog-completed',
    supermarketId: MERCADONA,
    sourceId: 'source-mercadona',
    mode: 'CATALOG_DISCOVERY',
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
     * A file import that finished (backend plan 0086, section 6; admin plan
     * 0010, section 5).
     *
     * The run whose warnings the run screen exists to draw, and the one no
     * crawl can stand in for: it has a `documentSha256`, a `skipped` count, and
     * one warning per decision it made without asking. `sourceId` is null and
     * always is, because an upload fetches nothing and a chain that publishes
     * only leaflets has no source row at all.
     *
     * The loyalty and conditional price codes are gone with the rules that
     * wrote them (backend plan 0086, section 6.1): those rules belong to the
     * producer now, and a producer's warning arrives as text under `EXTRACTOR`.
     * What is left is what the import itself decides, plus the producer's own
     * lost tile, so that what the producer lost and what the import dropped are
     * read in one table.
     */
    id: 'run-import-completed',
    supermarketId: DEZA,
    sourceId: null,
    mode: 'FILE_IMPORT',
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
        code: 'DUPLICATE_KEY',
        offerId: 'p12-o03',
        page: 12,
        name: 'Leche entera Hacendado brik 1 l.',
        message: 'Two products in this document share one key. The second won.',
      },
      {
        code: 'NO_MATCH',
        offerId: 'p05-o07',
        page: 5,
        name: 'Cerveza Radler Cruzcampo lata 33 cl.',
        message: 'Queued: nothing in the catalog looked like this.',
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

/**
 * The one queue, in every shape it draws (backend plan 0086, section 3; admin
 * plan 0014, section 1).
 *
 * Three seeds used to sit here: entries a walk found, refs it proposed, and
 * aliases a leaflet queued. `0086` folded the three tables into one with a
 * status column, so this is the only one left, and every shape those three used
 * to carry has to be in it.
 *
 * What the rows are for, in order. A walk's product that nothing matched, with
 * an API price, which is the plain `UNRESOLVED`. A walk's product the fuzzy rung
 * proposed an item for, which is the row an operator confirms in one press. A
 * leaflet row with **two** scopes, which is the whole reason the prices moved
 * off the row: two regional leaflets print one product and each price belongs to
 * its own scope. A DEZA web row with **no price at all**, which is the truth for
 * that chain and must read as a statement rather than as a blank. A leaflet row
 * whose proposal is a **sibling row** rather than an item, which is the one case
 * whose primary action is to open something else. Then a rejection and an
 * acceptance, so a filter asking for either by name finds one.
 */
export const SOURCE_ENTRY_SEED: readonly Wire.HarvestSourceCatalogEntryView[] =
  [
    {
      id: 'entry-milk',
      supermarketId: MERCADONA,
      externalId: '12345',
      sourceKind: 'OFFICIAL_API',
      name: 'Leche entera',
      brand: 'Hacendado',
      ean: '8480000123456',
      unitSize: 1,
      sizeFormat: '1 L',
      categoryPath: ['Lacteos', 'Leche'],
      url: 'https://tienda.mercadona.es/product/12345',
      extra: { packaging: 'brik', published: true },
      timesSeen: 4,
      firstSeenAt: '2026-08-14T07:00:00.000Z',
      lastSeenAt: NOW,
      firstRunId: 'run-catalog-completed',
      lastRunId: 'run-catalog-completed',
      itemId: null,
      candidateEntryId: null,
      status: 'UNRESOLVED',
      matchedBy: null,
      confidence: 0,
      decidedAt: null,
      prices: [
        {
          id: 'price-milk-national',
          priceScopeId: MERCADONA_NATIONAL,
          price: 0.89,
          currency: 'EUR',
          unitPrice: 0.89,
          unitPriceLabel: 'l',
          validFrom: null,
          validUntil: null,
          details: null,
          observedAt: NOW,
          runId: 'run-catalog-completed',
        },
      ],
    },
    {
      // The fuzzy rung proposed a product and stopped there, which is the rule
      // and the reason: a bad match writes a wrong price onto a real product
      // that people then shop on, which is worse than having no price.
      id: 'entry-bread',
      supermarketId: MERCADONA,
      externalId: '23456',
      sourceKind: 'OFFICIAL_API',
      name: 'Pan de molde integral',
      brand: 'Hacendado',
      ean: null,
      unitSize: 460,
      sizeFormat: '460 g',
      categoryPath: ['Panaderia'],
      url: null,
      extra: null,
      timesSeen: 9,
      firstSeenAt: '2026-07-01T07:00:00.000Z',
      lastSeenAt: NOW,
      firstRunId: 'run-catalog-completed',
      lastRunId: 'run-catalog-completed',
      itemId: 'item-bread',
      candidateEntryId: null,
      status: 'CANDIDATE',
      matchedBy: 'NAME_BRAND_SIZE',
      confidence: 0.6,
      decidedAt: null,
      prices: [
        {
          id: 'price-bread-national',
          priceScopeId: MERCADONA_NATIONAL,
          price: 1.25,
          currency: 'EUR',
          unitPrice: 2.72,
          unitPriceLabel: 'kg',
          validFrom: null,
          validUntil: null,
          details: null,
          observedAt: NOW,
          runId: 'run-catalog-completed',
        },
      ],
    },
    {
      // Two regional leaflets printed the same product, so the row carries two
      // prices and the queue draws a line per scope. This is what the columns
      // that used to sit on the row could not express.
      id: 'entry-aceite',
      supermarketId: DEZA,
      externalId: 'aceite-de-oliva-virgen-serie-oro-coosur|garrafa 5 litros',
      sourceKind: 'OFFICIAL_LEAFLET',
      name: 'Aceite de Oliva Virgen Serie Oro Coosur',
      brand: 'Coosur',
      ean: null,
      unitSize: 5,
      sizeFormat: 'Garrafa 5 litros',
      categoryPath: [],
      url: null,
      extra: {
        page: 1,
        promotion: null,
        raw_text: ['Garrafa 5 litros', 'PVP recomendado'],
      },
      timesSeen: 3,
      firstSeenAt: '2026-08-14T07:00:00.000Z',
      lastSeenAt: '2026-09-03T07:20:05.000Z',
      firstRunId: 'run-import-completed',
      lastRunId: 'run-import-completed',
      itemId: null,
      candidateEntryId: null,
      status: 'UNRESOLVED',
      matchedBy: null,
      confidence: 0,
      decidedAt: null,
      prices: [
        {
          id: 'price-aceite-national',
          priceScopeId: DEZA_NATIONAL,
          price: 19.95,
          currency: 'EUR',
          unitPrice: 3.99,
          unitPriceLabel: 'l',
          validFrom: '2026-09-10T00:00:00.000Z',
          validUntil: '2026-09-23T22:59:59.000Z',
          details: { page: 1 },
          observedAt: '2026-09-03T07:20:05.000Z',
          runId: 'run-import-completed',
        },
        {
          id: 'price-aceite-cordoba',
          priceScopeId: DEZA_CORDOBA,
          price: 18.95,
          currency: 'EUR',
          unitPrice: 3.79,
          unitPriceLabel: 'l',
          validFrom: '2026-09-10T00:00:00.000Z',
          validUntil: '2026-09-23T22:59:59.000Z',
          details: { page: 1 },
          observedAt: '2026-09-03T07:20:05.000Z',
          runId: 'run-import-completed',
        },
      ],
    },
    {
      // DEZA prints no price anywhere on its site, so a web row genuinely has
      // none (backend plan 0085). The queue says so rather than showing a blank,
      // because an operator who accepts this row and sees nothing written must
      // not read that as a failure.
      id: 'entry-galletas',
      supermarketId: DEZA,
      externalId: 'galletas-maria-cuetara|paquete-800-g',
      sourceKind: 'OFFICIAL_WEB',
      name: 'Galletas Maria Cuetara',
      brand: 'Cuetara',
      ean: null,
      unitSize: 800,
      sizeFormat: 'Paquete 800 g',
      categoryPath: ['Dulces', 'Galletas'],
      url: 'https://www.deza.es/producto/galletas-maria-cuetara',
      extra: { shops: ['T1', 'T4', 'C2'] },
      timesSeen: 2,
      firstSeenAt: '2026-08-28T07:00:00.000Z',
      lastSeenAt: '2026-09-02T07:00:00.000Z',
      firstRunId: 'run-catalog-reverted',
      lastRunId: 'run-catalog-reverted',
      itemId: null,
      candidateEntryId: null,
      status: 'UNRESOLVED',
      matchedBy: null,
      confidence: 0,
      decidedAt: null,
      prices: [],
    },
    {
      // The proposal is another row of this chain rather than a product. The
      // sibling is the one with the EAN, so it is the one to create the item
      // from, which is why the primary action here opens it instead.
      id: 'entry-leche-leaflet',
      supermarketId: MERCADONA,
      externalId: 'leche-entera-hacendado|brik-1-l',
      sourceKind: 'OFFICIAL_LEAFLET',
      name: 'LECHE ENTERA HACENDADO',
      brand: 'Hacendado',
      ean: null,
      unitSize: 1,
      sizeFormat: 'brik 1 l.',
      categoryPath: [],
      url: null,
      extra: { page: 31, raw_text: ['LECHE ENTERA HACENDADO brik 1 l.'] },
      timesSeen: 7,
      firstSeenAt: '2026-06-02T07:00:00.000Z',
      lastSeenAt: '2026-09-03T07:20:05.000Z',
      firstRunId: 'run-import-completed',
      lastRunId: 'run-import-completed',
      itemId: null,
      candidateEntryId: 'entry-milk',
      status: 'CANDIDATE',
      matchedBy: 'NAME_SIZE',
      confidence: 0.6,
      decidedAt: null,
      prices: [
        {
          id: 'price-leche-leaflet',
          priceScopeId: MERCADONA_NATIONAL,
          price: 0.79,
          currency: 'EUR',
          unitPrice: 0.79,
          unitPriceLabel: 'l',
          validFrom: '2026-09-10T00:00:00.000Z',
          validUntil: '2026-09-23T22:59:59.000Z',
          details: { page: 31 },
          observedAt: '2026-09-03T07:20:05.000Z',
          runId: 'run-import-completed',
        },
      ],
    },
    {
      // Not a product he tracks. The row stays rather than being deleted, so
      // the next run that observes the key touches it and asks nobody.
      id: 'entry-lote',
      supermarketId: DEZA,
      externalId: 'lote-degustacion-60-aniversario|',
      sourceKind: 'OFFICIAL_LEAFLET',
      name: 'Lote degustacion 60 aniversario',
      brand: null,
      ean: null,
      unitSize: null,
      sizeFormat: null,
      categoryPath: [],
      url: null,
      extra: { page: 31 },
      timesSeen: 2,
      firstSeenAt: '2026-08-14T07:00:00.000Z',
      lastSeenAt: '2026-09-03T07:20:05.000Z',
      firstRunId: 'run-import-completed',
      lastRunId: 'run-import-completed',
      itemId: null,
      candidateEntryId: null,
      status: 'REJECTED',
      matchedBy: 'MANUAL',
      confidence: 1,
      decidedAt: '2026-09-03T09:00:00.000Z',
      prices: [],
    },
    {
      // Accepted, and still carrying what the source printed. Renaming the
      // product does not stop the next run resolving, which is the whole point
      // of keeping the chain's own name (backend plan 0086, D8).
      id: 'entry-agua',
      supermarketId: DEZA,
      externalId: 'agua-mineral-lanjaron|garrafa-5-l',
      sourceKind: 'OFFICIAL_WEB',
      name: 'Agua mineral Lanjaron',
      brand: 'Lanjaron',
      ean: null,
      unitSize: 5,
      sizeFormat: 'Garrafa 5 l',
      categoryPath: ['Bebidas', 'Agua'],
      url: null,
      extra: null,
      timesSeen: 11,
      firstSeenAt: '2026-06-02T07:00:00.000Z',
      lastSeenAt: '2026-09-02T07:00:00.000Z',
      firstRunId: 'run-catalog-reverted',
      lastRunId: 'run-catalog-reverted',
      itemId: 'item-water',
      candidateEntryId: null,
      status: 'ACTIVE',
      matchedBy: 'MANUAL',
      confidence: 1,
      decidedAt: '2026-08-20T09:00:00.000Z',
      prices: [],
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
