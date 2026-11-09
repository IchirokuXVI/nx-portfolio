import { ApplicationRef, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  APP_RUNTIME,
  APP_STORE_UPDATES,
  APP_STORE_URL,
  BrowserFacade,
  BrowserGeolocationReader,
  GEOLOCATION_READER,
  GOOGLE_CREDENTIAL,
  LIVE_UPDATES,
  SHARE_TARGET,
  SYSTEM_BARS,
  UNAVAILABLE_LIVE_UPDATES,
  WebShareTarget,
  WebSystemBars,
} from '@portfolio/velista/platform';
import { NativeAppStoreUpdates } from './native-app-store-updates';
import { NativeBrowserFacade } from './native-browser-facade';
import { NativeGeolocationReader } from './native-geolocation-reader';
import { NativeGoogleCredential } from './native-google-credential';
import { NativeLiveUpdates } from './native-live-updates';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativeShareTarget } from './native-share-target';
import { NativeSystemBars } from './native-system-bars';
import { provideNativeShell } from './provide-native-shell';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform: () => boolean };
}

describe('provideNativeShell', () => {
  let doubles: NativePluginDoubles;

  function setUp(platform: 'browser' | 'server' = 'browser'): void {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: NATIVE_PLUGINS, useValue: doubles.loader },
        provideNativeShell(),
      ],
    });
  }

  function bridge(native: boolean): void {
    (globalThis as CapacitorGlobal).Capacitor = {
      isNativePlatform: () => native,
    };
  }

  afterEach(() => {
    delete (globalThis as CapacitorGlobal).Capacitor;
  });

  function expectWebDefaults(): void {
    expect(TestBed.inject(APP_RUNTIME)).toBe('web');
    expect(TestBed.inject(SHARE_TARGET)).toBeInstanceOf(WebShareTarget);
    expect(TestBed.inject(GEOLOCATION_READER)).toBeInstanceOf(
      BrowserGeolocationReader
    );
    expect(TestBed.inject(SYSTEM_BARS)).toBeInstanceOf(WebSystemBars);
    expect(TestBed.inject(BrowserFacade)).not.toBeInstanceOf(
      NativeBrowserFacade
    );
    expect(TestBed.inject(APP_STORE_URL)).toBeNull();
    // No picker on the web, so `GoogleSignIn` keeps the redirect flow (velista 0177).
    expect(TestBed.inject(GOOGLE_CREDENTIAL)).toBeNull();
    // No updater and no Play on the web (velista 0180).
    expect(TestBed.inject(LIVE_UPDATES)).toBe(UNAVAILABLE_LIVE_UPDATES);
    expect(TestBed.inject(APP_STORE_UPDATES).available()).toBe(false);
  }

  describe('on the web', () => {
    it('resolves every seam to the web default and loads no plugin', async () => {
      setUp();

      expectWebDefaults();
      await Promise.resolve();
      expect(doubles.loads).toBe(0);
    });

    it('confirms no boot on the web', async () => {
      setUp();
      TestBed.inject(APP_RUNTIME);
      TestBed.inject(ApplicationRef).tick();
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(doubles.readyNotices).toBe(0);
    });

    it('stays the web app where Capacitor defines its global but is not native', async () => {
      bridge(false);
      setUp();

      expectWebDefaults();
      await Promise.resolve();
      expect(doubles.loads).toBe(0);
    });

    it('stays the web app in a server render, whatever the global says', async () => {
      bridge(true);
      setUp('server');

      expectWebDefaults();
      await Promise.resolve();
      expect(doubles.loads).toBe(0);
    });
  });

  describe('inside a native shell', () => {
    beforeEach(() => {
      bridge(true);
      setUp();
    });

    it('provides the native implementation of every seam', () => {
      expect(TestBed.inject(APP_RUNTIME)).toBe('native');
      expect(TestBed.inject(SHARE_TARGET)).toBeInstanceOf(NativeShareTarget);
      expect(TestBed.inject(GEOLOCATION_READER)).toBeInstanceOf(
        NativeGeolocationReader
      );
      expect(TestBed.inject(SYSTEM_BARS)).toBeInstanceOf(NativeSystemBars);
      expect(TestBed.inject(BrowserFacade)).toBeInstanceOf(NativeBrowserFacade);
      expect(TestBed.inject(GOOGLE_CREDENTIAL)).toBeInstanceOf(
        NativeGoogleCredential
      );
      expect(TestBed.inject(LIVE_UPDATES)).toBeInstanceOf(NativeLiveUpdates);
      expect(TestBed.inject(APP_STORE_UPDATES)).toBeInstanceOf(
        NativeAppStoreUpdates
      );
    });

    it('confirms the boot at the first render, once per document', async () => {
      TestBed.inject(APP_RUNTIME);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
      // Nothing rendered yet, so nothing confirmed (velista 0180, D7).
      expect(doubles.readyNotices).toBe(0);

      const appRef = TestBed.inject(ApplicationRef);
      appRef.tick();
      appRef.tick();
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(doubles.readyNotices).toBe(1);
    });

    it('registers the back and link listeners at startup', async () => {
      TestBed.inject(APP_RUNTIME);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect([...doubles.listeners.keys()].sort()).toEqual([
        'appUrlOpen',
        'backButton',
      ]);
    });

    it('links the dead end face to the store listing', () => {
      expect(TestBed.inject(APP_STORE_URL)).toBe(
        'https://play.google.com/store/apps/details?id=app.velista'
      );
    });

    it('opens an address outside the app in the in app browser', async () => {
      TestBed.inject(BrowserFacade).openExternal(
        'https://www.openstreetmap.org'
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(doubles.opened).toEqual(['https://www.openstreetmap.org']);
    });
  });
});
