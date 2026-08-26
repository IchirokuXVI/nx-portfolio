import type { Route } from '@angular/router';
import { AppShellRoutes } from './routes';

/** Everything below the app's layout route, which is where the pages live. */
const pages: readonly Route[] = AppShellRoutes[0]?.children ?? [];

/** A page's own children, which today means the two sheets it offers. */
function sheetsOf(path: string): readonly Route[] {
  return pages.find((route) => route.path === path)?.children ?? [];
}

describe('AppShellRoutes', () => {
  /**
   * Plan 0008, section 4.1.1, and an acceptance criterion in its own right.
   *
   * The front door's path is `''`, so it consumes no segments and then offers its own
   * children whatever is left. Declared before its siblings it would swallow `home`
   * and `join/:code`, which is the trap `0001` section 6.1 documents in the shell.
   *
   * One assertion about the order rather than a test per route: it cannot be satisfied
   * by accident, it costs nothing as the table grows, and it fails the moment somebody
   * appends `zones/:zoneId` in the obvious place, which is exactly the mistake it
   * exists to catch.
   */
  it('declares every non empty path before the empty one', () => {
    const paths = pages.map((route) => route.path);
    const emptyAt = paths.indexOf('');

    expect(emptyAt).toBeGreaterThanOrEqual(0);
    expect(paths.slice(emptyAt + 1)).toEqual([]);
  });

  it('has exactly one empty path among the pages', () => {
    // Two would mean the second is unreachable, which is a silent failure rather
    // than a loud one.
    expect(pages.filter((route) => route.path === '')).toHaveLength(1);
  });

  describe('the ways in', () => {
    it('offers both sheets over the front door, publicly', () => {
      const front = pages.find((route) => route.path === '');

      expect(sheetsOf('').map((route) => route.path)).toEqual([
        'zones/new',
        'zones/join',
      ]);
      // The front door's own guard is `anonymousOnlyGuard`; neither sheet adds one,
      // because a person with no account is exactly who these two are for.
      expect(front?.canActivate).toHaveLength(1);
      expect(sheetsOf('').every((route) => route.canActivate === undefined))
        .toBe(true);
    });

    it('offers the same two over the dashboard', () => {
      // Both pages offer both actions, so the two copies come from one function and
      // cannot drift apart.
      expect(sheetsOf('home').map((route) => route.path)).toEqual([
        'zones/new',
        'zones/join',
      ]);
    });

    it('tells each sheet which page it is covering', () => {
      // Which is how Cancel knows where to go back to, without doing string surgery
      // on a URL, and correctly for a deep link with no history behind it.
      expect(sheetsOf('').map((route) => route.data?.['returnTo'])).toEqual([
        'landing',
        'landing',
      ]);
      expect(sheetsOf('home').map((route) => route.data?.['returnTo'])).toEqual([
        'home',
        'home',
      ]);
    });

    it('keeps the shared link page public and full screen', () => {
      // A cold arrival from somebody else's message: no guard, and no parent page to
      // render over, which is why it is not a sheet (section 4.1).
      const link = pages.find((route) => route.path === 'join/:code');

      expect(link).toBeDefined();
      expect(link?.canActivate).toBeUndefined();
      expect(link?.children).toBeUndefined();
    });

    it('keeps every page lazy, sheets included', () => {
      // The shell's initial payload carries the layout and the locale guard, and a
      // visitor downloads the one screen they are shown.
      const everyRoute = [...pages, ...sheetsOf(''), ...sheetsOf('home')];

      expect(
        everyRoute.every((route) => route.loadComponent !== undefined)
      ).toBe(true);
    });
  });
});
