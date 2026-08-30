import { InjectionToken } from '@angular/core';

/**
 * Which build of the app this is.
 *
 * Extraction contract item 6 (plan 0001) again: the value comes from the app's own
 * environment surface and is bound here, so every library reads a token and no
 * library reaches for an environment file. `gateway-interceptor.ts` is the only
 * consumer today, and it sends it as {@link CLIENT_VERSION_HEADER} on every request.
 *
 * The default is not a placeholder to be overwritten in tests: it is the honest
 * answer for anything that was not built by the app layer, and by {@link isOlderThan}
 * an unparseable version never compares against anything, so a spec that leaves it
 * alone gets the "no opinion" path rather than an accidental one.
 */
export const APP_VERSION = new InjectionToken<string>('APP_VERSION', {
  providedIn: 'root',
  factory: () => 'unknown',
});

/**
 * The header the client states its version in (plan 0034 D4).
 *
 * A request header rather than something derived from the user agent, because the
 * only thing that knows which bundle is running is the bundle.
 */
export const CLIENT_VERSION_HEADER = 'x-client-version';

/**
 * The header a deployment advertises its oldest supported client in.
 *
 * The gateway sets it on every response while `MIN_CLIENT_VERSION` is configured, and
 * it is named in `exposedHeaders` on the CORS options, without which a browser on
 * `velista.app` calling `api.velista.app` could not read it at all (plan 0034 D8).
 */
export const MIN_CLIENT_VERSION_HEADER = 'x-min-client-version';

/** A version split into its comparable parts. */
export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot separated prerelease identifiers, empty for a plain release. */
  readonly prerelease: readonly string[];
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Parses a semantic version, or returns null for anything that is not one.
 *
 * Null is a first class answer here rather than a failure (plan 0034 D6). A staging
 * build calls itself `staging` and a local one `0.0.0-dev`; the first does not parse,
 * and the rule is that a version nobody can order is never ordered. That is what stops
 * a mistyped floor on one deployment from locking out a fleet it was never aimed at.
 *
 * A leading `v` is accepted because release tags carry one and the version they name
 * does not, and the difference between `v1.4.0` and `1.4.0` is not one worth locking
 * a user out over.
 */
export function parseVersion(
  value: string | null | undefined
): ParsedVersion | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = SEMVER.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Orders two parsed versions the way semver 2.0.0 says to: the numeric core first,
 * then a prerelease sorting *below* the release it precedes, then identifier by
 * identifier with numeric ones compared as numbers.
 *
 * Negative when `a` is older, positive when it is newer, zero when they are the same
 * release. Build metadata is ignored, as the specification requires.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) {
    return core;
  }

  // 1.0.0-rc.1 precedes 1.0.0. An empty identifier list is the release itself, and
  // it is the *higher* of the two, which is the one place semver inverts the usual
  // "shorter sorts first" intuition.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];

    // A shorter set of identifiers sorts first when everything before it matched.
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      return Number(left) - Number(right);
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left < right ? -1 : 1;
  }

  return 0;
}

/**
 * Is `version` older than `floor`?
 *
 * **False whenever either side does not parse**, which is the whole of D6 in one
 * line. The question is only asked to decide whether to refuse a request or to pull a
 * client forward, and both are things that must not happen on a guess.
 */
export function isOlderThan(
  version: string | null | undefined,
  floor: string | null | undefined
): boolean {
  const parsedVersion = parseVersion(version);
  const parsedFloor = parseVersion(floor);

  if (parsedVersion === null || parsedFloor === null) {
    return false;
  }

  return compareVersions(parsedVersion, parsedFloor) < 0;
}
