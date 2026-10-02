import { Injectable, Logger } from '@nestjs/common';
import {
  PostalCodeSource,
  PriceScopeKind,
} from '@portfolio/luna-shopper/contracts';
import {
  candidatesNear,
  DIA_DEFAULT_POSTAL_CODE_RADIUS_METRES,
  DiaClient,
  DiaStoppedError,
  isTemporarilyClosed,
  parseOpeningHours,
  type DiaStoreDetail,
  type DiaStoreRecord,
} from '@portfolio/luna-shopper/dia';
import { SPAIN_POSTAL_CODE_CENTROIDS } from '@portfolio/luna-shopper/postal-codes/dataset';
import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `dia-api` adapter (plan 0174, section 5).
 *
 * **The shop file names every shop and no postal code.** It is one gzip file of
 * about 3,200 records, DIA and Clarel, with coordinates and a province and
 * nothing else. The address, the postal code and the hours are one detail
 * request per shop. So a run with no postal codes reads about 2,400 details,
 * and a run with postal codes narrows the file first: the province, then a
 * radius around each code's centroid, then the exact postal code on the
 * detail, which is the rule every chain runner follows (plan 0106, D4).
 *
 * **It declares the fulfilment store of every shop it keeps** (section 5.6).
 * One `check-service` per distinct postal code names the online store that
 * prices that area. That store is a `LOCAL_AREA` scope, as a Mercadona
 * warehouse is, and the shop carries its key. A code with no online service
 * names none, and the shop falls through to the chain's `NATIONAL` scope.
 *
 * **It creates nothing** (plan 0103, section 6.4; plan 0038, section 6.1). It
 * reports places for an admin to import and declares scopes for the
 * orchestrator to resolve.
 */
