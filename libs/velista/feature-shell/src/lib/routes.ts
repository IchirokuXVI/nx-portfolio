import { inject } from '@angular/core';
import { type Route } from '@angular/router';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { APP_DEFAULT_LOCALE, APP_KEY, AppLayout } from '@portfolio/velista/ui';
import {
  anonymousOnlyGuard,
  authenticatedGuard,
  guestOnlyGuard,
} from './auth-guards';
import { APP_USABLE_LOCALES } from './usable-locales';
import {
  listIdGuard,
  zoneIdGuard,
  zoneMemberGuard,
  zoneStaffGuard,
} from './zone-guards';

/**
 * This app's route table. The shell lazy-loads it through `velista/Routes`.
 *
 * Every page renders inside `AppLayout`, the parent route that owns the app's own
 * chrome and its theme token scope (plan 0001, the extraction contract, items 1
 * and 4). `localeGuard` owns the locale segment below this app's mount: it settles a
 * supported, canonical locale before anything here renders, inserting one when the URL
 * carries none and replacing one this app does not support (plan 0005 D6).
 *
 * The route table from plan 0001, section 6.2, is filled in as each page plan
 * lands — `zones/:zoneId`, `lists/:listId`, `auth/*`, `account`, `settings` are
 * what is left. Paths keep the word `zones` even though the interface says group
 * (rule N2): the translation layer renames the word, the code never does.
 *
 * The export is named for its role, not for the product, so a rename stays a data
 * edit (rule N1); the `@portfolio/velista/feature-shell` path already scopes it.
 */
/**
 * The two sheets, as children of whichever page they cover (plan 0008, rule E1).
 *
 * They are routes rather than a signal toggling a template branch, and the reason
 * that decides it is the Android back button: nothing was pushed onto the history
 * stack by a signal, so back would close the **app** rather than the sheet. As routes
 * the page beneath stays mounted and keeps its scroll, and the strings `LandingPage`
 * and `HomePage` were recording in `pendingRoutes` become one `routerLink` each.
 *
 * Both pages offer both actions, so this is one function called twice rather than four
 * entries written out: the two copies must not be able to drift, and the only thing
 * that differs between them is where Cancel goes back to.
 *
 * `zones` and not the word the interface uses, per rule N2 (plan 0001).
 */
function entrySheetRoutes(returnTo: 'landing' | 'home'): Route[] {
  return [
    {
      path: 'zones/new',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then(
          (m) => m.CreateGroupSheet
        ),
    },
    {
      path: 'zones/join',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then((m) => m.JoinCodeSheet),
    },
  ];
}

/**
 * The four confirm sheets over a member's row (plan 0010, section 4.2).
 *
 * One component and four entries rather than four components: everything except the
 * copy and the request is identical. And four entries rather than one that reads the
 * action out of the URL, because a route's `data` is something `routes.spec.ts` can
 * assert about, while a segment parsed inside a component is not.
 *
 * All four are children of the members screen, so the sheet covers the row it is about
 * and the back button dismisses it (rule E1, plan 0008).
 */
function memberActionRoutes(): Route[] {
  return (['remove', 'ban', 'transfer', 'rename'] as const).map((action) => ({
    path: `:membershipId/confirm/${action}`,
    data: { action },
    // Renaming is the one an ordinary member may reach, on their own row, so it is
    // guarded as a member rather than as staff (section 5.4). The other three are
    // staff only, and core refuses everybody else regardless of what is drawn.
    canActivate: [action === 'rename' ? zoneMemberGuard : zoneStaffGuard],
    loadComponent: () =>
      import('@portfolio/velista/feature-zones').then(
        (m) => m.MemberActionSheet
      ),
  }));
}

/**
 * The four sheets over the list page (plan 0012, section 4.2).
 *
 * Every one is a route and not a template flag, which is rule E1 from `0008`
 * unchanged: each covers the page without losing it, and Android's back button has to
 * dismiss it.
 *
 * Ticking a line off is deliberately not among them and never will be. It is one tap,
 * it is reversible by the same tap, and it is the thing the screen is for.
 *
 * No guards here. Which of these a caller may **use** is decided by the page from the
 * caller's own facts, and it cannot be decided by a guard at all: there is no
 * `GET /v1/lists/:id/access` and `ListView` carries no role for the caller, so whether
 * somebody may write to a list is not knowable before a write is attempted
 * (section 5.5). Core re-resolves the permission on every request regardless, so a
 * guard passing has never meant a write will be allowed.
 */
function listSheetRoutes(): Route[] {
  return [
    {
      path: 'lines/:lineId/edit',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then((m) => m.EditLineSheet),
    },
    {
      // Approved member, readers included: `comment.add` requires only
      // `requireApproved` on the zone, not write access on the list.
      path: 'lines/:lineId/comments',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then((m) => m.CommentsSheet),
    },
    {
      path: 'lines/:lineId/confirm/delete',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then(
          (m) => m.DeleteLineSheet
        ),
    },
    {
      // Rename, share and delete. All three are `requireManage`, which is a different
      // rule from the write access that gates lines: the list's creator, a zone admin,
      // or the owner. The sheet itself decides what to draw from `myRole`.
      path: 'settings',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then(
          (m) => m.ListSettingsSheet
        ),
    },
  ];
}

