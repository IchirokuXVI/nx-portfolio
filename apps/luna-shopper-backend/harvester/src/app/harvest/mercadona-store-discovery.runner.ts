import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PostalCodeSource,
  PriceScopeKind,
} from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  type ListStoresOptions,
  type MercadonaStore,
} from '@portfolio/luna-shopper/mercadona';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `mercadona-api` adapter (plan 0106).
 *
 * **The mode did not gain a sibling; the source did**, for the second time.
 * Plan 0038 asked OpenStreetMap for this chain's shops because its section 2.8
 * found that a postal code's bounding box spans a whole city and two thirds of
 * OpenStreetMap's supermarkets carry no postcode at all. That finding was about
 * OpenStreetMap and it stays true of OpenStreetMap. It was never a finding
 * about Mercadona's data: the chain's own store finder publishes 1,675 shops in
 * one static document, with a postal code and coordinates on every single one.
 *
 * **What it declares is the price scope of every shop it read**, which is what
 * lets a later multi warehouse walk say there is no scope left to create. A
 * shop's scope is its warehouse, and the warehouse is a property of the postal
 * code, answered by the chain itself. So a full run is one request for the
 * document plus one per distinct postal code, about 1,213 of them, which is two
 * orders of magnitude below a catalog discovery.
 *
 * **It creates nothing at all** (plan 0103, section 6.4; plan 0038, section
 * 6.1). It reports places for an admin to import and declares scopes for the
 * orchestrator to resolve, and it holds no writer for either.
 *
 * **It fetches no price.** The store finder states none.
 */
@Injectable()
export class MercadonaStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(MercadonaStoreDiscoveryRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    const options = this.clientOptions(context, source);

    await context.setStage('STORES', 'Reading every shop the chain names');
    const list = await MercadonaClient.listStores(options);

    // The filter is applied after the document is read, because the document is
    // one request whatever is asked of it (section 4). What it saves is the
    // warehouse lookups below.
    const wanted = normalizeCodes(input.postalCodes);
    const stores =
      wanted.size === 0
        ? list.stores
        : list.stores.filter((store) => wanted.has(store.postalCode));
    // A code somebody asked for that no shop sits on. Named on the report
    // rather than refused: a filter that matched nothing is a run that reports
    // nothing, and the operator needs to know which code was the wrong one.
    const unmatched = [...wanted].filter(
      (code) => !list.stores.some((store) => store.postalCode === code)
    );

    await context.setTotalPlanned(stores.length);
    this.logger.log(
      `Run ${context.runId}: ${stores.length} shop(s) of ${list.stores.length} named`
    );

    const brandKey = input.chain?.externalBrandKey ?? null;
    const brandName = input.chain?.brandName ?? null;

    await context.setStage('SCOPES', 'Asking the chain what prices each shop');
    const warehouses = await this.declareWarehouses(
      context,
      report,
      stores,
      options
    );

    await context.setStage('UPSERT', `Recording ${stores.length} place(s)`);
    for (const store of stores) {
      if (context.signal.aborted) {
        break;
      }
      report.place({
        provider: PROVIDER,
        externalRef: store.externalRef,
        brandKey,
        brandName,
        // The document holds no store name, so there is none to report. A name
        // built out of the town would be one the chain never published.
        name: null,
        latitude: store.latitude,
        longitude: store.longitude,
        street: store.street,
        city: store.city,
        postalCode: store.postalCode,
        // Stated by the chain on every record, so it is a source value in plan
        // 0097's sense: never a guess, and never overridden by one.
        postalCodeSource: PostalCodeSource.SOURCE,
        // The chain's own, per shop. The document holds both countries and
        // says which each shop is in, so the run's own country decides nothing
        // here: a radius has a country because it has a centre, and this has
        // neither.
        country: store.country,
        website: null,
        openingHours: store.openingHours,
        tags: tagsOf(store, warehouses.get(store.postalCode) ?? null),
        // The warehouse that prices this shop, which the block above declared
        // as a scope. A code that answered 404 names none, and a trusted import
        // then gives the shop a STORE scope of its own (plan 0107, 3.3).
        scopeKey: warehouses.get(store.postalCode) ?? null,
      });
    }

    await context.flush();

    const declared = list.declared;
    const read = countByCountry(list.stores);
    await context.setReport({
      /** How fresh the document was, as the chain dated it. */
      publishedOn: list.publishedOn,
      stores: stores.length,
      storesInDocument: list.stores.length,
      /**
       * What the chain says it published against what was read, per country.
       *
       * **A disagreement is a warning and not a failure.** The two documents
       * are written by different jobs, and a run that read 1,598 of a declared
       * 1,599 has still found 1,598 real shops.
       */
      declared,
      read,
      countsAgree: countsAgree(declared, read),
      warehousesDeclared: [...new Set(warehouses.values())],
      /**
       * Shops whose postal code answered 404, which means the chain sells
       * online to nobody there and states no price scope for that shop (D5).
       * They take the `STORE` scope every location with no named scope takes.
       */
      storesWithNoWarehouse: stores.filter(
        (store) => !warehouses.has(store.postalCode)
      ).length,
      postalCodesAsked: new Set(stores.map((store) => store.postalCode)).size,
      /** Codes the run was asked for that no shop sits on. */
      postalCodesWithNoShop: unmatched,
    });
  }

  /**
   * One `ScopeDeclaration` per distinct warehouse the shops resolve to.
   *
   * Asked once per **postal code** rather than once per shop: 1,599 Spanish
   * shops sit on 1,137 codes, so the difference is 462 requests to a third
   * party for answers already held.
   *
   * A 404 declares nothing and is not an error. It means Mercadona sells online
   * to nobody at that code, so the chain will not state a price scope for that
   * shop, and the count of those shops is on the run's report.
   */
  private async declareWarehouses(
    context: RunContext,
    report: RunReport,
    stores: readonly MercadonaStore[],
    options: MercadonaStoreOptions
  ): Promise<Map<string, string>> {
    const byCode = new Map<string, string>();
    const declared = new Set<string>();
    for (const code of new Set(stores.map((store) => store.postalCode))) {
      if (context.signal.aborted) {
        break;
      }
      const warehouse = await MercadonaClient.resolveWarehouse(code, {
        userAgent: options.userAgent,
        baseUrl: options.baseUrl,
        fetchImpl: options.fetchImpl,
        sleepImpl: options.sleepImpl,
        acquire: options.acquire,
        signal: options.signal,
      });
      await context.heartbeat();
      if (warehouse === null) {
        continue;
      }
      byCode.set(code, warehouse);
      if (!declared.has(warehouse)) {
        declared.add(warehouse);
        report.scope({
          key: warehouse,
          // A warehouse is not a postal code and not a shop: it is the group of
          // shops the chain prices together and names itself. Its priority
          // comes from the kind (plan 0105), so a national price still wins
          // where a warehouse states none.
          kind: PriceScopeKind.REGION,
          name: `Almacén ${warehouse}`,
        });
      }
    }
    return byCode;
  }

  /**
   * What the two static calls are handed. **A seam and not a knob**: a test
   * hands back options built on a fake fetch, and nothing in the runtime
   * overrides them.
   */
  protected clientOptions(
    context: RunContext,
    source: SupermarketSource | null
  ): MercadonaStoreOptions {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return {
      userAgent: settings.userAgent,
      // The storefront the postal code lookup asks, which is the same one the
      // walk asks. The two documents are elsewhere, so the source row names
      // them separately (plan 0083).
      baseUrl: settings.mercadonaBaseUrl,
      storesUrl: readString(source?.config ?? {}, 'storesUrl'),
      totalsUrl: readString(source?.config ?? {}, 'storesTotalsUrl'),
      acquire: context.acquire,
      signal: context.signal,
    };
  }
}

