import { signal, type Provider } from '@angular/core';
import type { OperatorSettings } from '@portfolio/velista/models';
import { MEMORY_OPERATOR_SETTINGS } from './operator-settings-memory';
import {
  OperatorSettingsStore,
  type OperatorSettingsState,
} from './operator-settings-store';

/**
 * An `OperatorSettingsStore` that holds what you gave it (velista `0172`).
 *
 * Ready with the memory deployment by default. Pass `null` for a store that has not
 * answered yet, and drive it with {@link land} and {@link fail}. The real store's own
 * behaviour, reading on the readiness edge and retrying once per edge, is covered
 * against the real thing in its spec. Plans `0173` and `0174` use this for their
 * screens.
 */
export function fakeOperatorSettingsStore(
  initial: OperatorSettings | null = MEMORY_OPERATOR_SETTINGS
) {
  const settings = signal<OperatorSettings | null>(initial);
  const state = signal<OperatorSettingsState>(
    initial === null ? 'loading' : 'ready'
  );
  let reloads = 0;

  return {
    settings: settings.asReadonly(),
    state: state.asReadonly(),
    reload: () => {
      reloads += 1;
      state.set('loading');
    },
    /** The answer arriving. */
    land: (next: OperatorSettings) => {
      settings.set(next);
      state.set('ready');
    },
    /** The read failing. */
    fail: () => {
      state.set('failed');
    },
    /** How many times something asked to read again. */
    reloads: () => reloads,
  };
}

export type FakeOperatorSettingsStore = ReturnType<
  typeof fakeOperatorSettingsStore
>;

export function provideFakeOperatorSettingsStore(
  store: FakeOperatorSettingsStore = fakeOperatorSettingsStore()
): Provider {
  return { provide: OperatorSettingsStore, useValue: store };
}
