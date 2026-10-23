import { TestBed } from '@angular/core/testing';
import { NativeGeolocationReader } from './native-geolocation-reader';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

describe('NativeGeolocationReader', () => {
  let doubles: NativePluginDoubles;
  let reader: NativeGeolocationReader;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    reader = TestBed.inject(NativeGeolocationReader);
  });

  describe('permission', () => {
    it.each([
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['prompt', 'prompt'],
      ['prompt-with-rationale', 'prompt'],
    ] as const)('reads Android %s as %s', async (android, ours) => {
      doubles.permission = android;
      await expect(reader.permission()).resolves.toBe(ours);
    });

    it('says unknown when Android cannot answer, which never hides the control', async () => {
      doubles.permission = new Error('Location services are not enabled.');
      await expect(reader.permission()).resolves.toBe('unknown');
    });
  });

  describe('read', () => {
    it('asks with the web reader defaults when the caller says nothing', async () => {
      await expect(reader.read()).resolves.toEqual({
        state: 'located',
        point: { latitude: 43.36, longitude: -8.41 },
      });
      expect(doubles.positionOptions).toEqual([
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      ]);
    });

    it('passes a high accuracy request through and carries the accuracy when asked', async () => {
      const outcome = await reader.read({
        enableHighAccuracy: true,
        timeoutMs: 20_000,
        maximumAgeMs: 0,
        withAccuracy: true,
      });

      expect(outcome).toEqual({
        state: 'located',
        point: { latitude: 43.36, longitude: -8.41, accuracyMetres: 12 },
      });
      expect(doubles.positionOptions).toEqual([
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
      ]);
    });

    it.each([
      ['OS-PLUG-GLOC-0003', 'denied'],
      ['OS-PLUG-GLOC-0008', 'denied'],
      ['OS-PLUG-GLOC-0010', 'timed-out'],
      ['OS-PLUG-GLOC-0007', 'unavailable'],
      ['OS-PLUG-GLOC-0002', 'unavailable'],
      [undefined, 'unavailable'],
    ])('maps the plugin error %s to %s', async (code, state) => {
      doubles.positionError = Object.assign(new Error('failed'), { code });
      await expect(reader.read()).resolves.toEqual({ state });
    });
  });
});
