import { TestBed } from '@angular/core/testing';
import type { AdminSession } from '@portfolio/luna-shopper-admin/models';
import { SessionStorage } from './session-storage';

/**
 * Where the token lives (plan 0013, section 2: `localStorage`, shared by every
 * tab).
 *
 * Three properties matter and all three are asserted here. The session survives
 * a reload, which is what `0002`'s amendment bought; it reaches another tab,
 * which is what this one buys; and nothing is ever handed back that this build
 * cannot use, because storage holds whatever an older build or a developer's
 * console left there and it is about to be presented as a credential.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: 'Operations',
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const KEY = 'luna-shopper-admin.session';

/**
 * The `storage` event a browser delivers to the *other* tabs of an origin.
 *
 * jsdom implements the storage areas but not the broadcast, so the event is
 * dispatched by hand. That is faithful to what is being tested: the listener
 * reads `key` and `newValue` off the event and never re-reads storage, exactly
 * because the tab it runs in may not share this one's view of it.
 */
function broadcast(newValue: string | null, key: string | null = KEY): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

describe('SessionStorage', () => {
  let storage: SessionStorage;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionStorage] });
    storage = TestBed.inject(SessionStorage);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('writes a session and reads the same one back', () => {
    storage.write(session);

    expect(storage.read()).toEqual(session);
  });

  /**
   * The change the operator actually feels: a rebuild lands, the tab reloads, and
   * the session is still there. A fresh instance because a reload is a fresh
   * instance; nothing is being remembered in the object.
   */
  it('survives a reload', () => {
    storage.write(session);

    const afterReload = TestBed.inject(SessionStorage);

    expect(afterReload.read()?.accessToken).toBe('a.b.c');
  });

  /**
   * What `0013` is for. `localStorage` is per origin rather than per tab, so a
   * tab opened from a bookmark reads the session the tab beside it signed in
   * with, instead of showing a login screen.
   */
  it('writes where another tab can read it', () => {
    storage.write(session);

    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clears what it wrote', () => {
    storage.write(session);

    storage.clear();

    expect(storage.read()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('answers null when nothing was ever stored', () => {
    expect(storage.read()).toBeNull();
  });

  /**
   * The deploy that lands this plan must not sign everybody out. A session an
   * earlier build wrote to `sessionStorage` is moved across on the first read,
   * and moved rather than copied so it happens once.
   */
  describe('a session an earlier build left behind', () => {
    it('is picked up, and shared from then on', () => {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          adminId: 'adm_1',
          username: 'ops',
          displayName: 'Operations',
          accessToken: 'a.b.c',
          expiresAt: session.expiresAt.toISOString(),
          receivedAt: session.receivedAt.toISOString(),
        })
      );

      expect(storage.read()?.accessToken).toBe('a.b.c');
      expect(localStorage.getItem(KEY)).not.toBeNull();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('never wins over a session that is already shared', () => {
      storage.write(session);
      sessionStorage.setItem(KEY, '{"accessToken":"stale"}');

      expect(storage.read()?.accessToken).toBe('a.b.c');
    });
  });

  describe('a stored value this build cannot use', () => {
    /**
     * Discarded **and removed**, in every case. Leaving it means parsing and
     * rejecting it again on every reload, and for the expired case it means a
     * credential with no remaining purpose sitting in the browser.
     */
    it.each([
      ['text that is not JSON', 'not-json'],
      ['JSON that is not an object', '"a.b.c"'],
      ['an object missing its token', '{"adminId":"a","username":"ops"}'],
      [
        'an expiry that does not parse',
        '{"adminId":"a","username":"ops","accessToken":"t","expiresAt":"soon"}',
      ],
    ])('discards %s, and removes it', (_case, raw) => {
      localStorage.setItem(KEY, raw);

      expect(storage.read()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('discards a token that has already expired, and removes it', () => {
      storage.write({ ...session, expiresAt: new Date(Date.now() - 1000) });

      expect(storage.read()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  /**
   * How a tab hears about the others (plan 0013, section 3).
   *
   * Every case answers with a session or with `null`, and `null` always means
   * the same thing to the caller: there is no shared session any more.
   */
  describe('watching for what another tab wrote', () => {
    let seen: (AdminSession | null)[];
    let stop: () => void;

    beforeEach(() => {
      seen = [];
      stop = storage.watch((value) => seen.push(value));
    });

    afterEach(() => stop());

    it('reports a session another tab wrote', () => {
      broadcast(
        JSON.stringify({
          adminId: 'adm_1',
          username: 'ops',
          displayName: 'Operations',
          accessToken: 'newer',
          expiresAt: session.expiresAt.toISOString(),
          receivedAt: session.receivedAt.toISOString(),
        })
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.accessToken).toBe('newer');
    });

    it('reports a sign out as null', () => {
      broadcast(null);

      expect(seen).toEqual([null]);
    });

    /** `key` is null when a whole storage area was wiped. Everything is gone. */
    it('reports a wiped storage area as null', () => {
      broadcast(null, null);

      expect(seen).toEqual([null]);
    });

    it('ignores every other key on the origin', () => {
      broadcast('anything', 'some-other-app.session');

      expect(seen).toHaveLength(0);
    });

    /**
     * A value nobody can use as a credential. Reported as a sign out rather than
     * ignored: a tab still holding a session for it is holding one the rest of
     * the app has lost.
     */
    it.each([
      ['nonsense', 'not-json'],
      ['a session that has already expired', expired()],
    ])('reports %s as null', (_case, raw) => {
      broadcast(raw);

      expect(seen).toEqual([null]);
    });

    it('stops when it is told to', () => {
      stop();

      broadcast(null);

      expect(seen).toHaveLength(0);
    });
  });

  /**
   * Reading storage *throws* rather than answering empty in more browsers than
   * one expects: a private window with site data blocked, an embedded webview, an
   * origin the user denied storage to. An operator in one of those still gets a
   * working app, one that signs in again after every reload.
   */
  describe('when the browser refuses storage', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };

    beforeEach(() => {
      for (const area of ['localStorage', 'sessionStorage'] as const) {
        jest
          .spyOn(globalThis, area, 'get')
          .mockReturnValue(throwing as unknown as Storage);
      }
    });

    afterEach(() => jest.restoreAllMocks());

    it('reads null instead of throwing', () => {
      expect(() => storage.read()).not.toThrow();
      expect(storage.read()).toBeNull();
    });

    it('writes and clears without throwing', () => {
      expect(() => storage.write(session)).not.toThrow();
      expect(() => storage.clear()).not.toThrow();
    });
  });
});

/** A stored session whose token is already over. */
function expired(): string {
  return JSON.stringify({
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    accessToken: 'a.b.c',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    receivedAt: new Date(Date.now() - 60_000).toISOString(),
  });
}
