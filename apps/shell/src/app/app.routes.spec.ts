import { appRoutes } from './app.routes';

/**
 * The shell's table is almost entirely ordering, and the ordering is load bearing in
 * a way nothing else enforces (plan 0003).
 *
 * At the site root `/en` means landingV2 in English and `/velista` means velista with
 * no locale yet, and both are a single segment directly under `/`. The shell resolves
 * that by trying app mounts first and falling through to the empty path app, which
 * works only while the entries are in that order. `isLocaleSegment` cannot be used to
 * tell the two apart and must not be reached for: a two letter app mount would be
 * indistinguishable from a locale, and the ordering rule stays correct however the
 * mounts happen to be spelled.
 */
describe('the shell route table', () => {
  const paths = appRoutes.map((route) => route.path);

  it('puts the empty path app last, below every mounted app', () => {
    // An empty path route with `loadChildren` is not terminal: it consumes no
    // segments and then offers the whole path to its own table. Above the mounts it
    // would swallow `/odontogram` and render landingV2's not found page instead.
    expect(paths.indexOf('')).toBe(paths.length - 1);
  });

  it('has exactly one empty path entry', () => {
    expect(paths.filter((path) => path === '')).toHaveLength(1);
  });

  it('gives the empty path app no guard of its own', () => {
    // landingV2 owns its locale now. A guard here would settle it twice, from two
    // places that could disagree.
    const root = appRoutes[appRoutes.length - 1];

    expect(root.canActivate).toBeUndefined();
  });
});
