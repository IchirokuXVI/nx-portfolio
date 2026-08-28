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
 *
 * **A default that quietly works is a liability.** The token is root provided, so it
 * resolves its default in the **root** injector. If a consumer also lives at the root
 * while the app binds the real implementation lower down, on a route, the consumer
 * never sees the binding and gets the default instead, with nothing to indicate it.
 * That is how velista shipped a home page reading in-memory fixtures while appearing
 * to talk to its backend (velista plan 0005). Where the default being wrong would be
 * invisible rather than loud, default to the real implementation and make the fake the
 * thing callers ask for by name.
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
 * Binds a service token to an implementation **and provides it**, at whichever
 * injector this goes in (route or remote providers).
 *
 * Reach for this one by default. It is the only one of the two that works when the
 * implementation is not `providedIn: 'root'`, which is the case for any service that
 * depends on something the app layer supplies: config tokens, or an `HttpClient` the
 * app configured with its own interceptors. Under module federation the root injector
 * belongs to the host, so a remote's services usually cannot be root provided at all.
 *
 * The implementation is constructed by the injector this provider lands in, so do not
 * also inject the concrete class somewhere else expecting the same object. Consumers
 * should be injecting the token anyway.
 */
export function provideService<T>(
  token: InjectionToken<T>,
  implementation: Type<T>
) {
  return { provide: token, useClass: implementation };
}

/**
 * Points a service token at an implementation **that is already provided elsewhere**,
 * without creating a second one.
 *
 * `useExisting` is an alias: it says where to look, and never constructs anything. So
 * this only works when the implementation provides itself with `providedIn: 'root'`,
 * or is listed in an injector at or above this one. Given a class that does neither,
 * the token resolves to a missing provider, and the error names the **class**, which
 * reads as if the class were the thing that was not provided rather than the alias
 * being unsatisfiable.
 *
 * Worth it when the implementation is a root singleton holding state that must not be
 * duplicated, and something also injects the concrete class directly. Otherwise prefer
 * {@link provideService}.
 */
export function useService<T>(
  token: InjectionToken<T>,
  implementation: Type<T>
) {
  return { provide: token, useExisting: implementation };
}
