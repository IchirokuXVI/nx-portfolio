/**
 * Research script. Not production code.
 *
 * Asks one question: is a LIDL offer region the same thing as a Spanish
 * province, so that the first two digits of a shop's postal code decide which
 * price applies to it?
 *
 * Spanish postal codes are five digits and the first two are the province code,
 * 01 Alava through 52 Melilla. If every region maps to exactly one province code
 * and every province code maps to exactly one region, then a postal code decides
 * the price and no store needs to name its region.
 *
 * It does not, and the question turns out not to matter: every store record
 * carries `marketingData.offerRegion` already, so the harvester reads the region
 * rather than deriving it. What this report is still good for is the opposite
 * direction, which is "what does a shopper near this postcode pay" when no shop
 * has been chosen.
 *
 * Usage:
 *   node tools/research/lidl/probe-postal-to-region.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const STORES =
  'https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores';
const STORES_KEY = '16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function loadStores() {
  const stores = [];
  const limit = 250;
  for (let offset = 0; ; offset += limit) {
    const response = await fetch(
      `${STORES}?limit=${limit}&offset=${offset}&country_code=ES`,
      { headers: { 'user-agent': UA, accept: '*/*', 'x-apikey': STORES_KEY } }
    );
    if (!response.ok) throw new Error(`${response.status} at offset ${offset}`);
    const body = await response.json();
    stores.push(...body.items);
    if (stores.length >= body.meta.total) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return stores;
}

const stores = await loadStores();
console.log(`stores: ${stores.length}`);

/** province code -> the set of region ids whose stores sit in that province */
const provinceToRegions = new Map();
/** region id -> the set of province codes its stores sit in */
const regionToProvinces = new Map();
const regionNames = new Map();
const rows = [];
let missingPostcode = 0;
let missingRegion = 0;

for (const store of stores) {
  const zip = store.address?.zip ?? null;
  const regionId = store.marketingData?.offerRegion ?? null;
  const regionName = store.marketingData?.offerRegionName ?? null;
  const zone = store.marketingData?.zone ?? null;
  if (!zip) missingPostcode++;
  if (regionId == null) missingRegion++;
  if (!zip || regionId == null) continue;

  const province = String(zip).padStart(5, '0').slice(0, 2);
  regionNames.set(regionId, regionName);

  if (!provinceToRegions.has(province))
    provinceToRegions.set(province, new Set());
  provinceToRegions.get(province).add(regionId);
  if (!regionToProvinces.has(regionId))
    regionToProvinces.set(regionId, new Set());
  regionToProvinces.get(regionId).add(province);

  rows.push({
    objectNumber: store.objectNumber,
    zip,
    province,
    city: store.address?.city ?? null,
    state: store.address?.state ?? null,
    regionId,
    regionName,
    zone,
  });
}

// A province that reaches more than one region breaks the postal code rule.
const splitProvinces = [...provinceToRegions.entries()]
  .filter(([, regions]) => regions.size > 1)
  .map(([province, regions]) => ({
    province,
    regions: [...regions].map((id) => ({ id, name: regionNames.get(id) })),
    stores: rows.filter((r) => r.province === province).length,
  }));

// A region spanning several provinces is fine for the rule, but worth seeing.
const wideRegions = [...regionToProvinces.entries()]
  .filter(([, provinces]) => provinces.size > 1)
  .map(([id, provinces]) => ({
    id,
    name: regionNames.get(id),
    provinces: [...provinces].sort(),
  }));

const report = {
  stores: stores.length,
  usable: rows.length,
  missingPostcode,
  missingRegion,
  distinctRegions: regionNames.size,
  distinctProvinces: provinceToRegions.size,
  splitProvinces,
  wideRegions,
};
// The report is small and the plan quotes it, so it is committed. The 730 store
// rows are a raw capture that changes every week, so they go beside it and are
// git ignored. probe-province-price-conflict.mjs reads the detail file.
writeFileSync(
  join(outDir, 'postal-to-region.json'),
  JSON.stringify(report, null, 2)
);
writeFileSync(
  join(outDir, 'postal-to-region.detail.json'),
  JSON.stringify({ rows }, null, 2)
);

console.log(
  `usable rows: ${rows.length} (no postcode: ${missingPostcode}, no region: ${missingRegion})`
);
console.log(
  `distinct regions: ${regionNames.size}, distinct province codes: ${provinceToRegions.size}`
);

console.log(
  `\n### provinces that reach more than one region: ${splitProvinces.length}`
);
for (const p of splitProvinces) {
  console.log(
    `  ${p.province} (${p.stores} stores) -> ${p.regions.map((r) => `${r.id}=${r.name}`).join(', ')}`
  );
}

console.log(
  `\n### regions spanning more than one province: ${wideRegions.length}`
);
for (const r of wideRegions)
  console.log(`  ${r.id}=${r.name} -> ${r.provinces.join(', ')}`);

const clean = splitProvinces.length === 0;
console.log(
  `\nVERDICT: a postal code ${clean ? 'DOES' : 'DOES NOT'} decide the region on its own.`
);
