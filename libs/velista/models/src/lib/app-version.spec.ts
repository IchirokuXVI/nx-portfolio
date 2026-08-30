import { isOlderThan, parseVersion } from './app-version';

/**
 * The comparator decides whether a user is refused service, so the cases that matter
 * most here are the ones where the answer must be "no opinion" (plan 0034 D6). A bug
 * that orders two versions slightly wrong delays an update; a bug that invents an
 * ordering for `staging` locks a fleet out of its own backend.
 */
describe('app version', () => {
  describe('parseVersion', () => {
    it('parses a plain release', () => {
      expect(parseVersion('1.4.2')).toEqual({
        major: 1,
        minor: 4,
        patch: 2,
        prerelease: [],
      });
    });

    it('accepts the leading v a release tag carries', () => {
      expect(parseVersion('v1.4.2')).toEqual(parseVersion('1.4.2'));
    });

    it('splits prerelease identifiers and ignores build metadata', () => {
      expect(parseVersion('1.0.0-rc.1+build.9')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['rc', '1'],
      });
    });

    it.each([
      ['staging', 'the tag every staging build carries'],
      ['latest', 'the tag every image carries'],
      ['1.4', 'a version with no patch'],
      ['', 'an empty string'],
      ['not a version', 'prose'],
    ])('returns null for %s (%s)', (value) => {
      expect(parseVersion(value)).toBeNull();
    });

    it.each([null, undefined])('returns null for %s', (value) => {
      expect(parseVersion(value)).toBeNull();
    });
  });

  describe('isOlderThan', () => {
    it('orders the numeric core', () => {
      expect(isOlderThan('1.4.2', '1.4.3')).toBe(true);
      expect(isOlderThan('1.4.2', '1.5.0')).toBe(true);
      expect(isOlderThan('1.4.2', '2.0.0')).toBe(true);
      expect(isOlderThan('2.0.0', '1.9.9')).toBe(false);
    });

    it('is false for the same version, so a client at the floor is served', () => {
      expect(isOlderThan('1.4.2', '1.4.2')).toBe(false);
    });

    it('sorts a prerelease below the release it precedes', () => {
      expect(isOlderThan('1.0.0-rc.1', '1.0.0')).toBe(true);
      expect(isOlderThan('1.0.0', '1.0.0-rc.1')).toBe(false);
    });

    it('compares prerelease identifiers the way the specification says', () => {
      expect(isOlderThan('1.0.0-rc.2', '1.0.0-rc.10')).toBe(true);
      expect(isOlderThan('1.0.0-alpha', '1.0.0-beta')).toBe(true);
      // A numeric identifier has lower precedence than an alphanumeric one.
      expect(isOlderThan('1.0.0-1', '1.0.0-alpha')).toBe(true);
      // Fewer identifiers sort first when everything before them matched.
      expect(isOlderThan('1.0.0-rc', '1.0.0-rc.1')).toBe(true);
    });

    it('has no opinion when the client version does not parse', () => {
      // The staging fleet, and every developer build, against any floor at all.
      expect(isOlderThan('staging', '9.9.9')).toBe(false);
      expect(isOlderThan('latest', '9.9.9')).toBe(false);
    });

    it('has no opinion when the floor does not parse', () => {
      // A mistyped MIN_CLIENT_VERSION retires nobody rather than everybody.
      expect(isOlderThan('1.0.0', 'v.1.0')).toBe(false);
      expect(isOlderThan('1.0.0', '')).toBe(false);
    });

    it('has no opinion about the development default, whatever the floor', () => {
      // 0.0.0-dev sorts below every release, but it is never *compared* to one in
      // practice because a development build talks to a gateway with no floor set.
      // The assertion that matters is the one below it.
      expect(isOlderThan('0.0.0-dev', '1.0.0')).toBe(true);
      expect(isOlderThan('0.0.0-dev', '')).toBe(false);
    });
  });
});
