import { inject, Injectable, InjectionToken } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * A dictation in progress, as the thing driving it needs to see it.
 *
 * Four verbs and no clock. Whoever owns the elapsed time owns it above this, because
 * pausing and resuming is arithmetic rather than a device capability, and a fake that
 * had to keep a clock would be a second implementation of the part worth testing.
 */
export interface SpeechCaptureSession {
  /** Stop listening, keeping what has been recognised so far. */
  pause(): void;
  /** Listen again, adding to what is already there. */
  resume(): void;
  /** End it and resolve everything that was recognised. Releases the microphone. */
  stop(): Promise<string>;
  /** End it and throw the words away. Releases the microphone. */
  close(): void;
}

/**
 * Turning speech into text, behind an interface.
 *
 * `SpeechRecognition` exists in a browser and in neither jsdom nor a server render,
 * and the states worth testing are a refused permission and a browser that does not
 * have it at all — neither of which a real microphone can be asked to produce on
 * demand. So the device sits behind this, a fake sits behind it in specs, and the
 * dictation above it is ordinary code (plan 0032, section 11).
 */
export interface SpeechCaptureI {
  /** Whether this browser can dictate at all. False on the server. */
  supported(): boolean;

  /**
   * Ask for the microphone and start listening.
   *
   * Rejects when permission is refused, when there is no device, and when the browser
   * has no `SpeechRecognition`. The caller renders a state for it; nothing here decides
   * which, because "you said no" and "your browser cannot do this" read differently.
   */
  open(): Promise<SpeechCaptureSession>;
}

export const SPEECH_CAPTURE = new InjectionToken<SpeechCaptureI>(
  'SPEECH_CAPTURE',
  { providedIn: 'root', factory: () => inject(WebSpeechCapture) }
);

/**
 * How long a deliberate stop waits for the engine to settle its last phrase
 * before giving back what it already has.
 *
 * Long enough that the ordinary case never hits it, short enough that a person
 * who pressed stop does not sit looking at a composer that did nothing.
 */
const STOP_GRACE_MS = 1500;

/**
 * The browser's own dictation, through `SpeechRecognition` (plan 0032, section 10).
 *
 * ## Why this and not `MediaRecorder`
 *
 * That plan left one thing open: where a spoken turn becomes text. It drew the first
 * of its two options — upload the audio and let the service transcribe — and said
 * backend `0039` had to choose before section 4 could be built.
 *
 * **`0039` shipped with no audio endpoint at all.** `POST /v1/assistant` takes
 * `{ message, transcript }`, both text, and there is no multipart route, no size cap
 * and no speech provider anywhere in the service. So the choice is made by what
 * exists: the browser transcribes and only text leaves the device, which is that
 * plan's second option.
 *
 * Section 10 predicted this would cost the pause button, on the grounds that
 * `SpeechRecognition` "hands back text and no file: there is nothing to pause". That
 * turns out not to follow. There is nothing to pause *in a file*, but there is
 * something to pause in a **session**: stopping recognition and starting it again
 * later, with the words so far kept, is a pause in every sense the person cares about.
 * The elapsed clock and the two thresholds were never the recorder's anyway — they
 * live in `Dictation` — so every control section 4 draws survives unchanged.
 *
 * What genuinely is lost is the audio itself, which nothing was going to keep, and
 * Firefox, which does not implement the API and gets `supported() === false` and a
 * field that still works. That is a smaller loss than a microphone button posting to a
 * route that answers 404.
 *
 * ## Privacy, said plainly because it changed
 *
 * Chrome and Safari perform this server side, so speech reaches the browser vendor
 * rather than this app's own backend. Under the audio upload it would have reached
 * Google through the assistant service instead. Neither is local, the destination
 * differs, and backend `0039` section 10's privacy note is written for a sentence
 * rather than a voice recording — which is now accurate again, because no recording
 * leaves.
 *
 * Every browser global comes through `BrowserFacade`, per plan 0001 D2: nothing here
 * is read at module scope or in a constructor, so a server render reaches
 * `supported()` returning false rather than a `ReferenceError`.
 */
@Injectable({ providedIn: 'root' })
export class WebSpeechCapture implements SpeechCaptureI {
  private readonly _browser = inject(BrowserFacade);

  supported(): boolean {
    return this._constructor() !== undefined;
  }

