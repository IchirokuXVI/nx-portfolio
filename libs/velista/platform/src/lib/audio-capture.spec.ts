import { TestBed } from '@angular/core/testing';
import { MediaRecorderCapture } from './audio-capture';
import { BrowserFacade } from './browser-facade';
import { fakeBrowserFacade } from './testing/velista-testing';

/**
 * The microphone, behind the interface that exists so it can be faked.
 *
 * `MediaRecorder` and `getUserMedia` are in neither jsdom nor a server render, and the
 * two states most worth testing — a refused permission and a device that is not there
 * — cannot be asked of a real microphone on demand. So this drives a fake recorder and
 * asserts the things this class actually decides: what container it negotiates, what
 * bitrate it asks for, and whether the microphone is released on every exit.
 *
 * That last one is the assertion with something to lose. A recorder stopped without
 * releasing its tracks leaves the browser's recording indicator on, which on a phone
 * reads as the app still listening after it was told to stop.
 */

class FakeRecorder {
  static supportedTypes: string[] = ['audio/webm;codecs=opus', 'audio/webm'];

  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supportedTypes.includes(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  pauses = 0;
  resumes = 0;

  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(
    readonly stream: FakeStream,
    readonly options?: { mimeType?: string; audioBitsPerSecond?: number }
  ) {
    // The real one reports the type it settled on, which is not necessarily the one
    // it was asked for.
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  addEventListener(
    type: string,
    listener: (event: never) => void,
    options?: { once: boolean }
  ): void {
    const wrapped = options?.once
      ? (event: never) => {
          this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((held) => held !== wrapped)
          );
          listener(event);
        }
      : listener;

    this.listeners.set(type, [...(this.listeners.get(type) ?? []), wrapped]);
  }

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.pauses += 1;
    this.state = 'paused';
  }

  resume(): void {
    this.resumes += 1;
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    // The real one flushes what it has before it says it stopped.
    this.emit('dataavailable', {
      data: new Blob(['audio'], { type: 'audio/webm' }),
    });
    this.emit('stop');
  }

  private emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event as never);
    }
  }
}

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack(), new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

interface Built {
  capture: MediaRecorderCapture;
  /** The recorder the last `open()` constructed, once there has been one. */
  recorder: () => FakeRecorder;
  stream: () => FakeStream;
}

function build(options: { present?: boolean; refuse?: boolean } = {}): Built {
  const present = options.present ?? true;
  let recorder: FakeRecorder | undefined;
  let stream: FakeStream | undefined;

  const Recorder = function (
    this: unknown,
    given: FakeStream,
    opts?: { mimeType?: string; audioBitsPerSecond?: number }
  ) {
    recorder = new FakeRecorder(given, opts);
    return recorder;
  } as unknown as typeof MediaRecorder;
  (
    Recorder as unknown as { isTypeSupported: (t: string) => boolean }
  ).isTypeSupported = FakeRecorder.isTypeSupported;

  const win = present
    ? ({
        MediaRecorder: Recorder,
        navigator: {
          mediaDevices: {
            getUserMedia: async () => {
              if (options.refuse) {
                throw new Error('NotAllowedError');
              }
              stream = new FakeStream();
              return stream;
            },
          },
        },
      } as unknown as Window)
    : ({ navigator: {} } as unknown as Window);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BrowserFacade,
        useValue: fakeBrowserFacade(new Map(), { window: win }),
      },
    ],
  });

  return {
    capture: TestBed.inject(MediaRecorderCapture),
    recorder: () => recorder as FakeRecorder,
    stream: () => stream as FakeStream,
  };
}

describe('MediaRecorderCapture', () => {
  afterEach(() => {
    FakeRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/webm'];
  });

  it('is unavailable where the browser cannot record, rather than throwing', async () => {
    // A server render, and any browser without `MediaRecorder`. The typed field
    // still works, so this is a state the composer draws and not an error.
    const { capture } = build({ present: false });

    expect(capture.supported()).toBe(false);
    await expect(capture.open()).rejects.toBeInstanceOf(Error);
  });

  it('rejects when the microphone is refused', async () => {
    // The caller renders a state for it; nothing here decides which, because "you
    // said no" and "there is no microphone" read differently.
    const { capture } = build({ refuse: true });

    await expect(capture.open()).rejects.toBeInstanceOf(Error);
  });

  it('asks for the best container this browser admits to', async () => {
    const built = build();
    await built.capture.open();

    // Opus first: it is very good at speech at a fraction of the bitrate anything
    // else needs, and it is what the browsers that offer a choice produce.
    expect(built.recorder().options?.mimeType).toBe('audio/webm;codecs=opus');
  });

  it('falls back through the preference list', async () => {
    FakeRecorder.supportedTypes = ['audio/ogg;codecs=opus', 'audio/ogg'];
    const built = build();
    await built.capture.open();

    expect(built.recorder().options?.mimeType).toBe('audio/ogg;codecs=opus');
  });

  it('lets the browser choose when it supports none of them', async () => {
    // Safari, which negotiates none of the list and produces `audio/mp4` on its
    // own. Asking for a type a browser refuses throws, so nothing is asked for.
    FakeRecorder.supportedTypes = [];
    const built = build();
    await built.capture.open();

    expect(built.recorder().options?.mimeType).toBeUndefined();
  });

  it('records speech at a bitrate that fits five minutes inside the cap', async () => {
    // The single most likely thing to be dropped on the way, and the reason the
    // service's byte cap is never the limit a person runs into: at this rate five
    // minutes is roughly 900 KB against a 2 MB cap.
    const built = build();
    await built.capture.open();

    expect(built.recorder().options?.audioBitsPerSecond).toBe(24_000);
  });

  it('hands back the recording and releases the microphone on stop', async () => {
    const built = build();
    const session = await built.capture.open();

    const recording = await session.stop();

    expect(recording.size).toBeGreaterThan(0);
    expect(built.stream().tracks.every((track) => track.stopped)).toBe(true);
  });

  it('reports the type the recorder settled on, not the one asked for', async () => {
    // A browser that ignored the preference is entitled to, and the service is
    // told what actually arrived rather than what this side hoped for.
    const built = build();
    const session = await built.capture.open();
    built.recorder().mimeType = 'audio/ogg';

    await expect(session.stop()).resolves.toMatchObject({ type: 'audio/ogg' });
  });

  it('pauses and resumes one continuous recording', async () => {
    // The control that got easier: one file with a gap in it, rather than an
    // engine stopped and restarted with the words so far kept.
    const built = build();
    const session = await built.capture.open();

    session.pause();
    expect(built.recorder().state).toBe('paused');
    session.resume();
    expect(built.recorder().state).toBe('recording');

    expect(built.recorder().pauses).toBe(1);
    expect(built.recorder().resumes).toBe(1);
  });

  it('releases the microphone on close, and keeps nothing', async () => {
    const built = build();
    const session = await built.capture.open();

    session.close();

    expect(built.recorder().state).toBe('inactive');
    expect(built.stream().tracks.every((track) => track.stopped)).toBe(true);
  });

  it('releases the microphone even when the recorder had already stopped', async () => {
    const built = build();
    const session = await built.capture.open();
    built.recorder().state = 'inactive';

    session.close();

    expect(built.stream().tracks.every((track) => track.stopped)).toBe(true);
  });
});
