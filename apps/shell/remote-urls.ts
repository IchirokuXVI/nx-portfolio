/**
 * How the shell decides where each remote lives, shared by both of its webpack
 * configs so the two cannot disagree.
 *
 * Module federation resolves remotes at **build** time, so the shell bundle carries
 * these URLs and the shell image is environment specific. Everything here therefore
 * runs in CI, never in a browser.
 *
 * ## Why this file exists
 *
 * `webpack.config.ts` read `MFE_REMOTE_URLS` and `webpack.prod.config.ts` did not: the
 * production config derived every remote from `MFE_BASE_URL` alone, hardcoding
 * `${base}/<name>` for all four. That was fine while every remote lived on one
 * micro-frontend host, and stopped being fine when velista moved to its own origin
 * (plan 0013, section 5.3), which is a URL no base can produce.
 *
 * Both configs now go through the same two functions, so a remote that leaves the
 * shared host is a CI environment variable rather than a second hardcoded hostname.
 */

/**
 * Every remote the shell mounts, in the order `module-federation.config.ts` lists
 * them. Written once so adding a remote does not mean remembering a second list.
 */
export const REMOTE_NAMES = [
  'odontogram',
  'damoclesSword',
  'landingV2',
  'velista',
] as const;

/**
 * Parse `MFE_REMOTE_URLS` — a comma separated list of `name=url` pairs, e.g.
 * `"velista=https://velista.app,landingV2=http://localhost:8081"` — into a
 * `{ name: url }` map. Returns undefined when unset or empty, so a caller can tell
 * "no override" from "override to nothing".
 *
 * Each pair splits on its **first** `=`, so a URL may itself contain one.
 */
export function parseRemoteUrls(
  raw: string | undefined
): Record<string, string> | undefined {
  if (!raw) return undefined;

  const map: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;

    const name = pair.slice(0, eq).trim();
    const url = pair.slice(eq + 1).trim();
    if (name && url) map[name] = url;
  }

  return Object.keys(map).length ? map : undefined;
}

/**
 * Every remote loaded from one micro-frontend host, `${base}/<name>`. This is what
 * production and staging looked like before any remote had an origin of its own, and
 * it is still how the other three are addressed.
 */
export function remotesFromBase(base: string): [string, string][] {
  return REMOTE_NAMES.map((name) => [name, `${base}/${name}`]);
}

/**
 * Apply the per-remote overrides over whatever the base produced.
 *
 * The precedence is `MFE_REMOTE_URLS` first, then the base, which is the order the
 * dev config has always used: a name absent from the map keeps the tuple it already
 * had. That is what lets CI move one remote to its own host without restating the
 * other three.
 */
export function withRemoteUrlOverrides<T extends string | [string, string]>(
  remotes: T[],
  overrides: Record<string, string> | undefined
): (T | [string, string])[] {
  if (!overrides) return remotes;

  return remotes.map((remote) => {
    const name = typeof remote === 'string' ? remote : remote[0];
    return overrides[name]
      ? ([name, overrides[name]] as [string, string])
      : remote;
  });
}
