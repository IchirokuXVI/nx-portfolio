import type { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import type { BasketLine, BasketParticipant } from '@portfolio/velista/models';
import {
  addedCaption,
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
    createdBy: null,
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

  it('names the reader rather than calling them "you"', () => {
    // Plan 0052 section 2.1, and the reason is the screen: this row is read on other
    // people's phones over a trolley, so "you got it" was the one caption here whose
    // meaning depended on whose hand the device was in.
    //
    // The reader here is `p-1`, whose row carries a typed name, and that name is what
    // is drawn: the caption reads identically whoever is holding the phone, which is
    // the whole of the report.
    expect(
      touchedCaption(
        line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        'p-1',
        'Daniel'
      )
    ).toBe('basket.touched.got:{"name":"Marc"}');
  });

  it('names the reader from their account, not from the row they touched', () => {
    // The owner's row carries no `displayName` at all, so without their account name
    // there is nothing on the basket to name them with: the caption fell through to
    // "Owner got it", a role where a person's name belongs.
    const unnamed = new Map([['p-owner', owner()]]);

    expect(
      touchedCaption(
        line({ settled: 3, touchedBy: 'p-owner', lastOutcome: 'BOUGHT' }),
        unnamed,
        translator,
        'en',
        'p-owner',
        'Daniel'
      )
    ).toBe('basket.touched.got:{"name":"Daniel"}');
  });

  it('names somebody else by their own name, never by the reader’s', () => {
    // `ownName` is the **reader's**, so it must reach only the reader's own row. A
    // caption that applied it to whoever touched the line would put the person
    // holding the phone's name on somebody else's purchase.
    expect(
      touchedCaption(
        line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' }),
        people,
        translator,
        'en',
        'p-someone-else',
        'Daniel'
      )
    ).toBe('basket.touched.got:{"name":"Marc"}');
  });
});

/**
 * Plan 0053, section 5: who put this here.
 *
 * The question a shop asks about a row nobody recognises. It is a second field
 * rather than a reading of `touchedBy`, because that one moves on the first settle;
 * what the row does with it is to yield to the more urgent sentence once anybody
 * has touched the line.
 */
describe('addedCaption', () => {
  const people = new Map<string, BasketParticipant>([
    ['p-1', person({ id: 'p-1', displayName: 'Dani' })],
    ['p-owner', owner()],
  ]);

  it('names whoever put the line there', () => {
    expect(
      addedCaption(
        line({ createdBy: 'p-1' }),
        people,
        translator,
        'en',
        'p-someone-else'
      )
    ).toBe('basket.added.by:{"name":"Dani"}');
  });

  it('draws nothing for a line the run composed', () => {
    // Which is every line in a basket nobody has typed into, so the ordinary
    // basket looks exactly as it did before this plan.
    expect(addedCaption(line(), people, translator, 'en', null)).toBeNull();
  });

  it('yields the moment somebody has touched the line', () => {
    // "Who got the bread" is the more urgent of the two while somebody is
    // shopping, and the row has three short lines. The field is still worth
    // keeping past that point, which is why it is a second column.
    expect(
      addedCaption(
        line({ createdBy: 'p-1', touchedBy: 'p-owner' }),
        people,
        translator,
        'en',
        null
      )
    ).toBeNull();
  });

  it('names the reader by their own account, like everybody else', () => {
    // The owner's participant row carries no display name at all, so their own
    // account name is the only thing that can name it. "You added this" is not
    // drawn, for plan 0052 section 2.1's reason: the phone is often not yours.
    expect(
      addedCaption(
        line({ createdBy: 'p-owner' }),
        people,
        translator,
        'en',
        'p-owner',
        'Daniel'
      )
    ).toBe('basket.added.by:{"name":"Daniel"}');
  });

  it('draws nothing for somebody this basket no longer holds', () => {
    // A participant removed since the line was added. "Added by " with nothing
    // after it is worse than nothing, and the row is complete without it.
    expect(
      addedCaption(
        line({ createdBy: 'p-gone' }),
        people,
        translator,
        'en',
        null
      )
    ).toBeNull();
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
