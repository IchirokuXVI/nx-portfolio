import { TestBed } from '@angular/core/testing';
import { APP_RUNTIME, APP_STORE_URL, detectNativeShell } from './app-runtime';

describe('APP_RUNTIME', () => {
  it('is the web app when nothing provides it', () => {
    // SSR rule 3: a server injector, a spec and the mounted build provide nothing.
    expect(TestBed.inject(APP_RUNTIME)).toBe('web');
  });

  it('has no store listing when nothing provides one', () => {
    expect(TestBed.inject(APP_STORE_URL)).toBeNull();
  });
});

describe('detectNativeShell', () => {
  const host = globalThis as { Capacitor?: unknown };

  afterEach(() => {
    delete host.Capacitor;
  });

  it('is false with no bridge at all, which is every browser and every server', () => {
    expect(detectNativeShell()).toBe(false);
  });

  it('is true when the bridge says it is native', () => {
    host.Capacitor = { isNativePlatform: () => true };

    expect(detectNativeShell()).toBe(true);
  });

  it('is false for the web build of the bridge, which defines the global too', () => {
    host.Capacitor = { isNativePlatform: () => false };

    expect(detectNativeShell()).toBe(false);
  });

  it('is false for a bridge with no such method, or one that answers loosely', () => {
    host.Capacitor = {};
    expect(detectNativeShell()).toBe(false);

    host.Capacitor = { isNativePlatform: () => 'yes' };
    expect(detectNativeShell()).toBe(false);
  });

  it('does not throw when the bridge does', () => {
    host.Capacitor = {
      isNativePlatform: () => {
        throw new Error('bridge not ready');
      },
    };

    expect(detectNativeShell()).toBe(false);
  });
});
