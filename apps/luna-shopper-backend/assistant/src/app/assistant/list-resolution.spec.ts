import { ListResolutionBranch } from '@portfolio/luna-shopper/contracts';
import { resolveList, type ContextList } from './list-resolution';

/**
 * The four branches of section 6.1, which are the thing this whole test is meant
 * to measure: how often the app can infer the list without asking.
 *
 * The property every case here is really asserting is the plan's own sentence — a
 * write that guessed is worse than a question — so ambiguity resolving to
 * `ASKED` is the assertion, not a fallback nobody looked at.
 */
const flat: ContextList = {
  listId: 'list-flat',
  listName: 'Piso',
  zoneId: 'zone-home',
  zoneName: 'Casa',
};
const beach: ContextList = {
  listId: 'list-beach',
  listName: 'Casa de la playa',
  zoneId: 'zone-beach',
  zoneName: 'Playa',
};
const weekly: ContextList = {
  listId: 'list-weekly',
  listName: 'Compra semanal',
  zoneId: 'zone-home',
  zoneName: 'Casa',
};

describe('resolveList', () => {
  describe('1. the list the caller named', () => {
    it('matches a named list against the index', () => {
      const result = resolveList({
        named: 'Piso',
        transcript: [],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: flat,
      });
    });

    it('matches ignoring case, accents and punctuation', () => {
      // Somebody typing on a phone writes "compra semanal" for a list they
      // created as "Compra Semanál". Matching that is the ordinary case.
      const result = resolveList({
        named: 'compra semanál',
        transcript: [],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: weekly,
      });
    });

    it('prefers an exact match over a longer list that contains it', () => {
      const casa: ContextList = {
        ...flat,
        listId: 'list-casa',
        listName: 'Casa',
      };

      const result = resolveList({
        named: 'Casa',
        transcript: [],
        lists: [casa, beach],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: casa,
      });
    });

    it('asks rather than guessing when a name matches two lists', () => {
      const one: ContextList = {
        ...flat,
        listId: 'a',
        listName: 'Compra casa',
      };
      const two: ContextList = {
        ...beach,
        listId: 'b',
        listName: 'Compra playa',
      };

      const result = resolveList({
        named: 'Compra',
        transcript: [],
        lists: [one, two],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.ASKED,
        candidates: [one, two],
      });
    });

    it('asks when the name matches nothing, rather than falling back to the only list', () => {
      // The dangerous case: one list plus a name that does not fit it. Branch 3
      // must not rescue a name the caller plainly meant to be different, because
      // the write would land somewhere they did not ask for.
      const result = resolveList({
        named: 'Lista del trabajo',
        transcript: [],
        lists: [flat],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.ASKED,
        candidates: [flat],
      });
    });

    it('narrows by zone when the caller named one', () => {
      const homeCopy: ContextList = {
        listId: 'home-compra',
        listName: 'Compra',
        zoneId: 'zone-home',
        zoneName: 'Casa',
      };
      const beachCopy: ContextList = {
        listId: 'beach-compra',
        listName: 'Compra',
        zoneId: 'zone-beach',
        zoneName: 'Playa',
      };

      const result = resolveList({
        named: 'Compra',
        zone: 'Playa',
        transcript: [],
        lists: [homeCopy, beachCopy],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: beachCopy,
      });
    });
  });

  describe('2. the list the conversation has been about', () => {
    it('uses the one list the transcript names', () => {
      const result = resolveList({
        transcript: ['que hay en la compra semanal?', 'Hay leche y pan.'],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.CONVERSATION,
        list: weekly,
      });
    });

    it('asks when the transcript names two', () => {
      const result = resolveList({
        transcript: ['compara Piso con Compra semanal'],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.ASKED,
        candidates: [flat, weekly],
      });
    });

    it('does not find a list name inside a longer word', () => {
      // "Piso" must not be found inside "pisotón". A person would not read it
      // that way, and a write is the wrong place to be generous.
      const result = resolveList({
        transcript: ['me he dado un pisoton en el pie'],
        lists: [flat, beach],
      });

      expect(result.branch).toBe(ListResolutionBranch.ASKED);
    });
  });

  describe('3. the only list there is', () => {
    it('uses it when nothing else answered', () => {
      const result = resolveList({
        transcript: ['añade leche'],
        lists: [flat],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.ONLY_LIST,
        list: flat,
      });
    });
  });

  describe('4. ask', () => {
    it('asks when there are several lists and no signal at all', () => {
      const result = resolveList({
        transcript: ['añade leche'],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.ASKED,
        candidates: [flat, beach, weekly],
      });
    });

    it('asks when the caller can see no lists', () => {
      const result = resolveList({ transcript: ['añade leche'], lists: [] });

      expect(result).toEqual({
        branch: ListResolutionBranch.ASKED,
        candidates: [],
      });
    });
  });

  /**
   * A tapped chip is an ordinary typed turn (plan 0046, section 4.3).
   *
   * The whole guarantee behind offering a chip at all is that what it sends
   * comes back and resolves, so the round trip is asserted here rather than
   * against a model: the chip's `message` is fed in as the next turn's `named`
   * and has to take the NAMED branch to the list it came from. A chip whose text
   * did not resolve would fail silently, with the assistant asking the same
   * question again.
   */
  describe('a tapped choice comes back and resolves', () => {
    it('resolves the bare list name a chip sends', () => {
      const result = resolveList({
        named: 'Piso',
        transcript: ['añade leche', '¿En cuál?'],
        lists: [flat, beach, weekly],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: flat,
      });
    });

    it('resolves the zone qualified name a chip sends when two share one', () => {
      // "Compra (Casa)" is what a chip sends when another candidate is also
      // called "Compra". The parentheses are punctuation, which `normalize`
      // flattens, so what matches is the name plus the zone.
      const homeShop: ContextList = {
        listId: 'list-home-shop',
        listName: 'Compra',
        zoneId: 'zone-home',
        zoneName: 'Casa',
      };
      const beachShop: ContextList = {
        listId: 'list-beach-shop',
        listName: 'Compra',
        zoneId: 'zone-beach',
        zoneName: 'Playa',
      };

      // No `zone` argument: the chip's whole text arrives as the name, which is
      // the case that has to work, because nothing makes the model split it.
      const result = resolveList({
        named: 'Compra (Playa)',
        transcript: ['añade leche'],
        lists: [homeShop, beachShop],
      });

      expect(result).toEqual({
        branch: ListResolutionBranch.NAMED,
        list: beachShop,
      });
    });
  });
});
