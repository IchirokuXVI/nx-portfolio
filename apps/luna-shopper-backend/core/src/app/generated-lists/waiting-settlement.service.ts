import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * The purchases that were made before a basket line reached any list (plan 0092
 * section 4.3, filled by plan 0093).
 *
 * ## Why the seam exists before the thing it holds
 *
 * Plan 0092 made "send this line to that list" an ordinary write: raising a
 * list's row from zero creates or adopts a line and inserts a provenance row.
 * The moment that row exists, the units this basket already bought on the line
 * have somewhere to belong, and plan 0093 re-homes them. Both places that insert
 * such a row call {@link rehome}, so plan 0093 fills one method rather than
 * finding every insert again and adding the call to each.
 *
 * ## It does nothing, and that is correct until plan 0093 lands
 *
 * Before that plan, a purchase made before the line reached a list stays where
 * plan 0055 section 6 left it, which is on the basket line and attached to no
 * list. Nothing is lost and nothing is wrong: the shopper bought the units and
 * no household has yet been told they wanted them.
 *
 * **Called inside the caller's transaction**, which is why the manager is a
 * required argument rather than a convenience. Re-homing lowers zone lines and
 * moves settlement rows, so it commits with the origin row that made it possible
 * or not at all.
 */
@Injectable()
export class WaitingSettlementService {
  /**
   * Give this line's waiting purchases to the origins it now has (plan 0093,
   * section 3).
   *
   * @param generatedListLineId the basket line whose origins just grew.
   * @param manager the caller's transaction, which this must write through.
   */
  async rehome(
    generatedListLineId: string,
    manager: EntityManager
  ): Promise<void> {
    // Deliberately empty until plan 0093. The parameters are read by nothing
    // yet, and are named rather than dropped because the signature is the
    // contract plan 0092 section 4.3 leaves behind.
    void generatedListLineId;
    void manager;
  }
}
