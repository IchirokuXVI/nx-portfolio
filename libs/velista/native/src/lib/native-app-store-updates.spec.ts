import { TestBed } from '@angular/core/testing';
import { NativeAppStoreUpdates } from './native-app-store-updates';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('NativeAppStoreUpdates', () => {
  let doubles: NativePluginDoubles;
  let store: NativeAppStoreUpdates;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    store = TestBed.inject(NativeAppStoreUpdates);
  });

  it('maps a newer build on Play into the own model', async () => {
    doubles.appUpdateInfoAnswer = {
      currentVersionCode: '20000',
      availableVersionCode: '21000',
      updateAvailability: 2,
      flexibleUpdateAllowed: true,
      immediateUpdateAllowed: false,
      installStatus: 0,
    };

    await expect(store.info()).resolves.toEqual({
      availableVersionCode: 21000,
      currentVersionCode: 20000,
      flexibleAllowed: true,
      immediateAllowed: false,
      installStatus: 'unknown',
    });
  });

  it('offers no version code when Play has no update', async () => {
    doubles.appUpdateInfoAnswer = {
      currentVersionCode: '20000',
      availableVersionCode: '21000',
      updateAvailability: 1,
    };

    await expect(store.info()).resolves.toMatchObject({
      availableVersionCode: null,
      currentVersionCode: 20000,
      flexibleAllowed: false,
      immediateAllowed: false,
    });
  });

  it('answers null for an APK that Play did not install', async () => {
    doubles.appUpdateErrors.add('getAppUpdateInfo');

    await expect(store.info()).resolves.toBeNull();
  });

  it('reads an accepted flow as true and a cancelled one as false', async () => {
    await expect(store.startFlexible()).resolves.toBe(true);
    await expect(store.immediate()).resolves.toBe(true);

    doubles.flexibleAnswer = { code: 1 };
    doubles.immediateAnswer = { code: 3 };
    await expect(store.startFlexible()).resolves.toBe(false);
    await expect(store.immediate()).resolves.toBe(false);
  });

  it('marks the flexible update ready when Play says it is downloaded', async () => {
    await settle();
    const listener = doubles.listeners.get('onFlexibleUpdateStateChange');
    expect(listener).toBeDefined();
    expect(store.flexibleReady()).toBe(false);

    listener?.({
      installStatus: 2,
      bytesDownloaded: 1,
      totalBytesToDownload: 9,
    });
    expect(store.flexibleReady()).toBe(false);

    listener?.({
      installStatus: 11,
      bytesDownloaded: 9,
      totalBytesToDownload: 9,
    });
    expect(store.flexibleReady()).toBe(true);

    await store.completeFlexible();
    expect(doubles.flexibleCompletions).toBe(1);
  });

  it('marks a download from an earlier session ready when info() sees it', async () => {
    doubles.appUpdateInfoAnswer = {
      currentVersionCode: '20000',
      availableVersionCode: '21000',
      updateAvailability: 2,
      installStatus: 11,
    };

    await expect(store.info()).resolves.toMatchObject({
      installStatus: 'downloaded',
    });
    expect(store.flexibleReady()).toBe(true);
  });

  it('resolves every method when Play rejects them all', async () => {
    for (const method of [
      'getAppUpdateInfo',
      'startFlexibleUpdate',
      'completeFlexibleUpdate',
      'performImmediateUpdate',
      'addListener',
    ]) {
      doubles.appUpdateErrors.add(method);
    }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    const refused = TestBed.inject(NativeAppStoreUpdates);
    await settle();

    await expect(refused.info()).resolves.toBeNull();
    await expect(refused.startFlexible()).resolves.toBe(false);
    await expect(refused.completeFlexible()).resolves.toBeUndefined();
    await expect(refused.immediate()).resolves.toBe(false);
    expect(refused.flexibleReady()).toBe(false);
  });

  it('resolves every method when the plugins cannot load', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NATIVE_PLUGINS,
          useValue: () => Promise.reject(new Error('no chunk')),
        },
      ],
    });
    const broken = TestBed.inject(NativeAppStoreUpdates);
    await settle();

    await expect(broken.info()).resolves.toBeNull();
    await expect(broken.startFlexible()).resolves.toBe(false);
    await expect(broken.completeFlexible()).resolves.toBeUndefined();
    await expect(broken.immediate()).resolves.toBe(false);
  });
});
