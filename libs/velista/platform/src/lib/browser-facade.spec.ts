import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import { ImpersonationState } from './impersonation-state';
import { StorageKeys } from './storage-keys';

describe('BrowserFacade', () => {
  describe('in a browser', () => {
    let facade: BrowserFacade;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      facade = TestBed.inject(BrowserFacade);
    });

    it('reports it is running in a browser', () => {
      expect(facade.isBrowser).toBe(true);
      expect(facade.window).not.toBeNull();
    });

    it('tracks connection loss through the window events', () => {
      window.dispatchEvent(new Event('offline'));
      expect(facade.onLine()).toBe(false);

      window.dispatchEvent(new Event('online'));
      expect(facade.onLine()).toBe(true);
    });

    it('round-trips a stored value and removes it', () => {
      facade.writeStorage('velista-test-key', 'value');
      expect(facade.readStorage('velista-test-key')).toBe('value');

      facade.removeStorage('velista-test-key');
      expect(facade.readStorage('velista-test-key')).toBeNull();
    });

    it('observes nothing where the browser has no IntersectionObserver', () => {
      // jsdom ships none. The bias is `matchMedia`'s: the caller that reads
      // this is the one deciding whether somebody has seen a change (velista
      // `0093`, section 7), and nothing is the quiet answer.
      const seen = jest.fn();
      const stop = facade.observeIntersection(
        document.createElement('li'),
        seen
      );

      expect(seen).not.toHaveBeenCalled();
      expect(() => stop()).not.toThrow();
    });

    it('reports an element coming into view, and disconnects on teardown', () => {
      // The one thing a jsdom spec can hold this to: that it observes the
      // element it was handed, passes the options through, reports what the
      // browser said, and lets go.
      const observed: Element[] = [];
      const disconnect = jest.fn();
      let announce: ((entries: IntersectionObserverEntry[]) => void) | null =
        null;
      let held: IntersectionObserverInit | undefined;

      class FakeObserver {
        constructor(
          callback: (entries: IntersectionObserverEntry[]) => void,
          options?: IntersectionObserverInit
        ) {
          announce = callback;
          held = options;
        }
        observe(element: Element): void {
          observed.push(element);
        }
        disconnect = disconnect;
      }
      Object.defineProperty(window, 'IntersectionObserver', {
        value: FakeObserver,
        configurable: true,
      });

      const element = document.createElement('li');
      const seen = jest.fn();
      const stop = facade.observeIntersection(element, seen, {
        threshold: 0.5,
      });

      expect(observed).toEqual([element]);
      expect(held).toEqual({ threshold: 0.5 });

      announce?.([{ isIntersecting: true } as IntersectionObserverEntry]);
      expect(seen).toHaveBeenLastCalledWith(true);

      announce?.([{ isIntersecting: false } as IntersectionObserverEntry]);
      expect(seen).toHaveBeenLastCalledWith(false);

      stop();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('answers false for a media query jsdom cannot evaluate', () => {
      // jsdom ships no `matchMedia`. The bias is deliberate: a caller phrases the
      // query so that false is the answer it wants when nothing can answer.
      expect(facade.matchMedia('(prefers-color-scheme: light)')()).toBe(false);
    });

    it('tracks a media query and shares one signal per query', () => {
      const listeners: ((event: MediaQueryListEvent) => void)[] = [];
      const list = {
        matches: true,
        addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
          listeners.push(fn),
        removeEventListener: jest.fn(),
      };
      const matchMedia = jest.fn().mockReturnValue(list);
      Object.defineProperty(window, 'matchMedia', {
        value: matchMedia,
        configurable: true,
      });

      const query = '(prefers-color-scheme: light)';
      const matches = facade.matchMedia(query);
      expect(matches()).toBe(true);

      listeners.forEach((fn) => fn({ matches: false } as MediaQueryListEvent));
      expect(matches()).toBe(false);

      // Memoised, so a second caller shares the listener rather than adding one.
      expect(facade.matchMedia(query)).toBe(matches);
      expect(matchMedia).toHaveBeenCalledTimes(1);
    });

    it('returns null instead of throwing when storage is unavailable', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });

      expect(facade.readStorage('velista-test-key')).toBeNull();
      // Writing must not throw either — nothing here is worth failing a user
      // action over.
      expect(() => facade.writeStorage('velista-test-key', 'v')).not.toThrow();
    });
  });

  // Velista `0133`, target 2: a tab that holds a support session keeps every key to
  // itself, and an ordinary tab is exactly as it was.
  describe('the storage of a support session', () => {
    const KEY = StorageKeys.lastList;

    beforeEach(() => jest.restoreAllMocks());

    afterEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    function facadeFor(marked: boolean): BrowserFacade {
      if (marked) {
        sessionStorage.setItem(StorageKeys.supportSession, '1');
      }
      TestBed.configureTestingModule({});
      return TestBed.inject(BrowserFacade);
    }

    it('writes, reads and removes in this tab and leaves the origin alone', () => {
      localStorage.setItem(KEY, 'the operator');
      const facade = facadeFor(true);

      expect(facade.readStorage(KEY)).toBeNull();

      facade.writeStorage(KEY, 'the user');
      expect(sessionStorage.getItem(KEY)).toBe('the user');
      expect(localStorage.getItem(KEY)).toBe('the operator');
      expect(facade.readStorage(KEY)).toBe('the user');

      facade.removeStorage(KEY);
      expect(sessionStorage.getItem(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBe('the operator');
    });

    it('never calls back for a write by another document', () => {
      const facade = facadeFor(true);
      const heard = jest.fn();
      facade.watchStorage(StorageKeys.session, heard);

      window.dispatchEvent(
        new StorageEvent('storage', { key: StorageKeys.session, newValue: 'x' })
      );
      window.dispatchEvent(new StorageEvent('storage', { key: null }));

      expect(heard).not.toHaveBeenCalled();
    });

    it('keeps an ordinary tab on the origin, and hears the other document', () => {
      const facade = facadeFor(false);
      const heard = jest.fn();
      facade.watchStorage(StorageKeys.session, heard);

      facade.writeStorage(KEY, 'value');
      expect(localStorage.getItem(KEY)).toBe('value');
      expect(sessionStorage.getItem(KEY)).toBeNull();

      window.dispatchEvent(
        new StorageEvent('storage', { key: StorageKeys.session, newValue: 'x' })
      );
      expect(heard).toHaveBeenCalledWith('x');
    });

    it('decides once, as the document starts', () => {
      const facade = facadeFor(false);
      facade.readStorage(KEY);

      // The handoff page writes the marker into an ordinary document, and leaves it.
      sessionStorage.setItem(StorageKeys.supportSession, '1');
      facade.writeStorage(KEY, 'value');

      expect(localStorage.getItem(KEY)).toBe('value');
      expect(TestBed.inject(ImpersonationState).active).toBe(false);
    });

    it('removes the keys of this tab that a test names, and no others', () => {
      const facade = facadeFor(false);
      sessionStorage.setItem('a:velista', '1');
      sessionStorage.setItem('b:shell', '1');

      facade.removeSessionStorageWhere((key) => key.endsWith(':velista'));

      expect(sessionStorage.getItem('a:velista')).toBeNull();
      expect(sessionStorage.getItem('b:shell')).toBe('1');
    });

    // The old document runs on until the new one commits. A refresh that lands in that
    // window must not change what the new document reads.
    it('writes and removes nothing once it has replaced the document', () => {
      const facade = facadeFor(true);
      const replace = jest.fn();
      jest
        .spyOn(facade, 'location', 'get')
        .mockReturnValue({ replace } as unknown as Location);
      sessionStorage.setItem(StorageKeys.session, 'the new pair');
      sessionStorage.setItem('a:velista', '1');

      facade.replaceDocument('/home');
      facade.writeStorage(StorageKeys.session, 'a late refresh');
      facade.removeStorage('a:velista');
      facade.writeSessionStorage(StorageKeys.supportSession, '2');
      facade.removeSessionStorage('a:velista');
      facade.removeSessionStorageWhere(() => true);
      facade.replaceDocument('/auth/support-ended');

      expect(sessionStorage.getItem(StorageKeys.session)).toBe('the new pair');
      expect(sessionStorage.getItem(StorageKeys.supportSession)).toBe('1');
      expect(sessionStorage.getItem('a:velista')).toBe('1');
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/home');
    });

    // The handoff page in an ordinary tab, while a refresh of the operator's own pair is
    // in flight: the server already rotated that refresh token, so its write must land.
    it('still writes the origin once an ordinary tab has replaced the document', () => {
      const facade = facadeFor(false);
      jest
        .spyOn(facade, 'location', 'get')
        .mockReturnValue({ replace: jest.fn() } as unknown as Location);
      localStorage.setItem(StorageKeys.session, 'the revoked pair');
      localStorage.setItem(KEY, 'stale');
      sessionStorage.setItem(StorageKeys.session, 'the new pair');

      facade.replaceDocument('/home');
      facade.writeStorage(StorageKeys.session, 'the refreshed pair');
      facade.removeStorage(KEY);
      facade.writeSessionStorage(StorageKeys.session, 'a late write');

      expect(localStorage.getItem(StorageKeys.session)).toBe(
        'the refreshed pair'
      );
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(sessionStorage.getItem(StorageKeys.session)).toBe('the new pair');
    });
  });

  describe('on the server', () => {
    let facade: BrowserFacade;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
      });
      facade = TestBed.inject(BrowserFacade);
    });

    // Plan 0001, D2: SSR is deferred, but nothing may make it harder. Every
    // browser-only global degrades instead of throwing.
    it('degrades to null rather than throwing', () => {
      expect(facade.isBrowser).toBe(false);
      expect(facade.window).toBeNull();
      expect(facade.location).toBeNull();
      expect(facade.readStorage('anything')).toBeNull();
      expect(() => facade.writeStorage('a', 'b')).not.toThrow();
      expect(() => facade.reload()).not.toThrow();
      expect(facade.matchMedia('(prefers-color-scheme: light)')()).toBe(false);
    });

    it('never reports offline during a server render', () => {
      expect(facade.onLine()).toBe(true);
    });
  });
});
