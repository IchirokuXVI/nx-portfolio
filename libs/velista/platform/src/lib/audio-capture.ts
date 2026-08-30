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
  pause(): void;
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
 * The real microphone, through `MediaRecorder` (plan 0032, section 4.5).
 *
 * **A file and not a transcript**, which is the decision section 4 rests on. The
 * browser's own `SpeechRecognition` hands back text and no file, so there would be
 * nothing to pause, nothing to hold at five minutes, and no recording to send.
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

    // No `mimeType`: asking for one a browser does not support throws, and the
    // container the browser picks for itself is one it can certainly produce. The
    // server is told what arrived by the blob's own type rather than by an assumption
    // written down on this side.
    const recorder = new win.MediaRecorder(stream);
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
}
