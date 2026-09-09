import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PostalCodeSource,
  PriceScopeKind,
} from '@portfolio/luna-shopper/contracts';
import { LidlClient, type LidlStore } from '@portfolio/luna-shopper/lidl';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `lidl-api` adapter (plan 0089, section 9).
 *
 * **LIDL publishes its own store list, and it is better than OpenStreetMap in
 * every field that matters**: 730 shops, official names, street, postcode,
 * province, coordinates, opening hours, and the price region. So this case
 * takes no postal code and no radius. It reads every shop in the country in
 * three requests.
 *
 * The region is the reason it exists at all. **Every one of the 730 records
 * carries `marketingData.offerRegion`, with no gaps**, so the link between a
 * shop and the price it pays is stated by the chain and this run copies it
 * rather than deriving anything. A postal code cannot answer the same question:
 * 12 of the 52 provinces hold shops in more than one region, and 3 of the 652
 * postcodes that hold a Lidl do too (section 4.1).
 *
 * **It creates nothing at all** (plan 0103, section 6.4). The rule from plan
 * 0038 section 6.1 already said it writes no shop and no chain in catalog: a
 * run reports places and an admin imports them, one at a time and by choice. It
 * used to create the price scopes itself, with the same paging and creating
 * written again in the catalog runner. It declares the regions now, and the
 * orchestrator resolves every declaration through one resolver.
 *
 * **Run it before the first catalog run.** A catalog run that meets a region
 * with no scope declares it too, so the order is a recommendation rather than a
 * hard gate, but a run in the wrong order produces scopes with no shops
 * attached to them.
 */
@Injectable()
export class LidlStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(LidlStoreDiscoveryRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    const client = this.createClient(context, source);
    const country = (input.country || 'es').trim().toLowerCase();

    await context.setStage('STORES', 'Reading every shop the chain names');
    const stores = await client.listStores(country.toUpperCase());
    await context.setTotalPlanned(stores.length);
    this.logger.log(`Run ${context.runId}: ${stores.length} shop(s) named`);

    // The chain's own identity, so a place this run reports groups with the
    // same chain a radius search found. It is read by the orchestrator rather
    // than guessed here: the owner owns that key, and a QID typed in a runner
    // would be a second opinion about it.
    const brandKey = input.chain?.externalBrandKey ?? null;
    const brandName = input.chain?.brandName ?? null;

    await context.setStage('SCOPES', 'Naming each offer region');
    const regions = this.declareRegions(report, stores);

    await context.setStage('UPSERT', `Recording ${stores.length} place(s)`);
    let withoutRegion = 0;
    for (const store of stores) {
      if (context.signal.aborted) {
        break;
      }
      if (!store.regionId) {
        // Not one was seen in the research. It is counted rather than assumed
        // away, because a shop with no region is a shop no price can reach.
        withoutRegion += 1;
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
        // The chain states it on every store record, so it is a source value in
        // plan 0097's sense: never a guess, and never overridden by one.
        postalCodeSource: store.postalCode ? PostalCodeSource.SOURCE : null,
        country,
        website: null,
        openingHours: store.openingHours,
        // The source's own fields, kept whole and unreshaped, so the region an
        // admin sees on the row is the one the chain stated (plan 0038, 8.2).
        tags: tagsOf(store),
      });
    }

    await context.flush();
    await context.setReport({
      stores: stores.length,
      regionsSeen: regions.length,
      /**
       * The regions this run declared, by the chain's own key. Which of them
       * catalog already held is the orchestrator's to say (plan 0103, 3).
       */
      regionsDeclared: regions,
      storesWithoutRegion: withoutRegion,
      requests: client.requests,
    });
  }

  /**
   * Every offer region the store list names, declared once each.
   *
   * A shop with no region declares nothing: there is no group to price it in,
   * which is why the count of those shops is on the run's report.
   */
  private declareRegions(
    report: RunReport,
    stores: readonly LidlStore[]
  ): string[] {
    const seen = new Set<string>();
    for (const store of stores) {
      if (!store.regionId || seen.has(store.regionId)) {
        continue;
      }
      seen.add(store.regionId);
      report.scope({
        key: store.regionId,
        // A LIDL offer region is not a postal code and not a shop: it is a
        // group of shops the chain prices together and names itself.
        kind: PriceScopeKind.REGION,
        name: store.regionName ?? null,
      });
    }
    return [...seen];
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource | null
  ): LidlClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new LidlClient({
      userAgent: settings.userAgent,
      storesUrl: readString(source?.config ?? {}, 'storesUrl'),
      storesApiKey: settings.lidlStoresApiKey,
      acquire: context.acquire,
      signal: context.signal,
    });
  }
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'LIDL';

/**
 * What the source said about the shop, as strings.
 *
 * The price region is the field this run exists for, so it is on the row an
 * admin reads before choosing the scope to import the shop into. The zone
 * (`PEN`, `BAL`, `CAN`) is recorded and decides nothing: it is coarser than a
 * region, and a price never keys on it (section 4).
 */
function tagsOf(store: LidlStore): Record<string, string> {
  const tags: Record<string, string> = {};
  if (store.regionId) {
    tags['lidl:offerRegion'] = store.regionId;
  }
  if (store.regionName) {
    tags['lidl:offerRegionName'] = store.regionName;
  }
  if (store.zone) {
    tags['lidl:zone'] = store.zone;
  }
  if (store.state) {
    tags['addr:state'] = store.state;
  }
  return tags;
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
