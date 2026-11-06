import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { APP_RUNTIME, type AppRuntime } from './app-runtime';
import {
  APP_STORE_UPDATES,
  type AppStoreUpdateInfo,
  type AppStoreUpdatesI,
} from './app-store-updates';
import { AppUpdates } from './app-updates';
import { BackendReadiness } from './backend-readiness';
import { BrowserFacade } from './browser-facade';
import {
  BundleUpdates,
  OTA_CHECK_INTERVAL_MS,
  OTA_MANIFEST_VERIFIER,
} from './bundle-updates';
import {
  BUILTIN_BUNDLE,
  LIVE_UPDATES,
  type LiveUpdateFailure,
  type LiveUpdatesI,
  type LiveUpdatesInfo,
} from './live-updates';
import { ReloadBlocker } from './reload-blocker';
import { StorageKeys } from './storage-keys';

const BASE = 'https://velista.app/ota/android/';
const BUILTIN_ID = '0.19.0+aaaaaaaaaaaa';
const NEWER = '0.20.0+bbbbbbbbbbbb';
const SHA = 'c'.repeat(64);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    platform: 'android',
    bundle: NEWER,
    version: '0.20.0',
    nativeApi: 1,
    critical: false,
    url: `bundles/${SHA}.zip`,
    sha256: SHA,
    size: 1024,
    builtAt: '2026-11-05T10:00:00Z',
    ...overrides,
  };
}

/** A hand built updater: answers what each field says and writes down every call. */
function fakeLiveUpdates() {
  const state = {
    info: {
      nativeApi: 1,
      otaBaseUrl: BASE,
      otaPublicKey: 'PEM',
      builtinBundle: BUILTIN_ID,
    } as LiveUpdatesInfo | null,
    current: BUILTIN_BUNDLE as string | null,
    manifest: JSON.stringify(manifest()) as string | null,
    signature: 'c2ln' as string | null,
    downloads: true,
    failures: [] as LiveUpdateFailure[],
    calls: [] as string[],
  };

  const api: LiveUpdatesI = {
    available: () => true,
    info: async () => state.info,
    current: async () => state.current,
    fetchText: async (url) => {
      state.calls.push(`fetch ${url}`);
      return url.endsWith('.sig') ? state.signature : state.manifest;
    },
    download: async ({ bundle, url, sha256 }) => {
      state.calls.push(`download ${bundle} ${url} ${sha256}`);
      return state.downloads;
    },
    apply: async (bundle) => void state.calls.push(`apply ${bundle}`),
    applyAtNextStart: async (bundle) => void state.calls.push(`next ${bundle}`),
    resetToBuiltin: async () => void state.calls.push('reset'),
    confirmBoot: async () => void state.calls.push('confirm'),
    failedBundles: async () => state.failures,
  };

  return { state, api };
}

/** A hand built Google Play. */
function fakeAppStore() {
  const state = {
    info: null as AppStoreUpdateInfo | null,
    accepts: false,
    immediateResult: false,
    calls: [] as string[],
  };
  const flexibleReady: WritableSignal<boolean> = signal(false);

  const api: AppStoreUpdatesI = {
    available: () => true,
    info: async () => state.info,
    startFlexible: async () => {
      state.calls.push('flexible');
      return state.accepts;
    },
    completeFlexible: async () => void state.calls.push('complete'),
    immediate: async () => {
      state.calls.push('immediate');
      return state.immediateResult;
    },
    flexibleReady,
  };

  return { state, api, flexibleReady };
}

function playOffers(code: number): AppStoreUpdateInfo {
  return {
    availableVersionCode: code,
    currentVersionCode: 19000,
    flexibleAllowed: true,
    immediateAllowed: true,
    installStatus: 'unknown',
  };
}

