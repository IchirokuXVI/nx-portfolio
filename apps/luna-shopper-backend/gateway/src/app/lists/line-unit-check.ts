import {
  ITEM_LOOKUP_LIMITS,
  ITEM_PATTERNS,
  LINE_PATTERNS,
  lineUnitsOf,
  type GetItemsRequest,
  type GetItemsResult,
  type LineUnit,
  type LineUnitBasis,
  type LineUnitBasisRequest,
  type ProductSizing,
} from '@portfolio/luna-shopper/contracts';
import { LineUnitNotOfferedException } from '@portfolio/luna-shopper/platform';
import type { NatsClient } from '../messaging/nats-client';

/**
 * The unit a line is allowed (plan 0246, section 4.2 and M3).
 *
 * Core stores the unit it is told. The gateway is the one place that holds
 * the line and the catalog together, so it refuses a unit none of the line's
 * products can be counted in, with `line_unit_not_offered` and the units the
 * line does offer in `details.offered`.
 *
 * - **A free text line offers `UNIT` alone**, and needs no catalog read.
 * - **A product the catalog no longer names offers nothing** and does not
 *   widen the set. A line whose products the catalog names none of is read as
 *   the free text line it now is.
 * - **A catalog that does not answer refuses nothing.** Unknown and slow must
 *   not look the same, as on a settle: the write goes on, and core stores the
 *   unit as it does for every caller.
 *
 * A plain class over the client rather than a provider, so the controllers it
 * serves keep the constructors their specs build them with.
 */
export class LineUnitCheck {
  constructor(private readonly nats: NatsClient) {}

  /**
   * Refuse each `unit` that its products do not offer. One catalog read for
   * every item, so a batch add costs one round trip.
   */
  async assertOffered(
    writes: readonly { unit: LineUnit; itemIds: readonly string[] }[]
  ): Promise<void> {
    const needed = writes.filter(
      (write) => write.unit !== 'UNIT' || write.itemIds.length > 0
    );
    if (needed.length === 0) {
      return;
    }
    const sizing = await this.sizingOf(
      needed.flatMap((write) => [...write.itemIds])
    );
    if (sizing === null) {
      return;
    }
    for (const write of needed) {
      const offered = lineUnitsOf(
        write.itemIds
          .map((id) => sizing.get(id))
          .filter((found): found is ProductSizing => found !== undefined)
      );
      if (!offered.includes(write.unit)) {
        throw new LineUnitNotOfferedException(
          `The products of this line cannot be counted in ${write.unit}`,
          { details: { offered } }
        );
      }
    }
  }

  /**
   * What an edit leaves the line counting in and holding, read from core when
   * the edit does not say (plan 0246, section 3.2). Null when core could not
   * answer: the edit then goes to core, which answers the real refusal.
   */
  async basisOf(userId: string, lineId: string): Promise<LineUnitBasis | null> {
    const req: LineUnitBasisRequest = { userId, lineId };
    try {
      return await this.nats.send<LineUnitBasis>(LINE_PATTERNS.unitBasis, req);
    } catch {
      return null;
    }
  }

  /** The size fields of these products by id, or null when catalog failed. */
  private async sizingOf(
    itemIds: readonly string[]
  ): Promise<Map<string, ProductSizing> | null> {
    const ids = [...new Set(itemIds)];
    const sizing = new Map<string, ProductSizing>();
    for (let at = 0; at < ids.length; at += ITEM_LOOKUP_LIMITS.maxIds) {
      // No scopes, so catalog reads no price: the size fields are enough.
      const req: GetItemsRequest = {
        ids: ids.slice(at, at + ITEM_LOOKUP_LIMITS.maxIds),
      };
      try {
        const found = await this.nats.send<GetItemsResult>(
          ITEM_PATTERNS.getMany,
          req
        );
        if (!Array.isArray(found?.items)) {
          return null;
        }
        for (const item of found.items) {
          sizing.set(item.id, {
            defaultUnit: item.defaultUnit,
            unitSize: item.unitSize ?? null,
            approxWeight: item.approxWeight ?? null,
          });
        }
      } catch {
        return null;
      }
    }
    return sizing;
  }
}
