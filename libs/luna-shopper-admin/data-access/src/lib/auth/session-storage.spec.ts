import { TestBed } from '@angular/core/testing';
import type { AdminSession } from '@portfolio/luna-shopper-admin/models';
import { SessionStorage } from './session-storage';

/**
 * Where the token lives (plan 0002, section 3, as amended: `sessionStorage`
 * rather than memory only).
 *
 * Two properties matter and both are asserted here. The session survives a
 * reload, which is what the change bought; and nothing is ever handed back that
 * this build cannot use, because storage holds whatever an older build or a
 * developer's console left there and it is about to be presented as a
 * credential.
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
   * The other half of the bargain, and the reason it is not `localStorage`.
   * Closing the browser has to end the session, and `sessionStorage` is the store
   * the browser clears when it does. Nothing may be written anywhere that
   * outlives it.
   */
  it('never writes to localStorage', () => {
    storage.write(session);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it('clears what it wrote', () => {
    storage.write(session);

    storage.clear();

    expect(storage.read()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('answers null when nothing was ever stored', () => {
    expect(storage.read()).toBeNull();
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
      sessionStorage.setItem(KEY, raw);

      expect(storage.read()).toBeNull();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('discards a token that has already expired, and removes it', () => {
      storage.write({ ...session, expiresAt: new Date(Date.now() - 1000) });

      expect(storage.read()).toBeNull();
      expect(sessionStorage.getItem(KEY)).toBeNull();
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
      jest
        .spyOn(globalThis, 'sessionStorage', 'get')
        .mockReturnValue(throwing as unknown as Storage);
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