@Injectable()
export class DiaStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(DiaStoreDiscoveryRunner.name);

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    const client = this.createClient(context, source);
    const outcome = new StoreRun();

    await context.setStage('STORES', 'Reading the shop file');
    const file = await client.storeFile();
    outcome.shopsInFile = file.total;
    outcome.clarelDropped = file.clarelDropped;
    for (const id of file.unreadable) {
      outcome.droppedRecords.push({ idTienda: id, reason: 'unreadable' });
    }

    // Section 5.3: the file has no postal code, so a filtered run reads the
    // details of the shops near each code and keeps the exact matches.
    const wanted = normalizeCodes(input.postalCodes);
    const candidates =
      wanted.size === 0
        ? file.stores
        : this.candidatesFor(
            file.stores,
            wanted,
            readPositive(source?.config ?? {}, 'postalCodeRadiusMetres') ??
              DIA_DEFAULT_POSTAL_CODE_RADIUS_METRES,
            outcome
          );
    outcome.candidates = candidates.length;
    await context.setTotalPlanned(candidates.length);
    await context.setStage(
      'STORES',
      `Reading ${candidates.length} shop detail(s)`
    );

    const today = new Date();
    const kept: Array<{ record: DiaStoreRecord; detail: DiaStoreDetail }> = [];
    /** The town of every shop whose detail was read, kept or dropped. */
    const towns = new Map<string, string | null>();
    for (const record of candidates) {
      if (context.signal.aborted) {
        break;
      }
      let detail: DiaStoreDetail | null;
      try {
        detail = await client.storeDetail(record.idTienda);
      } catch (error) {
        if (error instanceof DiaStoppedError || context.signal.aborted) {
          throw error;
        }
        outcome.failedShops.push({
          idTienda: record.idTienda,
          error: String(error),
        });
        await context.report({ failed: 1 });
        continue;
      }
      outcome.detailsRead += 1;
      await context.report({ processed: 1 });
      if (!detail) {
        outcome.failedShops.push({
          idTienda: record.idTienda,
          error: 'The detail named no shop.',
        });
        continue;
      }
      towns.set(detail.storeCode, detail.city);
      // Never a place without a postal code from this source (section 5.4).
      if (!detail.postalCode) {
        outcome.droppedRecords.push({
          idTienda: record.idTienda,
          reason: 'no-postal-code',
        });
        continue;
      }
      if (isTemporarilyClosed(detail, today)) {
        outcome.droppedRecords.push({
          idTienda: record.idTienda,
          reason: 'temporarily-closed',
          reopensOn: detail.reopensOn,
        });
        continue;
      }
      if (wanted.size > 0 && !wanted.has(detail.postalCode)) {
        // A candidate from the radius whose own code is another one. Not a
        // drop: it is a shop of a code nobody asked for.
        continue;
      }
      kept.push({ record, detail });
    }
    for (const code of wanted) {
      if (!kept.some(({ detail }) => detail.postalCode === code)) {
        outcome.postalCodesWithNoShop.push(code);
      }
    }

    await context.setStage(
      'SCOPES',
      'Asking DIA which online store serves each shop'
    );
    const stores = await this.declareFulfilmentStores(
      context,
      report,
      client,
      kept,
      towns,
      file.stores,
      outcome
    );

    const brandKey = input.chain?.externalBrandKey ?? null;
    const brandName = input.chain?.brandName ?? null;
    for (const { record, detail } of kept) {
      if (context.signal.aborted) {
        break;
      }
      const hours = parseOpeningHours(detail.hours);
      if (!hours.readable) {
        outcome.unreadableHours.push(record.idTienda);
      }
      const scopeKey = stores.get(detail.postalCode ?? '') ?? null;
      report.place({
        provider: PROVIDER,
        // The shop code, which is also how DIA numbers a fulfilment store.
        externalRef: detail.storeCode,
        brandKey,
        brandName,
        // Every DIA shop is "DIA". A name built from the street would be one
        // the chain never published (plan 0106).
        name: null,
        // The detail has none, so they come from the file.
        latitude: record.latitude,
        longitude: record.longitude,
        street: detail.street,
        city: detail.city,
        postalCode: detail.postalCode,
        postalCodeSource: PostalCodeSource.SOURCE,
        country: 'es',
        website: null,
        openingHours: hours.openingHours,
        tags: tagsOf(record, detail, scopeKey, hours.readable),
        scopeKey,
      });
      outcome.shopsKept += 1;
    }

    await context.flush();
    await context.setReport({
      ...outcome.toReport(),
      requests: client.requests,
    });
    this.logger.log(
      `Run ${context.runId}: ${outcome.shopsKept} shop(s) of ` +
        `${file.stores.length} DIA records, ${stores.size} postal code(s) served`
    );
  }

  /**
   * The shops near each requested postal code, deduplicated, in file order.
   * A code with no centroid has nothing to be near and is named.
   */
  private candidatesFor(
    stores: readonly DiaStoreRecord[],
    wanted: ReadonlySet<string>,
    radiusMetres: number,
    outcome: StoreRun
  ): DiaStoreRecord[] {
    const centroids = centroidsOf(wanted);
    const picked = new Set<string>();
    for (const code of wanted) {
      const centroid = centroids.get(code);
      if (!centroid) {
        outcome.postalCodesWithoutCentroid.push(code);
        continue;
      }
      for (const store of candidatesNear(
        stores,
        code,
        centroid,
        radiusMetres
      )) {
        picked.add(store.idTienda);
      }
    }
    return stores.filter((store) => picked.has(store.idTienda));
  }

  /**
   * One `check-service` per distinct postal code among the kept shops, and one
   * declaration per fulfilment store (section 5.6). Answers postal code to
   * store code, for the codes that have online service.
   *
   * The label names the store's town when this run read that store's detail,
   * or the file holds it and one more request reads it. The three city hubs
   * are such stores: closed to walk in customers, so dropped as shops, and
   * still the store a whole city is priced by.
   */
  private async declareFulfilmentStores(
    context: RunContext,
    report: RunReport,
    client: DiaClient,
    kept: ReadonlyArray<{ record: DiaStoreRecord; detail: DiaStoreDetail }>,
    towns: Map<string, string | null>,
    file: readonly DiaStoreRecord[],
    outcome: StoreRun
  ): Promise<Map<string, string>> {
    const byCode = new Map<string, string>();
    const declared = new Set<string>();
    const codes = [
      ...new Set(kept.map(({ detail }) => detail.postalCode ?? '')),
    ].filter((code) => code !== '');
    for (const code of codes) {
      if (context.signal.aborted) {
        break;
      }
      let store: string | null;
      try {
        store = await client.checkService(code);
      } catch (error) {
        if (error instanceof DiaStoppedError || context.signal.aborted) {
          throw error;
        }
        outcome.failedPostalCodes.push({
          postalCode: code,
          error: String(error),
        });
        continue;
      }
      await context.heartbeat();
      if (store === null) {
        outcome.postalCodesWithoutOnlineService.push(code);
        continue;
      }
      byCode.set(code, store);
      if (declared.has(store)) {
        continue;
      }
      declared.add(store);
      const town = await this.townOf(client, store, towns, file);
      report.scope({
        key: store,
        // A fulfilment store is a local area (section 3.1): a group of shops
        // DIA prices together and keys itself, below the chain's NATIONAL row.
        kind: PriceScopeKind.LOCAL_AREA,
        name: `Dia online, tienda ${store}` + (town ? ` (${town})` : ''),
      });
      outcome.scopesDeclared.push(store);
    }
    return byCode;
  }

  /** The town of a fulfilment store, or null when the file does not hold it. */
  private async townOf(
    client: DiaClient,
    store: string,
    known: Map<string, string | null>,
    file: readonly DiaStoreRecord[]
  ): Promise<string | null> {
    if (known.has(store)) {
      return known.get(store) ?? null;
    }
    const record = file.find((candidate) => candidate.codigoTienda === store);
    let town: string | null = null;
    if (record) {
      try {
        town = (await client.storeDetail(record.idTienda))?.city ?? null;
      } catch (error) {
        if (error instanceof DiaStoppedError) {
          throw error;
        }
        // A label is not worth a failed run: the scope is declared without it.
      }
    }
    known.set(store, town);
    return town;
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it.
   * There is no user agent to pass (decision D1, plan 0174, section 2).
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource | null
  ): DiaClient {
    return new DiaClient({
      baseUrl: readString(source?.config ?? {}, 'baseUrl'),
      acquire: context.acquire,
      signal: context.signal,
    });
  }
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'DIA';

