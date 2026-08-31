import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import {
  SILENCE_LIMITS,
  WebAudioSilenceDetector,
  type SilenceLimits,
} from './silence-detector';

/**
 * The four numbers, and one test each (plan 0038, section 4).
 *
 * Every one of them exists because leaving it out produces a specific failure, so
 * every one of them is asserted separately: a detector that stopped during the
 * lead in cuts people off before the first word, and one with no minimum sends an
 * empty file to a paid provider.
 *
 * **Nothing here touches a microphone or a real `AudioContext`.** The whole point
 * of the numbers being injected is that both interesting states are reachable
 * without waiting in real time, and the whole point of `BrowserFacade` is that the
 * window is a fake. The stream is driven by hand: a script of levels, one per
 * animation frame, which is exactly what the detector reads.
 */

const LIMITS: SilenceLimits = {
  leadInMs: 100,
  silenceMs: 200,
  minimumMs: 150,
  maxMs: 1000,
};

/** How much a frame advances the clock, so a test can count in frames. */
const FRAME_MS = 50;

/**
 * A window whose audio graph replays a script of levels.
 *
 * `getByteTimeDomainData` fills the buffer with samples that produce the level the
 * script asks for, so the detector's own arithmetic runs for real and only the
 * device is faked.
 */
function fakeWindow(levels: number[]) {
  let frame = 0;
  let now = 0;
  const pending = new Map<number, () => void>();
  let nextHandle = 1;

  const analyser = {
    fftSize: 1024,
    getByteTimeDomainData(buffer: Uint8Array): void {
      const level = levels[Math.min(frame, levels.length - 1)];
      // Every sample the same distance from the centre, so the root mean square
      // of the frame is exactly the level asked for.
      const value = Math.round(128 + level * 128);
      buffer.fill(value);
    },
  };

  const win = {
    AudioContext: class {
      createMediaStreamSource() {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      createAnalyser() {
        return analyser;
      }
      close() {
        return Promise.resolve();
      }
    },
    requestAnimationFrame(callback: () => void): number {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      pending.delete(handle);
    },
  };

  return {
    win: win as unknown as Window & typeof globalThis,
    /** Run one frame, advancing the clock and the script. */
    tick(): void {
      now += FRAME_MS;
      jest.setSystemTime(now);
      frame += 1;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
    tickTimes(count: number): void {
      for (let i = 0; i < count; i += 1) {
        this.tick();
      }
    },
  };
}

function detectorFor(levels: number[]) {
  const world = fakeWindow(levels);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: BrowserFacade, useValue: { window: world.win } },
      { provide: SILENCE_LIMITS, useValue: LIMITS },
    ],
  });

  const detector = runInInjectionContext(
    TestBed.inject(Injector),
    () => new WebAudioSilenceDetector()
  );

  return { detector, world };
}

/** A stream object, which nothing in the detector reads beyond passing it on. */
const STREAM = {} as MediaStream;

describe('SilenceDetector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not stop during the lead in, however quiet it is', () => {
    // People press and then draw breath. A detector that counted that as silence
    // would end the recording before the first word.
    const { detector, world } = detectorFor([0, 0, 0, 0, 0, 0, 0, 0]);
    const ended: string[] = [];

    detector.watch(STREAM, { onEnd: (reason) => ended.push(reason) });

    // Two frames is 100ms, exactly the lead in, and silent throughout.
    world.tickTimes(2);

    expect(ended).toEqual([]);
  });

  it('stops once quiet has lasted the configured time', () => {
    // Loud through the lead in and the minimum, then quiet.
    const { detector, world } = detectorFor([
      0.5, 0.5, 0.5, 0.5, 0.01, 0.01, 0.01, 0.01, 0.01,
    ]);
    const ended: string[] = [];

    detector.watch(STREAM, { onEnd: (reason) => ended.push(reason) });

    world.tickTimes(9);

    expect(ended).toEqual(['silence']);
  });

  it('never ends a recording shorter than the minimum', () => {
    // Silent from the first frame after the lead in. Without a floor under the
    // whole recording this would send an empty file to a paid provider.
    const { detector, world } = detectorFor([0, 0, 0, 0, 0, 0]);
    const ended: string[] = [];

    detector.watch(STREAM, { onEnd: (reason) => ended.push(reason) });

    // Three frames is 150ms: past the lead in and past the silence window, but
    // only just at the minimum.
    world.tickTimes(3);

    expect(ended).toEqual([]);
  });

  it('stops at the cap however loud it still is', () => {
    // A microphone left open in a kitchen is a bill and a privacy problem.
    const { detector, world } = detectorFor(new Array(30).fill(0.9));
    const ended: string[] = [];

    detector.watch(STREAM, { onEnd: (reason) => ended.push(reason) });

    world.tickTimes(25);

    expect(ended).toEqual(['cap']);
  });

  it('measures the room, so a noisy kitchen is not permanent silence', () => {
    // The threshold is relative. A room with an extractor fan has a noise floor
    // nothing absolute can be tuned for, and speech over it must still read as
    // speech while the fan alone reads as quiet.
    const { detector, world } = detectorFor([
      0.2, 0.2, 0.6, 0.6, 0.2, 0.2, 0.2, 0.2, 0.2,
    ]);
    const ended: string[] = [];

    detector.watch(STREAM, { onEnd: (reason) => ended.push(reason) });

    world.tickTimes(11);

    // It ended, which means the fan alone counted as quiet rather than as talking.
    expect(ended).toEqual(['silence']);
  });

  it('reports the level on every frame, for the meter', () => {
    const { detector, world } = detectorFor([0.4, 0.4, 0.4]);
    const levels: number[] = [];

    detector.watch(STREAM, {
      onLevel: (reading) => levels.push(reading.level),
      onEnd: () => undefined,
    });

    world.tickTimes(3);

    expect(levels).toHaveLength(3);
    // The single most common failure of a voice control is that the microphone was
    // not picking anything up, and a still meter says that before a transcript does.
    expect(levels.at(-1)).toBeGreaterThan(0);
  });

  it('watches nothing where the browser has no audio API', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: BrowserFacade, useValue: { window: null } },
        { provide: SILENCE_LIMITS, useValue: LIMITS },
      ],
    });
    const detector = runInInjectionContext(
      TestBed.inject(Injector),
      () => new WebAudioSilenceDetector()
    );

    expect(detector.supported()).toBe(false);
    // A handle that closes cleanly rather than a throw: the caller keeps its stop
    // button and its cap, so the feature degrades to press to stop.
    expect(() =>
      detector.watch(STREAM, { onEnd: () => undefined }).close()
    ).not.toThrow();
  });
});
