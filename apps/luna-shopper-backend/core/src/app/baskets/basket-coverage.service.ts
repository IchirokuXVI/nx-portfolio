import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Basket } from '../entities';
import {
  BASKET_COVERAGE_SQL,
  BASKETS_OF_ZONE_MEMBERS_SQL,
  COVERING_BASKETS_SQL,
  type CoveredList,
  type CoveringBasket,
} from './basket-coverage.sql';

/**
 * What a basket draws from, answered now rather than read off a stored list
 * (plan 0133, section 5).
 *
 * Coverage is a **rule** (plan 0130, section 3). A `LIVE` basket covers every
 * list its owner can write, and a `GENERATED` one covers those narrowed by its
 * `basket_sources` rows, where a row naming no list names the whole zone. Both
 * are evaluated on every read, so a list created in a covered zone appears with
 * no write to the basket, and a list its owner loses `WRITE` on disappears the
 * same way.
 *
 * The two methods are one rule read from opposite ends, which is what makes them
 * provable against each other rather than only against fixtures.
 */
@Injectable()
export class BasketCoverageService {
  constructor(
    @InjectRepository(Basket)
    private readonly baskets: Repository<Basket>
  ) {}

  /**
   * The lists this basket reads, now.
   *
   * The basket is taken as a row rather than as an id so that the call site
   * reads as a question about a basket somebody has already loaded and is
   * entitled to. The query nevertheless reads the kind and the owner out of the
   * table itself, which is what stops the argument and the database disagreeing.
   *
   * A basket whose owner has left every zone covers nothing, and that is an
   * answer rather than an error: a caller asking what a basket covers is drawing
   * a screen, not authorizing anything.
   */
  async listsOf(
    basket: Pick<Basket, 'id' | 'kind' | 'ownerUserId'>
  ): Promise<CoveredList[]> {
    return this.baskets.query(BASKET_COVERAGE_SQL, [basket.id]);
  }

  /**
   * The open baskets that cover this list, now, each with its owner.
   *
   * The reverse of {@link listsOf}. Plan 0139 is its caller: every write to a
   * line of this list is a write to each of these baskets, and this is how they
   * are told.
   */
  async coveringBaskets(listId: string): Promise<CoveringBasket[]> {
    return this.baskets.query(COVERING_BASKETS_SQL, [listId]);
  }

  /**
   * Every open basket owned by an approved member of this zone (plan 0139,
   * section 5).
   *
   * Asked when the **coverage** moved rather than a line, where naming the
   * baskets that gained or lost a list would mean answering two questions, one
   * about the state before the write and one about the state after it. This
   * superset needs neither and the announcement it carries says nothing beyond
   * "read again", so a basket that was unaffected pays one debounced read.
   */
  async basketsOfZoneMembers(zoneId: string): Promise<CoveringBasket[]> {
    return this.baskets.query(BASKETS_OF_ZONE_MEMBERS_SQL, [zoneId]);
  }
}
