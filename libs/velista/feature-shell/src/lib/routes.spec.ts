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

    it('offers the same two over the dashboard, beside its own', () => {
      // Both pages offer both entry actions, so those two copies come from one
      // function and cannot drift apart. `get` is the dashboard's alone (plan 0045):
      // Get shopping list is the primary action of this page and of no other, so it is
      // written here rather than added to `entrySheetRoutes`.
      expect(sheetsOf('home').map((route) => route.path)).toEqual([
        'get',
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
      // `get` carries no `returnTo`: it is offered over the dashboard and nowhere
      // else, so where Cancel goes is not a question it has to be told the answer to.
      expect(sheetsOf('home').map((route) => route.data?.['returnTo'])).toEqual(
        [undefined, 'home', 'home']
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

      it('offers the five sheets over it, as routes rather than flags', () => {
        // Rule E1: each covers the page without losing it, and Android's back button
        // has to dismiss it. Ticking a line off is deliberately not among them.
        expect(routeAt(listPath)?.children?.map((route) => route.path)).toEqual(
          [
            // What a tap opens (velista plan 0043, section 5.1). `/sheet`, because
            // `/detail` is the line page and neither of them is the bare
            // `lines/:lineId` any more.
            'lines/:lineId/sheet',
            'lines/:lineId/edit',
            'lines/:lineId/comments',
            'lines/:lineId/confirm/delete',
            'settings',
          ]
        );
      });

      it('guards none of the sheets, because write access is not knowable', () => {
        // There is no `GET /v1/lists/:id/access` and `ListView` carries no role for the
        // caller, so whether somebody may write is not decidable before a write is
        // attempted (section 5.5). The page decides what to draw; core decides what is
        // allowed, on every request.
        const sheets = routeAt(listPath)?.children ?? [];

        expect(sheets).toHaveLength(5);
        for (const sheet of sheets) {
          expect(sheet.canActivate).toBeUndefined();
        }
      });
    });

    /**
     * The line page (velista plan 0043, section 5.3).
     *
     * Every screen below a line ends in a segment that says which screen it is, and
     * that is what these assert. The bare `lines/:lineId` used to be the page, so the
     * page was the one thing under a line that no URL named, and the sheet over the
     * list carried `/detail` while not being the details of anything. Reading the two
     * back was a coin toss for anybody who had not written them.
     */
    describe('the line page', () => {
      const linePath = 'zones/:zoneId/lists/:listId/lines/:lineId/detail';
      const coveredPath = 'zones/:zoneId/lists/:listId';

      it('answers to /detail, and nothing answers to the bare line', () => {
        const paths = pages.map((route) => route.path);

        expect(paths).toContain(linePath);
        expect(paths).not.toContain(
          'zones/:zoneId/lists/:listId/lines/:lineId'
        );
      });

      it('does not collide with the sheets over the list page', () => {
        // The list page's path is a prefix of this one, so this URL is offered to that
        // branch first. It gets there because no sheet under the list answers to
        // `detail`, which is a fact worth asserting rather than assuming.
        const sheets = routeAt(coveredPath)?.children?.map(
          (route) => route.path
        );

        expect(sheets).not.toContain('lines/:lineId/detail');
        expect(sheets).toContain('lines/:lineId/sheet');
      });

      it('checks both ids with canMatch and demands an account', () => {
        expect(routeAt(linePath)?.canMatch).toHaveLength(2);
        expect(routeAt(linePath)?.canActivate).toHaveLength(1);
      });

      it('confirms a delete over itself rather than over the list', () => {
        // Deleting is the one thing on either screen that discards a history, so it is
        // confirmed from here too, and its URL sits under this page's own.
        expect(routeAt(linePath)?.children?.map((route) => route.path)).toEqual(
          ['confirm/delete']
        );
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
   * Installing the app (plan 0033). The three assertions its section 8 asks for, and
   * the middle one is the deliberate part: this page carries no guard on purpose.
   */
  describe('the install page', () => {
    const install = pages.find((route) => route.path === 'install');

    it('is declared, before the empty front door', () => {
      const paths = pages.map((route) => route.path);

      expect(install).toBeDefined();
      expect(paths.indexOf('install')).toBeLessThan(paths.indexOf(''));
    });

    it('is public, which is the whole point of a link', () => {
      // It can be sent to somebody who has never signed in, and it makes no request.
      // An absent guard reads as an oversight, so it is asserted rather than left to
      // the route table to imply.
      expect(install?.canActivate).toBeUndefined();
      expect(install?.canMatch).toBeUndefined();
    });

    it('is a destination and not a sheet, so it has no children and stays lazy', () => {
      expect(install?.children).toBeUndefined();
      expect(install?.loadComponent).toBeDefined();
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

  describe('the shopping profiles page (plan 0046)', () => {
    const profiles = pages.find((route) => route.path === 'account/profiles');

    it('is a page of its own, not a child of the account screen', () => {
      // `account` renders its sheets into an outlet at the bottom of its own scroll,
      // so a child here would draw a whole page under the account rows rather than
      // instead of them.
      const account = pages.find((route) => route.path === 'account');

      expect(profiles).toBeDefined();
      expect(account?.children?.map((route) => route.path)).not.toContain(
        'profiles'
      );
    });

    it('is declared before `account`, so nothing rests on backtracking', () => {
      const paths = pages.map((route) => route.path);

      expect(paths.indexOf('account/profiles')).toBeLessThan(
        paths.indexOf('account')
      );
      expect(paths.indexOf('account/profiles')).toBeLessThan(paths.indexOf(''));
    });

    it('is authenticated, and guarded by nothing else', () => {
      // A profile is private and resolves from the caller's own token, so there is
      // nothing here to authorize that the gateway does not already.
      expect(profiles?.canActivate).toHaveLength(1);
      expect(profiles?.canMatch).toBeUndefined();
    });

    it('offers the delete confirm as a sheet over it', () => {
      expect(profiles?.children?.map((route) => route.path)).toEqual([
        'confirm/delete',
      ]);
    });

    it('keeps the page and its sheet lazy', () => {
      const added = [profiles, ...(profiles?.children ?? [])];

      expect(added.every((route) => route?.loadComponent !== undefined)).toBe(
        true
      );
    });
  });

  /**
   * The shared basket and its join screen (plan 0044).
   *
   * The assertions worth having here are the two that are easy to break and
   * impossible to see: that the basket page carries **no** authentication guard,
   * and that the join screen sits at the top level rather than under the listing.
   */
  describe('the basket', () => {
    const basketPath = 'shopping-lists/:generatedListId';
    const joinPath = 's/:secret';

    function routeAt(path: string): Route | undefined {
      return pages.find((route) => route.path === path);
    }

    it('declares both, before the empty front door', () => {
      const paths = pages.map((route) => route.path);

      expect(paths).toContain(basketPath);
      expect(paths).toContain(joinPath);
      expect(paths.indexOf(basketPath)).toBeLessThan(paths.indexOf(''));
      expect(paths.indexOf(joinPath)).toBeLessThan(paths.indexOf(''));
    });

    it('lets a guest reach the basket, which is the whole feature', () => {
      // **No `authenticatedGuard`.** What authorizes a guest is their participant
      // session, checked by the server on every request; a guard here would refuse
      // exactly the reader plan 0044 exists for. An absent guard reads as an
      // oversight, so it is asserted rather than left to the table to imply.
      expect(routeAt(basketPath)?.canActivate).toBeUndefined();
    });

    it('declines a non UUID basket segment with canMatch', () => {
      // Rule G1, added before the collision exists: plan 0045 owns
      // `shopping-lists` as a listing, and the first thing anybody adds beside it
      // is a `shopping-lists/new` this route would otherwise swallow.
      expect(routeAt(basketPath)?.canMatch).toHaveLength(1);
    });

    it('keeps the join screen public and full screen', () => {
      // A cold arrival from somebody else's message: no guard, and no parent page
      // to render over, which is why it is not a sheet.
      expect(routeAt(joinPath)?.canActivate).toBeUndefined();
      expect(routeAt(joinPath)?.canMatch).toBeUndefined();
      expect(routeAt(joinPath)?.children).toBeUndefined();
    });

    it('keeps the join screen out from under the listing', () => {
      // `s/:secret` and not `shopping-lists/join/:secret`: a stranger holding this
      // link has no shopping lists, and every segment is another way for a link
      // pasted into a group chat to arrive broken.
      expect(joinPath.startsWith('shopping-lists')).toBe(false);
    });

    it('offers the three sheets over the basket', () => {
      expect(routeAt(basketPath)?.children?.map((route) => route.path)).toEqual(
        ['lines/:lineId/settle', 'people', 'share']
      );
    });

    it('guards none of the sheets, because what a reader may do is not a route', () => {
      // Which of them a caller may **use** is decided by the page from the
      // caller's own facts, and the server refuses the rest regardless of what is
      // drawn. The share sheet is the owner's alone and is not drawn for anybody
      // else, which is a property of the page rather than of the route.
      const sheets = routeAt(basketPath)?.children ?? [];

      expect(sheets).toHaveLength(3);
      for (const entry of sheets) {
        expect(entry.canActivate).toBeUndefined();
      }
    });

    it('provides the store on the page, so two baskets are never open at once', () => {
      expect(routeAt(basketPath)?.providers).toHaveLength(1);
    });

    it('keeps the page, the join screen and every sheet lazy', () => {
      const added = [
        routeAt(basketPath),
        routeAt(joinPath),
        ...(routeAt(basketPath)?.children ?? []),
      ];

      expect(added.every((route) => route?.loadComponent !== undefined)).toBe(
        true
      );
    });
  });

  describe('the assistant', () => {
    const assistant = pages.find((route) => route.path === 'assistant');

    it('is declared, before the empty front door', () => {
      // Plan 0032, section 2. The `''` ordering assertion at the top covers the table
      // as a whole; this one names the route, so removing it is a failure rather than
      // a shorter list that still happens to be ordered.
      const paths = pages.map((route) => route.path);

      expect(assistant).toBeDefined();
      expect(paths.indexOf('assistant')).toBeLessThan(paths.indexOf(''));
    });

    it('is authenticated, and guarded by nothing else', () => {
      // The bot acts as the caller through the gateway with the caller's own token
      // (backend 0039, rule A1), so there is nothing here to authorize that the API
      // does not already.
      expect(assistant?.canActivate).toHaveLength(1);
      expect(assistant?.canMatch).toBeUndefined();
    });

    it('is a destination and not a sheet, so it has no children', () => {
      // A sheet reachable from every page would be a child of every page: rule E1
      // would put one identical entry under each, and they must not drift.
      expect(assistant?.children).toBeUndefined();
      expect(assistant?.canDeactivate).toBeUndefined();
    });

    it('is lazy, and names no provider here', () => {
      // Both providers live on the page component. Naming either in `routes.ts` is an
      // eager import of the `feature-assistant` barrel, which would land the panel in
      // the shell's initial payload; the "keeps every page lazy" assertion above is
      // the one that would catch it, and this states the reason next to the route.
      expect(assistant?.loadComponent).toBeDefined();
      expect(assistant?.providers).toBeUndefined();
    });
  });
});

/**
 * Plan 0011 section 5 gave the panel an exit animation. This is what makes it play on
 * every way out of a sheet rather than only on the three that start inside
 * `SheetShell`, and it is asserted over the whole table rather than route by route
 * because the defect it guards against is a sheet added later that nobody remembers to
 * stamp. Such a sheet looks fine in development, where back is a key and the exit that
 * skipped the animation is the gesture, and is exactly the one somebody reports as
 * "this one does not animate".
 */
describe('the sheets and their exit animation', () => {
  /** Every route in the table, flattened, each with the path it is reached by. */
  function everyRoute(
    routes: readonly Route[],
    prefix = ''
  ): { path: string; route: Route }[] {
    return routes.flatMap((route) => {
      const path = `${prefix}/${route.path ?? ''}`;
      return [{ path, route }, ...everyRoute(route.children ?? [], path)];
    });
  }

  /**
   * A sheet is a route whose component draws itself in a `SheetShell`, which the table
   * cannot be asked directly without loading every lazy chunk. So the paths are named,
   * and `puts the guard on nothing else` is what keeps this list honest in the other
   * direction.
   */
  const SHEET_PATHS = [
    'get',
    'zones/new',
    'zones/join',
    'lists/new',
    'settings',
    'lines/:lineId/edit',
    'lines/:lineId/sheet',
    'lines/:lineId/comments',
    'lines/:lineId/confirm/delete',
    'name',
    'confirm/delete',
    ':membershipId/confirm/remove',
    ':membershipId/confirm/ban',
    ':membershipId/confirm/transfer',
    ':membershipId/confirm/rename',
    // The basket's three (plan 0044). Every one is a child of the basket page, so
    // the list underneath keeps its scroll and back dismisses the sheet.
    'lines/:lineId/settle',
    'people',
    'share',
  ];

  const all = everyRoute(AppShellRoutes);
  const sheets = all.filter(({ route }) =>
    SHEET_PATHS.includes(route.path ?? '')
  );

  it('holds the navigation off every sheet until the panel has fallen', () => {
    const missing = sheets
      .filter(({ route }) => (route.canDeactivate ?? []).length === 0)
      .map(({ path }) => path);

    expect(missing).toEqual([]);
  });

  it('puts the guard on nothing else', () => {
    // A page is not a panel, and delaying a navigation off one would be a stall with
    // nothing on screen to explain it.
    const overreach = all
      .filter(({ route }) => (route.canDeactivate ?? []).length > 0)
      .filter(({ route }) => !SHEET_PATHS.includes(route.path ?? ''))
      .map(({ path }) => path);

    expect(overreach).toEqual([]);
  });
});

/**
 * The basket routes (plans 0044 and 0045).
 *
 * The paths are written out here rather than compared against `BASKET_PATHS`, which the
 * links are built from, and that is forced rather than sloppy: this library **lazy
 * loads** `feature-shopping-lists`, so a static import of it is an eslint error even in
 * a spec, and it would be a real problem rather than a pedantic one, since naming the
 * constant here pulls those pages into the shell's initial payload.
 *
 * So the two are tied by these assertions instead: if somebody renames the constant,
 * the links move and these fail; if somebody renames the route, these fail. Either way
 * a rename cannot land half done, which is what matters, because a route path is the
 * one string that fails at neither compile time nor run time. A `routerLink` to a path
 * that does not exist simply does nothing when tapped, on a phone, in a shop.
 */
describe('the basket routes', () => {
  const paths = pages.map((route) => route.path);

  it('declares the history at the path the links are built from', () => {
    expect(paths).toContain('shopping-lists');
  });

  // Every non empty path comes before the front door, which the table-wide assertion
  // above already covers; this names it, so removing it is a failure rather than a
  // shorter list that still happens to be ordered.
  it('declares it before the front door', () => {
    expect(paths.indexOf('shopping-lists')).toBeLessThan(paths.indexOf(''));
  });

  // A basket is private and the listing resolves from the caller's own token. The
  // **basket** screen is the one that must not carry this guard, since a guest with no
  // account has to reach it by link; that route is `0044`'s.
  it('keeps the history behind the authenticated guard', () => {
    expect(
      pages.find((route) => route.path === 'shopping-lists')?.canActivate
    ).toHaveLength(1);
  });

  it('keeps it lazy, like every other page', () => {
    expect(
      pages.find((route) => route.path === 'shopping-lists')?.loadComponent
    ).toBeDefined();
  });
});
