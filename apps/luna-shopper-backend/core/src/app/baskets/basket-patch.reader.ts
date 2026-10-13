import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PURCHASE_SESSION_GAP_MS,
  type BasketEntryPatch,
  type BasketKind,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { Basket } from '../entities';
import { basketScopeOf, standingSkipsOf, toEntries } from './basket-line-facts';
import {
  BASKET_ELSEWHERE_SQL,
  BASKET_SETTLEMENTS_SQL,
  COVERED_LINES_BY_ID_SQL,
  type BasketElsewhereRow,
  type BasketSettlementRow,
  type CoveredLineRow,
} from './basket-read.sql';
import { toEntryPatch } from './basket-rows';

/** An open basket, as much of it as a patch is computed from. */
export interface PatchedBasket {
  basketId: string;
  kind: BasketKind;
}

/**
 * What one basket reads of a few lines, now (plan 0204, section 3).
 *
 * The basket read, narrowed to the lines a write named. It runs the read's own
 * statements with the read's own parameters and maps them with the read's own
 * functions, so a patch is the entry that a read made at the same instant would
 * serve. **Nothing here is a second copy of a rule.**
 *
 * ## What it costs
 *
 * At most five queries for one basket, whatever the number of lines: the
 * session of a `LIVE` basket, the lines, this basket's purchases of them, what
 * other baskets bought lately, and the standing skips. A `GENERATED` basket has
 * no session to ask about, and a `LIVE` basket with no session has no purchases
 * in scope, so each of those is four.
 *
 * It reads no product set, no walk history, no permission and no person. None
 * of them is in a patch.
 *
 * ## The basket is open
 *
 * A caller hands it a basket that the coverage just answered, and the coverage
 * answers open baskets alone. So the window of purchases made elsewhere is
 * always the open one, and the skips are always asked.
 */
@Injectable()
export class BasketPatchReader {
  /** How long a skip, and a `LIVE` basket's close, keep a row marked (0137). */
  private readonly skipWindowMs: number;

  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.skipWindowMs =
      configService.getOrThrow<CoreConfig>('core').basket.skipWindowMs;
  }

  /**
   * The patch of each of these lines that is a row of the basket.
   *
   * A line that is not in the answer **left the basket**: it is at zero with no
   * purchase that keeps it a row, or it was deleted or rejected. The read's own
   * predicates decide that, which is why they are not restated here.
   *
   * `listIds` are the lists the lines are in. The caller knows them, and they
   * are covered by construction: the baskets it asks for are the ones that
   * cover them.
   */
  async entriesOf(
    basket: PatchedBasket,
    listIds: readonly string[],
    lineIds: readonly string[]
  ): Promise<BasketEntryPatch[]> {
    if (lineIds.length === 0) {
      return [];
    }
    const scope = await basketScopeOf(this.baskets, {
      id: basket.basketId,
      kind: basket.kind,
    });
    const lines = await this.baskets.query<CoveredLineRow[]>(
      COVERED_LINES_BY_ID_SQL,
      [
        [...listIds],
        basket.basketId,
        scope.startedAt,
        scope.enabled,
        PURCHASE_SESSION_GAP_MS,
        [...lineIds],
      ]
    );
    if (lines.length === 0) {
      return [];
    }

    const covered = lines.map((line) => line.id);
    const [settlements, elsewhere, skips] = await Promise.all([
      scope.enabled
        ? this.baskets.query<BasketSettlementRow[]>(BASKET_SETTLEMENTS_SQL, [
            basket.basketId,
            covered,
            scope.startedAt,
            this.skipWindowMs,
          ])
        : Promise.resolve([]),
      this.baskets.query<BasketElsewhereRow[]>(BASKET_ELSEWHERE_SQL, [
        basket.basketId,
        covered,
        PURCHASE_SESSION_GAP_MS,
      ]),
      standingSkipsOf(this.baskets, basket.basketId, this.skipWindowMs),
    ]);

    const facts = { skips, kind: basket.kind };
    // No product sets: a patch names no product, and the entries are not
    // grouped into rows here.
    return toEntries(lines, [], settlements, elsewhere).map((entry) =>
      toEntryPatch(entry, facts)
    );
  }
}
