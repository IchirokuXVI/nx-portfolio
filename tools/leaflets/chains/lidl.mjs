// LIDL Spain: where its leaflets are and how the regions share them.
//
// lidl.es does not host its leaflets. The page at
// `/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402` embeds an
// overview widget from `esi.leaflets.schwarz`, and that widget is rendered from
// one JSON call:
//
//   https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl/es-ES&region_id=<n>&store_id=0
//
// `region_id` is the same id space as `marketingData.offerRegion` on the store
// records, the 59 price regions plan 0089 describes. Region 0 is what the site
// shows before a shop is chosen. The answer is regionalized: the same weekly
// leaflet is published once per group of regions, under a different flyer id
// and a different PDF each time, and the PDFs differ in content (the sizes and
// the ETags differ), so an edition for Galicia is not the edition for Sevilla.
// Two editions that are byte identical (region 0 and Madrid, this week) carry
// the same ETag, which is how the finder knows not to report them twice.
//
// Every request here is anonymous. The store API wants an `x-apikey`, and the
// key below is the public one every lidl.es page ships to the browser.

const OVERVIEW = 'https://endpoints.leaflets.schwarz/v4/overview';
const STORES =
  'https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores';
const STORES_KEY = '16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2';
const CLIENT_LOCALE = 'lidl/es-ES';
const STORES_PAGE = 250;

/** The region the site answers with when no shop has been chosen. */
export const NATIONAL_REGION = Object.freeze({
  code: '0',
  name: 'Nacional (sin tienda)',
  zone: null,
});

/**
 * What kind of leaflet a subcategory holds. The subcategory decides, because
 * the Canary editions are named "Islas canarias desde el 7/9" in both the
 * grocery and the bazar subcategory and only the subcategory tells them apart.
 * Anything else ("Nuestros folletos semanales", which holds the Lidl Factori
 * outlet leaflet in Madrid) is `other`.
 */
export function classify(subcategoryName, flyerName) {
  const subcategory = String(subcategoryName ?? '').toLowerCase();
  const name = String(flyerName ?? '').toLowerCase();
  if (subcategory.includes('bazar')) return 'bazar';
  if (subcategory.includes('alimentaci')) return 'grocery';
  if (name.includes('bazar')) return 'bazar';
  if (name.includes('alimentaci')) return 'grocery';
  return 'other';
}

/**
 * The price regions, read from the store records: every one of the 730 shops
 * names its region and there is no other list of them. Sorted by numeric code.
 */
export function regionsFromStores(stores) {
  const byCode = new Map();
  for (const store of stores) {
    const marketing = store?.marketingData;
    if (marketing?.offerRegion == null) continue;
    const code = String(marketing.offerRegion);
    const region = byCode.get(code) ?? {
      code,
      name: String(marketing.offerRegionName ?? code).trim(),
      zone: marketing.zoneName ?? null,
      stores: 0,
    };
    region.stores += 1;
    byCode.set(code, region);
  }
  return [...byCode.values()].sort((a, b) => Number(a.code) - Number(b.code));
}

export async function loadRegions(http) {
  const stores = [];
  for (let offset = 0; ; offset += STORES_PAGE) {
    const body = await http.json(
      `${STORES}?limit=${STORES_PAGE}&offset=${offset}&country_code=ES`,
      { 'x-apikey': STORES_KEY }
    );
    const items = body?.items ?? [];
    stores.push(...items);
    if (items.length === 0 || stores.length >= (body?.meta?.total ?? 0)) break;
  }
  return regionsFromStores(stores);
}

export function overviewUrl(regionCode) {
  const query = new URLSearchParams({
    client_locale: CLIENT_LOCALE,
    region_id: String(regionCode),
    store_id: '0',
  });
  return `${OVERVIEW}?${query}`;
}

/**
 * One leaflet per distinct flyer id, with the regions whose overview listed it.
 *
 * `overviews` is a Map from region code to the JSON that region's overview call
 * answered. The flyer's own `regions` field is ignored on purpose: it lists the
 * regions the publisher tagged, and the fact that decides a shopper's leaflet
 * is which region's overview shows it.
 */
