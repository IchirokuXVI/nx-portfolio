import type { Route } from '@angular/router';
import { AppShellRoutes } from './routes';

/**
 * Everything below the app's layout route, which is where the pages live.
 *
 * Two levels down rather than one since plan 0003: the top route carries the locale
 * guard and is componentless, and `:locale` below it carries `AppLayout` and the
 * pages. Reached by path rather than by index so the sibling `**` that keeps the
 * guard reachable cannot be mistaken for the layout.
 */
const localeRoute: Route | undefined = AppShellRoutes[0]?.children?.find(
  (route) => route.path === ':locale'
);

const pages: readonly Route[] = localeRoute?.children ?? [];

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
      expect(
        sheetsOf('').every((route) => route.canActivate === undefined)
      ).toBe(true);
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
      expect(sheetsOf('home').map((route) => route.data?.['returnTo'])).toEqual(
        ['home', 'home']
      );
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

  describe('the credential flows', () => {
    const AUTH_PATHS = [
      'auth/login',
      'auth/register',
      'auth/upgrade',
      'auth/verify',
      'auth/callback',
    ];

    it('declares all five, before the front door', () => {
      // The `''` ordering assertion above covers this for the table as a whole. This
      // one names the five, so removing one is a failure rather than a shorter list
      // that still happens to be ordered.
      const paths = pages.map((route) => route.path);

      for (const path of AUTH_PATHS) {
        expect(paths).toContain(path);
        expect(paths.indexOf(path)).toBeLessThan(paths.indexOf(''));
      }
    });

    it('guards register and sign in against anybody who is signed in', () => {
      // Rule C2 at the route: a guest filling in the register form would silently
      // strand every group they have.
      expect(
        pages.find((r) => r.path === 'auth/login')?.canActivate
      ).toHaveLength(1);
      expect(
        pages.find((r) => r.path === 'auth/register')?.canActivate
      ).toHaveLength(1);
    });

    it('guards upgrade, and guards it differently', () => {
      // Rule C1. The two guards are not the same function, which is the whole point:
      // whichever of the two screens a guest reaches, they end up on upgrade.
      const register = pages.find((r) => r.path === 'auth/register');
      const upgrade = pages.find((r) => r.path === 'auth/upgrade');

      expect(upgrade?.canActivate).toHaveLength(1);
      expect(upgrade?.canActivate?.[0]).not.toBe(register?.canActivate?.[0]);
    });

    it('leaves the two public ones public', () => {
      // A confirmation link is opened wherever the mail app happens to be, which is
      // often a phone that has never signed in, and the OAuth callback lands before
      // there is a session at all.
      expect(
        pages.find((r) => r.path === 'auth/verify')?.canActivate
      ).toBeUndefined();
      expect(
        pages.find((r) => r.path === 'auth/callback')?.canActivate
      ).toBeUndefined();
    });

    it('gives none of them children, because none of them is a sheet', () => {
      for (const path of AUTH_PATHS) {
        expect(
          pages.find((route) => route.path === path)?.children
        ).toBeUndefined();
      }
    });

    it('keeps them lazy', () => {
      for (const path of AUTH_PATHS) {
        expect(
          pages.find((route) => route.path === path)?.loadComponent
        ).toBeDefined();
      }
    });
  });

  describe('the ways in, still', () => {
    it('keeps every page lazy after plan 0009 added five', () => {
      // The shell's initial payload carries the layout and the locale guard, and a
      // visitor downloads the one screen they are shown.
      const everyRoute = [...pages, ...sheetsOf(''), ...sheetsOf('home')];

      expect(
        everyRoute.every((route) => route.loadComponent !== undefined)
      ).toBe(true);
    });
  });

  /**
   * Plan 0010, rule G1, and the ordering trap it exists to defuse.
   *
   * `zones/new` and `zones/join` are children of `''` and of `home`, and `''` is
   * declared last. A `zones/:zoneId` added in the obvious place is therefore offered
   * `/zones/new` first, matches it with `zoneId` set to the string `new`, and makes
   * the create sheet unreachable. Reordering cannot fix it, so the parameterised route
   * declines a non-UUID instead.
   */
  describe('the group page', () => {
    const groupPath = 'zones/:zoneId';
    const membersPath = 'zones/:zoneId/members';

    function routeAt(path: string): Route | undefined {
      return pages.find((route) => route.path === path);
    }

    it('declares both group routes, before the empty front door', () => {
      const paths = pages.map((route) => route.path);

      expect(paths).toContain(groupPath);
      expect(paths).toContain(membersPath);
      expect(paths.indexOf(groupPath)).toBeLessThan(paths.indexOf(''));
      expect(paths.indexOf(membersPath)).toBeLessThan(paths.indexOf(''));
    });

    it('puts the more specific members route before the general one', () => {
      // Habit rather than necessity: a route with children absent and segments left
      // over does not match anyway. It is the ordering that stays correct when
      // somebody later gives the group page more children.
      const paths = pages.map((route) => route.path);

      expect(paths.indexOf(membersPath)).toBeLessThan(paths.indexOf(groupPath));
    });

    it('guards both with canMatch, not canActivate', () => {
      // The distinction is the whole mechanism: a false `canActivate` aborts the
      // navigation, while a false `canMatch` carries on to the next route.
      expect(routeAt(groupPath)?.canMatch).toHaveLength(1);
      expect(routeAt(membersPath)?.canMatch).toHaveLength(1);
    });

    it('still leaves /zones/new to the front door', () => {
      // The half of rule G1 that `0008` predicted by name. The sheets stay children
      // of the pages they cover, and `''` stays last; the guard is what lets both.
      expect(sheetsOf('').map((route) => route.path)).toContain('zones/new');
    });

    it('offers the new list sheet and the settings sheet over the group', () => {
      expect(routeAt(groupPath)?.children?.map((route) => route.path)).toEqual([
        'lists/new',
        'settings',
      ]);
    });

    it('guards the new list sheet as a member and settings as staff', () => {
      // Any approved member may start a list (section 5.5), so demanding staff there
      // would hide a control that works.
      const children = routeAt(groupPath)?.children ?? [];

      expect(children[0]?.canActivate).toHaveLength(1);
      expect(children[1]?.canActivate).toHaveLength(1);
      expect(children[0]?.canActivate?.[0]).not.toBe(
        children[1]?.canActivate?.[0]
      );
    });

    /**
     * Rule L1 (plan 0012, section 4.1), which is rule G1 one level deeper.
     *
     * `lists/new` is already a child of `zones/:zoneId`, so `zones/:zoneId/lists/:listId`
     * declared beside it is offered `/lists/new` first and matches it with `listId` set
     * to the string `new`. Same trap, same fix, same reason for `canMatch`.
     */
    describe('the list page', () => {
      const listPath = 'zones/:zoneId/lists/:listId';

      it('is declared before the group page it is a prefix of', () => {
        // `zones/:zoneId` would otherwise match `/zones/<uuid>/lists/<uuid>` with two
        // segments left over, and this route would never be reached.
        const paths = pages.map((route) => route.path);

        expect(paths).toContain(listPath);
        expect(paths.indexOf(listPath)).toBeLessThan(paths.indexOf(groupPath));
        expect(paths.indexOf(listPath)).toBeLessThan(paths.indexOf(''));
      });

      it('declines a non UUID list segment with canMatch', () => {
        // Two guards, one per id. `canMatch` and not `canActivate`, because a declined
        // match has to carry on to the next route rather than abort the navigation.
        expect(routeAt(listPath)?.canMatch).toHaveLength(2);
        expect(routeAt(listPath)?.canActivate).toHaveLength(1);
      });

      it('still leaves /zones/<uuid>/lists/new to the create sheet', () => {
        expect(
          routeAt(groupPath)?.children?.map((route) => route.path)
        ).toContain('lists/new');
      });

      it('offers the four sheets over it, as routes rather than flags', () => {
        // Rule E1: each covers the page without losing it, and Android's back button
        // has to dismiss it. Ticking a line off is deliberately not among them.
        expect(routeAt(listPath)?.children?.map((route) => route.path)).toEqual([
          'lines/:lineId/edit',
          'lines/:lineId/comments',
          'lines/:lineId/confirm/delete',
          'settings',
        ]);
      });

      it('guards none of the sheets, because write access is not knowable', () => {
        // There is no `GET /v1/lists/:id/access` and `ListView` carries no role for the
        // caller, so whether somebody may write is not decidable before a write is
        // attempted (section 5.5). The page decides what to draw; core decides what is
        // allowed, on every request.
        const sheets = routeAt(listPath)?.children ?? [];

        expect(sheets).toHaveLength(4);
        for (const sheet of sheets) {
          expect(sheet.canActivate).toBeUndefined();
        }
      });
    });

    it('declares one confirm route per member action, with the action in data', () => {
      // One component and four entries, so `data` is something this spec can assert
      // about; an action parsed out of the URL inside the component would not be.
      const confirms = routeAt(membersPath)?.children ?? [];

      expect(confirms.map((route) => route.data?.['action'])).toEqual([
        'remove',
        'ban',
        'transfer',
        'rename',
      ]);
      expect(confirms.map((route) => route.path)).toEqual([
        ':membershipId/confirm/remove',
        ':membershipId/confirm/ban',
        ':membershipId/confirm/transfer',
        ':membershipId/confirm/rename',
      ]);
    });

    it('guards renaming as a member and the other three as staff', () => {
      // Renaming is the one an ordinary member may reach, on their own row.
      const confirms = routeAt(membersPath)?.children ?? [];
      const guards = confirms.map((route) => route.canActivate?.[0]);

      expect(guards[0]).toBe(guards[1]);
      expect(guards[1]).toBe(guards[2]);
      expect(guards[3]).not.toBe(guards[0]);
    });

    it('keeps every one of them lazy', () => {
      const added = [
        routeAt(groupPath),
        routeAt(membersPath),
        ...(routeAt(groupPath)?.children ?? []),
        ...(routeAt(membersPath)?.children ?? []),
      ];

      expect(added.every((route) => route?.loadComponent !== undefined)).toBe(
        true
      );
    });
  });

  /**
   * The account (plan 0015). A route rather than a sheet, by the same test `0009`
   * section 4.1 used: it is deep linkable, it has its own scroll, and it is where
   * somebody goes deliberately.
   */
  describe('the account', () => {
    const account = pages.find((route) => route.path === 'account');

    it('is declared, before the empty front door', () => {
      const paths = pages.map((route) => route.path);

      expect(account).toBeDefined();
      expect(paths.indexOf('account')).toBeLessThan(paths.indexOf(''));
    });

    it('is authenticated, and guarded by nothing else', () => {
      // There is deliberately no guest variant: the guest sees a **different screen**
      // and not a different route, which is a property of `SessionStore.isGuest` that
      // the page reads. Splitting it would give two URLs for one thing somebody
      // reaches by pressing one button (section 4.1).
      expect(account?.canActivate).toHaveLength(1);
      expect(account?.canMatch).toBeUndefined();
    });

    it('offers the rename and the delete confirm as sheets over it', () => {
      // Rule E1: children, so the screen underneath keeps its scroll and Android's
      // back button dismisses them.
      expect(account?.children?.map((route) => route.path)).toEqual([
        'name',
        'confirm/delete',
      ]);
    });

    it('guards neither sheet beyond the page they sit on', () => {
      // Both are about the caller's own account, which `authenticatedGuard` above has
      // already established they have.
      expect(
        account?.children?.every((route) => route.canActivate === undefined)
      ).toBe(true);
    });

    it('keeps the page and both sheets lazy', () => {
      const added = [account, ...(account?.children ?? [])];

      expect(added.every((route) => route?.loadComponent !== undefined)).toBe(
        true
      );
    });
  });
});
