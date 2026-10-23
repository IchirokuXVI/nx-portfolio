import { TestBed } from '@angular/core/testing';
import { ATTENTION_AFTER_MS, LiveConnection } from './live-connection';
import { provideFakeBrowserFacade } from './testing/velista-testing';

describe('LiveConnection', () => {
  function build(isBrowser = true): LiveConnection {
    TestBed.configureTestingModule({
      providers: [provideFakeBrowserFacade(undefined, { isBrowser })],
    });
    return TestBed.inject(LiveConnection);
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts off, with no attention', () => {
    const live = build();

    expect(live.phase()).toBe('off');
    expect(live.attention()).toBe(false);
  });

  it('raises attention after 2 000 ms of down, and not at 1 999', () => {
    const live = build();

    live.report('down');
    jest.advanceTimersByTime(ATTENTION_AFTER_MS - 1);
    expect(live.attention()).toBe(false);

    jest.advanceTimersByTime(1);
    expect(live.attention()).toBe(true);
  });

  it('keeps the clock of the first down when down is reported again', () => {
    // A socket retrying every second reports down on each attempt.
    const live = build();

    live.report('down');
    jest.advanceTimersByTime(1_500);
    live.report('down');
    jest.advanceTimersByTime(500);

    expect(live.attention()).toBe(true);
  });

  it('clears attention the moment the phase is up', () => {
    const live = build();
    live.report('down');
    jest.advanceTimersByTime(ATTENTION_AFTER_MS);
    expect(live.attention()).toBe(true);

    live.report('up');

    expect(live.attention()).toBe(false);
  });

  it('cancels the clock when up comes before the delay', () => {
    const live = build();

    live.report('down');
    jest.advanceTimersByTime(1_000);
    live.report('up');
    jest.advanceTimersByTime(ATTENTION_AFTER_MS * 2);

    expect(live.attention()).toBe(false);
  });

  it('never raises attention for off', () => {
    const live = build();

    live.report('down');
    live.report('off');
    jest.advanceTimersByTime(ATTENTION_AFTER_MS * 10);

    expect(live.phase()).toBe('off');
    expect(live.attention()).toBe(false);
  });

  it('runs no timer when isBrowser is false', () => {
    const live = build(false);

    live.report('down');

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(ATTENTION_AFTER_MS * 10);
    expect(live.phase()).toBe('down');
    expect(live.attention()).toBe(false);
  });
});
