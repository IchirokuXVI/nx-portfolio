import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppResumed } from './app-resumed';
import { provideFakeBrowserFacade } from './testing/velista-testing';

/** The `pageshow` listeners the service registered, in order. */
type Listener = (event: Event) => void;

describe('AppResumed', () => {
  let visible: WritableSignal<boolean>;
  let pageShow: Listener[];
  let removed: Listener[];

  /** A window that records its listeners, so a spec drives them by hand. */
  function fakeWindow(): Window {
    return {
      addEventListener: (name: string, handler: Listener) => {
        if (name === 'pageshow') {
          pageShow.push(handler);
        }
      },
      removeEventListener: (name: string, handler: Listener) => {
        if (name === 'pageshow') {
          removed.push(handler);
        }
      },
    } as unknown as Window;
  }

  function build(): AppResumed {
    const resumed = TestBed.inject(AppResumed);
    TestBed.tick();
    return resumed;
  }

  /**
   * Run a body against a stopped clock, with a handle to move it on.
   *
   * The collapse window is the thing under test, so it cannot also be measured with
   * the wall clock: a machine running a dozen jest workers can put a real second
   * between two statements, and the test would then assert the opposite of itself.
   */
  function freezeClock(body: (advance: (ms: number) => void) => void): void {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;

    try {
      body((ms) => (now += ms));
    } finally {
      Date.now = realNow;
    }
  }

  /** A `pageshow`, restored from the back/forward cache or not. */
  function firePageShow(persisted: boolean): void {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: persisted });
    for (const handler of pageShow) {
      handler(event);
    }
  }

  beforeEach(() => {
    visible = signal(true);
    pageShow = [];
    removed = [];

    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(new Map(), {
          visible,
          window: fakeWindow(),
        }),
      ],
    });
  });

  it('counts nothing before the app has been away', () => {
    // The zero is load bearing: consumers read a resume as "the count moved", so a
    // count that started at one would make the app's first frame look like a resume
    // and reconnect a socket in the middle of its first connect.
    const resumed = build();

    expect(resumed.resumes()).toBe(0);
  });

  it('counts one resume for hidden then visible', () => {
    const resumed = build();

    visible.set(false);
    TestBed.tick();
    visible.set(true);
    TestBed.tick();

    expect(resumed.resumes()).toBe(1);
  });

  it('does not count going away', () => {
    const resumed = build();

    visible.set(false);
    TestBed.tick();

    expect(resumed.resumes()).toBe(0);
  });

  it('counts a page restored from the back/forward cache', () => {
    // The case `visibilitychange` misses. On iOS Safari this is what happens to a
    // backgrounded installed app, and the restored page comes back with a dead socket
    // having fired no visibility change at all.
    const resumed = build();

    firePageShow(true);

    expect(resumed.resumes()).toBe(1);
  });

  it('ignores a pageshow that is an ordinary load', () => {
    const resumed = build();

    firePageShow(false);

    expect(resumed.resumes()).toBe(0);
  });

  it('collapses two edges that arrive together into one resume', () => {
    // A phone unlocking can raise both, and reconnecting twice tears down the socket
    // the first reconnect just opened. The clock is held still rather than trusted:
    // this asserts the window, and a loaded machine can put a second between two
    // statements.
    const resumed = build();

    freezeClock(() => {
      visible.set(false);
      TestBed.tick();
      visible.set(true);
      TestBed.tick();
      firePageShow(true);
    });

    expect(resumed.resumes()).toBe(1);
  });

  it('counts two resumes that are far enough apart', () => {
    const resumed = build();

    freezeClock((advance) => {
      visible.set(false);
      TestBed.tick();
      visible.set(true);
      TestBed.tick();

      advance(60_000);
      firePageShow(true);
    });

    expect(resumed.resumes()).toBe(2);
  });

  it('needs no window at all', () => {
    // A server render has no window and never resumes. Nothing throws, and the
    // visibility half still works because the facade answers for it.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideFakeBrowserFacade(new Map(), { visible })],
    });

    const resumed = build();
    visible.set(false);
    TestBed.tick();
    visible.set(true);
    TestBed.tick();

    expect(resumed.resumes()).toBe(1);
  });
});
