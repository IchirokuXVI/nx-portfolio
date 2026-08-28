import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type AppBrand } from '@portfolio/velista/models';
import { provideVelistaTesting } from './testing/velista-testing';
import { THEME_STORAGE_KEY, ThemeStore } from './theme-store';

/** Stands in for jsdom's missing `matchMedia`, reporting the OS as light or not. */
function stubPrefersLight(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    value: jest.fn().mockReturnValue({
      matches,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
    configurable: true,
  });
}

function createStore(override: Partial<AppBrand> = {}): ThemeStore {
  // The real `BrowserFacade` on purpose. This spec is about how the store reads
  // `localStorage` and `matchMedia`, so faking the facade would leave it asserting on
  // its own stub. `provideVelistaTesting` does not replace it for exactly this reason.
  TestBed.configureTestingModule({
    providers: [provideVelistaTesting({ brand: override })],
  });
  return TestBed.inject(ThemeStore);
}

describe('ThemeStore', () => {
  afterEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  // Plan 0002, section 4.5. Resolution order, first match wins: an explicit user
  // choice, then the operating system, then Night.
  describe('resolution order', () => {
    it('falls back to Night when nothing has an opinion', () => {
      const store = createStore();

      expect(store.preference()).toBe('system');
      expect(store.theme()).toBe('night');
      expect(store.themeClass()).toBe('theme-night');
    });

    it('follows the operating system when the user has not chosen', () => {
      stubPrefersLight(true);
      const store = createStore();

      expect(store.preference()).toBe('system');
      expect(store.theme()).toBe('day');
    });

    it('lets an explicit choice beat the operating system', () => {
      stubPrefersLight(true);
      const store = createStore();

      store.setPreference('night');

      expect(store.theme()).toBe('night');
      expect(store.themeClass()).toBe('theme-night');
    });

    it('hands control back to the device on `system`', () => {
      stubPrefersLight(true);
      const store = createStore();

      store.setPreference('night');
      store.setPreference('system');

      expect(store.theme()).toBe('day');
    });
  });

  describe('persistence', () => {
    it('remembers the choice across a reload', () => {
      createStore().setPreference('day');

      TestBed.resetTestingModule();
      expect(createStore().preference()).toBe('day');
    });

    it('ignores a stored value that is not a preference', () => {
      // Someone else's key collision, a hand edit, or a value from a version of
      // the app that offered a theme this one does not.
      localStorage.setItem(THEME_STORAGE_KEY, 'theme-midnight');

      const store = createStore();

      expect(store.preference()).toBe('system');
      expect(store.theme()).toBe('night');
    });

    it('still switches for this session when storage refuses the write', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage blocked');
      });
      const store = createStore();

      expect(() => store.setPreference('day')).not.toThrow();
      expect(store.theme()).toBe('day');
    });
  });

  describe('a brand that pins a theme', () => {
    it('overrides the whole resolution, not just the default', () => {
      stubPrefersLight(true);
      const store = createStore({ themeClass: 'theme-dusk' });

      expect(store.isPinned).toBe(true);
      expect(store.themeClass()).toBe('theme-dusk');

      store.setPreference('night');
      expect(store.themeClass()).toBe('theme-dusk');
    });

    it('is not pinned by default, so both themes stay reachable', () => {
      expect(createStore().isPinned).toBe(false);
    });
  });

  // Plan 0001, D2: `localStorage` and `matchMedia` are both server hostile, and
  // the standalone SSR build has to keep working.
  describe('on the server', () => {
    it('resolves to Night without touching a browser global', () => {
      TestBed.configureTestingModule({
        providers: [
          provideVelistaTesting(),
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });

      const store = TestBed.inject(ThemeStore);

      expect(store.theme()).toBe('night');
      expect(() => store.setPreference('day')).not.toThrow();
    });
  });
});
