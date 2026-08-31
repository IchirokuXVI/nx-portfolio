import { inject, InjectionToken } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * The four numbers that decide when somebody has stopped talking (plan 0038,
 * section 4).
 *
 * **Injected rather than written down**, for the reason plan 0032 gave for
 * `RECORDING_LIMITS` and this needs even more: every one of these states has to
 * be reachable in a test without waiting in real time, and there are four of
 * them rather than two.
 *
 * Each exists because leaving it out produces a specific failure:
 *
 * | | Without it |
 * | --- | --- |
 * | `leadInMs` | people press and then draw breath, and the recording ends before the first word |
 * | `silenceMs` | too short and it cuts between "half a dozen" and "eggs"; too long and the person is standing there wondering |
 * | `minimumMs` | a press that catches a quiet moment sends an empty file to a paid provider |
 * | `maxMs` | a microphone left open in a kitchen is a bill and a privacy problem |
 *
 * The cap is much shorter than the assistant panel's five minutes because this is
 * one sentence about a shopping list, and a short cap keeps every recording
 * comfortably inside the service's byte limit without the client having to think
 * about bytes at all.
 */
export interface SilenceLimits {
  readonly leadInMs: number;
  readonly silenceMs: number;
  readonly minimumMs: number;
  readonly maxMs: number;
}

export const SILENCE_LIMITS = new InjectionToken<SilenceLimits>(
  'SILENCE_LIMITS',
  {
    providedIn: 'root',
    factory: () => ({
      leadInMs: 1000,
      silenceMs: 1500,
      minimumMs: 1000,
      maxMs: 30000,
    }),
  }
);

/**
 * How loud it is right now, and whether that counts as quiet.
 *
 * A reading rather than a number, because the threshold is relative and the
 * caller draws a level meter from the same sample it decides on.
 */
export interface LevelReading {
  /** 0 to 1, smoothed. What a level meter is drawn from. */
  readonly level: number;
  /** Whether this sample is quiet **relative to the room** measured at the start. */
  readonly quiet: boolean;
}

/**
 * Watching a live stream for the moment somebody stops talking.
 *
 * ## Over the stream, never over the file
 *
 * An `AnalyserNode` on the same `MediaStream` the recorder is using, sampled on an
 * animation frame. The recorded file is never inspected: by the time there is a
 * file the moment to stop has passed, which is the whole point of doing this at
 * all.
 *
 * ## The threshold is relative
 *
 * A kitchen with an extractor fan running has a noise floor nothing absolute can
 * be tuned for. The first part of the lead in **measures the room**, and quiet
 * means quiet relative to that.
 *
 * Getting this wrong in the safe direction means the recording runs to its cap
 * and the person presses stop, which is a mild annoyance. Getting it wrong the
 * other way means the app cuts people off mid sentence, which is the failure that
 * makes a feature unusable. So the floor is the **quietest** sample of the
 * measuring window rather than the average or the loudest: somebody who starts
 * talking immediately would otherwise have their own voice measured as the room,
 * and every word after it would read as quiet.
 *
 * The relative test has one degenerate case it cannot answer on its own, which is
 * a recording that is loud from the first frame to the last: everything is then
 * quiet relative to everything else. So quiet also has to be quiet in absolute
 * terms, which is the second half of the test below.
 *
 * ## Stop is always available
 *
 * Nothing here is the only way out. The button becomes a stop while recording, so
 * this is a convenience over a control rather than a replacement for one.
 */
export interface SilenceDetectorI {
  /** Whether this browser can analyse a stream at all. False on the server. */
  supported(): boolean;

  /**
   * Watch a stream and call back when the talking stops.
   *
   * Returns a handle that stops watching. It never stops the recording itself:
   * this reports, and the caller decides, which keeps the decision in one place
   * and this class testable without a recorder.
   */
  watch(stream: MediaStream, handlers: SilenceHandlers): SilenceWatch;
}

export interface SilenceHandlers {
  /** Every sampled frame, for the level meter. */
  onLevel?(reading: LevelReading): void;
  /**
   * Quiet has lasted long enough, or the cap was reached.
   *
   * `reason` is `'silence'` or `'cap'`, which the caller may want to say
   * differently even though both end the recording.
   */
  onEnd(reason: 'silence' | 'cap'): void;
}

export interface SilenceWatch {
  /** Stop watching. Idempotent, and it releases nothing the caller did not give it. */
  close(): void;
}

export const SILENCE_DETECTOR = new InjectionToken<SilenceDetectorI>(
  'SILENCE_DETECTOR',
  {
    providedIn: 'root',
    factory: () => new WebAudioSilenceDetector(),
  }
);

/**
 * How much louder than the measured floor still counts as talking.
 *
 * A ratio rather than an absolute, so it means the same thing in a quiet room and
 * beside a fan. 1.6 is deliberately forgiving: the safe direction is to keep
 * listening, and a trailing "and eggs" said quietly must not read as silence.
 */
