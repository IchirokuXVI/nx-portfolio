import { toRealtimeEvent } from './realtime-event-mapper';

/**
 * The frames the basket's own room carries (velista `0048`, as `0090` left them).
 *
 * They are mapped rather than dropped, and this file exists because dropping them
 * looked like nothing at all: an unknown event name is discarded by design, so the
 * screen was simply never updated and there was no error anywhere to find. A name
 * that stops matching the server's is the same silence again, which is why every
 * payload here is written the way core actually emits it.
 *
 * **Four line events became one.** `generatedList.lineSettled`, `lineUpdated`,
 * `lineAdded` and `lineRemoved` each carried a line, and a basket stores no lines
 * since backend `0136`: a row is read out of the covered lists on every request, so
 * an event that said what a row now is would be a second answer to a question only
 * the server can answer. What is left is `basket.linesChanged`, which says that
 * something moved and nothing else.
 *
 * The names come from `RealtimeEvent` in `@portfolio/luna-shopper/contracts`, and
 * the shapes from the services that emit them. Written out rather than imported,
 * because rule D4 keeps every contracts import in this app type only: the barrel
 * re-exports ajv, and a string constant is not a type.
 */
describe('the basket room, off the wire', () => {
  /**
   * **Ids and nothing else**, which is the whole event (backend `0130`, section 6).
   *
   * A basket room holds guests, and a row names how much each household asks for,
   * so a broadcast that cannot be projected per socket carries the least privileged
   * view there is: the ids of the list lines that moved, which name no household
   * and no quantity.
   */
  it('reads the ids of the lines that moved', () => {
    expect(
      toRealtimeEvent('basket.linesChanged', { lineIds: ['zl-1', 'zl-2'] })
    ).toEqual({
      type: 'basket.linesChanged',
      lineIds: ['zl-1', 'zl-2'],
    });
  });

  /**
   * The event's meaning is "something moved", and one unreadable id does not make
   * that untrue. An empty array still says it, so it is still delivered: the store
   * reads the basket again either way.
   */
  it('drops an unreadable id rather than the event', () => {
    expect(
      toRealtimeEvent('basket.linesChanged', { lineIds: ['zl-1', 42, null] })
    ).toEqual({
      type: 'basket.linesChanged',
      lineIds: ['zl-1'],
    });
  });

  it('delivers an event that names no line at all', () => {
    expect(toRealtimeEvent('basket.linesChanged', {})).toEqual({
      type: 'basket.linesChanged',
      lineIds: [],
    });
  });

  it('drops a payload that is not an object', () => {
    expect(toRealtimeEvent('basket.linesChanged', 'not an object')).toBeNull();
  });

  /**
   * It carries **no basket id**, unlike the four events it replaced, and needs
   * none: one envelope addresses several rooms, so a `basketId` in the payload
   * could name only one of them, and the socket it arrives on is pinned to one
   * basket already.
   */
  it('carries no basket id, because the socket is the basket', () => {
    const event = toRealtimeEvent('basket.linesChanged', {
      lineIds: ['zl-1'],
      // Ignored even when a server sends one: the room is what says which basket.
      generatedListId: 'gl-1',
    });

    expect(event).not.toHaveProperty('generatedListId');
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
