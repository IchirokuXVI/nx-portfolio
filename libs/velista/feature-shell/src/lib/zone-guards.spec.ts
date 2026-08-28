import { UrlSegment, type Route } from '@angular/router';
import { listIdGuard, zoneIdGuard } from './zone-guards';

/**
 * Plan 0010, rule G1: `zones/:zoneId` matches only a UUID.
 *
 * `routes.spec.ts` asserts that the guard is declared and that it is a `canMatch`;
 * this asserts what it actually decides. The two together are the acceptance
 * criterion, and neither is much use alone.
 *
 * The guard takes segments rather than a param map because at `canMatch` time the
 * route has not been matched and there are no params yet, so it is exercised the same
 * way the router calls it. It injects nothing, deliberately, which is what lets it be
 * called straight rather than through a `TestBed` that would exist only to satisfy an
 * injection context this guard never uses.
 */
function matches(...paths: readonly string[]): boolean {
  const segments = paths.map((path) => new UrlSegment(path, {}));

  return zoneIdGuard({} as Route, segments) as boolean;
}

describe('zoneIdGuard', () => {
  it('matches a real zone id', () => {
    // Every id in the product comes from `@PrimaryGeneratedColumn('uuid')`, so this
    // is checkable rather than agreed.
    expect(matches('zones', '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71')).toBe(true);
  });

  it('is case insensitive, since a pasted link may be upper case', () => {
    expect(matches('zones', '8F14E45F-CEEA-4E2C-9E0B-9C1A6A3F2B71')).toBe(true);
  });

  it('declines `new`, which is what keeps the create sheet reachable', () => {
    // The whole point of the rule. Without this, `/zones/new` is swallowed by
    // `:zoneId` and the person who tapped Create a group gets a group page firing
    // `GET /v1/zones/new`.
    expect(matches('zones', 'new')).toBe(false);
  });

  it('declines `join`, the other reserved word under the same prefix', () => {
    expect(matches('zones', 'join')).toBe(false);
  });

  it('declines anything else that is not an id', () => {
    // A mistyped link now falls through to the front door instead of spending a
    // request to be told `not_found`.
    for (const segment of [
      'whatever',
      '123',
      '8f14e45f-ceea-4e2c-9e0b',
      '8f14e45f_ceea_4e2c_9e0b_9c1a6a3f2b71',
      '',
    ]) {
      expect(matches('zones', segment)).toBe(false);
    }
  });

  it('declines a URL with no id segment at all', () => {
    expect(matches('zones')).toBe(false);
  });
});

/**
 * Plan 0012, rule L1: `lists/:listId` matches only a UUID.
 *
 * Rule G1 one level deeper, with the same trap and the same fix. `lists/new` is a
 * child of `zones/:zoneId`, so `zones/:zoneId/lists/:listId` declared beside it is
 * offered `/lists/new` first and matches it with `listId` set to the string `new`.
 *
 * The list page is a **sibling** of `zones/:zoneId` rather than a child, because it is
 * its own destination, so its route matches all four segments and the list id is the
 * fourth rather than the second. That off by two is the thing most likely to be got
 * wrong here, which is why the fixtures below are whole paths.
 */
function listMatches(...paths: readonly string[]): boolean {
  const segments = paths.map((path) => new UrlSegment(path, {}));

  return listIdGuard({} as Route, segments) as boolean;
}

describe('listIdGuard', () => {
  const ZONE = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
  const LIST = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';

  it('matches a real list id in the fourth segment', () => {
    expect(listMatches('zones', ZONE, 'lists', LIST)).toBe(true);
  });

  it('is case insensitive, since a pasted link may be upper case', () => {
    expect(listMatches('zones', ZONE, 'lists', LIST.toUpperCase())).toBe(true);
  });

  it('declines `new`, which is what keeps the create sheet reachable', () => {
    // The whole point of the rule. Without it, `/zones/<uuid>/lists/new` is swallowed
    // and the person who tapped Start a list gets a list page firing
    // `GET /v1/lists/new/lines`.
    expect(listMatches('zones', ZONE, 'lists', 'new')).toBe(false);
  });

  it('declines anything else that is not an id', () => {
    for (const segment of [
      'whatever',
      '123',
      '3c9a1d02-5f47-4b8e',
      '3c9a1d02_5f47_4b8e_9a1c_7d2e6b4f0a35',
      '',
    ]) {
      expect(listMatches('zones', ZONE, 'lists', segment)).toBe(false);
    }
  });

  it('declines a URL that stops before the list id', () => {
    expect(listMatches('zones', ZONE, 'lists')).toBe(false);
    expect(listMatches('zones', ZONE)).toBe(false);
  });

  it('reads the fourth segment and not the second', () => {
    // The zone half is `zoneIdGuard`'s job and the two run side by side. A guard that
    // read from the wrong end would match the zone id and let `/lists/new` through.
    expect(listMatches('zones', ZONE, 'lists', 'new')).toBe(false);
    expect(listMatches('zones', 'new', 'lists', LIST)).toBe(true);
  });
});
