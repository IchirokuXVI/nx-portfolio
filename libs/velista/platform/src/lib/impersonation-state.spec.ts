import { TestBed } from '@angular/core/testing';
import { ImpersonationState } from './impersonation-state';
import { StorageKeys } from './storage-keys';
import { provideFakeBrowserFacade } from './testing/velista-testing';

function stateWith(marker: string | null): ImpersonationState {
  TestBed.configureTestingModule({
    providers: [
      provideFakeBrowserFacade(new Map(), {
        readSessionStorage: (key: string) =>
          key === StorageKeys.supportSession ? marker : null,
      }),
    ],
  });
  return TestBed.inject(ImpersonationState);
}

// Velista `0133`, target 1.
describe('ImpersonationState', () => {
  const view = { username: 'marta_r', until: new Date(1_900_000_000_000) };

  it('is active in a tab that started with the marker, and draws what it is shown', () => {
    const state = stateWith('1');

    expect(state.active).toBe(true);
    expect(state.session()).toBeNull();

    state.show(view);
    expect(state.session()).toEqual(view);
  });

  it('is not active in an ordinary tab, and never draws a strip there', () => {
    const state = stateWith(null);

    expect(state.active).toBe(false);
    state.show(view);
    expect(state.session()).toBeNull();
  });

  it('hands a press on End to whoever named what ending does', () => {
    const state = stateWith('1');
    const onEnd = jest.fn();

    state.end();
    state.handleEnd(onEnd);
    state.end();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
