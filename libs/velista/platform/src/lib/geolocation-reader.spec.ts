import { BrowserGeolocationReader } from './geolocation-reader';

/**
 * The reader behind `GEOLOCATION_READER` (plan 0058, section 3.5).
 *
 * **jsdom has neither `navigator.geolocation` nor a Permissions API**, which is exactly
 * why this class exists: the screens that use it are tested through the token with no
 * browser at all, and what is left to test here is the translation between the browser's
 * shapes and ours. Both are installed onto `navigator` per test and taken off again, so
 * the untouched case is a real case rather than one nobody ever reaches.
 */
type Navigatorish = {
  geolocation?: unknown;
  permissions?: unknown;
};

function withNavigator(patch: Navigatorish): () => void {
  const target = globalThis.navigator as unknown as Navigatorish;
  const had = { ...target };

  Object.assign(target, patch);

  return () => {
    for (const key of Object.keys(patch)) {
      delete target[key as keyof Navigatorish];
      if (key in had) {
        Object.assign(target, { [key]: had[key as keyof Navigatorish] });
      }
    }
  };
}

/** A `getCurrentPosition` that hands back one fixed position. */
function positionOf(latitude: number, longitude: number) {
  return {
    getCurrentPosition: (ok: (position: unknown) => void) =>
      ok({ coords: { latitude, longitude } }),
  };
}

/** A `getCurrentPosition` that fails with one of the browser's numeric codes. */
function failingWith(code: number) {
  return {
    getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) =>
      fail({ code }),
  };
}

describe('BrowserGeolocationReader', () => {
  describe('the permission, which prompts nobody', () => {
    it('answers unknown when the browser has no Permissions API', async () => {
      // Not `denied`: "we could not find out" and "you have refused" must not be the
      // same value, because one of them ends the feature.
      const reader = new BrowserGeolocationReader();

      await expect(reader.permission()).resolves.toBe('unknown');
    });

    it('passes the browser’s own state through', async () => {
      const restore = withNavigator({
        permissions: { query: async () => ({ state: 'denied' }) },
      });

      await expect(new BrowserGeolocationReader().permission()).resolves.toBe(
        'denied'
      );

      restore();
    });

    it('answers unknown when the query itself is refused', async () => {
      // Safari once refused this query for `geolocation` specifically. A browser that
      // will not say is not a browser that has refused.
      const restore = withNavigator({
        permissions: {
          query: async () => {
            throw new Error('not supported');
          },
        },
      });

      await expect(new BrowserGeolocationReader().permission()).resolves.toBe(
        'unknown'
      );

      restore();
    });
  });

  describe('reading a position', () => {
    it('answers unavailable rather than throwing where there is no geolocation', async () => {
      await expect(new BrowserGeolocationReader().read()).resolves.toEqual({
        state: 'unavailable',
      });
    });

    it('carries the two numbers and nothing else off the browser’s coordinates', async () => {
      // Accuracy, altitude, heading and speed are deliberately dropped: a field this
      // app cannot spend is a field that ends up in a log line somewhere.
      const restore = withNavigator({ geolocation: positionOf(37.88, -4.78) });

      await expect(new BrowserGeolocationReader().read()).resolves.toEqual({
        state: 'located',
        point: { latitude: 37.88, longitude: -4.78 },
      });

      restore();
    });

    it('reads a refusal as denied, which is the state that ends the feature', async () => {
      const restore = withNavigator({ geolocation: failingWith(1) });

      await expect(new BrowserGeolocationReader().read()).resolves.toEqual({
        state: 'denied',
      });

      restore();
    });

    it('reads a timeout as its own outcome, because it is worth trying again', async () => {
      const restore = withNavigator({ geolocation: failingWith(3) });

      await expect(new BrowserGeolocationReader().read()).resolves.toEqual({
        state: 'timed-out',
      });

      restore();
    });

    it('reads an unrecognised code as unavailable rather than as a refusal', async () => {
      // The honest answer for a code we do not know, and the one that does not end
      // the feature on a guess.
      const restore = withNavigator({ geolocation: failingWith(99) });

      await expect(new BrowserGeolocationReader().read()).resolves.toEqual({
        state: 'unavailable',
      });

      restore();
    });

    it('never rejects, whichever way it fails', async () => {
      const restore = withNavigator({ geolocation: failingWith(2) });

      await expect(
        new BrowserGeolocationReader().read()
      ).resolves.toBeDefined();

      restore();
    });
  });
});
