import type { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import type { BasketLine, BasketParticipant } from '@portfolio/velista/models';
import {
  originsCaption,
  participantInitials,
  participantName,
  quantityCaption,
  touchedCaption,
} from './basket-labels';

/**
 * The row's three sentences (plan 0044, sections 4.2 and 4.3).
 *
 * A translator that echoes its key and its values rather than one that
 * interpolates, so every assertion is about **which sentence was chosen and what
 * it was given**, never about rendered English. The real translator would make
 * these tests pass or fail on a copy edit, which is not what any of them is for.
 */
const translator = {
  t: (key: string, _ns?: string, _locale?: string, values?: unknown) =>
    values === undefined ? key : `${key}:${JSON.stringify(values)}`,
} as unknown as RokuTranslatorService;

function person(over: Partial<BasketParticipant> = {}): BasketParticipant {
  return {
    id: 'p-1',
    kind: 'GUEST',
    displayName: null,
    guestNumber: 2,
    userId: null,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: 'link-1',
    ...over,
  };
}

/**
 * The owner's participant row, exactly as core creates it.
 *
 * No display name and no guest number, which is not an oversight in the fixture: it
 * is what `generated-list-sharing.service.ts` writes, and it is the shape that made
 * the whole face row draw one repeated bubble.
 */
function owner(over: Partial<BasketParticipant> = {}): BasketParticipant {
  return person({
    id: 'p-owner',
    kind: 'OWNER',
    displayName: null,
    guestNumber: null,
    userId: 'u-1',
    shareLinkId: null,
    ...over,
  });
}

function line(over: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    content: 'Milk',
    quantity: 3,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...over,
  };
}

describe('participantName', () => {
  it('shows what a guest typed', () => {
    expect(
      participantName(person({ displayName: 'Dani' }), translator, 'en')
    ).toBe('Dani');
  });

  it('gives a guest who skipped the prompt their number', () => {
    // Stable for the life of the participant and unique within the basket, which
    // is what makes "Guest 2" a name somebody can use out loud in a shop.
    expect(participantName(person(), translator, 'en')).toBe(
      'basket.people.guestNumbered:{"count":2}'
    );
  });

  it('returns the same name for two guests who typed the same thing', () => {
    // The point of backend 0051 section 3.5, asserted rather than assumed: the
    // name is for reading and the **participant** is the identity, so nothing
    // may be keyed by this and the caller must still mark both as guests.
    const one = person({ id: 'p-1', displayName: 'Dani' });
    const two = person({ id: 'p-2', displayName: 'Dani' });

    expect(participantName(one, translator, 'en')).toBe(
      participantName(two, translator, 'en')
    );
    expect(one.id).not.toBe(two.id);
  });

  it('says "you" about the reader themselves', () => {
    expect(
      participantName(person({ displayName: 'Ana' }), translator, 'en', {
        you: true,
      })
    ).toBe('basket.touched.you');
  });

  it('is empty for somebody who is not on the basket', () => {
    // A participant id that resolves to nobody, which happens when a line was
    // touched by somebody since removed. An empty name is what stops the caller
    // drawing "  got it".
    expect(participantName(undefined, translator, 'en')).toBe('');
  });

  it('does not call the owner a guest', () => {
    // Core creates the owner's participant row with no display name and no guest
    // number, so the fallback that ends at "Guest" described exactly one person:
    // whoever made the basket, on their own basket.
    expect(participantName(owner(), translator, 'en')).toBe(
      'basket.people.owner'
    );
  });

  it('names the reader from their account where the basket cannot', () => {
    // The other half of the same absence. Only the reader's own name is available,
    // because nobody else's username is on this screen at all.
    expect(
      participantName(owner(), translator, 'en', { ownName: 'Daniel' })
    ).toBe('Daniel');
  });
});

/**
 * The bubbles on the face row.
 *
 * The bug these exist for: the header sliced two characters off the label, and every
 * label began with the same word, so an owner and three guests drew four identical
 * faces. The fix has to be asserted as **difference**, not as any particular letter.
 */
describe('participantInitials', () => {
  it('tells two unnamed guests apart', () => {
    const one = participantInitials(
      person({ guestNumber: 1 }),
      translator,
      'en'
    );
    const two = participantInitials(
      person({ guestNumber: 2 }),
      translator,
      'en'
    );

    expect(one).not.toBe(two);
  });

  it('tells the owner apart from a guest', () => {
    expect(participantInitials(owner(), translator, 'en')).not.toBe(
      participantInitials(person(), translator, 'en')
    );
  });

  it('uses the initial of a name somebody typed, and not their number', () => {
    // A guest who typed "Dani" is `D`. Appending the number they also happen to
    // have would label them with a fact the screen never shows them by.
    expect(
      participantInitials(
        person({ displayName: 'dani', guestNumber: 2 }),
        translator,
        'en'
      )
    ).toBe('D');
  });

  it('does not cut a surrogate pair in half', () => {
    // `slice(0, 2)` on an emoji name drew the replacement character. Code points,
    // which is `ListViewers`' rule and `accountInitial`'s.
    const initials = participantInitials(
      person({ displayName: '🐟 Dani' }),
      translator,
      'en'
    );

    expect(initials).toBe('🐟');
  });
});

