import type { BasketAnnouncer } from './basket-announcer.service';
import type { CoveringBasket } from './basket-coverage.sql';

/**
 * A {@link BasketAnnouncer} that records what it was told and reaches nothing.
 *
 * Plan 0139 gave nine services a dependency on the announcer, and every spec of
 * those services builds them positionally. One fake here rather than one per
 * spec, so a tenth method added later is added once.
 *
 * Every method is a `jest.fn`, so a spec that cares asserts on it and a spec
 * that does not simply passes it in. The announcement is not part of any write's
 * answer, which is what makes that safe: nothing under test reads what comes
 * back.
 */
export interface FakeBasketAnnouncer extends BasketAnnouncer {
  linesChanged: jest.Mock;
  linesChangedAcross: jest.Mock;
  basketChanged: jest.Mock;
  coverageMoved: jest.Mock;
  openBaskets: jest.Mock;
  coverageMovedTo: jest.Mock;
}

/** One fake, fresh per spec. `openBaskets` answers no baskets by default. */
export function fakeBasketAnnouncer(): FakeBasketAnnouncer {
  return {
    linesChanged: jest.fn().mockResolvedValue(undefined),
    linesChangedAcross: jest.fn().mockResolvedValue(undefined),
    basketChanged: jest.fn(),
    coverageMoved: jest.fn().mockResolvedValue(undefined),
    openBaskets: jest.fn().mockResolvedValue([] as CoveringBasket[]),
    coverageMovedTo: jest.fn(),
  } as unknown as FakeBasketAnnouncer;
}
