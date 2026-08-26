import { test as base, expect } from '@playwright/test';

/**
 * The damoclesSword home page autoplays the trailer, and trailer-video.spec.ts
 * unmutes it on purpose to prove the mute control works. That made the suite
 * play real sound out of the machine's speakers: roughly 50ms to 300ms per
 * browser project, once per run, which reads as audio starting and stopping at
 * random while the tests go by.
 *
 * Only the WebKit projects (Safari and Mobile Safari) are actually audible.
 * Playwright launches Chromium with `--mute-audio` and Firefox with
 * `media.volume_scale=0`, but it has no equivalent switch for WebKit, so the
 * same unmute is silent on three projects and loud on the other two.
 *
 * Pin every media element's volume to zero before any page script runs. `muted`
 * is deliberately left alone: the specs assert on it and the component toggles
 * it, and all of that keeps behaving exactly as it does in a real browser. Only
 * the audio output goes away.
 */
export const test = base.extend<{ silenceMedia: void }>({
  silenceMedia: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          'volume'
        );
        const read = descriptor?.get;
        const write = descriptor?.set;
        if (!read || !write) return;

        // Writing the same value back does not fire `volumechange`, so the
        // guard is what keeps the listener below from recursing.
        const silence = (element: HTMLMediaElement) => {
          if (read.call(element) !== 0) write.call(element, 0);
        };

        // The app can still set `volume`; it just never takes effect.
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
          configurable: true,
          get(this: HTMLMediaElement) {
            return read.call(this);
          },
          set(this: HTMLMediaElement) {
            silence(this);
          },
        });

        // Catch elements the page creates later, on the first event each one
        // fires. `volumechange` is the one that matters: it fires the instant
        // the mute control unmutes, before any audio is emitted.
        const onMediaEvent = (event: Event) => {
          const target = event.target;
          if (target instanceof HTMLMediaElement) silence(target);
        };
        for (const name of ['loadstart', 'play', 'playing', 'volumechange']) {
          document.addEventListener(name, onMediaEvent, true);
        }
      });

      await use();
    },
    { auto: true },
  ],
});

export { expect };
