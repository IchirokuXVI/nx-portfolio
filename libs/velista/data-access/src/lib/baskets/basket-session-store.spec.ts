import { TestBed } from '@angular/core/testing';
import { provideFakeBrowserFacade } from '@portfolio/velista/platform';
import { BasketSessionStore } from './basket-session-store';

/**
 * The ended marker (velista `0154`, target 6).
 *
 * It takes the credential's place, so it must never read as one, and it must
 * survive the reload that used to turn a removed guest into a stranger.
 */
describe('BasketSessionStore: the ended marker', () => {
  function build(storage: Map<string, string>): BasketSessionStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [BasketSessionStore, provideFakeBrowserFacade(storage)],
    });
    return TestBed.inject(BasketSessionStore);
  }

  const session = {
    basketId: 'b1',
    participantId: 'p1',
    secret: 's',
    socketToken: 't',
    socketTokenExpiresAt: null,
  };

  it('replaces the credential, and is never read as one', () => {
    const sessions = build(new Map());
    sessions.write(session);

    sessions.end('b1', 'REMOVED');

    expect(sessions.read('b1')).toBeNull();
    expect(sessions.ended('b1')).toBe('REMOVED');
  });

  it('survives a reload', () => {
    const storage = new Map<string, string>();
    build(storage).end('b1', 'EXPIRED');

    expect(build(storage).ended('b1')).toBe('EXPIRED');
  });

  it('is gone once a new join writes a credential over it', () => {
    const sessions = build(new Map());
    sessions.end('b1', 'REMOVED');

    sessions.write(session);

    expect(sessions.ended('b1')).toBeNull();
    expect(sessions.read('b1')?.participantId).toBe('p1');
  });

  it('reads nothing it does not know as a reason', () => {
    const storage = new Map<string, string>();
    const sessions = build(storage);
    sessions.end('b1', 'REMOVED');
    const key = [...storage.keys()][0];
    storage.set(key, JSON.stringify({ ended: 'BANISHED' }));

    expect(sessions.ended('b1')).toBeNull();
    expect(sessions.ended('b2')).toBeNull();
  });
});
