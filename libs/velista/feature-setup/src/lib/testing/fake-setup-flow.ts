import { signal } from '@angular/core';
import { shoppingProfileFor } from '@portfolio/velista/data-access';
import type { ProfileLoad, ShoppingProfile } from '@portfolio/velista/models';
import type { ChainsAnswer, SetupStep } from '../setup-flow';

/**
 * A `SetupFlow` for a step's spec: the profile it writes to, and a record of where it
 * was sent.
 *
 * Specs only. `tsconfig.lib.json` excludes this folder, because it names `jest` and a
 * library file that does would fail `nx build` while every `nx test` passed.
 */
export function fakeSetupFlow(
  profile: ShoppingProfile | null = shoppingProfileFor()
) {
  return {
    shoppingProfile: signal<ShoppingProfile | null>(profile),
    shoppingState: signal<ProfileLoad>('loaded'),
    chains: signal<ChainsAnswer | null>(null),
    loadProfiles: jest.fn(),
    path: (step: SetupStep) =>
      step === '' ? '/en/setup' : `/en/setup/${step}`,
    go: jest.fn<Promise<void>, [SetupStep]>(async () => undefined),
    finish: jest.fn<Promise<void>, []>(async () => undefined),
  };
}

export type FakeSetupFlow = ReturnType<typeof fakeSetupFlow>;
