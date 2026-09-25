import { ParticipantKind } from '@portfolio/luna-shopper/contracts';
import type { BasketParticipant } from '../entities';
import { BasketRedaction } from './basket-redaction';

/**
 * Who is told what about the households behind a basket (plan 0136, section
 * 3.4).
 *
 * Two questions with two different answers, which is the whole point of the
 * file: which lists a reader may see named is **per list**, and whether they are
 * served shop addresses is not a question about any list at all.
 */

function participant(
  over: Partial<BasketParticipant> = {}
): BasketParticipant {
  return {
    id: 'p1',
    kind: ParticipantKind.REGISTERED,
    userId: 'u1',
    invitedAt: null,
    ...over,
  } as BasketParticipant;
}

describe('the lists a reader is served', () => {
  it('serves the ones they write themselves and no others', () => {
    // `writableAmong(reader, coverage)` is asked by the caller, so the rule is
    // the intersection of the coverage with the reader's own `WRITE`.
    const redaction = BasketRedaction.of(
      participant(),
      new Set(['list-a'])
    );

    expect([...redaction.servedListIds]).toEqual(['list-a']);
  });

  it('serves a guest none, and costs no query to say so', () => {
    // A guest holds no account and therefore no list. `none` exists so the
    // caller skips the access read entirely rather than running it and throwing
    // the answer away, which is the difference between a rule and a filter.
    const redaction = BasketRedaction.none(
      participant({ kind: ParticipantKind.GUEST, userId: null })
    );

    expect(redaction.servedListIds.size).toBe(0);
  });
});

describe('who is served shop addresses (plan 0163, section 4)', () => {
  it('serves the owner', () => {
    expect(
      BasketRedaction.of(
        participant({ kind: ParticipantKind.OWNER }),
        new Set()
      ).servesLocations
    ).toBe(true);
  });

  it('serves a named person', () => {
    // Somebody the owner added from their groups. `invitedAt` is what says so.
    expect(
      BasketRedaction.of(
        participant({ invitedAt: new Date() }),
        new Set(['list-a'])
      ).servesLocations
    ).toBe(true);
  });

  // Plan 0163 reverses plan 0136 section 2 here, as the user decided on
  // 2026-09-24: a guest picks the shop they are standing in from the same list
  // the owner sees. The cost, that a link tells its holder roughly where the
  // owner shops, is written on `servesLocations` itself.
  it('serves a registered link visitor, and the per list rule is unchanged', () => {
    const redaction = BasketRedaction.of(
      participant(),
      new Set(['list-a', 'list-b'])
    );

    expect(redaction.servedListIds.size).toBe(2);
    expect(redaction.servesLocations).toBe(true);
  });

  it('serves a guest who holds nothing but the link', () => {
    const redaction = BasketRedaction.none(
      participant({ kind: ParticipantKind.GUEST, userId: null })
    );

    expect(redaction.servedListIds.size).toBe(0);
    expect(redaction.servesLocations).toBe(true);
  });
});

describe('the unredacted reader', () => {
  it('serves everything, for a caller that is not a reader at all', () => {
    // The history counts, the admin detail and the finish read the rows to
    // count or freeze them rather than to draw them for somebody. There is no
    // participant to measure, so inventing one would be a lie in whichever
    // direction it was pointed.
    const redaction = BasketRedaction.unredacted(['list-a', 'list-b']);

    expect([...redaction.servedListIds]).toEqual(['list-a', 'list-b']);
    expect(redaction.servesLocations).toBe(true);
  });
});