/** What one store discovery run needs: the two documents, and the storefront. */
export interface MercadonaStoreOptions extends ListStoresOptions {
  /** The storefront the postal code lookup asks. Not where the documents are. */
  baseUrl?: string;
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'MERCADONA';

/**
 * What the source said about the shop, as strings.
 *
 * The warehouse is the field this run exists for, so it is on the row an admin
 * reads before choosing the scope to import the shop into. The rest is the
 * chain's own detail, kept whole and unreshaped (plan 0038, 8.2); `mercadona:fs`
 * is the special dates, verbatim, because nothing here knows what `FA` means and
 * a guess would be worse than the string.
 */
function tagsOf(
  store: MercadonaStore,
  warehouse: string | null
): Record<string, string> {
  const tags: Record<string, string> = {};
  if (warehouse) {
    tags['mercadona:warehouse'] = warehouse;
  }
  if (store.province) {
    tags['addr:province'] = store.province;
  }
  if (store.phone) {
    tags['phone'] = store.phone;
  }
  if (store.parking !== null) {
    tags['parking'] = store.parking ? 'yes' : 'no';
  }
  if (store.readyToEat !== null) {
    tags['mercadona:readyToEat'] = store.readyToEat ? 'yes' : 'no';
  }
  if (store.openedOn) {
    tags['mercadona:openedOn'] = store.openedOn;
  }
  if (store.specialDates) {
    tags['mercadona:specialDates'] = store.specialDates;
  }
  return tags;
}

/** The codes asked for, trimmed. An empty array is every shop, like an absent one. */
function normalizeCodes(codes: readonly string[] | undefined): Set<string> {
  return new Set(
    (codes ?? []).map((code) => code.trim()).filter((code) => code !== '')
  );
}

function countByCountry(
  stores: readonly MercadonaStore[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const store of stores) {
    const key = store.country.toUpperCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Whether every country the chain declared a count for was read in full. */
function countsAgree(
  declared: Record<string, number>,
  read: Record<string, number>
): boolean {
  const countries = Object.keys(declared);
  return (
    countries.length > 0 &&
    countries.every((country) => declared[country] === read[country])
  );
}

function requireChain(supermarketId: string | undefined): string {
  if (!supermarketId) {
    throw new Error(
      'This chain publishes its own shops, so the run has to know which chain ' +
        'it is reading. Start it again naming the supermarket.'
    );
  }
  return supermarketId;
}

/** A setting from the source row rather than the environment (plan 0083). */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
