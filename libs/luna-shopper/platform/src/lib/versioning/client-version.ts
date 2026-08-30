/**
 * Comparing the version of the client that sent a request against the oldest one
 * this deployment is willing to serve (velista plan 0034).
 *
 * **This duplicates `libs/velista/models/src/lib/app-version.ts`, and the
 * duplication is forced rather than chosen**, for the same reason `ProblemDetails`
 * is copied into the frontend: this library pulls NestJS, pino and `node:crypto`,
 * so none of it is ever safe in a browser bundle. The two copies must agree, so
 * `client-version.spec.ts` and `app-version.spec.ts` assert the same table of
 * cases. Change one and change the other.
 *
 * The alternative was adding the `semver` package, which is a dependency and a
 * supply chain entry for forty lines of arithmetic that is fully specified and
 * never changes.
 *
 * {@link enableApiVersioning} is a different thing entirely and the two are worth
 * keeping apart in the reader's head: URI versioning decides which *route* a
 * request reaches, and this decides whether the *client* that sent it is still
 * supported. The first protects the shape of a request, the second retires the
 * caller. Neither substitutes for the other.
 */

/** The header a client states its build version in. */
export const CLIENT_VERSION_HEADER = 'x-client-version';

/** The header this deployment advertises its oldest supported client in. */
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
 * build calls itself `staging` and a local one `0.0.0-dev`; the first does not
 * parse, and the rule is that a version nobody can order is never ordered. That is
 * what keeps a mistyped `MIN_CLIENT_VERSION` from refusing a fleet it was never
 * aimed at.
 *
 * A leading `v` is accepted because release tags carry one and the version they name
 * does not.
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
 * identifier with numeric ones compared as numbers. Build metadata is ignored, as
 * the specification requires.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) {
    return core;
  }

  // 1.0.0-rc.1 precedes 1.0.0. An empty identifier list is the release itself and
  // is the higher of the two, which is the one place semver inverts the usual
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
 * line. This decides whether a request is refused, so it must never be decided on a
 * guess: an unrecognisable client version, or an unrecognisable floor, means no.
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

/** Is this a version this deployment could meaningfully compare against? */
export function isComparableVersion(value: string | null | undefined): boolean {
  return parseVersion(value) !== null;
}
