import { toRealtimeEvent } from '../realtime/realtime-event-mapper';
import { toBasketParticipant } from './basket-mappers';
import { toContact, toSharedGeneratedListSummary } from './mappers';

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

describe('toSharedGeneratedListSummary', () => {
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
    const shared = toSharedGeneratedListSummary(view);

    expect(shared?.lineCount).toBe(4);
    expect(shared?.owner).toEqual({ userId: 'u-marta', name: 'Marta' });
    expect(shared?.sharedAt).toEqual(new Date('2026-08-21T11:00:00.000Z'));
  });

  it('refuses a row that cannot say whose basket it is', () => {
    expect(
      toSharedGeneratedListSummary({ ...view, owner: undefined })
    ).toBeNull();
    expect(
      toSharedGeneratedListSummary({ ...view, sharedAt: 'not a date' })
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
  it('maps generatedList.shared and generatedList.unshared to their basket id', () => {
    expect(
      toRealtimeEvent('generatedList.shared', { generatedListId: 'gl1' })
    ).toEqual({ type: 'generatedList.shared', generatedListId: 'gl1' });
    expect(
      toRealtimeEvent('generatedList.unshared', { generatedListId: 'gl1' })
    ).toEqual({ type: 'generatedList.unshared', generatedListId: 'gl1' });
  });

  it('drops one that names no basket', () => {
    expect(toRealtimeEvent('generatedList.unshared', { id: 'gl1' })).toBeNull();
  });
});
