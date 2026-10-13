import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { needsPriceChoice } from '@portfolio/luna-shopper/basket-rules';
import type {
  BasketPriceChoicesView,
  BasketProductListsView,
  BasketProductListView,
  GetBasketPriceChoicesRequest,
  GetBasketProductListsRequest,
  GetLiveBasketRequest,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { Basket } from '../entities';
import { BasketLiveService } from './basket-live.service';
import { BasketReadService } from './basket-read.service';
import {
  BASKET_LIST_REFS_SQL,
  LINES_HOLDING_ITEM_SQL,
  type BasketListRefRow,
  type LineHoldingItemRow,
} from './basket-read.sql';
import { BasketWriteContext } from './basket-write.context';

/**
 * The two reads about the product of a line (plan 0201, sections 1 and 5).
 *
 * A covered line counts as one product, and core knows that product for every
 * line but one kind: a line with several products, no favourite and no buy in
 * this trip counts as the cheapest of them, and core holds no price. So the
 * gateway asks here which lines those are, prices them, and hands the picks to
 * the basket read.
 *
 * **Core still sees no price.** It answers ids and takes ids back.
 */
@Injectable()
export class BasketProductService {
  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>,
    private readonly context: BasketWriteContext,
    private readonly read: BasketReadService,
    private readonly live: BasketLiveService
  ) {}

  /** The covered lines whose product needs a price, for one reader. */
  async priceChoices(
    req: GetBasketPriceChoicesRequest
  ): Promise<BasketPriceChoicesView> {
    const opened = await this.context.open(req);
    return {
      basketId: opened.basket.id,
      participantId: opened.participant.id,
      lines: await this.choicesOf(opened.basket, opened.coveredListIds),
    };
  }

  /**
   * The same, for the permanent basket of an account.
   *
   * The live read arrives with an account and no participant, because there is
   * no participant until the basket exists. So this makes the basket as the
   * live read would, and answers the basket and the participant beside the
   * lines: the gateway needs both to ask what the basket is priced at.
   */
  async livePriceChoices(
    req: GetLiveBasketRequest
  ): Promise<BasketPriceChoicesView> {
    const { basket, participant } = await this.live.open(req.userId);
    const opened = await this.context.open({
      basketId: basket.id,
      participantId: participant.id,
    });
    return {
      basketId: basket.id,
      participantId: participant.id,
      lines: await this.choicesOf(basket, opened.coveredListIds),
    };
  }

  /**
   * The covered lists that can still take a product (section 5).
   *
   * Every covered list the actor writes themselves that holds no covered line
   * counting as that product. For each, the oldest line that holds the product
   * among its products, when the list has one: it can be at zero, and the page
   * raises it with the demand route instead of making a second line.
   *
   * ## "Counting as" is core's own answer
   *
   * It is decided with no picks, as on every path but the full read (decided
   * by the owner on 2026-10-13). So a list whose line has several products and
   * no favourite, and whose cheapest is this product, is answered here with
   * that line although the full read already draws it in the row. The client
   * holds that row and its entries, and leaves out a list it already shows.
   *
   * A guest is refused: they hold no list, so there is nothing to answer, and
   * the refusal says so instead of an empty array that reads as "every list
   * already asks for it".
   */
  async productLists(
    req: GetBasketProductListsRequest
  ): Promise<BasketProductListsView> {
    const opened = await this.context.open(req);
    if (!opened.participant.userId) {
      throw new ForbiddenException(
        'Only people with an account can add a product to a list'
      );
    }
    const writable = opened.coveredListIds.filter((listId) =>
      opened.servedListIds.has(listId)
    );
    if (writable.length === 0) {
      return { lists: [] };
    }

    const { entries, keys } = await this.read.keyedLinesOf(
      opened.basket,
      opened.coveredListIds
    );
    const asking = new Set(
      entries
        .filter((entry) => keys.productOf(entry.lineId) === req.itemId)
        .map((entry) => entry.listId)
    );
    const open = writable.filter((listId) => !asking.has(listId));
    if (open.length === 0) {
      return { lists: [] };
    }

    const [refs, holding] = await Promise.all([
      this.baskets.query<BasketListRefRow[]>(BASKET_LIST_REFS_SQL, [open]),
      this.baskets.query<LineHoldingItemRow[]>(LINES_HOLDING_ITEM_SQL, [
        open,
        req.itemId,
      ]),
    ]);
    // Oldest first for each list, so the first one seen is the one kept.
    const lineOf = new Map<string, LineHoldingItemRow>();
    for (const row of holding) {
      if (!lineOf.has(row.listId)) {
        lineOf.set(row.listId, row);
      }
    }
    return {
      lists: refs.map((ref): BasketProductListView => {
        const line = lineOf.get(ref.listId);
        return {
          listId: ref.listId,
          listName: ref.name,
          zoneId: ref.zoneId,
          zoneName: ref.zoneName,
          lineId: line?.lineId ?? null,
          lineName: line?.content ?? null,
          quantity: line ? Number(line.quantity) : null,
        };
      }),
    };
  }

  /** The covered lines that reach the step of the rule that needs a price. */
  private async choicesOf(
    basket: Basket,
    coveredListIds: readonly string[]
  ): Promise<BasketPriceChoicesView['lines']> {
    const { entries } = await this.read.keyedLinesOf(basket, coveredListIds);
    return entries
      .filter((entry) => needsPriceChoice(entry))
      .map((entry) => ({ lineId: entry.lineId, itemIds: [...entry.itemIds] }));
  }
}
