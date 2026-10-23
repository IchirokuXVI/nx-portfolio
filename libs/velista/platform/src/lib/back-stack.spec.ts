import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BackStack, handleBackWhile } from './back-stack';

describe('BackStack', () => {
  let stack: BackStack;

  beforeEach(() => {
    stack = TestBed.inject(BackStack);
  });

  it('answers false with nothing registered', () => {
    expect(stack.handle()).toBe(false);
  });

  it('asks the newest handler first and stops at the first that takes the press', () => {
    const asked: string[] = [];
    stack.register(() => {
      asked.push('page');
      return true;
    });
    stack.register(() => {
      asked.push('sheet');
      return true;
    });

    expect(stack.handle()).toBe(true);
    expect(asked).toEqual(['sheet']);
  });

  it('passes the press down past a handler that declines it', () => {
    const asked: string[] = [];
    stack.register(() => {
      asked.push('page');
      return true;
    });
    stack.register(() => {
      asked.push('closed menu');
      return false;
    });

    expect(stack.handle()).toBe(true);
    expect(asked).toEqual(['closed menu', 'page']);
  });

  it('answers false when every handler declines', () => {
    stack.register(() => false);
    stack.register(() => false);

    expect(stack.handle()).toBe(false);
  });

  it('forgets a handler once released, and a second release is harmless', () => {
    const older = jest.fn(() => true);
    const newer = jest.fn(() => true);
    stack.register(older);
    const release = stack.register(newer);

    release();
    release();
    stack.handle();

    expect(newer).not.toHaveBeenCalled();
    expect(older).toHaveBeenCalledTimes(1);
  });

  it('keeps walking when a handler releases itself mid press', () => {
    const older = jest.fn(() => true);
    stack.register(older);
    const release = stack.register(() => {
      release();
      return false;
    });

    expect(stack.handle()).toBe(true);
    expect(older).toHaveBeenCalledTimes(1);
  });
});

describe('handleBackWhile', () => {
  @Component({ selector: 'lib-menu-double', template: '' })
  class MenuDouble {
    readonly open = signal(false);
    readonly closed = jest.fn(() => this.open.set(false));

    constructor() {
      handleBackWhile(this.open, () => this.closed());
    }
  }

  function render() {
    const fixture = TestBed.createComponent(MenuDouble);
    fixture.detectChanges();
    return { fixture, menu: fixture.componentInstance };
  }

  it('registers nothing while closed', () => {
    const { menu } = render();

    expect(TestBed.inject(BackStack).handle()).toBe(false);
    expect(menu.closed).not.toHaveBeenCalled();
  });

  it('takes the press while open, and closes', () => {
    const { fixture, menu } = render();
    menu.open.set(true);
    fixture.detectChanges();

    expect(TestBed.inject(BackStack).handle()).toBe(true);
    expect(menu.closed).toHaveBeenCalledTimes(1);
  });

  it('passes a press on once closed, even before change detection runs', () => {
    const { fixture, menu } = render();
    menu.open.set(true);
    fixture.detectChanges();
    menu.open.set(false);

    expect(TestBed.inject(BackStack).handle()).toBe(false);
    expect(menu.closed).not.toHaveBeenCalled();
  });

  it('releases the registration on destroy', () => {
    const { fixture, menu } = render();
    menu.open.set(true);
    fixture.detectChanges();

    fixture.destroy();

    expect(TestBed.inject(BackStack).handle()).toBe(false);
  });
});
