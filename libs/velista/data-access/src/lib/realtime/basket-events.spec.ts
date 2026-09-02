import { toRealtimeEvent } from './realtime-event-mapper';

/**
 * The four frames the basket's own room carries (velista `0048`).
 *
 * They are mapped rather than dropped as of that plan, and this file exists because
 * dropping them looked like nothing at all: an unknown event name is discarded by
 * design, so the screen was simply never updated and there was no error anywhere to
 * find. A name that stops matching the server's is the same silence again, which is
 * why every payload here is written the way core actually emits it.
 *
 * The names come from `RealtimeEvent` in `@portfolio/luna-shopper/contracts`, and the
 * shapes from `generated-list-basket.service.ts`, `generated-list-settle.service.ts`
 * and `generated-list-sharing.service.ts`. Written out rather than imported, because
 * rule D4 keeps every contracts import in this app type only: the barrel re-exports
 * ajv, and a string constant is not a type.
 */
describe('the basket room, off the wire', () => {
  /**
   * A `GeneratedListBasketLineView`, in the server's field names and not ours.
   *
   * The names differ on purpose, which is rule D4's whole point and is also the thing
   * a hand written fixture gets wrong: `settledQuantity` becomes `settled` and
   * `lastEditedByParticipantId` becomes `touchedBy`, because the screen is called the
   * basket and nothing in this app's interface says "generated list".
   */
  const line = {
    id: 'line-1',
    content: 'Bread',
    quantity: 2,
    settledQuantity: 1,
    itemId: null,
    options: [],
    position: 0,
    lastEditedByParticipantId: 'p-2',
    lastEditedAt: null,
    lastOutcome: 'BOUGHT',
  };

  it('keeps the line off a settle, not only the basket it happened in', () => {
    // The half this used to throw away. `GeneratedListStore` wants the id, because a
    // summary cannot be recomputed from one line; the basket screen wants the line,
    // because it holds the lines and one merge moves one row with no request.
    const event = toRealtimeEvent('generatedList.lineSettled', {
      generatedListId: 'gl-1',
      line,
    });

    expect(event).toMatchObject({
      type: 'generatedList.lineSettled',
      generatedListId: 'gl-1',
      // Mapped into this app's own names, and carrying what the row draws.
      line: { id: 'line-1', settled: 1, touchedBy: 'p-2' },
    });
  });

  it('maps an edit the same way a settle is mapped', () => {
    const event = toRealtimeEvent('generatedList.lineUpdated', {
      generatedListId: 'gl-1',
      line,
    });

    expect(event).toMatchObject({
      type: 'generatedList.lineUpdated',
      generatedListId: 'gl-1',
    });
  });

  it('reads an append as its own event, and carries who added it', () => {
    // Its own name and not a second `lineUpdated`, which is the whole reason luna
    // `0055` gave it one: a client receiving that would have to decide whether to
    // replace a row or append one, and the merge does nothing at all for an id the
    // basket does not hold, so the new line would vanish.
    const event = toRealtimeEvent('generatedList.lineAdded', {
      generatedListId: 'gl-1',
      line: { ...line, createdByParticipantId: 'p-3' },
    });

    expect(event).toMatchObject({
      type: 'generatedList.lineAdded',
      generatedListId: 'gl-1',
      line: { id: 'line-1', createdBy: 'p-3' },
    });
  });

  it('drops an append whose line it cannot read', () => {
    // The one place a readable id is not enough. An append has no earlier copy to
    // fall back on, so a blank row in a shop is the alternative to dropping it.
    expect(
      toRealtimeEvent('generatedList.lineAdded', {
        generatedListId: 'gl-1',
        line: 'not a line',
      })
    ).toBeNull();
  });

  it('reads a line with no creator as one the run composed', () => {
    // Null is the honest answer rather than a missing field: a derived line was put
    // there by the generation and not by a person. Absent reads the same way, which
    // is what lets a basket served by an older backend draw the same nothing.
    const event = toRealtimeEvent('generatedList.lineAdded', {
      generatedListId: 'gl-1',
      line,
    });

    expect(event).toMatchObject({ line: { createdBy: null } });
  });

  it('keeps the basket id when the line is unreadable', () => {
    // Null rather than dropping the event: the id is still good, so the store that
    // only wanted the id is unaffected and the one that wanted the line refetches.
    const event = toRealtimeEvent('generatedList.lineSettled', {
      generatedListId: 'gl-1',
      line: 'not a line',
    });

    expect(event).toEqual({
      type: 'generatedList.lineSettled',
      generatedListId: 'gl-1',
      line: null,
    });
  });

  it('reads a participant joining, which arrives bare', () => {
    // No basket id on the payload, and it needs none: it arrives only on a
    // connection pinned to one basket.
    const event = toRealtimeEvent('generatedList.participantJoined', {
      id: 'p-3',
      kind: 'GUEST',
      displayName: null,
      guestNumber: 2,
      userId: null,
      joinedAt: '2026-09-01T10:41:00.000Z',
      lastSeenAt: '2026-09-01T10:41:00.000Z',
      shareLinkId: 'link-1',
    });

    expect(event).toMatchObject({
      type: 'generatedList.participantJoined',
      participant: { id: 'p-3', kind: 'GUEST', guestNumber: 2 },
    });
  });

  it('reads who is present, keyed by participant and never by user', () => {
    // A guest has no user id at all, which is exactly what a presence entry built on
    // `PresenceUser` could not express, and why this is its own shape.
    const event = toRealtimeEvent('presence.generatedListUpdated', {
      generatedListId: 'gl-1',
      present: [
        {
          participantId: 'p-3',
          kind: 'GUEST',
          displayName: null,
          guestNumber: 2,
          userId: null,
        },
      ],
    });

    expect(event).toEqual({
      type: 'presence.generatedListUpdated',
      generatedListId: 'gl-1',
      present: [
        {
          participantId: 'p-3',
          kind: 'GUEST',
          displayName: null,
          guestNumber: 2,
          userId: null,
        },
      ],
    });
  });

  it('drops one unreadable face rather than emptying a full shop', () => {
    const event = toRealtimeEvent('presence.generatedListUpdated', {
      generatedListId: 'gl-1',
      present: [
        { kind: 'GUEST' },
        {
          participantId: 'p-3',
          kind: 'OWNER',
          displayName: 'Dani',
          guestNumber: null,
          userId: 'u-1',
        },
      ],
    });

    expect(event).toMatchObject({ present: [{ participantId: 'p-3' }] });
  });
});