describe('touchedCaption', () => {
  const people = new Map([['p-1', person({ displayName: 'Marc' })]]);

  it('says nothing about a line nobody has touched', () => {
    expect(touchedCaption(line(), people, translator, 'en', null)).toBeNull();
  });

  it('says who finished it', () => {
    expect(
      touchedCaption(
        line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.got:{"name":"Marc"}');
  });

  it('says how many when it is partly done', () => {
    expect(
      touchedCaption(
        line({ settled: 2, touchedBy: 'p-1', lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.gotSome:{"name":"Marc","count":2}');
  });

  it('distinguishes "they had none" from "they got it"', () => {
    // The case the whole `lastOutcome` field exists for. A NOT_AVAILABLE settle
    // closes the outstanding amount, so `settled` reaches `quantity` exactly as
    // a purchase would: these two lines have **identical numbers** and must not
    // read the same, because one of them claims a purchase that never happened.
    const numbers = { quantity: 3, settled: 3, touchedBy: 'p-1' } as const;

    expect(
      touchedCaption(
        line({ ...numbers, lastOutcome: 'NOT_AVAILABLE' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.none:{"name":"Marc"}');

    expect(
      touchedCaption(
        line({ ...numbers, lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.got:{"name":"Marc"}');
  });

  it('says nothing about a line that was edited rather than settled', () => {
    // Somebody changed the line without buying anything, so there is no honest
    // sentence about a purchase to draw.
    expect(
      touchedCaption(
        line({ settled: 2, touchedBy: 'p-1', lastOutcome: null }),
        people,
        translator,
        'en',
        null
      )
    ).toBeNull();
  });

  it('says "you" when the reader is the one who touched it', () => {
    expect(
      touchedCaption(
        line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        'p-1'
      )
    ).toBe('basket.touched.got:{"name":"basket.touched.you"}');
  });
});

describe('quantityCaption', () => {
  it('draws nothing for a single wanted thing', () => {
    // "×1" is noise on a row that already says what it is.
    expect(quantityCaption(line({ quantity: 1 }), translator, 'en')).toBe('');
  });

  it('draws the count when more than one is wanted', () => {
    expect(quantityCaption(line({ quantity: 3 }), translator, 'en')).toBe(
      'basket.line.wanted:{"count":3}'
    );
  });

  it('draws both numbers when a line is partly settled', () => {
    // Section 4.2: what was submitted **and** what is outstanding, so nobody has
    // to do arithmetic in an aisle.
    expect(
      quantityCaption(line({ quantity: 3, settled: 2 }), translator, 'en')
    ).toBe('basket.line.partly:{"settled":2,"total":3}');
  });

  it('draws nothing once a line is finished', () => {
    expect(
      quantityCaption(line({ quantity: 3, settled: 3 }), translator, 'en')
    ).toBe('');
  });
});

/**
 * The caption that must never appear for a guest (plan 0044, section 4.1).
 *
 * These four are the whole of the redaction as this file sees it, and the first
 * two are the ones worth the file: **absent and empty are different questions**,
 * and collapsing them is the bug that draws "from " with nothing after it.
 */
describe('originsCaption', () => {
  const names = new Map([
    ['list-a', 'Weekly shop'],
    ['list-b', 'Groceries'],
  ]);

  function origin(listId: string, id = listId) {
    return { id, zoneId: 'z', listId, lineId: 'zl', quantity: 1 };
  }

  it('says nothing when origins are absent, which is a guest', () => {
    // No `origins` key at all: the server did not send it, and there is nothing
    // to hide because there is nothing there.
    expect(originsCaption(line(), names, translator, 'en')).toBeNull();
  });

  it('says nothing when origins are present and empty, which is a typed line', () => {
    // A different fact from the one above, and it happens to draw the same thing.
    // The two are asserted separately because a single `?? []` would make the
    // first case behave like this one, which is exactly the leak.
    expect(
      originsCaption(line({ origins: [] }), names, translator, 'en')
    ).toBeNull();
  });

  it('names one household', () => {
    expect(
      originsCaption(
        line({ origins: [origin('list-a')] }),
        names,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });

  it('names two, and counts beyond that', () => {
    expect(
      originsCaption(
        line({ origins: [origin('list-a'), origin('list-b')] }),
        names,
        translator,
        'en'
      )
    ).toBe('basket.from.two:{"first":"Weekly shop","second":"Groceries"}');
  });

  it('drops an origin whose list it cannot name rather than printing an id', () => {
    // A basket outlives the lists it drew from. A raw uuid in a caption is worse
    // than a shorter caption, and printing one would also be printing zone data
    // in the one form nobody can read.
    expect(
      originsCaption(
        line({ origins: [origin('list-a'), origin('list-gone')] }),
        names,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });

  it('counts one household once, however many lines it contributed', () => {
    expect(
      originsCaption(
        line({ origins: [origin('list-a', 'o-1'), origin('list-a', 'o-2')] }),
        names,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });
});
