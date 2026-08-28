import { TestBed } from '@angular/core/testing';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { PresenceStore } from './presence-store';

/**
 * The store, driven by the in-memory client through the **real** mapper.
 *
 * `RealtimeMemory.emit` takes a raw name and payload rather than a built event, so
 * every case here goes through `toRealtimeEvent` exactly as a socket payload would.
 * A spec that pushed a typed event past the mapper would be a spec of the switch
 * statement below and of nothing else.
 */
function setup() {
  TestBed.configureTestingModule({
    providers: [provideVelistaTesting(), RealtimeMemory, PresenceStore],
  });

  return {
    store: TestBed.inject(PresenceStore),
    realtime: TestBed.inject(REALTIME_CLIENT) as RealtimeMemory,
  };
}

describe('PresenceStore', () => {
  it('holds who is online in a zone', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.zoneUpdated', {
      zoneId: 'z1',
      online: [{ userId: 'u1' }, { userId: 'u2' }],
    });

    expect(store.onlineIn('z1').map((user) => user.userId)).toEqual([
      'u1',
      'u2',
    ]);
  });

  it('answers with nobody for a room it has heard nothing about', () => {
    const { store } = setup();

    // Empty rather than null, and it is the honest answer: presence is advisory, so
    // "nobody has told us" and "nobody is there" render the same and neither is an
    // error worth making a caller handle.
    expect(store.onlineIn('z-unknown')).toEqual([]);
    expect(store.viewersOf('l-unknown')).toEqual([]);
    expect(store.editorsOf('l-unknown')).toEqual([]);
  });

  it('replaces a snapshot rather than merging into it', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'u1' }, { userId: 'u2' }],
      editors: [],
    });
    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'u1' }],
      editors: [],
    });

    // The server publishes the whole room every time, read back after the write that
    // caused it. Merging is how somebody who left stays lit up forever.
    expect(store.viewersOf('l1').map((user) => user.userId)).toEqual(['u1']);
  });

  it('keeps zones and lists apart', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.zoneUpdated', {
      zoneId: 'shared-id',
      online: [{ userId: 'u1' }],
    });
    realtime.emit('presence.listUpdated', {
      listId: 'shared-id',
      viewers: [{ userId: 'u2' }],
      editors: [],
    });

    expect(store.onlineIn('shared-id').map((user) => user.userId)).toEqual([
      'u1',
    ]);
    expect(store.viewersOf('shared-id').map((user) => user.userId)).toEqual([
      'u2',
    ]);
  });

  it('names whoever is editing one line', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'u2' }],
      editors: [
        { userId: 'u2', lineId: 'line-1' },
        { userId: 'u3', lineId: 'line-2' },
      ],
    });

    expect(store.editorOfLine('l1', 'line-2')?.userId).toBe('u3');
    expect(store.editorOfLine('l1', 'line-9')).toBeNull();
  });

  it('keeps the current user, because filtering is a decision for the screen', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'me' }, { userId: 'u2' }],
      editors: [],
    });

    // A store that quietly dropped an id would make this disagree with the count the
    // server broadcast, which is exactly what a debugging surface must not do.
    expect(store.viewersOf('l1').length).toBe(2);
  });

  it('empties when the connection goes, and fills again when it returns', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.zoneUpdated', {
      zoneId: 'z1',
      online: [{ userId: 'u1' }],
    });

    realtime.setConnected(false);
    TestBed.tick();

    // Presence is per connection on both ends. Every snapshot now describes a room
    // this client is not in, and showing it is the failure plan 0016 names as the
    // worst one available: looking live while being stale.
    expect(store.onlineIn('z1')).toEqual([]);

    realtime.setConnected(true);
    TestBed.tick();
    realtime.emit('presence.zoneUpdated', {
      zoneId: 'z1',
      online: [{ userId: 'u1' }],
    });

    expect(store.onlineIn('z1').length).toBe(1);
  });

  it('ignores every event that belongs to another store', () => {
    const { store, realtime } = setup();

    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'u2' }],
      editors: [],
    });
    realtime.emit('member.kicked', {
      id: 'm1',
      zoneId: 'z1',
      userId: 'u2',
      username: 'Ana',
      role: 'MEMBER',
      status: 'KICKED',
    });

    // Inferring a departure from a membership event would be guessing at something
    // the next broadcast states outright.
    expect(store.viewersOf('l1').length).toBe(1);
  });

  it('offers one list as a signal a container can hold', () => {
    const { store, realtime } = setup();

    const live = store.forList('l1');
    expect(live().viewers).toEqual([]);

    realtime.emit('presence.listUpdated', {
      listId: 'l1',
      viewers: [{ userId: 'u2' }],
      editors: [],
    });

    expect(live().viewers.map((user) => user.userId)).toEqual(['u2']);
  });
});
