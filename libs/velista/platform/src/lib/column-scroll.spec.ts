import { COLUMN_SCROLL_RETURN_MS, ColumnScroll } from './column-scroll';

/**
 * A column whose offset clamps to how far it can scroll, which jsdom does not do:
 * `room` is how tall the content is past the fold, and a page still loading has less.
 */
function column(room = 1000): HTMLElement & { room: number } {
  const element = document.createElement('main') as HTMLElement & {
    room: number;
  };
  let top = 0;
  element.room = room;
  Object.defineProperty(element, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, element.room));
    },
  });
  return element;
}

/** Somebody scrolled the column to `top`. */
function scrollTo(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
}

describe('ColumnScroll', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the offset as the column scrolls', () => {
    const scroll = new ColumnScroll(null);
    const main = column();
    scroll.attach(main);

    scrollTo(main, 240);

    expect(scroll.top).toBe(240);
    expect(scroll.returning).toBe(false);
  });

  it('stops reading once detached', () => {
    const scroll = new ColumnScroll(null);
    const main = column();
    scroll.attach(main);
    scrollTo(main, 240);

    scroll.detach();
    scrollTo(main, 600);

    expect(scroll.top).toBe(240);
  });

  it('waits for the content, then puts the old offset back', () => {
    const scroll = new ColumnScroll(480);
    const main = column();
    scroll.attach(main);

    scroll.settle(false);
    expect(main.scrollTop).toBe(0);
    expect(scroll.returning).toBe(true);

    scroll.settle(true);
    expect(main.scrollTop).toBe(480);
    expect(scroll.returning).toBe(false);
  });

  it('keeps trying, a frame at a time, while the column is still too short', () => {
    const scroll = new ColumnScroll(480);
    const main = column(100);
    scroll.attach(main);

    scroll.settle(true);
    expect(main.scrollTop).toBe(100);
    expect(scroll.returning).toBe(true);
    // A page left mid restore keeps the place it was given, not the clamped one.
    expect(scroll.top).toBe(480);

    main.room = 1000;
    jest.advanceTimersToNextTimer();

    expect(main.scrollTop).toBe(480);
    expect(scroll.returning).toBe(false);
  });

  it('gives up when the column never grows that far', () => {
    const scroll = new ColumnScroll(480);
    const main = column(100);
    scroll.attach(main);

    scroll.settle(true);
    jest.advanceTimersByTime(COLUMN_SCROLL_RETURN_MS + 100);

    expect(scroll.returning).toBe(false);
    expect(main.scrollTop).toBe(100);
  });

  it('gives way to a scroll by hand', () => {
    const scroll = new ColumnScroll(480);
    const main = column(100);
    scroll.attach(main);
    scroll.settle(true);

    main.dispatchEvent(new Event('touchstart'));
    main.room = 1000;
    jest.advanceTimersToNextTimer();

    expect(scroll.returning).toBe(false);
    expect(main.scrollTop).toBe(100);
  });
});
