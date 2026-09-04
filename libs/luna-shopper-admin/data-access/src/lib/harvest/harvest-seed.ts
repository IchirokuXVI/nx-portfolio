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
 * look tidy. One run still going with a known total, one that failed because the
 * storefront switch was off, one aborted. Places that are near duplicates of each
 * other, which is the case the review queue is for. A ref whose source is gone
 * beside one that was never resolved.
 */

/** Fixed, so that a spec asserting on a row can name it. */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';

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
    failed: 16,
    stage: 'fetch-products',
    stageLabel: 'Fetching products',
    abortRequestedAt: null,
    error: null,
    correlationId: 'seed-correlation-1',
    requestedByUserId: null,
  },
  {
    // The storefront switch, as it actually presents itself: the spawn is
    // accepted, the runner refuses on its first step, and the run finalizes
    // carrying the sentence that names the variable.
    id: 'run-catalog-storefront-off',
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
    failed: 0,
    stage: null,
    stageLabel: null,
    abortRequestedAt: null,
    error:
      'MERCADONA_ENABLED is false, so this deployment does not fetch from that storefront.',
    correlationId: 'seed-correlation-2',
    requestedByUserId: null,
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
    failed: 0,
    stage: 'query-overpass',
    stageLabel: 'Querying OpenStreetMap',
    abortRequestedAt: '2026-09-01T08:13:52.000Z',
    error: null,
    correlationId: 'seed-correlation-3',
    requestedByUserId: null,
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
