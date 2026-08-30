import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import { WebSpeechCapture } from './speech-capture';
import { fakeBrowserFacade } from './testing/velista-testing';

/**
 * The browser's dictation engine, as it actually behaves.
 *
 * Two of its habits are the whole reason this file exists, and neither can be
 * asked of a real microphone on demand:
 *
 * - **`stop()` on an engine that is not running fires nothing.** The spec says to
 *   ignore the call, so a caller waiting for `end` waits forever. That is the
 *   state a paused dictation is in, and the state the app's own five minute limit
 *   puts one in — the one the panel tells somebody to press stop to get out of.
 * - **It ends itself after a stretch of silence**, even with `continuous` set,
 *   which is ordinary rather than the end of a message for somebody taking their
 *   time between items.
 */
class FakeRecognition {
  continuous = false;
  interimResults = false;
  running = false;
  starts = 0;
  aborts = 0;

  /**
   * Whether `start()` hands back an audio stream at once.
   *
   * Set it after opening to model the gap the real engine has: `start()` asks the
   * device for a stream and the `start` event arrives whenever that is ready.
   */
  deferStart = false;

  private readonly listeners = new Map<string, ((event: never) => void)[]>();
  private readonly heard: string[] = [];
  private pendingStart = false;

  addEventListener(
    type: string,
    listener: (event: never) => void,
    options?: { once: boolean }
  ): void {
    const wrapped = options?.once
      ? (event: never) => {
          this.remove(type, wrapped);
          listener(event);
        }
      : listener;

    this.listeners.set(type, [...(this.listeners.get(type) ?? []), wrapped]);
  }

  start(): void {
    this.starts += 1;
    if (this.running) {
      // The real one throws InvalidStateError on a double start.
      throw new Error('InvalidStateError');
    }
    if (this.deferStart) {
      this.pendingStart = true;
      return;
    }
    this.running = true;
    this.emit('start');
  }

  /** The audio stream turning up, some time after `start()` asked for it. */
  startArrives(): void {
    if (!this.pendingStart) {
      return;
    }
    this.pendingStart = false;
    this.running = true;
    this.emit('start');
  }

  /** The engine going away without the courtesy of an event. */
  diesSilently(): void {
    this.running = false;
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.emit('end');
  }

  abort(): void {
    this.aborts += 1;
    // Abort terminates a start that has been asked for and not yet arrived, which
    // is what makes it the right call in that gap: the stream never turns up
    // behind a session nobody is holding.
    this.pendingStart = false;
    if (!this.running) {
      return;
    }
    this.running = false;
    this.emit('end');
  }

  /** A phrase the engine settled on. */
  hears(transcript: string): void {
    this.heard.push(transcript);
    this.emit('result', {
      resultIndex: this.heard.length - 1,
      results: this.heard.map((text) =>
        Object.assign([{ transcript: text }], { isFinal: true })
      ),
    });
  }

  /** The engine giving up on its own, which is not a deliberate end. */
  endsItself(): void {
    this.running = false;
    this.emit('end');
  }

  private remove(type: string, listener: (event: never) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((held) => held !== listener)
    );
  }

  private emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event as never);
    }
  }
}

function build(engine: FakeRecognition | null): WebSpeechCapture {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BrowserFacade,
        useValue: fakeBrowserFacade(new Map(), {
          window:
            engine === null
              ? ({} as Window)
              : ({
                  SpeechRecognition: function () {
                    return engine;
                  },
                } as unknown as Window),
        }),
      },
    ],
  });

  return TestBed.inject(WebSpeechCapture);
}

describe('WebSpeechCapture', () => {
  it('is unavailable where the browser has no engine, rather than throwing', async () => {
    // Firefox, and every server render. The typed field still works, so this is a
    // state the composer draws and not an error.
    const capture = build(null);

    expect(capture.supported()).toBe(false);
    await expect(capture.open()).rejects.toBeInstanceOf(Error);
  });

  it('hands back everything it settled on an ordinary stop', async () => {
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    engine.hears('and milk');

    await expect(session.stop()).resolves.toBe('add bread and milk');
    expect(engine.running).toBe(false);
  });

  it('keeps listening when the engine ends itself on silence', async () => {
    // Somebody may take a while between items, so an end nobody asked for is a
    // pause in the sentence rather than the end of the message.
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    engine.endsItself();

    expect(engine.running).toBe(true);
    expect(engine.starts).toBe(2);

    engine.hears('and milk');
    await expect(session.stop()).resolves.toBe('add bread and milk');
  });

  it('hands back the words when stop follows a pause', async () => {
    // The engine is not running, so no `end` is coming. This used to wait for one
    // forever: the composer went back to a text field, the promise never settled,
    // and the message was gone without anything on screen saying so.
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    session.pause();
    expect(engine.running).toBe(false);

    await expect(session.stop()).resolves.toBe('add bread');
  });

  it('hands back the words when stop lands between an automatic end and its restart', async () => {
    // The gap is real: the restart asks for an audio stream and the `start` event
    // comes back whenever the device is ready. A press in that window is the same
    // problem as the paused one, and the microphone has to be released rather
    // than left open behind a session nobody holds any more.
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    engine.deferStart = true;
    engine.endsItself();

    await expect(session.stop()).resolves.toBe('add bread');
    expect(engine.aborts).toBe(1);

    // And the stream that turns up late finds a session nobody is holding, which
    // must not leave it listening.
    engine.startArrives();
    expect(engine.running).toBe(false);
  });

  it('gives back what it has rather than waiting forever on an engine that died', async () => {
    // Belt and braces behind the check above: an engine that goes away without
    // firing anything would otherwise hold the promise, and the cost of trusting
    // it is the whole message.
    jest.useFakeTimers();
    try {
      const engine = new FakeRecognition();
      const session = await build(engine).open();

      engine.hears('add bread');
      engine.diesSilently();

      const said = session.stop();
      jest.advanceTimersByTime(2000);

      await expect(said).resolves.toBe('add bread');
    } finally {
      jest.useRealTimers();
    }
  });

  it('resumes after a pause and keeps what was already said', async () => {
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    session.pause();
    session.resume();

    expect(engine.running).toBe(true);
    engine.hears('and milk');

    await expect(session.stop()).resolves.toBe('add bread and milk');
  });

  it('throws away the words on close, and releases the microphone', async () => {
    const engine = new FakeRecognition();
    const session = await build(engine).open();

    engine.hears('add bread');
    session.close();

    expect(engine.aborts).toBe(1);
    expect(engine.running).toBe(false);
  });
});
