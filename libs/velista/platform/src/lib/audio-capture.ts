import { inject, Injectable, InjectionToken } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * A recording in progress, as the thing driving it needs to see it.
 *
 * Four verbs and no clock. Whoever owns the elapsed time owns it above this, because
 * pausing and resuming is arithmetic rather than a device capability, and a fake that
 * had to keep a clock would be a second implementation of the part worth testing.
 */
export interface AudioCaptureSession {
  /** Hold the recording, keeping what is already in it. */
  pause(): void;
  /** Carry on recording into the same file. */
  resume(): void;
  /** Ends the capture and resolves the audio. Releases the microphone. */
  stop(): Promise<Blob>;
  /** Ends the capture and throws the audio away. Releases the microphone. */
  close(): void;
}

/**
 * Opening a microphone, behind an interface.
 *
 * `MediaRecorder` and `getUserMedia` exist in a browser and in neither jsdom nor a
 * server render, and the states worth testing are a refused permission and a device
 * that is not there — neither of which a real microphone can be asked to produce on
 * demand. So the device sits behind this, a fake sits behind it in specs, and the
 * recorder above it is ordinary code (plan 0032, section 11).
 */
export interface AudioCaptureI {
  /** Whether this browser can record at all. False on the server. */
  supported(): boolean;

  /**
   * Ask for the microphone and start recording.
   *
   * Rejects when permission is refused, when there is no device, and when the browser
   * has no `MediaRecorder`. The caller renders a state for it; nothing here decides
   * which, because "you said no" and "there is no microphone" read differently.
   */
  open(): Promise<AudioCaptureSession>;
}

export const AUDIO_CAPTURE = new InjectionToken<AudioCaptureI>(
  'AUDIO_CAPTURE',
  {
    providedIn: 'root',
    factory: () => inject(MediaRecorderCapture),
  }
);

/**
 * What to ask `MediaRecorder` for, best first (backend plan 0041, section 3.3).
 *
 * Every one of these is on the provider's accepted list, checked against its current
 * documentation rather than against the plan, which expected `audio/webm` to be
 * missing and was out of date: there is no container rewrite in this codebase and
 * there does not need to be one.
 *
 * Opus first because it is very good at speech at a small fraction of the bitrate
 * anything else needs, and because it is what the two browsers that offer a choice
 * already produce. Safari negotiates none of these and falls through to its own
 * `audio/mp4`, which is why the list is a preference and not a requirement.
 */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
] as const;

/**
 * What to record speech at, in bits per second (backend plan 0041, section 5).
 *
 * **This is a change to what was recovered, not a recovery.** The earlier
 * `MediaRecorderCapture` passed no bitrate at all, on the sound reasoning that the
 * browser's own choice is one it can certainly produce. Its own choice is also, in
 * Chrome, generous enough that five minutes lands several megabytes past the service's
 * 2 MB cap.
 *
 * 24 kbps of Opus is comfortably intelligible speech — the codec is designed for
 * exactly this job — and it puts a full five minute recording at roughly 900 KB, which
 * is inside the cap with room for a container and a bad estimate. A number chosen so
 * the limit that stops a message is the person's five minutes, never a byte count they
 * cannot see.
 */
const SPEECH_BITS_PER_SECOND = 24_000;

/**
 * The real microphone, through `MediaRecorder` (plan 0032 section 4.5, backend 0041).
 *
 * ## A file, and why it came back
 *
 * This was `MediaRecorder`, became `SpeechRecognition` in `ef47f1a` because the
 * service that shipped had no audio endpoint, and is `MediaRecorder` again now that
 * backend `0041` built one. That is not a circle: the browser was chosen from what
 * existed rather than on the merits, and the merits are on this side.
 *
 * **Firefox gets a microphone.** `getUserMedia` and `MediaRecorder` are in every
 * browser in the support matrix; `SpeechRecognition` is not in Firefox at all, so
 * that period cost a whole browser its microphone button.
 *
 * **A file has no seams.** The dictation engine ends itself on silence, so the code
 * above it had to restart recognition on every `end` and track whether the engine was
 * actually running, because `stop()` on a stopped engine fires nothing. Pause and
 * resume here are `MediaRecorder.pause()` and `.resume()` on one continuous recording,
 * and the seam that had to be defended is simply not there.
 *
 * **The privacy gain was smaller than it looked.** Chrome and Safari implement
 * `SpeechRecognition` by sending audio to the browser vendor. The choice was never
 * between sending a recording and not sending one; it was between sending it as this
 * app's request, under terms this project has read, and sending it as the browser's,
 * under terms it cannot see. Backend `0041` section 6 is the honest account of what a
 * recording now crosses.
 *
 * Every browser global it touches comes through `BrowserFacade`, per plan 0001 D2:
 * nothing here is read at module scope or in a constructor, so a server render reaches
 * `supported()` returning false rather than a `ReferenceError`.
 */
@Injectable({ providedIn: 'root' })
export class MediaRecorderCapture implements AudioCaptureI {
  private readonly _browser = inject(BrowserFacade);

  supported(): boolean {
    const win = this._browser.window;

    return (
      win !== null &&
      typeof win.MediaRecorder !== 'undefined' &&
      win.navigator.mediaDevices?.getUserMedia !== undefined
    );
  }

  async open(): Promise<AudioCaptureSession> {
    const win = this._browser.window;
    if (win === null || !this.supported()) {
      throw new Error('this browser cannot record audio');
    }

    const stream = await win.navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    // The best container this browser will admit to supporting, and a bitrate low
    // enough that five minutes of it fits inside the service's cap. Asking for a
    // `mimeType` a browser does not support throws, which is why the list is walked
    // through `isTypeSupported` rather than guessed at, and why an empty answer is a
    // valid one: the browser then picks for itself, as it always did.
    const recorder = new win.MediaRecorder(stream, {
      ...(this._negotiate(win) ?? {}),
      audioBitsPerSecond: SPEECH_BITS_PER_SECOND,
    });

    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    // Every track, released together. A recorder that is stopped without this leaves
    // the browser's recording indicator on, which on a phone reads as the app still
    // listening after it was told to stop.
    const release = () => stream.getTracks().forEach((track) => track.stop());

    recorder.start();

    return {
      pause: () => recorder.pause(),
      resume: () => recorder.resume(),
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.addEventListener(
            'stop',
            () => {
              release();
              // The recorder's own type rather than the one that was asked for: a
              // browser that ignored the preference and chose something else is
              // entitled to, and the server is told what actually arrived rather
              // than what this side hoped for.
              resolve(new Blob(chunks, { type: recorder.mimeType }));
            },
            { once: true }
          );
          recorder.stop();
        }),
      close: () => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
        release();
      },
    };
  }

  /**
   * The first preferred container this browser admits to, or nothing.
   *
   * Nothing is a real answer and is the Safari case: it supports none of the list and
   * produces `audio/mp4` on its own, which the service accepts. Passing a type it
   * refused would throw where letting it choose works.
   */
  private _negotiate(
    win: Window & typeof globalThis
  ): { mimeType: string } | undefined {
    const isSupported = win.MediaRecorder?.isTypeSupported;
    if (typeof isSupported !== 'function') {
      return undefined;
    }

    const mimeType = PREFERRED_TYPES.find((type) =>
      isSupported.call(win.MediaRecorder, type)
    );

    return mimeType === undefined ? undefined : { mimeType };
  }
}