  async open(): Promise<SpeechCaptureSession> {
    const Recognition = this._constructor();
    if (Recognition === undefined) {
      throw new Error('this browser cannot dictate');
    }

    const recognition = new Recognition();
    // Continuous, because this takes a week's shopping list and not a search query;
    // interim results are ignored, so only settled text is ever kept.
    recognition.continuous = true;
    recognition.interimResults = false;
    // No `lang`: left unset, the engine uses the browser's own language, which is the
    // one the person set on the device. Passing this app's locale would be worse — a
    // Spanish speaker reading the app in English still dictates in Spanish.

    let settled = '';
    let listening = false;
    /** Set while a pause or a stop is deliberate, so `onend` does not restart. */
    let ending = false;
    /**
     * Whether the engine is actually running right now, which is **not** the same
     * as whether this session is open.
     *
     * It is false while paused, false after the app has stopped at its own limit,
     * and false for the gap between the engine ending itself on silence and the
     * restart below getting an audio stream back. In every one of those a
     * `stop()` would produce no `end` event, and waiting for one loses the
     * message. Tracked here rather than inferred, because only the engine knows.
     */
    let running = false;

    recognition.addEventListener('start', () => {
      running = true;
    });

    recognition.addEventListener('result', (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          settled = `${settled} ${result[0].transcript}`.trim();
        }
      }
    });

    // The engine stops itself after a stretch of silence, which for this audience is
    // an ordinary event rather than the end of a message: somebody may take a while
    // between items. So a stop nobody asked for restarts it, and only a deliberate
    // pause or stop is allowed to end the session.
    recognition.addEventListener('end', () => {
      running = false;

      if (ending || !listening) {
        return;
      }

      try {
        recognition.start();
      } catch {
        // Already starting, or the engine refused. Nothing to do: the words settled
        // so far are kept and stop still resolves them.
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onStart = () => {
        listening = true;
        resolve();
      };
      // `not-allowed` and `service-not-allowed` are the refusal; anything else before
      // the first start is a browser that cannot do this. The caller renders one state
      // for both, so they are not distinguished here.
      const onError = (event: { error?: string }) =>
        reject(new Error(event.error ?? 'speech recognition failed'));

      recognition.addEventListener('start', onStart, { once: true });
      recognition.addEventListener('error', onError, { once: true });
      recognition.start();
    });

    return {
      pause: () => {
        ending = true;
        listening = false;
        recognition.stop();
      },
      resume: () => {
        ending = false;
        listening = true;
        try {
          recognition.start();
        } catch {
          // Already running. Harmless: the words keep accumulating either way.
        }
      },
      stop: () =>
        new Promise<string>((resolve) => {
          ending = true;
          listening = false;

          // Nothing is listening, so no `end` is coming: `stop()` on an engine
          // that is not running is ignored by the browser and fires nothing at
          // all. This is the ordinary way out of a paused dictation and the only
          // way out of one the app stopped at its own limit — which is the case
          // the panel explicitly tells somebody to press stop for — so waiting
          // for that event used to hold the promise open forever and swallow the
          // message. `abort` first because the engine may be between an automatic
          // end and its restart, and that restart must not leave the microphone
          // open behind a session nobody holds any more.
          if (!running) {
            recognition.abort();
            resolve(settled);
            return;
          }

          let done = false;
          const settle = () => {
            if (done) {
              return;
            }
            done = true;
            clearTimeout(guard);
            resolve(settled);
          };

          // The guard is armed before the listener is attached and before the
          // engine is asked to stop, so that whichever of the two settles this
          // first has the other one to cancel.
          //
          // It is here because waiting for `end` indefinitely is not safe: an
          // engine that dies without an event is rare, and the cost of trusting
          // it is the whole message.
          const guard = setTimeout(settle, STOP_GRACE_MS);

          // Wait for `end` rather than resolving immediately, because the engine
          // settles its last phrase on the way out and that phrase is usually the
          // most important word in the sentence.
          recognition.addEventListener('end', settle, { once: true });

          recognition.stop();
        }),
      close: () => {
        ending = true;
        listening = false;
        // `abort` and not `stop`: nothing is going to read the words, so there is no
        // reason to wait for the engine to settle them.
        recognition.abort();
      },
    };
  }

  /** The constructor, under either name, or undefined where there is none. */
  private _constructor(): SpeechRecognitionCtor | undefined {
    const win = this._browser.window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    } | null;

    // Safari and Chrome on iOS still only have the prefixed one.
    return win?.SpeechRecognition ?? win?.webkitSpeechRecognition;
  }
}

/**
 * The slice of the Web Speech API this uses.
 *
 * Declared here rather than pulled from `@types/dom-speech-recognition`, which this
 * workspace does not install: four members are cheaper than a dependency, and a hand
 * written type cannot drift into claiming support for something the code does not use.
 */
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(
    type: 'result',
    listener: (event: SpeechRecognitionResultEvent) => void
  ): void;
  addEventListener(
    type: 'error',
    listener: (event: { error?: string }) => void,
    options?: { once: boolean }
  ): void;
  addEventListener(
    type: 'start' | 'end',
    listener: () => void,
    options?: { once: boolean }
  ): void;
}

interface SpeechRecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}
