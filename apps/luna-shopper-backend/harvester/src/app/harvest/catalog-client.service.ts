import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  ITEM_PRICE_PATTERNS,
  POSTAL_CODE_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PriceSourceKind,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type AddItemPriceBatchResult,
  type CreateItemInput,
  type CreateItemRequest,
  type CreateItemsResult,
  type CreateSupermarketLocationRequest,
  type CreateSupermarketRequest,
  type DeleteItemPricesByRunResult,
  type FindItemByEanResult,
  type ItemPage,
  type ItemPriceBatchEntry,
  type ItemView,
  type LocalizedText,
  type NearbyPostalCodesView,
  type NearestPostalCodeView,
  type PostalCodeLocationCountsView,
  type PriceScopeKind,
  type PriceScopePage,
  type PriceScopeView,
  type SetSupermarketItemAvailabilityResult,
  type SetSupermarketLocationItemAvailabilityResult,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  getRequestContext,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { firstValueFrom } from 'rxjs';
import type { HarvesterConfig } from '../config/app-config';

export const CATALOG_NATS_CLIENT = 'CATALOG_NATS_CLIENT';

/**
 * The harvester's only door into catalog (plan 0038, section 4.2).
 *
 * The seam this enforces: the harvester holds `itemId`, `supermarketId`,
 * `supermarketLocationId` and `priceScopeId` as **opaque** values, never joins
 * across the boundary, and reads and writes catalog only through these subjects.
 * Nothing in the harvester imports a catalog entity, and no query in the
 * harvester's database mentions a catalog table.
 *
 * **Authentication is plan 0072, section 4**: the harvester holds a dedicated
 * `HARVESTER_ACTOR_ID` uuid, and catalog knows it as a **service** through its
 * own `SERVICE_ACTOR_IDS`. Every write passes catalog's gate on the service
 * branch, carrying no token at all. Still no shared secret.
 *
 * The harvester deliberately holds no operator token. It is a service, not an
 * admin, and giving a machine a credential shaped like a person's is how the
 * arrangement this replaced became confusing: the uuid used to sit in catalog's
 * `PLATFORM_ADMIN_USER_IDS`, which made the harvester an admin in every log line
 * and every gate that read that list.
 */
@Injectable()
export class CatalogClient {
  private readonly actorId: string;

  constructor(
    @Inject(CATALOG_NATS_CLIENT) private readonly client: ClientProxy,
    config: ConfigService
  ) {
    this.actorId = config.getOrThrow<HarvesterConfig>('harvester').actorId;
  }

  /**
   * Who catalog sees. A run started by the owner still writes as the harvester,
   * because the write is the harvester's: attributing it to the person who
   * pressed the button would hide which changes a machine made.
   */
  private actor(): string {
    if (!this.actorId) {
      throw new Error(
        'HARVESTER_ACTOR_ID is not set, so catalog would reject every write ' +
          "this run makes. Set it to a uuid and add that uuid to catalog's " +
          'SERVICE_ACTOR_IDS.'
      );
    }
    return this.actorId;
  }

  // --- Reads ---------------------------------------------------------------

  listSupermarkets(cursor?: string): Promise<SupermarketPage> {
    return this.send(SUPERMARKET_PATTERNS.list, {
      userId: this.actor(),
      cursor,
      limit: 100,
    });
  }

  getSupermarket(supermarketId: string): Promise<SupermarketView> {
    return this.send(SUPERMARKET_PATTERNS.get, {
      userId: this.actor(),
      supermarketId,
    });
  }

  listPriceScopes(
    supermarketId?: string,
    cursor?: string
  ): Promise<PriceScopePage> {
    return this.send(PRICE_SCOPE_PATTERNS.list, {
      userId: this.actor(),
      supermarketId,
      cursor,
      limit: 100,
    });
  }

  /**
   * Step 2 of the matching ladder. A lookup rather than a search: EAN is unique
   * when present, so it either finds the one item or finds nothing, and finding
   * nothing is a normal answer.
   */
  findItemByEan(ean: string): Promise<FindItemByEanResult> {
    return this.send(ITEM_PATTERNS.findByEan, { userId: this.actor(), ean });
  }

  /**
   * A page of catalog items, used to load the match index once per run. Catalog
   * is owner curated and small by construction, so the whole index fits in
   * memory; matching per product over NATS would be 4,232 round trips.
   */
  searchItems(cursor?: string): Promise<ItemPage> {
    return this.send(ITEM_PATTERNS.search, {
      userId: this.actor(),
      cursor,
      limit: 100,
    });
  }

