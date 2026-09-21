import type { Basket, BasketParticipant, BasketProgress } from './basket-view';
import { basketProgressSentence, selectBasketSurface } from './basket-view';
import type { BasketKind, BasketStatus, ParticipantKind } from './enums';

function person(
  kind: ParticipantKind,
  overrides: Partial<BasketParticipant> = {}
): BasketParticipant {
  return {
    id: `p-${kind.toLowerCase()}`,
    kind,
    displayName: null,
    username: null,
    guestNumber: null,
    userId: null,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: null,
    ...overrides,
  };
}

function progress(overrides: Partial<BasketProgress> = {}): BasketProgress {
  return { done: 0, unavailable: 0, total: 0, ...overrides };
}

function basket(
  overrides: Partial<Basket> & { kind: BasketKind; status?: BasketStatus } = {
    kind: 'GENERATED',
  }
): Basket {
  return {
    id: 'basket-1',
    kind: 'GENERATED',
    name: null,
    status: 'OPEN',
    createdAt: null,
    rows: [],
    lists: [],
    participants: [],
    me: person('OWNER'),
    products: new Map(),
    scopes: new Map(),
    progress: progress(),
    pending: 0,
    ...overrides,
  };
}

/**
 * The sentence above the rows, which is a different sentence per kind (velista
 * `0091`, section 4).
 *
 * The `LIVE` half is the one worth the spec. A basket that is never finished
 * counts `done` over the current shopping session alone, so "3 of 40 got" is
 * true and reads as a failure; what the screen exists to answer is what is left.
 */
describe('basketProgressSentence', () => {
  it('counts a generated trip the way it always did', () => {
    expect(
      basketProgressSentence('GENERATED', progress({ done: 3, total: 12 }), 9)
    ).toEqual({
      key: 'basket.progress',
      args: { done: 3, total: 12 },
      unavailable: 0,
    });
  });

  it('says what is left when nothing has been bought this trip', () => {
    expect(
      basketProgressSentence('LIVE', progress({ done: 0, total: 12 }), 12)
    ).toEqual({
      key: 'basket.live.left',
      args: { pending: 12 },
      unavailable: 0,
    });
  });

  it('says what is left first, then what this trip got', () => {
    expect(
      basketProgressSentence('LIVE', progress({ done: 3, total: 15 }), 12)
    ).toEqual({
      key: 'basket.live.leftAndGot',
      args: { pending: 12, done: 3 },
      unavailable: 0,
    });
  });

  it('says nothing is left, and what the trip came to', () => {
    expect(
      basketProgressSentence('LIVE', progress({ done: 3, total: 3 }), 0)
    ).toEqual({
      key: 'basket.live.allGot',
      args: { done: 3 },
      unavailable: 0,
    });
  });

  it('says nothing got this trip rather than congratulating an empty one', () => {
    // Nothing left and nothing bought: every row is one the shop had none of.
    // "Nothing left, 0 got this trip" would be a sentence about a trip that
    // happened, so it says "0 to buy" beside the clause that explains it.
    expect(
      basketProgressSentence(
        'LIVE',
        progress({ done: 0, unavailable: 2, total: 2 }),
        0
      )
    ).toEqual({
      key: 'basket.live.left',
      args: { pending: 0 },
      unavailable: 2,
    });
  });

  it('carries the unavailable count beside every sentence, not inside it', () => {
    // A different claim from a purchase, appended as its own clause by whatever
    // draws the sentence, so nothing can fold a shop that had none into a count
    // of shopping done.
    expect(
      basketProgressSentence(
        'LIVE',
        progress({ done: 1, unavailable: 2, total: 6 }),
        3
      ).unavailable
    ).toBe(2);
  });
});

/**
 * The page, by the kind of basket it is drawing (velista `0091`, section 3).
 *
 * One spec per row of that table, because each row is a control that must not
 * appear on a basket nobody ever finishes.
 */