/** What one store discovery accumulates, and the report it writes. */
class StoreRun {
  shopsInFile = 0;
  clarelDropped = 0;
  candidates = 0;
  detailsRead = 0;
  shopsKept = 0;
  readonly droppedRecords: Array<{
    idTienda: string;
    reason: 'temporarily-closed' | 'no-postal-code' | 'unreadable';
    reopensOn?: string | null;
  }> = [];
  readonly failedShops: Array<{ idTienda: string; error: string }> = [];
  readonly failedPostalCodes: Array<{ postalCode: string; error: string }> = [];
  readonly postalCodesWithNoShop: string[] = [];
  readonly postalCodesWithoutCentroid: string[] = [];
  readonly postalCodesWithoutOnlineService: string[] = [];
  readonly scopesDeclared: string[] = [];
  readonly unreadableHours: string[] = [];

  toReport(): Record<string, unknown> {
    return {
      shopsInFile: this.shopsInFile,
      clarelDropped: this.clarelDropped,
      candidates: this.candidates,
      detailsRead: this.detailsRead,
      shopsKept: this.shopsKept,
      /** Named, with the reason and, for a closed shop, when it reopens. */
      droppedRecords: this.droppedRecords,
      failedShops: this.failedShops,
      failedPostalCodes: this.failedPostalCodes,
      postalCodesWithNoShop: this.postalCodesWithNoShop,
      postalCodesWithoutCentroid: this.postalCodesWithoutCentroid,
      postalCodesWithoutOnlineService: this.postalCodesWithoutOnlineService,
      scopesDeclared: this.scopesDeclared,
      /** Shops whose hours were kept raw in `dia:hours` (section 5.5). */
      unreadableHours: this.unreadableHours,
    };
  }
}

/**
 * What the source said about the shop, as strings, kept whole and unreshaped
 * (plan 0038, section 8.2). The fulfilment store is the field this run exists
 * for, so it is on the row an admin reads before importing the shop.
 */
function tagsOf(
  record: DiaStoreRecord,
  detail: DiaStoreDetail,
  fulfilmentStore: string | null,
  hoursReadable: boolean
): Record<string, string> {
  const tags: Record<string, string> = {
    'dia:idTienda': record.idTienda,
    'addr:province': record.provinceCode,
  };
  if (fulfilmentStore) {
    tags['dia:fulfilmentStore'] = fulfilmentStore;
  }
  if (detail.phone) {
    tags['phone'] = detail.phone;
  }
  if (detail.holidays) {
    tags['dia:holidays'] = detail.holidays;
  }
  if (detail.fresh) {
    tags['dia:fresh'] = detail.fresh;
  }
  if (detail.homeDelivery) {
    tags['dia:homeDelivery'] = 'yes';
  }
  if (detail.leaflet) {
    tags['dia:leaflet'] = detail.leaflet;
  }
  if (!hoursReadable) {
    tags['dia:hours'] = JSON.stringify(detail.hours);
  }
  return tags;
}

/** The centroid of each requested code that the dataset holds. */
function centroidsOf(
  codes: ReadonlySet<string>
): Map<string, { latitude: number; longitude: number }> {
  const found = new Map<string, { latitude: number; longitude: number }>();
  for (const centroid of SPAIN_POSTAL_CODE_CENTROIDS) {
    if (codes.has(centroid.postalCode)) {
      found.set(centroid.postalCode, centroid);
    }
  }
  return found;
}

/** The codes asked for, trimmed. An empty array is every shop, like an absent one. */
function normalizeCodes(codes: readonly string[] | undefined): Set<string> {
  return new Set(
    (codes ?? []).map((code) => code.trim()).filter((code) => code !== '')
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

function readPositive(
  config: Record<string, unknown>,
  key: string
): number | undefined {
  const value = Number(config[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