  /**
   * How many shops catalog holds in each of these postal codes (plan 0063,
   * section 5). Zero is what makes a code **unknown** and earns it a place in
   * the discovery queue.
   *
   * The one read here that carries no actor. It is a count over rows catalog
   * already serves openly, and the codes come from an event that deliberately
   * does not say whose profile they landed on: a discovery run is about a place,
   * not a person, and naming the user would put an account id in a queue row
   * that outlives the request by a month.
   */
  countLocationsByPostalCode(
    country: string,
    postalCodes: string[]
  ): Promise<PostalCodeLocationCountsView> {
    return this.send(SUPERMARKET_LOCATION_PATTERNS.countByPostalCode, {
      country,
      postalCodes,
    });
  }

  /**
   * Which postal code a point is in, if any centroid is close enough (plan
   * 0097, section 3).
   *
   * Plan 0061 solved this once, for `SupermarketLocation`, and stopped at the
   * service boundary: nothing in the harvester called it. A discovered place
   * carries whatever `addr:postcode` OpenStreetMap had, which is about a third
   * of them, so the count of places **located in** a code would otherwise miss
   * two thirds of them silently.
   *
   * One call per untagged place, sequential, inside a run that already spends
   * minutes on two rate limited HTTP requests. A batched subject for it would be
   * a second contract to keep in step for no measured gain.
   *
   * Like the count above it, this carries no actor: it is a geography question
   * over a shipped table and it names nobody.
   */
  resolveNearestPostalCode(
    country: string,
    latitude: number,
    longitude: number,
    maxDistanceMetres: number
  ): Promise<NearestPostalCodeView> {
    return this.send(POSTAL_CODE_PATTERNS.nearest, {
      country,
      latitude,
      longitude,
      maxDistanceMetres,
    });
  }

  /**
   * The neighbours of one code, and **whether we hold the code at all**.
   *
   * The harvester asks it for `known` rather than for the neighbours: adding a
   * postal code by hand refuses a code catalog does not have, because the
   * centroid table is the whole national list and a code missing from it is a
   * typo (plan 0097, section 6.1).
   */
  nearbyPostalCodes(
    country: string,
    postalCode: string,
    radiusMetres: number
  ): Promise<NearbyPostalCodesView> {
    return this.send(POSTAL_CODE_PATTERNS.nearby, {
      country,
      postalCode,
      radiusMetres,
    });
  }

  /**
   * A chain's shops. The default name match of plan 0084, section 6 compares a
   * source's printed shop name against these labels and addresses, and
   * `sourceLocation.map` checks that the location a person picked really belongs
   * to the chain whose queue they are draining.
   *
   * A page at a time, like every other read here: the harvester holds these ids
   * opaquely and a chain has tens of shops, not thousands.
   */
  /** One shop, to check that a mapping a person made points where they think. */
  getSupermarketLocation(
    supermarketLocationId: string
  ): Promise<SupermarketLocationView> {
    return this.send(SUPERMARKET_LOCATION_PATTERNS.get, {
      userId: this.actor(),
      supermarketLocationId,
    });
  }

  listSupermarketLocations(
    supermarketId: string,
    cursor?: string
  ): Promise<SupermarketLocationPage> {
    return this.send(SUPERMARKET_LOCATION_PATTERNS.list, {
      userId: this.actor(),
      supermarketId,
      cursor,
      limit: 100,
    });
  }

  // --- Writes --------------------------------------------------------------

  createSupermarket(
    input: Omit<CreateSupermarketRequest, 'userId'>
  ): Promise<SupermarketView> {
    return this.send(SUPERMARKET_PATTERNS.create, {
      userId: this.actor(),
      ...input,
    });
  }

  /**
   * A scope, with the name the chain gave it (plan 0089, section 4).
   *
   * The label is the source's own word for the group, which is what makes a
   * list of 59 rows readable: `Huesca` beside `21` rather than `21` alone. It
   * is optional because a chain that publishes a key and no name still gets a
   * scope, which is where Mercadona's warehouse codes sit.
   */
  createPriceScope(
    supermarketId: string,
    kind: PriceScopeKind,
    externalKey: string | null,
    label: LocalizedText | null = null
  ): Promise<PriceScopeView> {
    return this.send(PRICE_SCOPE_PATTERNS.create, {
      userId: this.actor(),
      supermarketId,
      kind,
      externalKey,
      label,
    });
  }

  createLocation(
    input: Omit<CreateSupermarketLocationRequest, 'userId'>
  ): Promise<SupermarketLocationView> {
    return this.send(SUPERMARKET_LOCATION_PATTERNS.create, {
      userId: this.actor(),
      ...input,
    });
  }