describe('selectBasketSurface', () => {
  describe('a generated basket', () => {
    const generated = basket({ kind: 'GENERATED', name: 'Saturday shop' });

    it('is titled by the basket itself, name or date', () => {
      expect(selectBasketSurface(generated, person('OWNER')).title).toEqual({
        kind: 'basket',
      });
    });

    it('explains nothing under the heading', () => {
      expect(
        selectBasketSurface(generated, person('OWNER')).hintKey
      ).toBeNull();
    });

    it('offers the owner the finish control while it is open', () => {
      expect(selectBasketSurface(generated, person('OWNER')).finish).toBe(true);
      expect(selectBasketSurface(generated, person('REGISTERED')).finish).toBe(
        false
      );
      expect(selectBasketSurface(generated, person('GUEST')).finish).toBe(
        false
      );
    });

    it('asks the owner whether the trip is over once nothing is pending', () => {
      const settled = basket({
        kind: 'GENERATED',
        rows: [{ rowKey: 'r-1' }] as unknown as Basket['rows'],
        pending: 0,
      });

      expect(selectBasketSurface(settled, person('OWNER')).allDone).toBe(true);
    });

    it('asks nobody about a basket that arrived empty', () => {
      expect(selectBasketSurface(generated, person('OWNER')).allDone).toBe(
        false
      );
    });

    it('draws the banner when the trip is over', () => {
      const finished = basket({ kind: 'GENERATED', status: 'FINISHED' });

      expect(
        selectBasketSurface(finished, person('OWNER')).finishedBanner
      ).toBe(true);
      // And no finish control beside it: there is nothing left to finish.
      expect(selectBasketSurface(finished, person('OWNER')).finish).toBe(false);
    });

    it('draws presence, and sends the owner back to the history', () => {
      const surface = selectBasketSurface(generated, person('OWNER'));

      expect(surface.presence).toBe(true);
      expect(surface.back).toBe('history');
    });

    it('sends everybody else back to the dashboard', () => {
      // The history lists the reader's own baskets, and a basket somebody shared
      // with them is not one of those.
      expect(selectBasketSurface(generated, person('REGISTERED')).back).toBe(
        'home'
      );
    });
  });

  describe('the basket that is always there', () => {
    const live = basket({ kind: 'LIVE' });

    it('is titled by words this app owns, for its owner', () => {
      expect(selectBasketSurface(live, person('OWNER')).title).toEqual({
        kind: 'key',
        key: 'basket.live.title',
      });
    });

    it('names the owner for anybody else, from their participant row', () => {
      const shared = basket({
        kind: 'LIVE',
        participants: [person('OWNER', { displayName: 'Ana' })],
      });

      expect(selectBasketSurface(shared, person('REGISTERED')).title).toEqual({
        kind: 'key',
        key: 'basket.live.titleOf',
        args: { name: 'Ana' },
      });
    });

    it('prefers a display name and falls back to the username', () => {
      const shared = basket({
        kind: 'LIVE',
        participants: [person('OWNER', { username: 'ana' })],
      });

      expect(selectBasketSurface(shared, person('GUEST')).title).toEqual({
        kind: 'key',
        key: 'basket.live.titleOf',
        args: { name: 'ana' },
      });
    });

    it('says whose it is not at all rather than saying "undefined"', () => {
      // An owner with neither name is titled as though the reader owned it: less
      // specific is better than a heading with a hole in it.
      expect(selectBasketSurface(live, person('REGISTERED')).title).toEqual({
        kind: 'key',
        key: 'basket.live.title',
      });
    });

    it('explains itself in one line under the heading', () => {
      expect(selectBasketSurface(live, person('OWNER')).hintKey).toBe(
        'basket.live.hint'
      );
    });

    it('offers no finish, to anybody, ever', () => {
      // The route carries no `finish` child either. Both, because a control that
      // is not drawn still leaves a URL, and a URL that is not routed still
      // leaves a control.
      expect(selectBasketSurface(live, person('OWNER')).finish).toBe(false);
    });

    it('never asks whether the trip is over', () => {
      const settled = basket({
        kind: 'LIVE',
        rows: [{ rowKey: 'r-1' }] as unknown as Basket['rows'],
        pending: 0,
      });

      expect(selectBasketSurface(settled, person('OWNER')).allDone).toBe(false);
    });

    it('never draws the finished banner, because the status is always open', () => {
      expect(selectBasketSurface(live, person('OWNER')).finishedBanner).toBe(
        false
      );
    });

    it('draws no faces: the server keeps no presence room for it', () => {
      expect(selectBasketSurface(live, person('OWNER')).presence).toBe(false);
    });

    it('is shareable, exactly as a generated one is', () => {
      expect(selectBasketSurface(live, person('OWNER')).share).toBe(true);
      expect(selectBasketSurface(live, person('REGISTERED')).share).toBe(false);
    });

    it('says a different thing when it is empty', () => {
      const surface = selectBasketSurface(live, person('OWNER'));

      expect(surface.emptyTitleKey).toBe('basket.live.empty');
      expect(surface.emptyBodyKey).toBe('basket.live.emptyHint');
    });

    it('goes back to the dashboard, never to the history', () => {
      expect(selectBasketSurface(live, person('OWNER')).back).toBe('home');
    });

    it('says what is left rather than counting a trip', () => {
      const shopping = basket({
        kind: 'LIVE',
        progress: progress({ done: 3, total: 15 }),
        pending: 12,
      });

      expect(selectBasketSurface(shopping, person('OWNER')).progress.key).toBe(
        'basket.live.leftAndGot'
      );
    });
  });

  /**
   * Rule D4's least capable surface: everything a kind this build has never heard
   * of withholds is a control that would change a basket, and the title falls
   * back to the basket's own because a heading is not a write.
   */
  describe('a kind this build does not recognise', () => {
    const unknown = basket({ kind: 'UNKNOWN', name: 'Saturday shop' });

    it('withholds every control the LIVE surface withholds', () => {
      const surface = selectBasketSurface(unknown, person('OWNER'));

      expect(surface.finish).toBe(false);
      expect(surface.allDone).toBe(false);
      expect(surface.finishedBanner).toBe(false);
      expect(surface.presence).toBe(false);
    });

    it('keeps the generated title, because a heading is not a control', () => {
      // The one column it does not take from the `LIVE` surface. Everything that
      // column withholds would change a basket; a name is a name.
      expect(selectBasketSurface(unknown, person('OWNER')).title).toEqual({
        kind: 'basket',
      });
    });
  });
});
