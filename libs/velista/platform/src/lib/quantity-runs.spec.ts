import {
  createEnvironmentInjector,
  DOCUMENT,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { quantityRuns, type QuantityRun } from './quantity-runs';

describe('quantityRuns (velista 0188, section 4)', () => {
  let sent: Array<[string, QuantityRun]>;
  let injector: EnvironmentInjector;

  const step = (from: number, to: number, repeat = false) => ({
    from,
    to,
    repeat,
  });

  const make = () => {
    injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector)
    );
    return runInInjectionContext(injector, () =>
      quantityRuns<string>((key, run) => sent.push([key, run]))
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sent = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('sends one run per quiet beat with the first from and the last to', () => {
    const runs = make();
    runs.step('a', step(750, 775));
    jest.advanceTimersByTime(700);
    runs.step('a', step(775, 800));
    jest.advanceTimersByTime(700);
    runs.step('a', step(800, 825));
    expect(sent).toEqual([]);
    jest.advanceTimersByTime(800);
    expect(sent).toEqual([['a', { from: 750, to: 825 }]]);
  });

  it('keeps separate runs per key', () => {
    const runs = make();
    runs.step('a', step(1, 2));
    runs.step('b', step(5, 4));
    jest.advanceTimersByTime(800);
    expect(sent).toEqual([
      ['a', { from: 1, to: 2 }],
      ['b', { from: 5, to: 4 }],
    ]);
  });

  it('sends nothing for a run back to its start', () => {
    const runs = make();
    runs.step('a', step(3, 4));
    runs.step('a', step(4, 3));
    jest.advanceTimersByTime(800);
    expect(sent).toEqual([]);
    expect(runs.pending().size).toBe(0);
  });

  it('draws the open run, then the stored amount once it is sent', () => {
    const runs = make();
    expect(runs.shown('a', 750)).toBe(750);
    runs.step('a', step(750, 775));
    expect(runs.pending().get('a')).toBe(775);
    expect(runs.shown('a', 750)).toBe(775);
    jest.advanceTimersByTime(800);
    expect(runs.pending().has('a')).toBe(false);
    expect(runs.shown('a', 775)).toBe(775);
  });

  it('sends a run at once on flush, and only once', () => {
    const runs = make();
    runs.step('a', step(1, 3));
    runs.flush('a');
    expect(sent).toEqual([['a', { from: 1, to: 3 }]]);
    jest.advanceTimersByTime(800);
    expect(sent).toHaveLength(1);
    runs.flush('a');
    expect(sent).toHaveLength(1);
  });

  it('sends every open run when its context is destroyed', () => {
    const runs = make();
    runs.step('a', step(1, 3));
    runs.step('b', step(9, 8));
    injector.destroy();
    expect(sent).toEqual([
      ['a', { from: 1, to: 3 }],
      ['b', { from: 9, to: 8 }],
    ]);
  });

  it('sends every open run when the page is hidden', () => {
    const runs = make();
    const doc = TestBed.inject(DOCUMENT);
    runs.step('a', step(1, 3));
    const state = jest
      .spyOn(doc, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toEqual([['a', { from: 1, to: 3 }]]);
    state.mockRestore();
  });
});
