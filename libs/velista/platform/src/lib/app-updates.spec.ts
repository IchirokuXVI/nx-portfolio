import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates, UPDATE_CHECK_INTERVAL_MS } from './app-updates';
import { BrowserFacade } from './browser-facade';
import { ReloadBlocker } from './reload-blocker';

/**
 * A document that records its listeners, so a spec can drive a visibility change
 * without a real one. `BrowserFacade` is the only thing in this app allowed to hold a
 * browser global (plan 0001 D2), which is what makes faking one here enough.
 */
function fakeDocument() {
  const listeners = new Map<string, Set<() => void>>();

  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

describe('AppUpdates', () => {
  let versionUpdates: Subject<VersionEvent>;
  let unrecoverable: Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>;
  let routerEvents: Subject<unknown>;
  let checkForUpdate: jest.Mock<Promise<boolean>, []>;
  let reload: jest.Mock;
  let doc: ReturnType<typeof fakeDocument>;

  /** Lets every pending `then`/`finally` in the check chain run. */
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  function configure(isEnabled: boolean) {
    versionUpdates = new Subject();
    unrecoverable = new Subject();
    routerEvents = new Subject();
    checkForUpdate = jest.fn().mockResolvedValue(false);
    reload = jest.fn();
    doc = fakeDocument();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SwUpdate,
          useValue: {
            isEnabled,
            versionUpdates,
            unrecoverable,
            checkForUpdate,
          },
        },
        { provide: Router, useValue: { events: routerEvents } },
        { provide: BrowserFacade, useValue: { document: doc, reload } },
      ],
    });
  }

  function ready(appData?: object) {
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new', appData },
    });
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('with an enabled service worker', () => {
    let blocker: ReloadBlocker;

    beforeEach(() => {
      configure(true);
      TestBed.inject(AppUpdates);
      blocker = TestBed.inject(ReloadBlocker);
    });

    it('checks when the window becomes visible', () => {
      // The trigger that matters: an installed window is resumed far more often
      // than it is cold started, and the resume used to be the one moment the app
      // was guaranteed not to ask (plan 0034 D1).
      doc.emit('visibilitychange');

      expect(checkForUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not check when the window is hidden rather than shown', () => {
      doc.visibilityState = 'hidden';

      doc.emit('visibilitychange');

      expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it('checks on the interval while the window stays open', () => {
      jest.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
      expect(checkForUpdate).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(checkForUpdate).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent checks into the one in flight', async () => {
      // The interceptor calls `checkNow` once per response, so a page firing a
      // burst of requests against a deployment that moved its floor would
      // otherwise start a check per request.
      let settle: (value: boolean) => void = () => undefined;
      checkForUpdate.mockReturnValueOnce(
        new Promise<boolean>((resolve) => (settle = resolve))
      );

      const updates = TestBed.inject(AppUpdates);
      updates.checkNow();
      updates.checkNow();
      updates.checkNow();

      expect(checkForUpdate).toHaveBeenCalledTimes(1);

      settle(false);
      await flushMicrotasks();

      updates.checkNow();
      expect(checkForUpdate).toHaveBeenCalledTimes(2);
    });

    it('swallows a failed check so the next trigger can try again', async () => {
      checkForUpdate.mockRejectedValueOnce(new Error('offline'));

      const updates = TestBed.inject(AppUpdates);
      updates.checkNow();
      await flushMicrotasks();

      updates.checkNow();
      expect(checkForUpdate).toHaveBeenCalledTimes(2);
    });

    it('waits for the next navigation before reloading an ordinary update', () => {
      ready({ critical: false });
      expect(reload).not.toHaveBeenCalled();

      routerEvents.next(new NavigationEnd(1, '/en/home', '/en/home'));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('treats a version with no appData as an ordinary update', () => {
      ready(undefined);
      expect(reload).not.toHaveBeenCalled();

      routerEvents.next(new NavigationEnd(1, '/en/home', '/en/home'));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads a critical update without waiting for a navigation', () => {
      // The release time switch (plan 0034 D3): a change the running bundle is
      // actively wrong about should not wait for the user to change screens.
      ready({ critical: true });

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('never reloads over unsaved work, critical or not', () => {
      // `ReloadBlocker` exists because the app has no offline queue (plan 0001 D6),
      // so a reload at the wrong moment is permanent data loss.
      const release = blocker.block();

      ready({ critical: true });
      expect(reload).not.toHaveBeenCalled();

      release();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not re-propose a deferred reload on every later navigation', () => {
      const release = blocker.block();

      ready();
      routerEvents.next(new NavigationEnd(1, '/en/home', '/en/home'));
      routerEvents.next(new NavigationEnd(2, '/en/lists', '/en/lists'));
      expect(reload).not.toHaveBeenCalled();

      release();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload on a navigation when no version is ready', () => {
      routerEvents.next(new NavigationEnd(1, '/en/home', '/en/home'));

      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads immediately on an unrecoverable state, blocker or not', () => {
      // Nothing left to protect: the cached state is already broken, and honouring
      // a blocker here would strand the user in an app that cannot work.
      blocker.block();

      unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'gone' });

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('without an enabled service worker', () => {
    beforeEach(() => {
      configure(false);
      TestBed.inject(AppUpdates);
    });

    it('subscribes to nothing and schedules nothing', () => {
      // Every development build and every run under the portfolio shell, where
      // `provideServiceWorker` never runs (plan 0013 D4).
      expect(doc.listenerCount('visibilitychange')).toBe(0);

      jest.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 3);
      expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it('ignores checkNow', () => {
      TestBed.inject(AppUpdates).checkNow();

      expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it('does not reload when a version event arrives anyway', () => {
      ready({ critical: true });
      routerEvents.next(new NavigationEnd(1, '/en/home', '/en/home'));

      expect(reload).not.toHaveBeenCalled();
    });
  });
});
