import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  InjectionToken,
  signal,
} from '@angular/core';
import { SPEECH_CAPTURE, type SpeechCaptureSession } from './speech-capture';

/**
 * The two moments a long dictation has to be told about (plan 0032, section 4.4).
 *
 * **Injected rather than written down**, which is an exit criterion in its own right:
 * both states have to be reachable in a test without waiting five minutes.
 *
 * `warnAtSeconds` grows the container and says how long is left; listening carries on.
 * `maxSeconds` **pauses**, and does not send. Sending on a timer takes the choice away
 * from somebody who was mid sentence, and a message that leaves on its own is a message
 * nobody agreed to send.
 *
 * The limit is a limit on the **turn**, not on an upload. It used to be about five
 * minutes of a codec, back when the audio was going to be posted to the service; the
 * words now go as text, so what this actually protects is the gateway's 2000 character
 * message field and somebody's ability to read back what they said before sending it.
 * The numbers are unchanged because the reason for their size never was the codec.
 */
export interface DictationLimits {
  readonly warnAtSeconds: number;
  readonly maxSeconds: number;
}

export const DICTATION_LIMITS = new InjectionToken<DictationLimits>(
  'DICTATION_LIMITS',
  {
    providedIn: 'root',
    factory: () => ({ warnAtSeconds: 180, maxSeconds: 300 }),
  }
);

/**
 * Where a dictation is.
 *
 * `recording` keeps the word the design uses for the state a person is in, which is
 * that the app is listening to them. `stopped` is the app's own pause at the limit.
 */
export type DictationState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopped'
  | 'refused'
  | 'unavailable';

/**
 * A spoken message, from the first press to the words.
 *
 * ## It produces text, and that is the backend's doing
 *
 * Plan 0032 section 4.5 drew a `MediaRecorder` and left where audio becomes text open,
 * because backend `0039` had to answer first. `0039` shipped a text-only
 * `POST /v1/assistant` with no multipart route and no speech provider, so the answer is
 * that the browser transcribes and only text leaves the device. `SpeechCapture` carries
 * the full account; what matters here is that **every control section 4 draws is
 * unaffected**, because none of them was ever a property of the audio: the clock, the
 * two thresholds and the pause all live in this class.
 *
 * ## Press to start, press to stop
 *
 * Press and hold is the conventional voice gesture and it is the one this audience
 * cannot perform: it asks for sustained, steady pressure for the length of the message,
 * which is precisely what a tremor removes. Nothing here listens to a pointer, so a
 * message survives a hand that shakes, drifts, or lets go (plan 0032, section 4.2).
 *
 * ## The clock is arithmetic, not a counter
 *
 * `elapsedSeconds` is accumulated across the segments the microphone was actually open,
 * so a pause of any length adds nothing to it and the limit measures time spent
 * speaking rather than wall clock time. A tick that fires late, or a tab that was
 * backgrounded for a minute, therefore corrects itself on the next tick instead of
 * drifting.
 *
 * ## It is not root scoped
 *
 * Provided by the page that draws the panel, so leaving the panel destroys it and
 * releases the microphone, which is the drawn behaviour: a message does not survive
 * leaving mid dictation (section 12). It is also what lets a spec override
 * `DICTATION_LIMITS` for the component under test rather than for the whole app.
 */
@Injectable()
export class Dictation {
  private readonly _capture = inject(SPEECH_CAPTURE);
  private readonly _limits = inject(DICTATION_LIMITS);

  private readonly _state = signal<DictationState>('idle');

  /** Time from segments that are already closed. Never includes the open one. */
  private readonly _committedMs = signal(0);

  /** When the open segment began, in `Date.now()` terms. Zero when none is open. */
  private readonly _segmentFrom = signal(0);

  /** What the ticker last read the clock as. The only thing that makes time pass. */
  private readonly _now = signal(0);

  /** The open dictation session, or null. Not a signal: nothing renders it. */
  private _session: SpeechCaptureSession | null = null;

  private _ticker: ReturnType<typeof setInterval> | null = null;

  /**
   * Closed segments, plus however much of the open one has elapsed.
   *
   * Split in two so that closing a segment and reading the clock cannot double count
   * it, which is the arithmetic mistake this shape exists to make impossible: a single
   * running total has to be written by both the ticker and the pause, and whichever
   * ran second added the same milliseconds again.
   */
  private readonly _elapsedMs = computed(() => {
    const from = this._segmentFrom();

    return (
      this._committedMs() + (from === 0 ? 0 : Math.max(0, this._now() - from))
    );
  });

  readonly state = this._state.asReadonly();

