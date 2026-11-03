import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  ADMIN_ITEM_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  type AdminCredential,
  type AdminItemUsageRequest,
  type AdminItemUsageResult,
  type SourceEntryItemUsage,
  type SourceEntryItemUsageRequest,
  type SourceEntryItemUsageResult,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  getRequestContext,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { firstValueFrom, timeout } from 'rxjs';

/** Injection token for the NATS client catalog asks other services on. */
export const CATALOG_NATS_REQUESTS = 'CATALOG_NATS_REQUESTS';

/** Injection token for {@link ItemReferences}. */
export const ITEM_REFERENCES = 'ITEM_REFERENCES';

/**
 * How long catalog waits for the harvester or core to answer (plan 0239).
 *
 * Nest's NATS client waits forever, and a merge or a delete that cannot learn
 * what names a product must not go ahead on a guess, so a silent service fails
 * the write instead of hanging it until the proxy cuts the operator off.
 */
export const ITEM_REFERENCES_TIMEOUT_MS = 5000;

/** What the harvester's queue holds for one product (plan 0239). */
export type QueueUsage = Pick<
  SourceEntryItemUsage,
  'rowCount' | 'activeSupermarketIds'
>;

/**
 * What the other services hold that names a catalog product (plan 0239).
 *
 * The seam the merge and the delete read through: an interface, so a spec
 * hands in a fake and the item service never names a broker.
 */
export interface ItemReferences {
  /** The harvester's rows, per product. A product asked about is always in it. */
  queueUsage(
    credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, QueueUsage>>;
  /** Core's lines that hold each product. Always one entry per product. */
  lineUsage(
    credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, number>>;
}

/**
 * {@link ItemReferences} over NATS (plan 0239, sections 1.1 and 4).
 *
 * Catalog's first requests to another service. It forwards the operator's own
 * credential, so the harvester and core each check the operator's token
 * themselves, as they do for the gateway, and catalog holds no credential of
 * its own toward them.
 */
@Injectable()
export class NatsItemReferences implements ItemReferences {
  constructor(
    @Inject(CATALOG_NATS_REQUESTS) private readonly client: ClientProxy
  ) {}

  async queueUsage(
    credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, QueueUsage>> {
    const request: SourceEntryItemUsageRequest = {
      userId: credential.userId,
      adminToken: credential.adminToken,
      itemIds: [...itemIds],
    };
    const answer = await this.send<SourceEntryItemUsageResult>(
      SOURCE_ENTRY_PATTERNS.itemUsage,
      request
    );
    const usage = new Map<string, QueueUsage>(
      itemIds.map((id) => [id, { rowCount: 0, activeSupermarketIds: [] }])
    );
    for (const entry of answer.usage) {
      usage.set(entry.itemId, {
        rowCount: entry.rowCount,
        activeSupermarketIds: entry.activeSupermarketIds,
      });
    }
    return usage;
  }

  async lineUsage(
    credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, number>> {
    const request: AdminItemUsageRequest = {
      userId: credential.userId,
      adminToken: credential.adminToken,
      itemIds: [...itemIds],
    };
    const answer = await this.send<AdminItemUsageResult>(
      ADMIN_ITEM_PATTERNS.usage,
      request
    );
    const usage = new Map<string, number>(itemIds.map((id) => [id, 0]));
    for (const entry of answer.usage) {
      usage.set(entry.itemId, entry.listLineCount);
    }
    return usage;
  }

  private send<TResponse>(
    subject: string,
    payload: object
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
      return firstValueFrom(
        this.client
          .send<TResponse>(subject, record)
          .pipe(timeout(ITEM_REFERENCES_TIMEOUT_MS))
      );
    });
  }
}
