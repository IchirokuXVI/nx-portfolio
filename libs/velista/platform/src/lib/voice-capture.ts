import { inject, Injectable, InjectionToken } from '@angular/core';
import { BrowserFacade } from './browser-facade';

/**
 * The recording, once it has stopped.
 *
 * The blob is what gets uploaded and the duration is what the row draws before
 * anything is downloaded. Both are needed at once, which is why this is a pair
 * rather than a bare `Blob`.
 */
export interface VoiceRecording {
  blob: Blob;
  /** What the browser negotiated, parameters included, as sent on the part. */
  mimeType: string;
  /** How long the recorder ran, in seconds. Never trusted by the server. */
  durationSeconds: number;
}

/** A recording in progress, as the thing driving it needs to see it. */
export interface VoiceCaptureSession {
  /** Stop and hand back what was recorded. Releases the microphone. */
  stop(): Promise<VoiceRecording>;
  /** Stop and throw it away. Releases the microphone. */
  close(): void;
}

/**
 * Recording the microphone, behind an interface.
 *
 * The states worth testing are a refused permission, a device that is not there,
 * and a browser with no `MediaRecorder` at all, and none of those can be asked of
 * a real microphone on demand. So the device sits behind this, a fake sits behind
 * it in specs, and everything above is ordinary code (plan 0032, section 11).
 *
 * ## Why this and not `SpeechCapture` beside it
 *
 * `SpeechCapture` hands back text and keeps nothing. That is right for the
 * assistant, where the words are the whole message and the audio is scaffolding.
 * It is wrong for a comment, where **the audio is the message and the transcript
 * is a reading of it** (plan 0039, section 3), so what is needed here is a file.
 *
 * It is also the interface that works everywhere. Firefox has no
 * `SpeechRecognition` and therefore gets no microphone button from that service;
 * `MediaRecorder` and `getUserMedia` are in every browser that has either.
 */
export interface VoiceCaptureI {
  /** Whether this browser can record at all. False on the server. */
  supported(): boolean;

  /**
   * Ask for the microphone and start recording.
   *
   * Rejects when permission is refused, when there is no device, and when the
   * browser cannot record. The caller renders a state for it; nothing here
   * decides which, because "you said no" and "your browser cannot do this" read
   * the same way to somebody looking at a composer that did nothing.
   */
  open(): Promise<VoiceCaptureSession>;
}

export const VOICE_CAPTURE = new InjectionToken<VoiceCaptureI>(
  'VOICE_CAPTURE',
  {
    providedIn: 'root',
    factory: () => inject(MediaRecorderCapture),
  }
);

/**
 * What the recorder asks for, best first.
 *
 * Chrome produces WebM/Opus and will not negotiate Ogg; Firefox produces
 * Ogg/Opus; Safari produces MP4 with AAC inside. All three are on the server's
 * accepted list, so the negotiation here is about quality rather than about
 * getting an upload accepted: Opus is very good at speech at a small fraction of
 * the bitrate everything else needs.
 *
 * The empty string at the end is not a mime type: it is the browser's own choice,
 * taken when it supports none of the above. A browser's own choice is one it can
 * certainly produce, which is the only property that matters at that point.
 */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
  '',
];

/**
 * A speech grade bitrate, in bits per second.
 *
 * Stated rather than left to the browser, and this is the single most likely
 * thing to be dropped on the way (plan 0041, section 5). Chrome's own choice is
 * generous enough that a minute of audio lands well past a sensible cap, while
 * Opus is intelligible at a small fraction of it. 24 kbps is roughly three
 * kilobytes a second, so plan 0039's sixty second ceiling is about 180 KB: an
 * order of magnitude inside the server's two megabyte limit, with room for a
 * container that is less efficient than Opus.
 */
const SPEECH_BITS_PER_SECOND = 24000;

