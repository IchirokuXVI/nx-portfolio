import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { onEdge } from './on-edge';

describe('onEdge', () => {
  function watch(start: number) {
    const counter = signal(start);
    const act = jest.fn();
    runInInjectionContext(TestBed.inject(Injector), () => onEdge(counter, act));
    TestBed.tick();
    return { counter, act };
  }

  it('acts on nothing at creation, whatever the counter starts at', () => {
    expect(watch(0).act).not.toHaveBeenCalled();
    expect(watch(3).act).not.toHaveBeenCalled();
  });

  it('acts once per move of the counter', () => {
    const { counter, act } = watch(0);

    counter.set(1);
    TestBed.tick();
    expect(act).toHaveBeenCalledTimes(1);

    counter.set(2);
    TestBed.tick();
    expect(act).toHaveBeenCalledTimes(2);
  });

  it('does not act on a fall to zero, which is a sign out, and acts on the next rise', () => {
    const { counter, act } = watch(2);

    counter.set(0);
    TestBed.tick();
    expect(act).not.toHaveBeenCalled();

    counter.set(1);
    TestBed.tick();
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('does not act again when nothing moved', () => {
    const { counter, act } = watch(0);

    counter.set(1);
    TestBed.tick();
    TestBed.tick();
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('does not track what the act reads', () => {
    const counter = signal(0);
    const other = signal(0);
    const act = jest.fn(() => other());
    runInInjectionContext(TestBed.inject(Injector), () => onEdge(counter, act));
    TestBed.tick();

    counter.set(1);
    TestBed.tick();
    other.set(5);
    TestBed.tick();
    expect(act).toHaveBeenCalledTimes(1);
  });
});