  createItem(input: Omit<CreateItemRequest, 'userId'>): Promise<ItemView> {
    return this.send(ITEM_PATTERNS.create, { userId: this.actor(), ...input });
  }

  /**
   * Several products in one catalog transaction (plan 0100).
   *
   * The step a bulk decisions file needs: forty products are created or none
   * are, because the binds that follow name every one of them. The answer holds
   * one view per input, in the order they were sent.
   */
  createItems(items: CreateItemInput[]): Promise<CreateItemsResult> {
    return this.send(ITEM_PATTERNS.createMany, {
      userId: this.actor(),
      items,
    });
  }

  /**
   * Delete a product, for the one caller that has to undo its own creation.
   *
   * A bulk decisions file whose binds fail after its products were created
   * leaves those products bound by nothing, and the harvester is the only thing
   * that knows they are orphans.
   */
  deleteItem(itemId: string): Promise<{ id: string }> {
    return this.send(ITEM_PATTERNS.delete, { userId: this.actor(), itemId });
  }

  /**
   * Write a batch of prices for one scope, as this run (plan 0080, section 9).
   *
   * Every price a source gives is a row of its own, stamped with the run that
   * wrote it so a reverted run can take its rows back (plan 0082). A value the
   * current row already holds inserts nothing and comes back as `confirmed`.
   * Nothing is declined any more: an owner's price and this run's coexist, and
   * the policy decides between them on every read.
   */
  addPrices(
    priceScopeId: string,
    entries: ItemPriceBatchEntry[],
    // Nullable since plan 0086: a `source_entry_prices` row folded in by that
    // migration has no run to name, because the column it came from never
    // recorded which walk had written the number.
    sourceRunId: string | null,
    sourceKind: PriceSourceKind = PriceSourceKind.OFFICIAL_API
  ): Promise<AddItemPriceBatchResult> {
    return this.send(ITEM_PRICE_PATTERNS.addBatch, {
      userId: this.actor(),
      priceScopeId,
      sourceKind,
      sourceRunId,
      entries,
    });
  }

  /**
   * Take back everything one run said about prices (plan 0082, section 2).
   *
   * The first of a revert's two steps, and it goes first on purpose: catalog
   * and the harvester are two databases with no transaction between them, so a
   * failure after this one leaves prices gone and the run unmarked, which a
   * retry finishes. A run with no rows answers zeros rather than failing, which
   * is what makes that retry always the right response.
   */
  deletePricesByRun(sourceRunId: string): Promise<DeleteItemPricesByRunResult> {
    return this.send(ITEM_PRICE_PATTERNS.deleteByRun, {
      userId: this.actor(),
      sourceRunId,
    });
  }

  /**
   * Whether a scope carries each of these products. A separate write from the
   * prices, because a 404 from a detail call says "not stocked here" and
   * states no price (plan 0080, section 2).
   */
  setAvailability(
    priceScopeId: string,
    entries: { itemId: string; available: boolean }[]
  ): Promise<SetSupermarketItemAvailabilityResult> {
    return this.send(SUPERMARKET_ITEM_PATTERNS.setAvailability, {
      userId: this.actor(),
      priceScopeId,
      entries,
    });
  }

  /**
   * Whether one shop carries each of these products (plan 0084, section 4).
   *
   * One call per shop, carrying a value for every product the run resolved,
   * positive **and** negative: a source that names the shops carrying a product
   * says by omission that the rest do not, and throwing that away leaves the run
   * unable to state anything negative.
   *
   * Catalog decides what it may write. A row a person typed is skipped and comes
   * back in `conflicts` rather than overwritten, and the run reports the
   * disagreement instead of applying it.
   */
  setLocationAvailability(
    supermarketLocationId: string,
    entries: { itemId: string; available: boolean }[],
    sourceRunId: string | null,
    sourceKind: PriceSourceKind = PriceSourceKind.OFFICIAL_WEB,
    observedAt?: Date
  ): Promise<SetSupermarketLocationItemAvailabilityResult> {
    return this.send(SUPERMARKET_LOCATION_ITEM_PATTERNS.setAvailability, {
      userId: this.actor(),
      supermarketLocationId,
      sourceKind,
      sourceRunId,
      observedAt: observedAt?.toISOString(),
      entries,
    });
  }

  private send<TResponse>(
    subject: string,
    payload: Record<string, unknown>
  ): Promise<TResponse> {
    const context = getRequestContext();
    return traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(
          buildNatsHeaders({
            correlationId: context?.correlationId,
            locale: context?.locale,
          })
        )
        .build();
      return firstValueFrom(this.client.send<TResponse>(subject, record));
    });
  }
}