export const AppShellRoutes: Route[] = [
  {
    /**
     * The app's mount, and the guard that settles its locale (plan 0003).
     *
     * `AppLayout` moves down to the `:locale` child so the chrome renders *after*
     * the language it displays has been decided. This route is componentless and
     * exists to carry the guard, the title and the readiness resolve, which are
     * decided once for the app rather than repeated by every page ever added.
     */
    path: '',
    // The app's translations are **not** installed here any more. They moved up to
    // `app-providers.ts`, because `gatewayInterceptor` injects `RokuTranslatorService`
    // for its `Accept-Language` header and a functional interceptor resolves from the
    // injector that declares `provideHttpClient`. That injector is the app's, one
    // level above this route, and a route's providers are invisible looking up, so
    // every gateway request threw `NG0201`. The full account is on the provider itself.
    //
    // What plan 0006 section 3 was protecting still holds: the providers sit above
    // every page, and the mounted app and the standalone bootstrap get them the same
    // way, since both enter through `app-providers.ts`. Only the injector changed, and
    // it moved in the direction that has more above it rather than less.
    canActivate: [localeGuard],
    // No page of this app is created until its strings have arrived (plan 0006,
    // section 4). On the parent, so it is decided once for the app rather than
    // repeated by every page ever added, and after the locale guard: Angular runs a
    // route's `canActivate` to completion before its `resolve`, so the locale is
    // already settled and this can only ever wait for the language it will render.
    //
    // The observable is handed to the router as it is, with no `firstValueFrom` and no
    // timeout, and both omissions are the contract rather than an oversight. `loaded$`
    // emits **exactly one** value and then completes, in the failure case as well as
    // the success case (rokutranslator 0004, Problem 3), so the router's own `take(1)`
    // is all the unwrapping it needs and a rejected loader still activates the route,
    // at worst with keys for the namespace that failed. A timeout would trade that
    // determinism for a build that renders text on a fast machine and keys on a slow
    // one, with nothing in the source saying which. Being a `ReplaySubject(1)`, every
    // navigation after the first resolves from the buffer and costs nothing.
    // This app's own title, from this app's own translator (plan 0005 D10). The
    // shell used to set it through a `titleNs` in its route data naming velista's
    // namespace; with a translator per app the shell has none to look it up in.
    title: localizedTitle('app-title'),
    resolve: { translationsReady: () => inject(RokuTranslatorService).loaded$ },
    data: {
      appKey: APP_KEY,
      supportedLocales: APP_USABLE_LOCALES,
      defaultLocale: APP_DEFAULT_LOCALE,
    },
    // **Every route with a non empty path comes before the `''` front door**, and a
    // spec fails the moment that stops being true (plan 0008, section 4.1.1).
    //
    // Giving the front door children turned it from a terminal route into a prefix.
    // Its path is `''`, so it consumes no segments and then offers `zones/new` to
    // whatever is left, which is the same shape `0001` section 6.1 documents in the
    // shell: an empty path route swallows the segments meant for its siblings. The
    // order makes the question moot, and it is cheaper to assert once than to test
    // every route against every other. `zones/:zoneId`, when it lands, would be
    // shadowed by `zones/new` if it were ever appended after this.
    children: [
      {
        /**
         * The locale, which this app now owns rather than inheriting from a
         * `:locale` route the shell kept on everybody's behalf.
         *
         * `AppLayout` hangs here rather than on the parent so the chrome is created
         * below the guard, in the language the guard just settled.
         */
        path: ':locale',
        component: AppLayout,
        children: [
          {
            // The dashboard (plan 0003). Its guard also carries what `selectHomeState`'s
            // anonymous branch used to, and earlier: nothing here is constructed, and no
            // request is fired, on behalf of somebody who is not signed in.
            //
            // Both routes stay lazy, so the shell's initial payload carries the layout and
            // the locale guard but neither page, and a visitor downloads the one screen
            // they are actually shown. That was the split's whole point and it only starts
            // paying once there are two of them, which there now are.
            path: 'home',
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-home').then((m) => m.HomePage),
            children: [...entrySheetRoutes('home')],
          },
          // The credential flows (plan 0009). Routes and not sheets, because none of them
          // completes one field in place over a page that keeps its context: each has two
          // fields, its own alternative path at the bottom, and in two cases a Google
          // button, so each is a destination (section 4.1).
          //
          // The guards are rule C1, and between them they are the whole of rule C2: a
          // guest is barred from `register`, where a valid form would silently strand
          // every group they have, and steered to `upgrade`, which is the only path that
          // keeps them. Which person may see which screen is a property of the route,
          // where it is tested, rather than a branch in a template.
          {
            path: 'auth/login',
            canActivate: [anonymousOnlyGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-auth').then(
                (m) => m.SignInPage
              ),
          },
          {
            path: 'auth/register',
            canActivate: [anonymousOnlyGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-auth').then(
                (m) => m.RegisterPage
              ),
          },
          {
            path: 'auth/upgrade',
            canActivate: [guestOnlyGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-auth').then(
                (m) => m.UpgradePage
              ),
          },
          {
            // Public, and it has to be: a confirmation link is opened wherever the mail
            // app happens to be, which is often a phone that has never signed in.
            path: 'auth/verify',
            loadComponent: () =>
              import('@portfolio/velista/feature-auth').then(
                (m) => m.VerifyEmailPage
              ),
          },
          {
            // Public, and inert until the gateway redirects here with the pair in the URL
            // fragment instead of answering JSON (section 5.6).
            path: 'auth/callback',
            loadComponent: () =>
              import('@portfolio/velista/feature-auth').then(
                (m) => m.AuthCallbackPage
              ),
          },
          // The group and its people (plan 0010). Both carry `zoneIdGuard`, which is
          // **rule G1**: a `canMatch` that declines any segment that is not a UUID, so
          // `/zones/new` falls through to the front door's create sheet instead of being
          // swallowed by `:zoneId`. See `zone-guards.ts` for why reordering cannot do it.
          //
          // `members` is declared before `zones/:zoneId` out of habit rather than
          // necessity: a route whose children are absent and whose segments are left over
          // does not match anyway, but the specific before the general is the ordering
          // that stays correct when somebody later gives the group page more children.
          // The list, and the four sheets over it (plan 0012). A **sibling** of
          // `zones/:zoneId` rather than a child of it, because it is its own
          // destination: a child would render inside the group page's outlet, over the
          // group page, which is what a sheet does and this is not.
          //
          // Declared before `zones/:zoneId` for the reason `members` is, and here it is
          // necessity rather than habit: `zones/:zoneId` is a prefix of this path and
          // would match `/zones/<uuid>/lists/<uuid>` with two segments left over.
          //
          // Two `canMatch` guards, each stating one thing. `zoneIdGuard` checks the
          // zone segment and `listIdGuard` is **rule L1**: it declines any list segment
          // that is not a UUID, so `/zones/<uuid>/lists/new` falls through to the group
          // page's own `lists/new` child instead of being swallowed by `:listId`.
          {
            path: 'zones/:zoneId/lists/:listId',
            canMatch: [zoneIdGuard, listIdGuard],
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-lists').then(
                (m) => m.ListPage
              ),
            children: [...listSheetRoutes()],
          },
          {
            path: 'zones/:zoneId/members',
            canMatch: [zoneIdGuard],
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-zones').then(
                (m) => m.MembersPage
              ),
            children: [...memberActionRoutes()],
          },
          {
            path: 'zones/:zoneId',
            canMatch: [zoneIdGuard],
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-zones').then(
                (m) => m.GroupPage
              ),
            children: [
              {
                // Any approved member may start a list, which is why this is the member
                // guard and not the staff one (section 5.5).
                path: 'lists/new',
                canActivate: [zoneMemberGuard],
                loadComponent: () =>
                  import('@portfolio/velista/feature-zones').then(
                    (m) => m.CreateListSheet
                  ),
              },
              {
                // Rename, regenerate the code, delete. Staff, and delete is owner only,
                // which the sheet itself decides from `myRole` (rule G2).
                path: 'settings',
                canActivate: [zoneStaffGuard],
                loadComponent: () =>
                  import('@portfolio/velista/feature-zones').then(
                    (m) => m.GroupSettingsSheet
                  ),
              },
            ],
          },
          {
            // A cold arrival on somebody else's invite link, and the one way in that is
            // not a sheet: there is no page underneath to cover (plan 0008, section 4.1).
            // Public, because the whole point is that the recipient has no account.
            path: 'join/:code',
            loadComponent: () =>
              import('@portfolio/velista/feature-entry').then(
                (m) => m.JoinLinkPage
              ),
          },
          {
            // The front door (plans 0003 and 0007). A designed screen for somebody with
            // no account, not a signed-out fallback, which is why it sits at the mount:
            // that is the URL a home screen shortcut is installed against.
            //
            // Guarded rather than adaptive. `0003` rendered both screens from one
            // component and let a `@switch` decide, which made "a signed in user never
            // sees the front door" a fact about a template instead of a property of the
            // route. As a redirect it is checkable, and the signed in user still reaches
            // their groups in one navigation.
            //
            // Last, and the only empty path here. See the note on `children` above.
            path: '',
            canActivate: [anonymousOnlyGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-landing').then(
                (m) => m.LandingPage
              ),
            children: [...entrySheetRoutes('landing')],
          },
        ],
      },
      {
        /**
         * **Load bearing, and not merely a 404.** The guard above only runs when
         * this parent route matches, and a parent with `children` matches only if
         * one of them matches the remainder. With `:locale` as the only child, any
         * URL without a locale segment failed to match the whole branch, Angular
         * fell through to the shell's routes, and this app's guard, the one whose
         * job is to *insert* the missing locale, never ran at all.
         *
         * So the app claims every path below its mount and the guard settles the
         * locale for all of them. Anything still here afterwards carries a
         * supported canonical locale and simply is not a route, which is this
         * app's own 404, drawn in a language the visitor can read.
         */
        path: '**',
        component: NotFoundComponent,
      },
    ],
  },
];
