import { InjectionToken, Type } from '@angular/core';

/**
 * Declares a root-provided DI token bound to a service interface, defaulting to
 * a chosen implementation (in practice the in-memory one). Consumers inject the
 * token typed to the interface instead of a concrete class, so the app depends
 * on the contract, not the implementation.
 *
 * The `defaultImpl` factory runs in an injection context, so it resolves the
 * default with `inject(SomeMemory)`. Swapping the whole app to another
 * implementation (e.g. an HTTP-backed one) is then a one-line change here at the
 * token declaration; overriding it for a single remote or environment is a
 * `provideService(TOKEN, OtherImpl)` in that injector. Unit tests resolve to the
 * default (memory) with no setup.
 */
export function serviceToken<T>(
  description: string,
  defaultImpl: () => T
): InjectionToken<T> {
  return new InjectionToken<T>(description, {
    providedIn: 'root',
    factory: defaultImpl,
  });
}

/**
 * Binds a service token to a concrete implementation at a specific injector
 * (route/remote providers), overriding the token's default. `useExisting` keeps
 * the app on the implementation's own `providedIn: 'root'` singleton rather than
 * creating a second instance.
 */
export function provideService<T>(
  token: InjectionToken<T>,
  implementation: Type<T>
) {
  return { provide: token, useExisting: implementation };
}
