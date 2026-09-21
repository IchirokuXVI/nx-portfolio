import type { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import type {
  BasketListRef,
  BasketParticipant,
  BasketRow,
  BasketRowEntry,
} from '@portfolio/velista/models';
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
    username: null,
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
 * is what `basket-sharing.service.ts` writes, and it is the shape that made
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

function row(over: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: 'zl-1',
    content: 'Milk',
    left: 3,
    bought: 0,
    asked: 3,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [entry(null)],
    ...over,
  };
}

function entry(
  listId: string | null,
  over: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId: `zl-${listId ?? 'none'}`,
    listId,
    left: 3,
    bought: 0,
    asked: 3,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...over,
  };
}

function ref(listId: string, name: string): BasketListRef {
  return { listId, name, zoneId: 'z', zoneName: 'Home' };
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

  it('never says "you" about the reader, because the phone may not be theirs', () => {
    // Plan 0052 section 2.1. `ParticipantNameOptions.you` is deleted rather than
    // left unused: four people work one list in a shop and read it on each other's
    // phones, so "you" was the one label here whose meaning depended on whose hand
    // the device was in. The reader is named like everybody else.
    expect(
      participantName(person({ displayName: 'Ana' }), translator, 'en', {
        ownName: 'Daniel',
      })
    ).toBe('Ana');
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

  it('prefers the username the basket carries over the role word', () => {
    // Plan 0052 section 2.2. "Owner" is a role where a person belongs, and the only
    // reason it was reached was that core wrote the row with a null name. Luna 0054
    // carries the account holder's username, and this is what it is for.
    expect(participantName(owner({ username: 'marc' }), translator, 'en')).toBe(
      'marc'
    );
  });

  it('prefers a typed name over the username', () => {
    // A signed in participant may still type a name on the join screen, and if they
    // did they said it on purpose (luna 0054, section 2.4).
    expect(
      participantName(
        owner({ username: 'marc', displayName: 'Marc at the shop' }),
        translator,
        'en'
      )
    ).toBe('Marc at the shop');
  });

  it('prefers the reader’s own account name over the username on their row', () => {
    // Both name the same person and `ownName` is the fresher of the two: the username
    // on a participant is a snapshot taken at join time, so somebody who has since
    // renamed their account would otherwise read their old name on their own row.
    expect(
      participantName(owner({ username: 'marc' }), translator, 'en', {
        ownName: 'Daniel',
      })
    ).toBe('Daniel');
  });

  it('still gives a guest with no username their number', () => {
    // The fallback order is not disturbed by the new field: a guest has no account
    // and `Guest N` is still what tells two unnamed ones apart.
    expect(participantName(person(), translator, 'en')).toBe(
      'basket.people.guestNumbered:{"count":2}'
    );
  });

  it('keeps the role word for a basket generated before the username existed', () => {
    // **The fallback is not deleted with the field's arrival** (section 2.2). A basket
    // made before luna 0054 shipped carries no username for anybody, and this is what
    // those baskets keep drawing; without it they would draw an empty string.
    expect(participantName(owner({ username: null }), translator, 'en')).toBe(
      'basket.people.owner'
    );
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

  it('says nothing about a row nobody has touched', () => {
    expect(touchedCaption(row(), people, translator, 'en', null)).toBeNull();
  });

  it('says who finished it', () => {
    expect(
      touchedCaption(
        row({ left: 0, bought: 3, state: 'DONE', touchedBy: 'p-1' }),
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
        row({ left: 1, bought: 2, state: 'PARTLY', touchedBy: 'p-1' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.gotSome:{"name":"Marc","count":2}');
  });

  /**
   * The case the whole `state` field exists for. A row somebody bought out and a
   * row the shop had none of are both **finished**, so no pair of numbers can tell
   * them apart, and one of the two sentences claims a purchase that never
   * happened.
   */
  it('distinguishes "they had none" from "they got it"', () => {
    expect(
      touchedCaption(
        row({ state: 'NOT_AVAILABLE', touchedBy: 'p-1' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.none:{"name":"Marc"}');

    expect(
      touchedCaption(
        row({ left: 0, bought: 3, state: 'DONE', touchedBy: 'p-1' }),
        people,
        translator,
        'en',
        null
      )
    ).toBe('basket.touched.got:{"name":"Marc"}');
  });

  /**
   * Touched without anything being bought: a rename, or a purchase somebody has
   * since taken back. There is no honest sentence about a purchase.
   */
  it('says nothing about a row that was touched but never bought', () => {
    expect(
      touchedCaption(
        row({ touchedBy: 'p-1', bought: 0 }),
        people,
        translator,
        'en',
        null
      )
    ).toBeNull();
  });

  it('says nothing for a participant this basket does not hold', () => {
    expect(
      touchedCaption(
        row({ bought: 1, state: 'PARTLY', touchedBy: 'p-nobody' }),
        new Map(),
        translator,
        'en',
        null
      )
    ).toBeNull();
  });

  /**
   * The reader is named like everybody else, because the screen is four people
   * reading one list on **each other's** phones: "you got it" is unreadable when
   * the phone in your hand is not yours (plan 0052, section 2.1).
   */
  it('names the reader by their own account name', () => {
    expect(
      touchedCaption(
        row({ left: 0, bought: 3, state: 'DONE', touchedBy: 'p-owner' }),
        new Map([['p-owner', owner()]]),
        translator,
        'en',
        'p-owner',
        'Daniel'
      )
    ).toBe('basket.touched.got:{"name":"Daniel"}');
  });
});

describe('quantityCaption', () => {
  it('draws nothing for a single wanted thing', () => {
    // "×1" is noise on a row that already says what it is.
    expect(quantityCaption(row({ left: 1, asked: 1 }), translator, 'en')).toBe(
      ''
    );
  });

  it('draws the count when more than one is wanted', () => {
    expect(quantityCaption(row({ left: 3 }), translator, 'en')).toBe(
      'basket.line.wanted:{"count":3}'
    );
  });

  it('draws both numbers when a row is partly bought', () => {
    // What was got **and** what was asked for, so nobody has to do arithmetic in
    // an aisle.
    expect(
      quantityCaption(
        row({ state: 'PARTLY', bought: 2, left: 1, asked: 3 }),
        translator,
        'en'
      )
    ).toBe('basket.row.boughtOf:{"bought":2,"asked":3}');
  });

  it('draws both numbers once a row is finished', () => {
    expect(
      quantityCaption(
        row({ state: 'DONE', bought: 3, left: 0, asked: 3 }),
        translator,
        'en'
      )
    ).toBe('basket.row.boughtOf:{"bought":3,"asked":3}');
  });

  /**
   * "0 of 6" is true and is the sentence the glyph beside it needs: the shop had
   * none of the six, and nothing was bought.
   */
  it('says nothing was got on a row the shop had none of', () => {
    expect(
      quantityCaption(
        row({ state: 'NOT_AVAILABLE', bought: 0, left: 6, asked: 6 }),
        translator,
        'en'
      )
    ).toBe('basket.row.boughtOf:{"bought":0,"asked":6}');
  });

  /**
   * An entry answers for itself under a list's heading, which is what lets a row
   * two households asked for say each household's own numbers.
   */
  it('draws an entry’s own numbers when it is handed one', () => {
    expect(
      quantityCaption(
        entry('l-1', { state: 'PARTLY', bought: 2, left: 4, asked: 6 }),
        translator,
        'en'
      )
    ).toBe('basket.row.boughtOf:{"bought":2,"asked":6}');
  });
});

/**
 * The caption that must never appear for a guest (velista `0090`, section 9.1).
 *
 * **One question, one answer.** Backend `0136` replaced the per key redaction with
 * a list of the refs this reader was served, and the mapper drops an id there is
 * no ref for to null, so "may I name this list" is asked once and answered once.
 * The old pair of nulls, absent against present and empty, is not representable
 * any more.
 */
describe('originsCaption', () => {
  const lists = new Map([
    ['list-a', ref('list-a', 'Weekly shop')],
    ['list-b', ref('list-b', 'Groceries')],
  ]);

  it('says nothing to a reader served no list at all, which is a guest', () => {
    expect(
      originsCaption(
        row({ entries: [entry('list-a')] }),
        new Map(),
        translator,
        'en'
      )
    ).toBeNull();
  });

  it('says nothing when every entry is on a list nobody was served', () => {
    expect(
      originsCaption(row({ entries: [entry(null)] }), lists, translator, 'en')
    ).toBeNull();
  });

  it('names one household', () => {
    expect(
      originsCaption(
        row({ entries: [entry('list-a')] }),
        lists,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });

  it('names two, and counts beyond that', () => {
    expect(
      originsCaption(
        row({ entries: [entry('list-a'), entry('list-b')] }),
        lists,
        translator,
        'en'
      )
    ).toBe('basket.from.two:{"first":"Weekly shop","second":"Groceries"}');
  });

  /**
   * A basket outlives the lists it covers. A raw uuid in a caption is worse than
   * a shorter caption, and printing one would also be printing a household's id
   * in the one form nobody can read.
   */
  it('drops an entry whose list it cannot name rather than printing an id', () => {
    expect(
      originsCaption(
        row({ entries: [entry('list-a'), entry('list-gone')] }),
        lists,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });

  it('counts one household once, however many lines it asked on', () => {
    expect(
      originsCaption(
        row({
          entries: [
            entry('list-a', { lineId: 'zl-1' }),
            entry('list-a', { lineId: 'zl-2' }),
          ],
        }),
        lists,
        translator,
        'en'
      )
    ).toBe('basket.from.one:{"first":"Weekly shop"}');
  });
});
