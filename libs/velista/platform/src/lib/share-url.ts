/**
 * An absolute URL to hand somebody else, and it carries **no locale**.
 *
 * The counterpart of {@link appPath}, which is the URL to navigate *this* session to
 * and therefore states the language this session is in. A shared link is the other
 * case: it is read by somebody whose language this app has no way to know, so the
 * locale slot is left empty and `localeGuard` fills it with the **recipient's** on
 * arrival (plan 0005, its "insert a missing one" case). Baking the sender's in opens
 * the app in the wrong language for exactly the one reader the link exists for.
 *
 * The first segment therefore has to be one the guard will not mistake for a locale.
 * `isLocaleSegment` matches two letters and an optional region, so `s` and `join` are
 * both safe, and a future two letter segment would not be: the guard would consume it
 * as an unsupported locale rather than insert one in front of it.
 *
 * It lives here rather than beside either of the screens that share, because both of
 * them do: `feature-shopping-lists` shares a shopping trip and `feature-home` and
 * `feature-zones` share a group. Importing one feature library from another would
 * couple two siblings and pull the first one's barrel into the second one's lazy
 * chunk, which is the same reasoning `appPath` already records.
 *
 * A link that genuinely needs a locale is a different function, not an argument here.
 * There is none today.
 *
 * @param origin where velista is served from, with or without a trailing slash: its
 *   own domain in the standalone build, the portfolio's under the shell.
 * @param basePath the mount, `''` standalone and `/velista` under the shell.
 */
export function shareUrl(
  origin: string,
  basePath: string,
  ...segments: readonly string[]
): string {
  const base = `${origin.replace(/\/$/, '')}${basePath}`;
  const path = segments.map((segment) => encodeURIComponent(segment));

  return [base, ...path].join('/');
}
