import { TestBed } from '@angular/core/testing';
import { BUILTIN_BUNDLE } from '@portfolio/velista/platform';
import { NativeLiveUpdates } from './native-live-updates';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

const BUNDLE = '0.21.0+1a2b3c4d5e6f';

describe('NativeLiveUpdates', () => {
  let doubles: NativePluginDoubles;
  let live: NativeLiveUpdates;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    live = TestBed.inject(NativeLiveUpdates);
  });

  describe('info()', () => {
    it('answers the facts of the APK', async () => {
      await expect(live.info()).resolves.toEqual({
        nativeApi: 1,
        otaBaseUrl: 'https://staging.velista.app/ota/android/',
        otaPublicKey: 'PEM',
        builtinBundle: '0.20.0+0f7476f4e1a2',
      });
      expect(live.available()).toBe(true);
    });

    it('says unavailable once the APK has no OTA channel', async () => {
      doubles.nativeInfoAnswer = {
        nativeApi: 1,
        otaBaseUrl: '',
        otaPublicKey: '',
        builtinBundle: '0.20.0+0f7476f4e1a2',
      };

      await expect(live.info()).resolves.toMatchObject({ otaBaseUrl: '' });
      expect(live.available()).toBe(false);
    });

    it('answers null for an answer it cannot read', async () => {
      doubles.nativeInfoAnswer = { nativeApi: '1', otaBaseUrl: 'x' };

      await expect(live.info()).resolves.toBeNull();
      expect(live.available()).toBe(false);
    });
  });

  describe('current()', () => {
    it('maps the APK own bundle to the builtin marker, not its versionName', async () => {
      await expect(live.current()).resolves.toBe(BUILTIN_BUNDLE);
    });

    it('answers the version a downloaded bundle was given', async () => {
      doubles.currentAnswer = {
        bundle: { id: 'r4nd0m1d00', version: BUNDLE, status: 'success' },
        native: '0.20.0',
      };

      await expect(live.current()).resolves.toBe(BUNDLE);
    });
  });

  describe('download()', () => {
    const request = {
      bundle: BUNDLE,
      url: 'https://staging.velista.app/ota/android/bundles/abc.zip',
      sha256: 'a'.repeat(64),
    };

    it('downloads under the manifest bundle as the version, checked by its SHA-256', async () => {
      await expect(live.download(request)).resolves.toBe(true);

      expect(doubles.downloads).toEqual([
        { url: request.url, version: BUNDLE, checksum: request.sha256 },
      ]);
    });

    it('answers true at once for a bundle the updater already holds', async () => {
      doubles.listAnswer = {
        bundles: [{ id: 'r4nd0m1d00', version: BUNDLE, status: 'pending' }],
      };

      await expect(live.download(request)).resolves.toBe(true);
      expect(doubles.downloads).toEqual([]);
    });

    it('downloads again over a held bundle in error', async () => {
      doubles.listAnswer = {
        bundles: [{ id: 'r4nd0m1d00', version: BUNDLE, status: 'error' }],
      };

      await expect(live.download(request)).resolves.toBe(true);
      expect(doubles.downloads).toHaveLength(1);
    });

    it('answers false when the checksum is wrong', async () => {
      doubles.downloadError = new Error(
        `Failed to download from: ${request.url}`
      );

      await expect(live.download(request)).resolves.toBe(false);
    });
  });

  describe('apply()', () => {
    it('switches by the id that list() pairs with the version', async () => {
      doubles.listAnswer = {
        bundles: [
          {
            id: 'oldoldold0',
            version: '0.19.0+aaaaaaaaaaaa',
            status: 'success',
          },
          { id: 'r4nd0m1d00', version: BUNDLE, status: 'pending' },
        ],
      };

      await live.apply(BUNDLE);

      expect(doubles.sets).toEqual([{ id: 'r4nd0m1d00' }]);
    });

    it('switches to nothing when no usable bundle has that version', async () => {
      doubles.listAnswer = {
        bundles: [{ id: 'r4nd0m1d00', version: BUNDLE, status: 'error' }],
      };

      await live.apply(BUNDLE);

      expect(doubles.sets).toEqual([]);
    });
  });

  it('resets to the built-in bundle', async () => {
    await live.resetToBuiltin();

    expect(doubles.resets).toBe(1);
  });

  describe('failedBundles()', () => {
    it('maps the last rollback once, and nothing after it', async () => {
      doubles.failedAnswers = [
        {
          bundle: { id: 'r4nd0m1d00', version: BUNDLE, status: 'pending' },
        },
      ];

      await expect(live.failedBundles()).resolves.toEqual([{ bundle: BUNDLE }]);
      await expect(live.failedBundles()).resolves.toEqual([]);
    });
  });

  describe('fetchText()', () => {
    const url = 'https://staging.velista.app/ota/android/manifest.json';

    it('asks native HTTP for the exact bytes and answers them as text', async () => {
      const body = '{\n  "schema": 1,\n  "bundle": "0.21.0+é"\n}\n';
      const bytes = new TextEncoder().encode(body);
      // As Android sends it: base64 with a line break every 76 characters.
      const encoded = btoa(String.fromCharCode(...bytes)).replace(
        /(.{20})/g,
        '$1\n'
      );
      doubles.httpAnswer = { status: 200, data: encoded };

      // The final line break survives, which a `text` response loses.
      await expect(live.fetchText(url)).resolves.toBe(body);
      expect(doubles.httpRequests).toEqual([
        { url, method: 'GET', responseType: 'arraybuffer' },
      ]);
    });

    it('answers null for a body that is not base64 of UTF-8', async () => {
      doubles.httpAnswer = { status: 200, data: '!!not base64!!' };
      await expect(live.fetchText(url)).resolves.toBeNull();

      doubles.httpAnswer = { status: 200, data: btoa('\xff\xfe') };
      await expect(live.fetchText(url)).resolves.toBeNull();
    });

    it('answers null on a 404', async () => {
      doubles.httpAnswer = { status: 404, data: '' };

      await expect(live.fetchText(url)).resolves.toBeNull();
    });

    it('answers null for a body Android already parsed, whose bytes are gone', async () => {
      doubles.httpAnswer = { status: 200, data: { schema: 1 } };

      await expect(live.fetchText(url)).resolves.toBeNull();
    });
  });

  it('confirms the boot once per document however often it is asked', async () => {
    await Promise.all([live.confirmBoot(), live.confirmBoot()]);
    await live.confirmBoot();

    expect(doubles.readyNotices).toBe(1);
  });

  describe('a plugin that rejects', () => {
    beforeEach(() => {
      for (const method of [
        'notifyAppReady',
        'download',
        'set',
        'reset',
        'list',
        'current',
        'getFailedUpdate',
      ]) {
        doubles.updaterErrors.add(method);
      }
      doubles.nativeInfoError = new Error('no plugin');
      doubles.httpError = new Error('no network');
    });

    it('resolves every method to the unavailable answer', async () => {
      await expect(live.info()).resolves.toBeNull();
      expect(live.available()).toBe(false);
      await expect(live.current()).resolves.toBeNull();
      await expect(live.fetchText('https://x/ota/')).resolves.toBeNull();
      await expect(
        live.download({ bundle: BUNDLE, url: 'https://x', sha256: 'a' })
      ).resolves.toBe(false);
      await expect(live.apply(BUNDLE)).resolves.toBeUndefined();
      await expect(live.resetToBuiltin()).resolves.toBeUndefined();
      await expect(live.confirmBoot()).resolves.toBeUndefined();
      await expect(live.failedBundles()).resolves.toEqual([]);
    });

    it('resolves when the plugins cannot even load', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: NATIVE_PLUGINS,
            useValue: () => Promise.reject(new Error('no chunk')),
          },
        ],
      });
      const broken = TestBed.inject(NativeLiveUpdates);

      await expect(broken.info()).resolves.toBeNull();
      await expect(broken.current()).resolves.toBeNull();
      await expect(broken.fetchText('https://x')).resolves.toBeNull();
      await expect(
        broken.download({ bundle: BUNDLE, url: 'https://x', sha256: 'a' })
      ).resolves.toBe(false);
      await expect(broken.apply(BUNDLE)).resolves.toBeUndefined();
      await expect(broken.resetToBuiltin()).resolves.toBeUndefined();
      await expect(broken.confirmBoot()).resolves.toBeUndefined();
      await expect(broken.failedBundles()).resolves.toEqual([]);
    });
  });
});