const QUIET_RATIO = 1.6;

/** A floor under the floor, so a silent room does not make every sample "loud". */
const MINIMUM_FLOOR = 0.01;

/**
 * How loud a sample can be and still count as quiet, whatever the room was.
 *
 * The relative test alone cannot answer the case where the lead in was already
 * speech: the floor is then a voice, and the voice that follows is quiet relative
 * to it. This is well above any room tone and well below speech at arm's length,
 * so it decides only that case and leaves the relative test to do the real work.
 */
const ABSOLUTE_QUIET_CEILING = 0.5;

/** How much of the previous level survives into the next, to stop the meter flickering. */
const SMOOTHING = 0.7;

/**
 * The real thing, on `AnalyserNode` (plan 0038, section 4).
 *
 * Every browser global comes through `BrowserFacade` per plan 0001 D2: nothing is
 * read at module scope or in a constructor, so a server render reaches
 * `supported()` returning false rather than a `ReferenceError`.
 */
export class WebAudioSilenceDetector implements SilenceDetectorI {
  private readonly _browser = inject(BrowserFacade);
  private readonly _limits = inject(SILENCE_LIMITS);

  supported(): boolean {
    const win = this._browser.window;

    return (
      win !== null &&
      (typeof win.AudioContext !== 'undefined' ||
        typeof (win as { webkitAudioContext?: unknown }).webkitAudioContext !==
          'undefined')
    );
  }

  watch(stream: MediaStream, handlers: SilenceHandlers): SilenceWatch {
    const win = this._browser.window;
    if (win === null || !this.supported()) {
      // Nothing to watch with. The caller keeps its stop button and its cap, so
      // the feature degrades to press to stop rather than failing.
      return { close: () => undefined };
    }

    const Ctor =
      win.AudioContext ??
      (win as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audio = new Ctor();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();

    // The room, measured across the lead in and fixed when it ends. The quietest
    // sample, so somebody who started talking straight away does not have their
    // own voice recorded as the room.
    let floor: number | null = null;
    // Seeded from the first sample rather than started at zero. Starting at zero
    // means the smoother spends the whole lead in climbing towards the room, so
    // the floor is measured well below what the room actually is and the room
    // itself then reads as talking: the recording never ends by itself in any
    // space with a noise floor, which is precisely the case this is for.
    let smoothed: number | null = null;
    let quietSince: number | null = null;
    let closed = false;
    let frame = 0;

    const finish = (reason: 'silence' | 'cap') => {
      if (closed) {
        return;
      }
      close();
      handlers.onEnd(reason);
    };

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      win.cancelAnimationFrame(frame);
      source.disconnect();
      // The stream itself belongs to whoever opened it. Closing the context
      // releases what this method created and nothing else.
      void audio.close().catch(() => undefined);
    };

    const tick = () => {
      if (closed) {
        return;
      }

      analyser.getByteTimeDomainData(samples);
      const level = rootMeanSquare(samples);
      smoothed =
        smoothed === null
          ? level
          : smoothed * SMOOTHING + level * (1 - SMOOTHING);

      const elapsed = Date.now() - startedAt;

      if (elapsed < this._limits.leadInMs) {
        // Still measuring the room, and nothing may end the recording yet: people
        // press and then draw breath, and a detector that counted this as silence
        // would cut them off before the first word.
        floor = floor === null ? smoothed : Math.min(floor, smoothed);
        handlers.onLevel?.({ level: smoothed, quiet: false });
        frame = win.requestAnimationFrame(tick);
        return;
      }

      const room = Math.max(floor ?? MINIMUM_FLOOR, MINIMUM_FLOOR);
      const quiet =
        smoothed < room * QUIET_RATIO && smoothed < ABSOLUTE_QUIET_CEILING;
      handlers.onLevel?.({ level: smoothed, quiet });

      if (elapsed >= this._limits.maxMs) {
        finish('cap');
        return;
      }

      if (!quiet) {
        quietSince = null;
        frame = win.requestAnimationFrame(tick);
        return;
      }

      quietSince ??= Date.now();

      // A floor under the whole recording, so a press that caught a quiet moment
      // never sends an empty file to a paid provider.
      const longEnough = elapsed >= this._limits.minimumMs;
      if (longEnough && Date.now() - quietSince >= this._limits.silenceMs) {
        finish('silence');
        return;
      }

      frame = win.requestAnimationFrame(tick);
    };

    frame = win.requestAnimationFrame(tick);

    return { close };
  }
}

/**
 * The signal level of one frame, 0 to 1.
 *
 * Time domain samples are centred on 128, so the deviation from it is the
 * amplitude. Root mean square rather than a peak, because a peak is a click and
 * what matters here is whether somebody is speaking.
 */
function rootMeanSquare(samples: Uint8Array): number {
  let sum = 0;
  for (const sample of samples) {
    const deviation = (sample - 128) / 128;
    sum += deviation * deviation;
  }

  return Math.sqrt(sum / samples.length);
}
