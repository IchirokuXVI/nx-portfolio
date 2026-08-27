import { UrlSegment, type Route } from '@angular/router';
import { zoneIdGuard } from './zone-guards';

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
