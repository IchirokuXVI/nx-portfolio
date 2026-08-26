import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import { ReloadBlocker } from './reload-blocker';

describe('ReloadBlocker', () => {
  let blocker: ReloadBlocker;
  let reload: jest.Mock;

  beforeEach(() => {
    reload = jest.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: BrowserFacade, useValue: { reload } }],
    });
    blocker = TestBed.inject(ReloadBlocker);
  });

  it('reloads immediately when nothing is held', () => {
    blocker.reloadWhenIdle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('defers the reload while a blocker is held, then fires it on release', () => {
    // `0003` section 3.1: reloading over an open dialog or a half-typed field
    // discards the user's work, and with no offline queue that loss is permanent.
    const release = blocker.block();

    blocker.reloadWhenIdle();
    expect(reload).not.toHaveBeenCalled();

    release();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the last of several blockers', () => {
    const first = blocker.block();
    const second = blocker.block();

    blocker.reloadWhenIdle();
    first();
    expect(reload).not.toHaveBeenCalled();

    second();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('releases idempotently, so a submit handler and a destroy hook can both call it', () => {
    const release = blocker.block();
    blocker.reloadWhenIdle();

    release();
    release();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(blocker.isBlocked()).toBe(false);
  });

  it('does not reload on release when none was requested', () => {
    const release = blocker.block();

    release();

    expect(reload).not.toHaveBeenCalled();
  });
});
