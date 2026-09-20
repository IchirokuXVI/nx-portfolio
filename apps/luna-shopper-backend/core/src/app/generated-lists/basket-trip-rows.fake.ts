import type { DataSource, EntityManager } from 'typeorm';
import { GeneratedList } from '../entities';
import type { BasketTripRowsService } from './basket-trip-rows.service';

/**
 * The freeze and the thaw, recorded rather than run (plan 0135, section 3).
 *
 * Every unit spec of `GeneratedListService.update` needs one, because the
 * service calls it inside the transaction that moves the status, and none of
 * them has a database. What a spec asserts is `calls`: which of the two ran, for
 * which basket, and in which order against the announcements.
 */
export interface FakeBasketTripRows {
  service: BasketTripRowsService;
  /** Every call, in order. */
  calls: { call: 'freeze' | 'thaw'; basketId: string }[];
}

/**
 * A recording {@link BasketTripRowsService}.
 *
 * `throwOn` makes one of the two fail, which is how "a freeze that throws leaves
 * the status unchanged and announces nothing" is stated without a database.
 */
export function fakeBasketTripRows(
  throwOn?: 'freeze' | 'thaw'
): FakeBasketTripRows {
  const calls: FakeBasketTripRows['calls'] = [];
  const record = async (call: 'freeze' | 'thaw', basketId: string) => {
    calls.push({ call, basketId });
    if (throwOn === call) {
      throw new Error(`the ${call} failed`);
    }
  };
  return {
    calls,
    service: {
      freeze: (_manager: EntityManager, basketId: string) =>
        record('freeze', basketId),
      thaw: (_manager: EntityManager, basketId: string) =>
        record('thaw', basketId),
    } as unknown as BasketTripRowsService,
  };
}

/**
 * A `DataSource` whose `transaction` runs its callback against one basket
 * repository, for the specs of `GeneratedListService.update`.
 *
 * The method locks and re-reads the basket inside the transaction (plan 0135,
 * section 3.1), so a spec that already has a `lists` fake needs only to have
 * `manager.findOne(GeneratedList, …)` and `manager.getRepository(GeneratedList)`
 * reach it.
 *
 * **The callback is awaited and its error is not caught**, so a spec sees the
 * rejection the real transaction would raise. Nothing here rolls anything back:
 * the fakes record what was asked rather than storing it, and a spec that cares
 * asserts the recording.
 */
export function fakeUpdateDataSource(lists: unknown): DataSource {
  const manager = {
    findOne: async (entity: unknown, options: unknown) => {
      if (entity !== GeneratedList) {
        throw new Error('the update reads baskets and nothing else');
      }
      return (
        lists as { findOne: (options: unknown) => Promise<unknown> }
      ).findOne(options);
    },
    getRepository: (entity: unknown) => {
      if (entity !== GeneratedList) {
        throw new Error('the update writes baskets and nothing else');
      }
      return lists;
    },
  };
  return {
    transaction: async <T>(work: (m: unknown) => Promise<T>): Promise<T> =>
      work(manager),
  } as unknown as DataSource;
}