export function collectEditions(overviews, regions) {
  const regionByCode = new Map(regions.map((r) => [String(r.code), r]));
  const editions = new Map();
  for (const [code, overview] of overviews) {
    const region = regionByCode.get(String(code)) ?? {
      code: String(code),
      name: String(code),
      zone: null,
    };
    for (const category of overview?.categories ?? []) {
      for (const subcategory of category?.subcategories ?? []) {
        for (const flyer of subcategory?.flyers ?? []) {
          if (!flyer?.id) continue;
          const edition = editions.get(flyer.id) ?? {
            chain: 'lidl',
            sourceId: flyer.id,
            name: flyer.name ?? '',
            title: flyer.title ?? '',
            kind: classify(subcategory.name, flyer.name),
            category: subcategory.name ?? '',
            pdfUrl: flyer.pdfUrl ?? flyer.hiResPdfUrl ?? null,
            fileSize: flyer.fileSize ?? flyer.hiResFileSize ?? null,
            startDate: flyer.startDate ?? null,
            endDate: flyer.endDate ?? null,
            offerStartDate: flyer.offerStartDate ?? null,
            offerEndDate: flyer.offerEndDate ?? null,
            viewerUrl: flyer.flyerUrlAbsolute ?? null,
            regions: [],
          };
          if (!edition.regions.some((r) => r.code === region.code)) {
            edition.regions.push({
              code: region.code,
              name: region.name,
              zone: region.zone ?? null,
            });
          }
          editions.set(flyer.id, edition);
        }
      }
    }
  }
  for (const edition of editions.values()) {
    edition.regions.sort((a, b) => Number(a.code) - Number(b.code));
  }
  return [...editions.values()];
}

/**
 * Every leaflet LIDL Spain publishes right now, one per flyer id.
 *
 * `options.regions` restricts the sweep to the given codes. `options.log` gets
 * one line per stage. The content hash is the PDF's ETag from a HEAD request,
 * which the asset host derives from the file's bytes, so two editions with the
 * same ETag are the same document and no download is needed to know it.
 */
export async function findLeaflets(http, options = {}) {
  const log = options.log ?? (() => {});
  let regions;
  try {
    regions = await loadRegions(http);
    log(`lidl: ${regions.length} price regions from the store API`);
  } catch (error) {
    if (!options.regions) {
      throw new Error(
        `lidl: the store API refused (${error.message}); pass --regions to sweep ids by hand`
      );
    }
    regions = [];
    log(`lidl: store API unavailable, sweeping the given codes without names`);
  }
  const all = [NATIONAL_REGION, ...regions];
  const wanted = options.regions
    ? options.regions.map(
        (code) =>
          all.find((r) => r.code === String(code)) ?? {
            code: String(code),
            name: String(code),
            zone: null,
          }
      )
    : all;

  const overviews = new Map();
  for (const region of wanted) {
    const overview = await http.json(overviewUrl(region.code));
    if (!overview?.success) {
      throw new Error(
        `lidl: overview for region ${region.code} answered ${overview?.message ?? 'nothing'}`
      );
    }
    overviews.set(region.code, overview);
  }
  log(`lidl: ${overviews.size} regions swept`);

  const editions = collectEditions(overviews, wanted);
  const heads = new Map();
  for (const edition of editions) {
    if (!edition.pdfUrl) {
      edition.contentHash = { algorithm: 'source-id', value: edition.sourceId };
      continue;
    }
    if (!heads.has(edition.pdfUrl)) {
      heads.set(edition.pdfUrl, await http.head(edition.pdfUrl));
    }
    const head = heads.get(edition.pdfUrl);
    const etag = head?.etag?.replace(/^W\//, '').replace(/"/g, '') ?? null;
    edition.contentHash = etag
      ? { algorithm: 'etag', value: etag }
      : { algorithm: 'source-id', value: edition.sourceId };
    if (head?.lastModified) edition.lastModified = head.lastModified;
  }
  log(`lidl: ${editions.length} flyer ids, ${heads.size} distinct PDFs`);
  return editions;
}

export const chain = {
  key: 'lidl',
  name: 'LIDL',
  findLeaflets,
};
