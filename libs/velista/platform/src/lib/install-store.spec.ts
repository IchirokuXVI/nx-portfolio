import { TestBed } from '@angular/core/testing';
import { InstallStore } from './install-store';
import { StorageKeys } from './storage-keys';
import { provideVelistaTesting } from './testing/velista-testing';

/**
 * Plan 0033, section 8.
 *
 * Against the **real** `BrowserFacade`, for the reason `theme-store.spec.ts` gives: this
 * spec is about how the store reads and listens to the browser, so a faked facade would
 * leave it asserting on its own stub.
 *
 * jsdom has no `matchMedia`, and the facade answers false wherever it cannot answer at
 * all, which is exactly the bias this store needs: not installed unless something says
 * otherwise.
 */
function createStore(): InstallStore {
  TestBed.configureTestingModule({ providers: [provideVelistaTesting()] });
  return TestBed.inject(InstallStore);
}

/** The event Chromium fires, with the two members the store touches. */
function beforeInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted'
): Event & { prompted: boolean } {
  // Cancelable, like the real one: `preventDefault` is what suppresses Chromium's
  // own infobar, and on a non cancelable event the call would silently do nothing.
  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as Event & {
    prompted: boolean;
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompted = false;
  event.prompt = () => {
    event.prompted = true;
    return Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('InstallStore', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('starts in manual, which is the state that always has something to show', () => {
    const store = createStore();

    expect(store.state()).toBe('manual');
    expect(store.canPrompt()).toBe(false);
  });

  /**
   * The event fires at the browser's discretion, once, and usually before any of the
   * three screens exists. This is the whole reason the store is constructed at
   * bootstrap rather than by the page that shows the button (D1).
   */
  it('captures a prompt fired before any page exists, and moves to ready', () => {
    const store = createStore();

    window.dispatchEvent(beforeInstallPrompt());

    expect(store.state()).toBe('ready');
    expect(store.canPrompt()).toBe(true);
  });

  it('keeps Chromium’s own infobar out of the way', () => {
    createStore();
    const event = beforeInstallPrompt();

    const notCancelled = window.dispatchEvent(event);

    // `preventDefault`, so the browser's mini infobar does not compete with the page
    // that is about to offer the same thing.
    expect(notCancelled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('moves to installed when the browser says it happened', () => {
    const store = createStore();
    window.dispatchEvent(beforeInstallPrompt());

    window.dispatchEvent(new Event('appinstalled'));

    expect(store.state()).toBe('installed');
    expect(store.canPrompt()).toBe(false);
  });

  it('remembers that it happened, because the event fires once', () => {
    createStore();

    window.dispatchEvent(new Event('appinstalled'));

    expect(localStorage.getItem(StorageKeys.installed)).toBe('true');
    // A fresh store, standing in for the next page load in the same tab.
    TestBed.resetTestingModule();
    expect(createStore().state()).toBe('installed');
  });

  describe('prompt', () => {
    it('asks the browser and reports what the person chose', async () => {
      const store = createStore();
      const event = beforeInstallPrompt('accepted');
      window.dispatchEvent(event);

      await expect(store.prompt()).resolves.toBe('accepted');
      expect(event.prompted).toBe(true);
    });

    it('reports a dismissal as a dismissal, not a failure', async () => {
      const store = createStore();
      window.dispatchEvent(beforeInstallPrompt('dismissed'));

      await expect(store.prompt()).resolves.toBe('dismissed');
    });

    /**
     * Rule I2. The event is good once: after `prompt()` resolves it is spent, and
     * Chromium may fire a fresh one later or may not. Holding a spent event leaves a
     * button that looks identical and does nothing, which is worse than no button.
     */
    it('spends the event, whatever the answer was', async () => {
      const store = createStore();
      window.dispatchEvent(beforeInstallPrompt('dismissed'));

      await store.prompt();

      // Back to the state whose label navigates to the steps instead. Nothing stuck.
      expect(store.state()).toBe('manual');
      await expect(store.prompt()).resolves.toBe('unavailable');
    });

    it('clears the event even when the browser refuses the ask', async () => {
      const store = createStore();
      const event = beforeInstallPrompt() as Event & {
        prompt: () => Promise<void>;
      };
      event.prompt = () => Promise.reject(new Error('gesture already spent'));
      window.dispatchEvent(event);

      await expect(store.prompt()).resolves.toBe('unavailable');
      expect(store.state()).toBe('manual');
    });

    it('answers unavailable when there was never anything to ask with', async () => {
      const store = createStore();

      await expect(store.prompt()).resolves.toBe('unavailable');
    });
  });

  it('chooses a guide, and the guide never decides whether a button exists', () => {
    const store = createStore();

    // jsdom reports its own user agent, which is not one of the four, so it lands on
    // the generic fallback. What matters here is that the state is independent of it.
    expect(store.guide()).toBe('android-menu');
    expect(store.state()).toBe('manual');

    window.dispatchEvent(beforeInstallPrompt());

    expect(store.state()).toBe('ready');
    expect(store.guide()).toBe('android-menu');
  });
});