  /** Seconds spent speaking, floored. What the `m:ss` beside the buttons shows. */
  readonly elapsedSeconds = computed(() =>
    Math.floor(this._elapsedMs() / 1000)
  );

  /** True from the first press until the words are taken or thrown away. */
  readonly active = computed(() =>
    ['recording', 'paused', 'stopped'].includes(this._state())
  );

  /** Past the warning and not yet at the limit: the container grows and says so. */
  readonly warning = computed(
    () =>
      this._state() !== 'stopped' &&
      this.active() &&
      this.elapsedSeconds() >= this._limits.warnAtSeconds
  );

  /** How long is left, which is the number the warning interpolates. Never negative. */
  readonly remainingSeconds = computed(() =>
    Math.max(0, this._limits.maxSeconds - this.elapsedSeconds())
  );

  readonly limits = this._limits;

  constructor() {
    // The microphone is released when the panel goes, whatever route change took it,
    // including one the person made mid sentence.
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /**
   * Ask for the microphone and begin.
   *
   * **Never rejects.** A refused permission and an absent device are states this
   * renders, not exceptions the caller has to remember to catch: an unhandled rejection
   * on a button press is precisely the failure section 11 asks for a test against.
   */
  async start(): Promise<void> {
    if (this.active()) {
      return;
    }

    if (!this._capture.supported()) {
      this._state.set('unavailable');
      return;
    }

    this._committedMs.set(0);
    this._segmentFrom.set(0);

    try {
      this._session = await this._capture.open();
    } catch {
      // Refused, or no device, or the browser withdrew the API between the check
      // above and here. All three read the same to the person: it did not start.
      this._state.set('refused');
      return;
    }

    this._openSegment();
    this._state.set('recording');
    this._startTicking();
  }

  /** Hold, keeping what has been said. The dot hollows and the button becomes resume. */
  pause(): void {
    if (this._state() !== 'recording') {
      return;
    }

    this._closeSegment();
    this._session?.pause();
    this._state.set('paused');
  }

  /**
   * Carry on. Refused once the app has stopped at the limit, which is what makes stop
   * the only way out of that state (section 4.4).
   */
  resume(): void {
    if (this._state() !== 'paused') {
      return;
    }

    this._session?.resume();
    this._openSegment();
    this._state.set('recording');
    this._startTicking();
  }

  /**
   * End it and hand back what was said, or null when nothing was listening.
   *
   * The one exit that produces a message, and it is deliberately the same press from
   * all three of recording, paused and stopped: the finger that started a dictation
   * ends it without travelling, and at the limit it is the only control left.
   *
   * An empty string is a real answer and is **not** collapsed to null: it means the
   * microphone was open and heard nothing recognisable, which the caller treats the
   * way it treats an empty field. Null means there was no session at all.
   */
  async stop(): Promise<string | null> {
    const session = this._session;
    if (session === null) {
      return null;
    }

    this._closeSegment();
    this._stopTicking();
    this._session = null;
    this._state.set('idle');

    try {
      return (await session.stop()).trim();
    } catch {
      // The engine died between the press and the words. Nothing to send, and the
      // panel treats a null the way it treats an empty field: it does nothing.
      return null;
    }
  }

  /** End it and throw the words away. Leaving the panel, and nothing else, does this. */
  cancel(): void {
    this._closeSegment();
    this._stopTicking();
    this._session?.close();
    this._session = null;
    this._committedMs.set(0);
    this._state.set('idle');
  }

  /**
   * The clock, and the one thing it decides.
   *
   * Four ticks a second rather than one, so that the limit is reached within 250ms of
   * the message actually being that long. The displayed number is floored seconds, so
   * three of every four ticks change nothing on screen and cost a signal read.
   */
  private _startTicking(): void {
    this._stopTicking();
    this._ticker = setInterval(() => this._tick(), 250);
  }

  private _tick(): void {
    if (this._state() !== 'recording') {
      return;
    }

    this._now.set(Date.now());

    if (this.elapsedSeconds() >= this._limits.maxSeconds) {
      // Paused, and **not** sent. The message is held and one press sends it, which
      // returns the decision to the person who was speaking (section 4.4).
      this._closeSegment();
      this._session?.pause();
      this._state.set('stopped');
      this._stopTicking();
    }
  }

  private _openSegment(): void {
    const now = Date.now();
    this._now.set(now);
    this._segmentFrom.set(now);
  }

  /** Banks the open segment and closes it. A second call adds nothing. */
  private _closeSegment(): void {
    const from = this._segmentFrom();
    if (from === 0) {
      return;
    }

    this._committedMs.update((ms) => ms + Math.max(0, Date.now() - from));
    this._segmentFrom.set(0);
  }

  private _stopTicking(): void {
    if (this._ticker !== null) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }
}