/**
 * The browser's own recorder, through `MediaRecorder` and `getUserMedia`.
 *
 * Every browser global comes through `BrowserFacade`, per plan 0001 D2: nothing
 * here is read at module scope or in a constructor, so a server render reaches
 * `supported()` returning false rather than a `ReferenceError`.
 */
@Injectable({ providedIn: 'root' })
export class MediaRecorderCapture implements VoiceCaptureI {
  private readonly _browser = inject(BrowserFacade);

  supported(): boolean {
    const win = this._window();
    return (
      win?.MediaRecorder !== undefined &&
      win?.navigator?.mediaDevices?.getUserMedia !== undefined
    );
  }

  async open(): Promise<VoiceCaptureSession> {
    const win = this._window();
    const Recorder = win?.MediaRecorder;
    const media = win?.navigator?.mediaDevices;

    if (Recorder === undefined || media?.getUserMedia === undefined) {
      throw new Error('this browser cannot record');
    }

    // Echo cancellation and noise suppression are asked for rather than assumed:
    // this is somebody talking into a phone in a kitchen, and the defaults differ
    // per browser. A browser that ignores them still gives a usable stream.
    const stream = await media.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mimeType = pickType(Recorder);
    const recorder = new Recorder(stream, {
      ...(mimeType === '' ? {} : { mimeType }),
      audioBitsPerSecond: SPEECH_BITS_PER_SECOND,
    });

    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    const startedAt = Date.now();
    // The whole recording in one blob at the end rather than a timeslice: there
    // is nothing streaming it anywhere, and chunked delivery would only add a
    // chance of a partial upload.
    recorder.start();

    /** Releases the microphone. Without this the browser keeps its indicator on. */
    const release = () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    };

    return {
      stop: () =>
        new Promise<VoiceRecording>((resolve) => {
          const settle = () => {
            release();
            resolve({
              // `recorder.mimeType` and not the requested one: the browser is
              // allowed to give something else, and the part's content type has
              // to be what is actually in the blob.
              blob: new Blob(chunks, {
                type: recorder.mimeType || mimeType || 'audio/webm',
              }),
              mimeType: recorder.mimeType || mimeType || 'audio/webm',
              durationSeconds: (Date.now() - startedAt) / 1000,
            });
          };

          if (recorder.state === 'inactive') {
            // Already stopped, so no `stop` event is coming and waiting for one
            // would hold the promise open forever with the message inside it.
            settle();
            return;
          }

          recorder.addEventListener('stop', settle, { once: true });
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

  private _window(): RecorderWindow | null {
    return this._browser.window as unknown as RecorderWindow | null;
  }
}

/** The best type this browser admits to supporting, or '' for its own choice. */
function pickType(Recorder: MediaRecorderCtor): string {
  for (const candidate of PREFERRED_TYPES) {
    if (candidate === '') {
      return '';
    }
    if (Recorder.isTypeSupported?.(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * The slice of the recording APIs this uses.
 *
 * Declared here rather than relying on the DOM lib's own, for the same reason
 * `speech-capture.ts` declares its own: a hand written type cannot drift into
 * claiming support for something the code does not use, and the constructor has
 * to be reachable off the facade's window rather than as a global.
 */
interface RecorderWindow {
  MediaRecorder?: MediaRecorderCtor;
  navigator?: {
    mediaDevices?: {
      getUserMedia?(constraints: {
        audio: Record<string, boolean>;
      }): Promise<MediaStreamLike>;
    };
  };
}

type MediaRecorderCtor = {
  new (
    stream: MediaStreamLike,
    options: { mimeType?: string; audioBitsPerSecond?: number }
  ): MediaRecorderLike;
  isTypeSupported?(type: string): boolean;
};

interface MediaRecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  start(): void;
  stop(): void;
  addEventListener(
    type: 'dataavailable',
    listener: (event: { data: Blob }) => void
  ): void;
  addEventListener(
    type: 'stop',
    listener: () => void,
    options?: { once: boolean }
  ): void;
}

interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}