describe('BundleUpdates and the native AppUpdates', () => {
  let live: ReturnType<typeof fakeLiveUpdates>;
  let store: ReturnType<typeof fakeAppStore>;
  let verify: jest.Mock<Promise<boolean>, [string, string, string]>;
  let routerEvents: Subject<unknown>;
  let reload: jest.Mock;
  let visible: WritableSignal<boolean>;
  let local: Map<string, string>;
  let session: Map<string, string>;
  let checkForUpdate: jest.Mock;

  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  const navigate = (id: number) =>
    routerEvents.next(new NavigationEnd(id, `/en/p${id}`, `/en/p${id}`));

  function configure(runtime: AppRuntime = 'native') {
    live = fakeLiveUpdates();
    store = fakeAppStore();
    verify = jest.fn().mockResolvedValue(true);
    routerEvents = new Subject();
    reload = jest.fn();
    visible = signal(true);
    local = new Map();
    session = new Map();
    checkForUpdate = jest.fn().mockResolvedValue(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: APP_RUNTIME, useValue: runtime },
        { provide: LIVE_UPDATES, useValue: live.api },
        { provide: APP_STORE_UPDATES, useValue: store.api },
        { provide: OTA_MANIFEST_VERIFIER, useValue: verify },
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: true,
            versionUpdates: new Subject(),
            unrecoverable: new Subject(),
            checkForUpdate,
          },
        },
        { provide: Router, useValue: { events: routerEvents } },
        {
          provide: BrowserFacade,
          useValue: {
            document: {
              visibilityState: 'visible',
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
            },
            window: null,
            visible,
            reload,
            onLine: signal(true),
            readStorage: (key: string) => local.get(key) ?? null,
            writeStorage: (key: string, value: string) =>
              void local.set(key, value),
            removeStorage: (key: string) => void local.delete(key),
            readSessionStorage: (key: string) => session.get(key) ?? null,
            writeSessionStorage: (key: string, value: string) =>
              void session.set(key, value),
            removeSessionStorage: (key: string) => void session.delete(key),
          },
        },
      ],
    });
  }

  const downloads = () =>
    live.state.calls.filter((call) => call.startsWith('download'));
  const manifestFetches = () =>
    live.state.calls.filter((call) => call.endsWith('manifest.json'));

  beforeEach(() => {
    jest.useFakeTimers();
    configure();
  });
  afterEach(() => jest.useRealTimers());

  describe('a check', () => {
    it('does not parse a manifest whose signature is bad, and downloads nothing', async () => {
      // Verified before it is parsed (D5): text that is not even JSON is never read.
      verify.mockResolvedValue(false);
      live.state.manifest = 'not json';
      const parse = jest.spyOn(JSON, 'parse');

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe('none');

      expect(verify).toHaveBeenCalledWith('not json', 'c2ln', 'PEM');
      expect(parse).not.toHaveBeenCalledWith('not json');
      expect(downloads()).toEqual([]);
      parse.mockRestore();
    });

    it('ignores an unsigned manifest', async () => {
      live.state.signature = null;

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe('none');
      expect(verify).not.toHaveBeenCalled();
      expect(downloads()).toEqual([]);
    });

    it('downloads nothing when the manifest names the running bundle', async () => {
      live.state.current = NEWER;

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe(
        'current'
      );
      expect(downloads()).toEqual([]);
    });

    it('reads the built-in bundle by its id from the APK', async () => {
      // `current()` answers `builtin` for the APK's own bundle (D8).
      live.state.manifest = JSON.stringify(manifest({ bundle: BUILTIN_ID }));

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe(
        'current'
      );
      expect(downloads()).toEqual([]);
    });

    it('resets to the built-in bundle when the manifest names it, and downloads nothing', async () => {
      live.state.current = NEWER;
      live.state.manifest = JSON.stringify(manifest({ bundle: BUILTIN_ID }));
      const bundles = TestBed.inject(BundleUpdates);

      await expect(bundles.check()).resolves.toBe('ready');
      await bundles.applyNow();

      expect(downloads()).toEqual([]);
      expect(live.state.calls).toContain('reset');
      expect(live.state.calls.some((call) => call.startsWith('apply'))).toBe(
        false
      );
    });

    it('downloads a newer bundle from the manifest URL, with its SHA-256', async () => {
      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe(
        'ready'
      );

      expect(downloads()).toEqual([
        `download ${NEWER} ${BASE}bundles/${SHA}.zip ${SHA}`,
      ]);
    });

    it('marks a downloaded bundle for the next cold start at once', async () => {
      // The default of D6's last paragraph, until target 1 says otherwise.
      await TestBed.inject(BundleUpdates).check();

      expect(live.state.calls).toContain(`next ${NEWER}`);
      expect(live.state.calls).not.toContain(`apply ${NEWER}`);
    });

    it('downloads nothing for a bundle recorded as failed', async () => {
      local.set(StorageKeys.failedBundles, JSON.stringify([NEWER]));

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe(
        'failed'
      );
      expect(downloads()).toEqual([]);
    });

    it('records a failure the updater reports, and never downloads it again', async () => {
      live.state.failures = [{ bundle: NEWER, reason: 'not confirmed' }];
      const bundles = TestBed.inject(BundleUpdates);

      await expect(bundles.check()).resolves.toBe('failed');
      expect(JSON.parse(local.get(StorageKeys.failedBundles) ?? '[]')).toEqual([
        NEWER,
      ]);

      // The updater deleted it (`autoDeleteFailed`), and the record still holds.
      live.state.failures = [];
      jest.advanceTimersByTime(OTA_CHECK_INTERVAL_MS);
      await expect(bundles.check()).resolves.toBe('failed');
      expect(downloads()).toEqual([]);
    });

    it('clears the record when the manifest names another bundle', async () => {
      local.set(
        StorageKeys.failedBundles,
        JSON.stringify(['0.19.5+dddddddddddd'])
      );

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe(
        'ready'
      );
      expect(local.has(StorageKeys.failedBundles)).toBe(false);
    });

    it('downloads nothing for a higher nativeApi and asks Play once per version code', async () => {
      live.state.manifest = JSON.stringify(manifest({ nativeApi: 2 }));
      store.state.info = playOffers(20000);
      const bundles = TestBed.inject(BundleUpdates);

      await expect(bundles.check()).resolves.toBe('needs-native');
      jest.advanceTimersByTime(OTA_CHECK_INTERVAL_MS);
      await expect(bundles.check()).resolves.toBe('needs-native');

      expect(downloads()).toEqual([]);
      expect(store.state.calls).toEqual(['flexible']);
      expect(local.get(StorageKeys.flexibleUpdateAsked)).toBe('20000');

      // A higher code asks once more.
      store.state.info = playOffers(21000);
      jest.advanceTimersByTime(OTA_CHECK_INTERVAL_MS);
      await bundles.check();
      expect(store.state.calls).toEqual(['flexible', 'flexible']);
    });

    it('never asks for the immediate update while the server serves this build', async () => {
      live.state.manifest = JSON.stringify(manifest({ nativeApi: 2 }));
      store.state.info = playOffers(20000);

      await TestBed.inject(BundleUpdates).check();

      expect(store.state.calls).not.toContain('immediate');
    });

    it('makes one check of two resumes within ten minutes', async () => {
      const bundles = TestBed.inject(BundleUpdates);

      bundles.resumed();
      await flush();
      jest.advanceTimersByTime(OTA_CHECK_INTERVAL_MS - 1);
      bundles.resumed();
      await flush();
      expect(manifestFetches()).toHaveLength(1);

      jest.advanceTimersByTime(1);
      bundles.resumed();
      await flush();
      expect(manifestFetches()).toHaveLength(2);
    });

    it('collapses a check that starts while one is in flight', async () => {
      const bundles = TestBed.inject(BundleUpdates);

      const first = bundles.check();
      const second = bundles.check({ force: true });

      expect(second).toBe(first);
      await first;
      expect(manifestFetches()).toHaveLength(1);
    });

    it('answers none and never throws when the updater rejects', async () => {
      live.api.fetchText = () => Promise.reject(new Error('plugin gone'));

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe('none');
    });

    it('asks nothing when the APK has no OTA channel', async () => {
      live.state.info = {
        ...(live.state.info as LiveUpdatesInfo),
        otaBaseUrl: '',
      };

      await expect(TestBed.inject(BundleUpdates).check()).resolves.toBe('none');
      expect(live.state.calls).toEqual([]);
    });
  });

  describe('applying', () => {
    let blocker: ReloadBlocker;

    beforeEach(() => {
      TestBed.inject(AppUpdates);
      blocker = TestBed.inject(ReloadBlocker);
    });

    it('checks after the first navigation of a cold start, and not before', async () => {
      await flush();
      expect(manifestFetches()).toHaveLength(0);

      navigate(1);
      await flush();
      expect(manifestFetches()).toHaveLength(1);
    });

    it('applies a normal bundle at the next navigation and not before', async () => {
      navigate(1);
      await flush();
      expect(live.state.calls).not.toContain(`apply ${NEWER}`);

      navigate(2);
      await flush();
      expect(live.state.calls).toContain(`apply ${NEWER}`);
      expect(reload).not.toHaveBeenCalled();
    });

    it('holds a normal bundle while a form is held, then applies it', async () => {
      navigate(1);
      await flush();
      const release = blocker.block();

      navigate(2);
      await flush();
      expect(live.state.calls).not.toContain(`apply ${NEWER}`);

      release();
      await flush();
      expect(live.state.calls).toContain(`apply ${NEWER}`);
    });

    it('applies a critical bundle through whenIdle with set(), never with reload()', async () => {
      live.state.manifest = JSON.stringify(manifest({ critical: true }));
      const whenIdle = jest.spyOn(blocker, 'whenIdle');
      const release = blocker.block();

      navigate(1);
      await flush();
      expect(whenIdle).toHaveBeenCalled();
      expect(live.state.calls).not.toContain(`apply ${NEWER}`);

      release();
      await flush();
      expect(live.state.calls).toContain(`apply ${NEWER}`);
      expect(reload).not.toHaveBeenCalled();
    });

    it('checks on a resume, and not on the first frame', async () => {
      TestBed.tick();
      await flush();
      expect(manifestFetches()).toHaveLength(0);

      visible.set(false);
      TestBed.tick();
      visible.set(true);
      TestBed.tick();
      await flush();
      expect(manifestFetches()).toHaveLength(1);
    });

    it('completes a downloaded flexible update at the idle navigation moment', async () => {
      live.state.manifest = null;
      navigate(1);
      await flush();

      store.flexibleReady.set(true);
      const release = blocker.block();
      navigate(2);
      await flush();
      expect(store.state.calls).not.toContain('complete');

      release();
      await flush();
      expect(store.state.calls).toContain('complete');
    });

    it('tells a page no route matched that a waiting bundle is newer', async () => {
      const updates = TestBed.inject(AppUpdates);
      await expect(updates.newerVersionForUnknownPage('/en/x')).resolves.toBe(
        false
      );

      navigate(1);
      await flush();
      await expect(updates.newerVersionForUnknownPage('/en/x')).resolves.toBe(
        true
      );

      updates.reloadForUnknownPage('/en/x');
      await flush();
      expect(live.state.calls).toContain(`apply ${NEWER}`);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  /** Velista `0180` D9: OTA first, then Play's immediate flow, then the dead end. */
  describe('a build the server refuses', () => {
    function refuse(): void {
      TestBed.inject(BackendReadiness).reportTooOld();
      TestBed.tick();
    }

    it('applies a bundle already downloaded, past the blocker, and spends the attempt', async () => {
      const updates = TestBed.inject(AppUpdates);
      navigate(1);
      await flush();
      TestBed.inject(ReloadBlocker).block();
      const fetches = manifestFetches().length;

      refuse();
      await flush();

      expect(manifestFetches()).toHaveLength(fetches);
      expect(live.state.calls).toContain(`apply ${NEWER}`);
      expect(session.get(StorageKeys.updateAttempt)).toBe('1');
      expect(updates.updateFailed()).toBe(false);
      expect(store.state.calls).not.toContain('immediate');
    });

    it('checks the manifest at once, past the ten minute floor, then applies', async () => {
      const bundles = TestBed.inject(BundleUpdates);
      TestBed.inject(AppUpdates);
      live.state.current = NEWER;
      await bundles.check();
      live.state.current = BUILTIN_BUNDLE;

      refuse();
      await flush();

      expect(manifestFetches()).toHaveLength(2);
      expect(live.state.calls).toContain(`apply ${NEWER}`);
      expect(session.get(StorageKeys.updateAttempt)).toBe('1');
    });

    it('asks Play for the immediate update when no bundle fits', async () => {
      live.state.manifest = JSON.stringify(manifest({ nativeApi: 2 }));
      store.state.info = playOffers(20000);
      store.state.immediateResult = true;
      const updates = TestBed.inject(AppUpdates);

      refuse();
      await flush();

      expect(store.state.calls).toContain('immediate');
      expect(downloads()).toEqual([]);
      expect(updates.updateFailed()).toBe(false);
      expect(session.has(StorageKeys.updateAttempt)).toBe(false);
    });

    it('ends on the dead end when Play cannot help either', async () => {
      live.state.manifest = null;
      const updates = TestBed.inject(AppUpdates);

      refuse();
      await flush();

      expect(updates.updateFailed()).toBe(true);
      expect(reload).not.toHaveBeenCalled();
      expect(checkForUpdate).not.toHaveBeenCalled();
    });

    it('skips the bundle once the attempt is spent, and goes on to Play', async () => {
      session.set(StorageKeys.updateAttempt, '1');
      store.state.info = playOffers(20000);
      const updates = TestBed.inject(AppUpdates);

      refuse();
      await flush();

      expect(manifestFetches()).toHaveLength(0);
      expect(store.state.calls).toContain('immediate');
      expect(updates.updateFailed()).toBe(true);
    });

    it('starts one attempt however many requests are refused', async () => {
      const updates = TestBed.inject(AppUpdates);

      refuse();
      updates.demandUpdate();
      updates.demandUpdate();
      await flush();

      expect(manifestFetches()).toHaveLength(1);
      expect(
        live.state.calls.filter((call) => call.startsWith('apply'))
      ).toHaveLength(1);
    });
  });

  describe('on the web', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      configure('web');
    });

    it('never touches either token', async () => {
      const liveCalls = jest.spyOn(live.api, 'info');
      const storeCalls = jest.spyOn(store.api, 'info');
      const updates = TestBed.inject(AppUpdates);

      navigate(1);
      navigate(2);
      updates.checkNow();
      TestBed.inject(BackendReadiness).reportTooOld();
      TestBed.tick();
      await updates.newerVersionForUnknownPage('/en/x');
      await flush();

      expect(liveCalls).not.toHaveBeenCalled();
      expect(storeCalls).not.toHaveBeenCalled();
      expect(live.state.calls).toEqual([]);
      expect(store.state.calls).toEqual([]);
    });
  });
});
