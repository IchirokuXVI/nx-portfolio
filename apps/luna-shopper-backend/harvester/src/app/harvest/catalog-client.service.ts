import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type CreateItemRequest,
  type CreateSupermarketLocationRequest,
  type CreateSupermarketRequest,
  type FindItemByEanResult,
  type ItemPage,
  type ItemView,
  type PriceScopeKind,
  type PriceScopePage,
  type PriceScopeView,
  type SupermarketItemBatchEntry,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
  type UpsertSupermarketItemBatchResult,
  PriceSourceKind,
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
 * **Authentication is backlog 0001 section 4.1 unchanged**: the harvester holds
 * a dedicated `HARVESTER_ACTOR_ID` uuid listed in catalog's
 * `PLATFORM_ADMIN_USER_IDS`, so every write it makes passes the existing platform
 * admin gate and is attributable in the log exactly like the owner's own writes.
 * No new authorization machinery, and no shared secret.
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
          'this run makes. Set it to a uuid and add that uuid to catalog\'s ' +
          'PLATFORM_ADMIN_USER_IDS.'
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

  // --- Writes --------------------------------------------------------------

  createSupermarket(
    input: Omit<CreateSupermarketRequest, 'userId'>
  ): Promise<SupermarketView> {
    return this.send(SUPERMARKET_PATTERNS.create, {
      userId: this.actor(),
      ...input,
    });
  }

  createPriceScope(
    supermarketId: string,
    kind: PriceScopeKind,
    externalKey: string | null
  ): Promise<PriceScopeView> {
    return this.send(PRICE_SCOPE_PATTERNS.create, {
      userId: this.actor(),
      supermarketId,
      kind,
      externalKey,
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
   * Write a batch of prices for one scope. Section 6.5 is applied on catalog's
   * side, per entry, and the entries it declined come back in `skipped` so the
   * run can report the disagreement rather than swallow it.
   */
  upsertPrices(
    priceScopeId: string,
    entries: SupermarketItemBatchEntry[],
    priceSourceKind: PriceSourceKind = PriceSourceKind.OFFICIAL_API
  ): Promise<UpsertSupermarketItemBatchResult> {
    return this.send(SUPERMARKET_ITEM_PATTERNS.upsertBatch, {
      userId: this.actor(),
      priceScopeId,
      priceSourceKind,
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
