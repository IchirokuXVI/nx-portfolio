import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DiscoveredPlaceStatus,
  PriceScopeKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import { LidlClient, type LidlStore } from '@portfolio/luna-shopper/lidl';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { DiscoveredPlace, type SupermarketSource } from '../entities';
import { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
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
 * **It creates no shop and no chain in catalog.** The rule from plan 0038
 * section 6.1 holds: a run writes `DiscoveredPlace` rows and an admin imports
 * them, one at a time and by choice. What it does create is the price scopes,
 * because a price scope is not a shop of ours: it is the chain's own grouping,
 * and a price cannot point at one that does not exist yet.
 *
 * **Run it before the first catalog run.** A catalog run that meets a region
 * with no scope creates the scope itself, so the order is a recommendation
 * rather than a hard gate, but a run in the wrong order produces scopes with no
 * shops attached to them.
 */
@Injectable()
export class LidlStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(LidlStoreDiscoveryRunner.name);

  constructor(
    @InjectRepository(DiscoveredPlace)
    private readonly places: Repository<DiscoveredPlace>,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    const supermarketId = requireChain(input.supermarketId);
    const client = this.createClient(context, source);
    const country = (input.country || 'es').trim().toLowerCase();

    await context.setStage('STORES', 'Reading every shop the chain names');
    const stores = await client.listStores(country.toUpperCase());
    await context.setTotalPlanned(stores.length);
    this.logger.log(`Run ${context.runId}: ${stores.length} shop(s) named`);

    // The chain's own identity, so a place this run writes groups with the same
    // chain a radius search found. It is read rather than guessed: the owner
    // owns that key, and a QID typed here would be a second opinion about it.
    const chain = await this.catalog.getSupermarket(supermarketId);
    const brandName = chain.name.es ?? chain.name.en ?? null;

    await context.setStage(
      'SCOPES',
      'Creating a price scope for each offer region'
    );
    const scopes = await this.resolveScopes(supermarketId, stores);

    await context.setStage('UPSERT', `Recording ${stores.length} place(s)`);
    const seenAt = new Date();
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
      await this.upsert(store, {
        runId: context.runId,
        brandKey: chain.externalBrandKey,
        brandName,
        country,
        seenAt,
      });
      await context.report({ processed: 1 });
    }

    await context.flush();
    await context.setReport({
      stores: stores.length,
      regionsSeen: scopes.size,
      scopesCreated: [...scopes.entries()]
        .filter(([, scope]) => scope.created)
        .map(([regionId]) => regionId),
      storesWithoutRegion: withoutRegion,
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

  /** One price scope per region the store list names, created on first sight. */
  private async resolveScopes(
    supermarketId: string,
    stores: readonly LidlStore[]
  ): Promise<Map<string, { id: string; created: boolean }>> {
    const held = new Map<string, PriceScopeView>();
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listPriceScopes(supermarketId, cursor);
      for (const scope of page.items) {
        if (scope.externalKey) {
          held.set(scope.externalKey, scope);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const scopes = new Map<string, { id: string; created: boolean }>();
    for (const store of stores) {
      if (!store.regionId || scopes.has(store.regionId)) {
        continue;
      }
      const existing = held.get(store.regionId);
      if (existing) {
        scopes.set(store.regionId, { id: existing.id, created: false });
        continue;
      }
      const created = await this.catalog.createPriceScope(
        supermarketId,
        PriceScopeKind.REGION,
        store.regionId,
        store.regionName ? { es: store.regionName, en: store.regionName } : null
      );
      scopes.set(store.regionId, { id: created.id, created: true });
    }
    return scopes;
  }

  /**
   * One shop, written or refreshed.
   *
   * Re-discovery refreshes the description but **never resurrects a place the
   * owner already rejected or imported**: `status` is the owner's, and a run
   * does not get to overwrite a decision.
   */
  private async upsert(
    store: LidlStore,
    run: {
      runId: string;
      brandKey: string | null;
      brandName: string | null;
      country: string;
      seenAt: Date;
    }
  ): Promise<void> {
    const fields = {
      brandKey: run.brandKey,
      brandName: run.brandName,
      name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
      street: store.street,
      city: store.city,
      postalCode: store.postalCode,
      country: run.country,
      website: null,
      openingHours: store.openingHours,
      // The source's own fields, kept whole and unreshaped, so the region an
      // admin sees on the row is the one the chain stated (plan 0038, 8.2).
      tags: tagsOf(store),
      runId: run.runId,
      lastSeenAt: run.seenAt,
    };

    const existing = await this.places.findOne({
      where: { provider: PROVIDER, externalRef: store.externalRef },
    });
    if (existing) {
      Object.assign(existing, fields);
      await this.places.save(existing);
      return;
    }
    await this.places.save(
      this.places.create({
        provider: PROVIDER,
        externalRef: store.externalRef,
        status: DiscoveredPlaceStatus.NEW,
        firstSeenAt: run.seenAt,
        ...fields,
      })
    );
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
