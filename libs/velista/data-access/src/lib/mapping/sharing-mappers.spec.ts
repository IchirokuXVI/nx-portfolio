import {
  isLinkVisitor,
  isNamedPerson,
  type BasketParticipant,
} from '@portfolio/velista/models';
import { toRealtimeEvent } from '../realtime/realtime-event-mapper';
import { toBasketParticipant, toBasketShareLink } from './basket-mappers';
import { toContact, toSharedBasketSummary } from './mappers';

/** The wire shapes backend `0114` added, mapped from `unknown` (velista `0085`). */

describe('toBasketParticipant without a join time', () => {
  // Backend 0114 section 11 stopped sending `joinedAt` and `lastSeenAt` to a reader
  // who is not sent a device, so the field is absent rather than null for them.
  it('accepts the view and reads the time as unknown', () => {
    const participant = toBasketParticipant({
      id: 'p1',
      kind: 'REGISTERED',
      displayName: null,
      username: 'Leo',
      guestNumber: null,
      userId: 'u-leo',
      shareLinkId: null,
    });

    expect(participant).not.toBeNull();
    expect(participant?.joinedAt).toBeNull();
    expect(participant?.lastSeenAt).toBeNull();
    expect(participant && 'device' in participant).toBe(false);
  });
});

/** Backend `0140` section 8: every projection of a participant carries an end. */
describe('toBasketParticipant and the end of a visit', () => {
  const view = {
    id: 'p1',
    kind: 'REGISTERED',
    displayName: null,
    username: 'Leo',
    guestNumber: null,
    userId: 'u-leo',
    shareLinkId: 'link-1',
  };

  it('reads the moment a visit ends', () => {
    expect(
      toBasketParticipant({
        ...view,
        expiresAt: '2026-09-01T22:05:00.000Z',
      })?.expiresAt
    ).toEqual(new Date('2026-09-01T22:05:00.000Z'));
  });

  it('reads a null and an unreadable one as no end at all', () => {
    expect(
      toBasketParticipant({ ...view, expiresAt: null })?.expiresAt
    ).toBeNull();
    // A backend before `0140` sends nothing, and a malformed one sends
    // something unreadable. Both mean "this person does not expire", which is
    // the safe way to be wrong: every screen that reads it says a sentence.
    expect(toBasketParticipant(view)?.expiresAt).toBeNull();
    expect(
      toBasketParticipant({ ...view, expiresAt: 'soon' })?.expiresAt
    ).toBeNull();
  });
});

describe('isNamedPerson and isLinkVisitor', () => {
  const participant = (
    kind: 'OWNER' | 'REGISTERED' | 'GUEST',
    expiresAt: string | null
  ): BasketParticipant => {
    const mapped = toBasketParticipant({
      id: `p-${kind}`,
      kind,
      displayName: null,
      username: null,
      guestNumber: null,
      userId: kind === 'GUEST' ? null : 'u-1',
      shareLinkId: expiresAt === null ? null : 'link-1',
      expiresAt,
    });
    if (mapped === null) {
      throw new Error(`the fixture for ${kind} did not map`);
    }
    return mapped;
  };

  it('calls the owner neither, whatever their row says', () => {
    const owner = participant('OWNER', null);

    expect(isNamedPerson(owner)).toBe(false);
    expect(isLinkVisitor(owner)).toBe(false);
  });

  it('calls a person with no end a named person', () => {
    expect(isNamedPerson(participant('REGISTERED', null))).toBe(true);
    expect(isLinkVisitor(participant('REGISTERED', null))).toBe(false);
  });

  it('calls everybody with an end a visitor, guest and account alike', () => {
    const guest = participant('GUEST', '2026-09-01T22:41:00.000Z');
    const registered = participant('REGISTERED', '2026-09-01T22:05:00.000Z');

    expect(isLinkVisitor(guest)).toBe(true);
    expect(isLinkVisitor(registered)).toBe(true);
    expect(isNamedPerson(guest)).toBe(false);
    expect(isNamedPerson(registered)).toBe(false);
  });
});

describe('toBasketShareLink', () => {
  const link = {
    id: 'link-1',
    secret: 's3cret',
    createdAt: '2026-09-01T09:00:00.000Z',
    expiresAt: '2026-09-01T21:00:00.000Z',
    participantCount: 2,
  };

  it('reads the link and when it stops accepting people', () => {
    expect(toBasketShareLink(link)?.expiresAt).toEqual(
      new Date('2026-09-01T21:00:00.000Z')
    );
    // The `GET` wraps the link and the `PUT` answers it bare.
    expect(toBasketShareLink({ link })?.id).toBe('link-1');
  });

  it('refuses a link with no end, because the server mints none', () => {
    expect(toBasketShareLink({ ...link, expiresAt: null })).toBeNull();
    expect(toBasketShareLink({ ...link, expiresAt: undefined })).toBeNull();
    expect(toBasketShareLink({ ...link, expiresAt: 'tomorrow' })).toBeNull();
  });
});

describe('toSharedBasketSummary', () => {
  const view = {
    id: 'gl1',
    kind: 'GENERATED',
    name: null,
    status: 'OPEN',
    generatedAt: '2026-08-21T10:00:00.000Z',
    lineCount: 4,
    settledLineCount: 1,
    boughtLineCount: 1,
    notAvailableLineCount: 0,
    presentCount: 0,
    owner: { userId: 'u-marta', name: 'Marta' },
    sharedAt: '2026-08-21T11:00:00.000Z',
  };

  it('keeps the summary and adds the owner and the shared date', () => {
    const shared = toSharedBasketSummary(view);

    expect(shared?.lineCount).toBe(4);
    expect(shared?.owner).toEqual({ userId: 'u-marta', name: 'Marta' });
    expect(shared?.sharedAt).toEqual(new Date('2026-08-21T11:00:00.000Z'));
  });

  it('refuses a row that cannot say whose basket it is', () => {
    expect(toSharedBasketSummary({ ...view, owner: undefined })).toBeNull();
    expect(
      toSharedBasketSummary({ ...view, sharedAt: 'not a date' })
    ).toBeNull();
  });
});

describe('toContact', () => {
  it('reads one membership', () => {
    expect(
      toContact({ userId: 'u-leo', zoneId: 'z1', username: 'Leo' })
    ).toEqual({ userId: 'u-leo', zoneId: 'z1', username: 'Leo' });
  });

  it('refuses a membership with a field missing', () => {
    expect(toContact({ userId: 'u-leo', zoneId: 'z1' })).toBeNull();
    expect(toContact(null)).toBeNull();
  });
});

describe('the access events', () => {
  it('maps basket.shared and basket.unshared to their basket id', () => {
    expect(toRealtimeEvent('basket.shared', { basketId: 'gl1' })).toEqual({
      type: 'basket.shared',
      basketId: 'gl1',
    });
    expect(toRealtimeEvent('basket.unshared', { basketId: 'gl1' })).toEqual({
      type: 'basket.unshared',
      basketId: 'gl1',
    });
  });

  it('drops one that names no basket', () => {
    expect(toRealtimeEvent('basket.unshared', { id: 'gl1' })).toBeNull();
  });
});
