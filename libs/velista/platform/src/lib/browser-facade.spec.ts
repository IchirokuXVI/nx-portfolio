import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';

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
    });

    it('never reports offline during a server render', () => {
      expect(facade.onLine()).toBe(true);
    });
  });
});
