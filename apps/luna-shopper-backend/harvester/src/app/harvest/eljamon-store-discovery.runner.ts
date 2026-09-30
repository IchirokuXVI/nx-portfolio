import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import {
  ElJamonClient,
  type ElJamonStore,
} from '@portfolio/luna-shopper/eljamon';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `eljamon-web` adapter (plan 0169, section 3).
 *
 * **One request names every shop.** The chain's store locator answers a search
 * from Lepe with a 1000 km radius with all 366 of its shops, and the farthest
 * of them is 332 km away. So this case takes no radius and no centre of the
 * run's, and a postal code filters what it reports rather than what it fetches.
 *
 * **It names no price scope, on any place** (section 2). The site shows one
 * price list for every shop, so a shop's prices come from the chain's
 * `NATIONAL` scope, which the stack of the `STORE` scope an import gives it
 * already reaches (plan 0116). A scope key here would put every shop in a
 * scope the chain never states.
 *
 * **It creates nothing** (plan 0103, section 6.4; plan 0038, section 6.1). It
 * reports places for an admin to import.
 */
@Injectable()
export class ElJamonStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(ElJamonStoreDiscoveryRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    const client = this.createClient(context, source);

    await context.setStage('STORES', 'Reading every shop the chain names');
    const list = await client.listStores();

    // The same filter the other chains apply, read the same way (plan 0107,
    // section 1): after the document is read, on the shop's own postal code,
    // exactly. An empty array and an absent field are both every shop.
    const wanted = normalizeCodes(input.postalCodes);
    const stores =
      wanted.size === 0
        ? list.stores
        : list.stores.filter((store) => wanted.has(store.postalCode));
    const unmatched = [...wanted].filter(
      (code) => !list.stores.some((store) => store.postalCode === code)
    );

    await context.setTotalPlanned(stores.length);
    this.logger.log(
      `Run ${context.runId}: ${stores.length} shop(s) of ${list.stores.length} named`
    );

    // The document states no total, so completeness cannot be checked against
    // the chain. A count far under the one measured is the next best signal.
    const warnings: string[] = [];
    if (list.stores.length < EXPECTED_AT_LEAST) {
      const warning =
        `The locator named ${list.stores.length} shop(s). The chain had 366 ` +
        `on 2026-09-29, so a count under ${EXPECTED_AT_LEAST} suggests the ` +
        'search or the page changed.';
      warnings.push(warning);
      this.logger.warn(`Run ${context.runId}: ${warning}`);
    }

    const brandKey = input.chain?.externalBrandKey ?? null;
    const brandName = input.chain?.brandName ?? null;

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
        name: store.name,
        latitude: store.latitude,
        longitude: store.longitude,
        street: store.street,
        city: store.city,
        postalCode: store.postalCode,
        // Stated by the chain on every record kept, so it is a source value in
        // plan 0097's sense. A record with none was dropped and named instead.
        postalCodeSource: PostalCodeSource.SOURCE,
        country: 'es',
        website: null,
        // One free text line, kept verbatim and never parsed (section 3).
        openingHours: store.openingHours,
        tags: tagsOf(store),
        // Deliberately absent: one price list for every shop (section 2).
        scopeKey: null,
      });
    }

    await context.flush();
    await context.setReport({
      shopsRead: list.recordsRead,
      shopsKept: list.stores.length,
      shopsReported: stores.length,
      /** Every record that is not reported as a shop, with the reason. */
      droppedRecords: list.dropped,
      /** Codes the run was asked for that no shop sits on. */
      postalCodesWithNoShop: unmatched,
      warnings,
      requests: client.requests,
    });
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource | null
  ): ElJamonClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const config = source?.config ?? {};
    return new ElJamonClient({
      userAgent: settings.userAgent,
      locatorUrl: readString(config, 'locatorUrl'),
      locatorOrigin: readOrigin(config),
      locatorRadiusKm: readPositive(config, 'locatorRadiusKm'),
      acquire: context.acquire,
      signal: context.signal,
    });
  }
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'ELJAMON';

/** 366 shops on 2026-09-29. Fewer than this is a warning (section 3). */
const EXPECTED_AT_LEAST = 300;

/** The province, verbatim, which is the one address field `ObservedPlace` lacks. */
function tagsOf(store: ElJamonStore): Record<string, string> {
  return store.province ? { 'addr:province': store.province } : {};
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

/**
 * Where the locator search is centred, from `source.config.locatorOrigin` as
 * `{ latitude, longitude, label }`, or the library's default, Lepe.
 */
function readOrigin(
  config: Record<string, unknown>
): { latitude: number; longitude: number; label: string } | undefined {
  const origin = config['locatorOrigin'];
  if (!origin || typeof origin !== 'object') {
    return undefined;
  }
  const value = origin as Record<string, unknown>;
  const latitude = Number(value['latitude']);
  const longitude = Number(value['longitude']);
  const label = typeof value['label'] === 'string' ? value['label'] : '';
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, label }
    : undefined;
}
