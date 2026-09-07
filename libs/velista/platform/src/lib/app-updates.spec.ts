import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  AppUpdates,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_DOWNLOAD_TIMEOUT_MS,
} from './app-updates';
import { BackendReadiness } from './backend-readiness';
import { BrowserFacade } from './browser-facade';
import { ReloadBlocker } from './reload-blocker';
import { StorageKeys } from './storage-keys';

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
  let session: Map<string, string>;

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
    session = new Map<string, string>();

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
        {
          provide: BrowserFacade,
          useValue: {
            document: doc,
            reload,
            // `BackendReadiness` reads this through `ConnectionState`, and it holds
            // the timer off with `isBrowser`, which a bare fake leaves undefined.
            onLine: signal(true),
            readSessionStorage: (key: string) => session.get(key) ?? null,
            writeSessionStorage: (key: string, value: string) =>
              void session.set(key, value),
            removeSessionStorage: (key: string) => void session.delete(key),
          },
        },
      ],
    });
  }

  /** The refusal, arriving the way it does in the app: through the readiness state. */
  function refuse(): void {
    TestBed.inject(BackendReadiness).reportTooOld();
    TestBed.tick();
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

    /**
     * Plan 0072. A build the deployment refuses is in the same position as a broken
     * cache: nothing behind the screen can be submitted, so nothing is protected by
     * waiting, and the only way out is a new bundle.
     */
    describe('a build the server refuses', () => {
      it('asks the worker for a new version', async () => {
        refuse();
        await flushMicrotasks();

        expect(checkForUpdate).toHaveBeenCalledTimes(1);
      });

      it('reloads a version that arrives without waiting for a navigation', async () => {
        checkForUpdate.mockResolvedValue(true);
        refuse();
        await flushMicrotasks();

        ready({ critical: false });

        // No `NavigationEnd`. Plan 0034 D7 is untouched, because the reload still
        // happens on `VERSION_READY` and only there; what it no longer waits for is a
        // navigation that a user who is not navigating never makes.
        expect(reload).toHaveBeenCalledTimes(1);
      });

      it('reloads over unsaved work, unlike every other update', async () => {
        // D7. The form a blocker protects cannot be submitted by a client every one
        // of whose requests is refused, so waiting costs the user time and saves them
        // nothing.
        blocker.block();
        checkForUpdate.mockResolvedValue(true);
        refuse();
        await flushMicrotasks();

        ready();

        expect(reload).toHaveBeenCalledTimes(1);
      });

      it('takes a version already waiting for a navigation', async () => {
        // The gap D3 describes from the other side: a check on the half hour timer
        // found a version, and the user has not changed screens since. Asking the
        // worker again would answer `false`, because nothing is newer than the latest
        // it already holds, and the dead end would be drawn over a cached bundle.
        ready();
        expect(reload).not.toHaveBeenCalled();

        refuse();
        await flushMicrotasks();

        expect(reload).toHaveBeenCalledTimes(1);
        expect(checkForUpdate).not.toHaveBeenCalled();
      });

      it('stops on the dead end when there is no newer version', async () => {
        // D5. `false` is the worker saying there is nothing to install, which is the
        // honest end of the wait rather than a reason to keep waiting.
        checkForUpdate.mockResolvedValue(false);
        const updates = TestBed.inject(AppUpdates);

        refuse();
        await flushMicrotasks();

        expect(reload).not.toHaveBeenCalled();
        expect(updates.updateFailed()).toBe(true);
      });

      it('stops on the dead end when the version found never arrives', async () => {
        checkForUpdate.mockResolvedValue(true);
        const updates = TestBed.inject(AppUpdates);

        refuse();
        await flushMicrotasks();
        expect(updates.updateFailed()).toBe(false);

        jest.advanceTimersByTime(UPDATE_DOWNLOAD_TIMEOUT_MS);

        expect(updates.updateFailed()).toBe(true);
        expect(reload).not.toHaveBeenCalled();
      });

      it('does not reload twice in one document', async () => {
        // D4. The reload happened, the tab came back, and the server refused the same
        // build again: a deployment whose floor is above its own newest build, or a
        // cache serving the old bundle back.
        session.set(StorageKeys.updateAttempt, '1');
        checkForUpdate.mockResolvedValue(true);
        const updates = TestBed.inject(AppUpdates);

        refuse();
        await flushMicrotasks();

        expect(checkForUpdate).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(updates.updateFailed()).toBe(true);
      });

      it('records the attempt when it does reload', async () => {
        checkForUpdate.mockResolvedValue(true);
        refuse();
        await flushMicrotasks();

        ready();

        expect(session.get(StorageKeys.updateAttempt)).toBe('1');
      });

      it('clears the attempt once the backend serves this build again', () => {
        // A floor moved later in a long lived tab gets an attempt of its own.
        session.set(StorageKeys.updateAttempt, '1');

        TestBed.inject(BackendReadiness).reportReady();
        TestBed.tick();

        expect(session.has(StorageKeys.updateAttempt)).toBe(false);
      });

      it('starts one attempt however many requests are refused', async () => {
        checkForUpdate.mockResolvedValue(true);
        const updates = TestBed.inject(AppUpdates);

        refuse();
        updates.demandUpdate();
        updates.demandUpdate();
        await flushMicrotasks();

        expect(checkForUpdate).toHaveBeenCalledTimes(1);
      });

      it('reloads once by hand from the dead end, counter or not', () => {
        session.set(StorageKeys.updateAttempt, '1');

        TestBed.inject(AppUpdates).reloadByHand();

        // Bypasses the counter on purpose: it exists to stop the app looping, and
        // this is a person choosing.
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    /**
     * Plan 0034 D7, which this plan preserves rather than reverses (0072 D3). A client
     * that reloaded on the server's word alone, in the window between a deploy moving
     * its floor and the new bundle being reachable, would come back identical, be told
     * the same thing, and reload again with no way out.
     */
    it('reloads nothing on the refusal alone, nor on an advertised floor', async () => {
      checkForUpdate.mockResolvedValue(true);
      const updates = TestBed.inject(AppUpdates);

      // What the interceptor does with the advertised floor header.
      updates.checkNow();
      await flushMicrotasks();
      expect(reload).not.toHaveBeenCalled();

      // And what it does with an outright refusal.
      refuse();
      await flushMicrotasks();
      expect(reload).not.toHaveBeenCalled();

      // Only a version actually cached moves anything.
      ready();
      expect(reload).toHaveBeenCalledTimes(1);
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

    /**
     * Plan 0072 D6. There is no update channel here, so there is no `VERSION_READY`
     * to wait for, and a plain reload is what fetches a fresh `index.html` and a
     * fresh bundle. The one attempt counter bounds it exactly as it bounds the other
     * path, which is what stops a refused build reloading the shell's page forever.
     */
    describe('and a build the server refuses', () => {
      it('reloads the page itself, once', async () => {
        refuse();
        await flushMicrotasks();

        expect(checkForUpdate).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(session.get(StorageKeys.updateAttempt)).toBe('1');
      });

      it('shows the dead end instead when the attempt is already spent', async () => {
        session.set(StorageKeys.updateAttempt, '1');
        const updates = TestBed.inject(AppUpdates);

        refuse();
        await flushMicrotasks();

        expect(reload).not.toHaveBeenCalled();
        expect(updates.updateFailed()).toBe(true);
      });
    });
  });
});
