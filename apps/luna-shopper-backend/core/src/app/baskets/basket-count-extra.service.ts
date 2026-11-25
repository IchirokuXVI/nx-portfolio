import { Injectable } from '@nestjs/common';
import {
  isOpenBasket,
  type BasketRowResult,
  type CountBasketRowExtraRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  BasketFinishedException,
  ForbiddenException,
} from '@portfolio/luna-shopper/platform';
import { assertLineUnit, requireLineUnit } from '../lists/line-unit-rules';
import { LineService } from '../lists/line.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketWriteContext } from './basket-write.context';

/**
 * "Count the extra" from the basket (plan 0276, section 9).
 *
 * A raise of a row's demand takes the units bought above the ask into the
 * ask, and its report offers to count them toward the raise. This is that
 * answer: the line goes down by `amount`, and the extra stays inside the ask.
 *
 * It is the demand's sibling, and it opens the basket as the demand does:
 * refused on a finished basket, the line named by the demand's own rule
 * ({@link BasketDemandService.pick}), and plan 0131's `canChangeDemand` asked
 * of the basket's **owner**, never of the actor. The write is
 * `LineService.countExtra` as the owner with the basket as `via`, so the
 * approval rule, the change row and the events are the list's own.
 */
@Injectable()
export class BasketCountExtraService {
  constructor(
    private readonly context: BasketWriteContext,
    private readonly demand: BasketDemandService,
    private readonly lines: LineService
  ) {}

  async countExtra(req: CountBasketRowExtraRequest): Promise<BasketRowResult> {
    const opened = await this.context.open(req);
    if (!isOpenBasket(opened.basket.status)) {
      throw new BasketFinishedException(
        'This basket is finished, so what it asks for cannot be changed'
      );
    }
    // Refused before anything else is read, as the demand refuses it.
    requireLineUnit(req.unit);

    const entry = await this.demand.pick(opened, req);
    assertLineUnit(entry, req.unit);
    if (!(await this.demand.ownerMayChange(opened.basket.ownerUserId, entry))) {
      throw new ForbiddenException(
        'This list does not allow its quantity to be changed from here'
      );
    }

    // `expect` is the entry's `left`, the line's quantity, which the count
    // checks against the row its lock reads. Its announcement tells every
    // basket that covers the list, this one included.
    const counted = await this.lines.countExtra({
      userId: opened.basket.ownerUserId,
      lineId: entry.id,
      unit: req.unit,
      amount: req.amount,
      expect: req.expect,
      via: opened.via(),
    });
    return { ...(await opened.result([entry.id])), counted: counted.counted };
  }
}
