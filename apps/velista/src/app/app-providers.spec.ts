import {
  APP_INITIALIZER,
  createEnvironmentInjector,
  ENVIRONMENT_INITIALIZER,
  EnvironmentInjector,
  type Type,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ApiUrl,
  ConnectionRecovery,
  SessionStore,
  TokenStore,
  ZONE_SERVICE,
  ZoneApi,
  ZoneMemory,
  ZoneStore,
} from '@portfolio/velista/data-access';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_BRAND,
} from '@portfolio/velista/models';
import { ThemeStore } from '@portfolio/velista/platform';
import { appProviders } from './app-providers';

/**
 * The topology test. This is the spec that plan `0005` exists because of.
 *
 * Every other spec in this workspace configures providers through
 * `TestBed.configureTestingModule`, which puts them in the **testing environment
 * injector**. That injector carries the `root` scope, so a `providedIn: 'root'`
 * service can see them. Production does not look like that: the shell owns the root
 * injector, and `entry.routes.ts` hands `appProviders` to a **route**, which the
 * router turns into a child `EnvironmentInjector` scoped `environment` and nothing
 * else. A root scoped service is created in the root injector and resolves its own
 * dependencies from there, so it cannot see anything the route provided.
 *
 * That difference is the entire bug, and it is invisible to a test that does not
 * reproduce it. So this file never puts `appProviders` in the TestBed. It builds the
 * child injector by hand, exactly as `@angular/router` does
 * (`createEnvironmentInjector(route.providers, parentInjector)`), and asks that
 * injector for what the app needs.
 *
 * Before rule D5 every assertion below failed with
 * `NG0201: No provider found for InjectionToken APP_BRAND`, or with the app quietly
 * running on in-memory data.
 */
describe('appProviders, resolved the way the router resolves them', () => {
  /** The child injector the router builds for `providers` on the velista route. */
  function routeInjector(): EnvironmentInjector {
    return createEnvironmentInjector(
      appProviders,
      TestBed.inject(EnvironmentInjector),
      'Route: velista'
    );
  }

  it.each([
    ['APP_BRAND', APP_BRAND],
    ['APP_API_CONFIG', APP_API_CONFIG],
    ['APP_BASE_PATH', APP_BASE_PATH],
  ])('resolves the app level token %s', (_name, token) => {
    expect(routeInjector().get(token)).toBeDefined();
  });

  // Naming each one is the point: a service added later without rule D5 fails here
  // by name, instead of turning a rendering test red for reasons nobody can read.
  it.each([
    ['ThemeStore', ThemeStore],
    ['ApiUrl', ApiUrl],
    ['TokenStore', TokenStore],
    ['SessionStore', SessionStore],
    ['ZoneStore', ZoneStore],
    ['ZoneApi', ZoneApi],
    ['ConnectionRecovery', ConnectionRecovery],
  ])('constructs %s from the route injector', (_name, type) => {
    expect(routeInjector().get(type as Type<unknown>)).toBeInstanceOf(type);
  });

  it('binds ZONE_SERVICE to the real gateway, not the in-memory default', () => {
    // The silent failure. `provideService(ZONE_SERVICE, ZoneApi)` was already in
    // `appProviders` before this plan and it did nothing: `ZoneStore` was created in
    // the root injector, so it resolved the token's default factory and quietly used
    // `ZoneMemory`. The app looked like it worked, and served invented data.
    const service = routeInjector().get(ZONE_SERVICE);

    expect(service).toBeInstanceOf(ZoneApi);
    expect(service).not.toBeInstanceOf(ZoneMemory);
  });

  it('builds gateway URLs from the app supplied configuration', () => {
    // Proves `ApiUrl` really received `APP_API_CONFIG` rather than merely being
    // constructible, which is what row two of the plan's table was about.
    expect(routeInjector().get(ApiUrl).gateway('/v1/zones')).toMatch(
      /^https?:\/\/.+\/v1\/zones$/
    );
  });

  it('registers its startup work as an environment initializer, never APP_INITIALIZER', () => {
    // `APP_INITIALIZER` is read once by `ApplicationInitStatus` at bootstrap, from the
    // root injector. Nothing ever asks a route injector for it, so `ConnectionRecovery`
    // was never constructed. `ENVIRONMENT_INITIALIZER` runs when the injector it is
    // declared on is created, which is the one primitive that works in both the
    // mounted-remote and the standalone case.
    const injector = routeInjector();

    expect(injector.get(APP_INITIALIZER, null)).toBeNull();
    expect(injector.get(ENVIRONMENT_INITIALIZER, null)).not.toBeNull();
  });
});
