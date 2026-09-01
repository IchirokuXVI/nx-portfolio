import { inject } from '@angular/core';
import { type Route } from '@angular/router';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { BasketStore } from '@portfolio/velista/data-access';
import { sheetFallGuard } from '@portfolio/velista/platform';
import { APP_DEFAULT_LOCALE, APP_KEY, AppLayout } from '@portfolio/velista/ui';
import {
  anonymousOnlyGuard,
  authenticatedGuard,
  guestOnlyGuard,
} from './auth-guards';
import { APP_USABLE_LOCALES } from './usable-locales';
import {
  generatedListIdGuard,
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
 * lands. `settings` is the last one outstanding, and it is deliberately **not** folded
 * into `account`: its access is Any and `account`'s is Authenticated, so theme and
 * language would go behind `authenticatedGuard` and an anonymous visitor reading the
 * front door in the wrong language would have no way to change it (plan 0015,
 * section 4.5). Paths keep the word `zones` even though the interface says group
 * (rule N2): the translation layer renames the word, the code never does.
 *
 * The export is named for its role, not for the product, so a rename stays a data
 * edit (rule N1); the `@portfolio/velista/feature-shell` path already scopes it.
 */
/**
 * Mark a route as drawn in a `SheetShell`, which is a fact about the route and not
 * only about the component.
 *
 * Rule E1 makes a sheet a child route, so every way out of one is a navigation and the
 * router destroys the panel on the frame it decides. `SheetShell` can hold that back
 * for the exits that start inside it (Cancel, the scrim, Escape), and for nothing else:
 * the back button, the back gesture and a submit that leaves for another page all
 * changed the route first, so the panel vanished instead of falling. On a phone the
 * back gesture *is* how a bottom sheet is closed, which is what made the two entry
 * sheets read as having no close animation at all.
 *
 * `sheetFallGuard` is what holds the navigation open long enough to draw the fall, and
 * it belongs on the route because that is the only hook that runs before the component
 * is destroyed. Stamped by this helper rather than written out twelve times, so a sheet
 * added later cannot quietly be the one that skips it; `routes.spec.ts` asserts that
 * every route with a panel carries it.
 */
function sheet(route: Route): Route {
  return { ...route, canDeactivate: [sheetFallGuard] };
}

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
    sheet({
      path: 'zones/new',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then(
          (m) => m.CreateGroupSheet
        ),
    }),
    sheet({
      path: 'zones/join',
      data: { returnTo },
      loadComponent: () =>
        import('@portfolio/velista/feature-entry').then((m) => m.JoinCodeSheet),
    }),
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
  return (['remove', 'ban', 'transfer', 'rename'] as const).map((action) =>
    sheet({
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
    })
  );
}

/**
 * The five sheets over the list page (plan 0012 section 4.2, velista 0043 section 5.1).
 *
 * Every one is a route and not a template flag, which is rule E1 from `0008`
 * unchanged: each covers the page without losing it, and Android's back button has to
 * dismiss it.
 *
 * **Changing a line's quantity is deliberately not among them and never will be.** It
 * is the gesture the screen is built around, it happens under a thumb, and a sheet
 * would put a navigation and a dismissal around a number somebody is dragging. What
 * used to be said in this place about ticking off is the same rule about a different
 * gesture: the primary act on this page is never a route.
 *
 * The detail sheet is new and is what a **tap** opens now. It earns a route twice over:
 * it covers the page like the rest, and it is where a purchase is recorded, which is a
 * deliberate act somebody should be able to back out of with the back button.
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
    sheet({
      // What a tap on a row opens (velista plan 0043, section 5.1).
      //
      // `lines/:lineId/detail` rather than the bare `lines/:lineId`, and the segment is
      // load bearing: the bare path belongs to the **line page**, which is a page of
      // its own so it can be linked to and reached from a search later (section 5.3).
      // Giving the sheet the short URL would have taken the linkable one away from the
      // screen whose whole reason for being a page is that it can be linked to.
      //
      // No guard, like the others here: whether this caller may record a purchase is
      // decided inside it from the same abilities the page uses, and opening it to read
      // a history is something anybody holding `READ` may do.
      path: 'lines/:lineId/detail',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then(
          (m) => m.LineDetailSheet
        ),
    }),
    sheet({
      path: 'lines/:lineId/edit',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then((m) => m.EditLineSheet),
    }),
    sheet({
      // Approved member, readers included: `comment.add` requires only
      // `requireApproved` on the zone, not write access on the list.
      path: 'lines/:lineId/comments',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then((m) => m.CommentsSheet),
    }),
    sheet({
      path: 'lines/:lineId/confirm/delete',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then(
          (m) => m.DeleteLineSheet
        ),
    }),
    sheet({
      // Rename, share and delete. All three are `requireManage`, which is a different
      // rule from the write access that gates lines: the list's creator, a zone admin,
      // or the owner. The sheet itself decides what to draw from `myRole`.
      path: 'settings',
      loadComponent: () =>
        import('@portfolio/velista/feature-lists').then(
          (m) => m.ListSettingsSheet
        ),
    }),
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
            children: [
              sheet({
                // Get shopping list (plan 0045, section 3.4). A child of the dashboard
                // and so a sheet by rule E1, for the two entry sheets' reason exactly:
                // it covers the page without losing its scroll, and Android's back
                // button dismisses it rather than closing the app.
                //
                // No guard beyond the dashboard's own. Whether the caller may generate
                // anything is decided by what they hold `WRITE` on (backend `0051`
                // section 2), which is not knowable before the sources are read, so the
                // sheet is where it is answered and not the route.
                path: 'get',
                loadComponent: () =>
                  import('@portfolio/velista/feature-home').then(
                    (m) => m.GetListSheet
                  ),
              }),
              ...entrySheetRoutes('home'),
            ],
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
          /**
           * Everything about one line (velista plan 0043, section 5.3).
           *
           * **Declared before `zones/:zoneId/lists/:listId`**, and that is necessity
           * rather than habit, exactly as the list page itself is declared before
           * `zones/:zoneId`: the list page's path is a prefix of this one and it
           * carries children, so a URL ending in `lines/<uuid>` would be offered to
           * that branch first. None of its sheet children matches a bare line id, so
           * the branch would fail and the router would fall through to here anyway,
           * which works and is exactly the kind of thing that stops working when
           * somebody adds a sheet. Ordering makes it not depend on that.
           *
           * A page rather than a deeper sheet because it can be linked to, which is
           * also why it holds the short URL and the detail sheet takes `/detail`.
           */
          {
            path: 'zones/:zoneId/lists/:listId/lines/:lineId',
            canMatch: [zoneIdGuard, listIdGuard],
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-lists').then(
                (m) => m.LinePage
              ),
            children: [
              sheet({
                // The one thing on either screen that discards the history, so it is
                // confirmed here as well as from the list (section 5.3).
                path: 'confirm/delete',
                loadComponent: () =>
                  import('@portfolio/velista/feature-lists').then(
                    (m) => m.DeleteLineSheet
                  ),
              }),
            ],
          },
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
              sheet({
                // Any approved member may start a list, which is why this is the member
                // guard and not the staff one (section 5.5).
                path: 'lists/new',
                canActivate: [zoneMemberGuard],
                loadComponent: () =>
                  import('@portfolio/velista/feature-zones').then(
                    (m) => m.CreateListSheet
                  ),
              }),
              sheet({
                // Rename, regenerate the code, delete. Staff, and delete is owner only,
                // which the sheet itself decides from `myRole` (rule G2).
                path: 'settings',
                canActivate: [zoneStaffGuard],
                loadComponent: () =>
                  import('@portfolio/velista/feature-zones').then(
                    (m) => m.GroupSettingsSheet
                  ),
              }),
            ],
          },
          {
            // The history of generated shopping lists (plan 0045, section 3.3).
            //
            // The path is written out rather than taken from `BASKET_PATHS`, which the
            // three screens that link here build their links from: naming that constant
            // is a static import of `feature-shopping-lists`, which this file lazy
            // loads, so it would pull those pages into the shell's initial payload.
            // `routes.spec.ts` asserts the two still agree.
            //
            // Declared **before** `account` and before the front door, like every other
            // non empty path, and it will also need to come before `0044`'s
            // `shopping-lists/:generatedListId` once that lands: the two are siblings
            // rather than parent and child, because the basket screen is its own
            // destination and not something drawn over this page. `:generatedListId`
            // carries a `canMatch` UUID guard for `zoneIdGuard`'s reason, so the two
            // cannot swallow one another whichever way round they sit.
            //
            // `authenticatedGuard` and nothing more. A basket is private and the
            // listing resolves from the caller's own token, so there is nothing here to
            // authorize that the gateway does not already. The **basket** screen is the
            // one that must not carry this guard, since a guest with no account has to
            // reach it by link.
            path: 'shopping-lists',
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-shopping-lists').then(
                (m) => m.ShoppingListsPage
              ),
          },
          {
            // Shopping profiles (plan 0046). A page of its own and **not a child of
            // `account`**, which is what the path might suggest: `account` renders its
            // sheets into an outlet at the bottom of its own scroll, so a child route
            // here would draw a whole page under the account rows rather than instead
            // of them.
            //
            // Declared **before** `account` for the same reason every non empty path
            // comes before the front door. A parent with children only matches when one
            // of them matches the remainder, so `account` would decline `profiles` and
            // the router would fall through to this one anyway; stating the order makes
            // that a decision rather than a piece of luck about how backtracking works.
            //
            // `authenticatedGuard` and nothing more. A profile is private and resolves
            // from the caller's own token, so there is nothing here to authorize that
            // the gateway does not already.
            path: 'account/profiles',
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-account').then(
                (m) => m.ProfilesPage
              ),
            children: [
              sheet({
                // `confirm/delete`, matching the shape `0010` gave a member action and
                // `0015` gave the account, so every destructive confirm in this app is
                // addressed the same way.
                path: 'confirm/delete',
                loadComponent: () =>
                  import('@portfolio/velista/feature-account').then(
                    (m) => m.DeleteProfileSheet
                  ),
              }),
            ],
          },
          {
            // The account (plan 0015). A **route** and not a sheet, by the same test
            // `0009` section 4.1 used for the credential screens: it is deep linkable,
            // it has its own scroll, and it is where somebody goes deliberately rather
            // than something drawn over a page they were reading.
            //
            // `authenticatedGuard` and nothing more. There is no guest variant, because
            // the guest sees a **different screen** and not a different route: it is a
            // property of `SessionStore.isGuest` that the page already reads, and
            // splitting the route would give two URLs for one thing somebody reaches by
            // pressing one button. That is a deliberate departure from rule C1
            // (`0009`), and the difference is what the branch protects: there, the
            // wrong screen silently strands every group a person has, so it had to be
            // unreachable. Here the wrong branch is a screen with rows that do not
            // apply. Guards are for the ones that cost something.
            path: 'account',
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-account').then(
                (m) => m.AccountPage
              ),
            children: [
              sheet({
                // Renaming needs a field, so it is a small form in a `SheetShell`
                // rather than a confirm. A child route under rule E1, so the account
                // screen keeps its scroll underneath and Android's back button
                // dismisses it.
                path: 'name',
                loadComponent: () =>
                  import('@portfolio/velista/feature-account').then(
                    (m) => m.RenameSheet
                  ),
              }),
              sheet({
                // `confirm/delete`, matching the shape `0010` gave a member action, so
                // the two typed confirmations in this app are addressed the same way.
                path: 'confirm/delete',
                loadComponent: () =>
                  import('@portfolio/velista/feature-account').then(
                    (m) => m.DeleteAccountSheet
                  ),
              }),
            ],
          },
          {
            // The assistant (plan 0032). A **route** and not a sheet, and here the
            // argument is stronger than it was for the account screen: the app bar is
            // drawn on every signed in page, so its button is everywhere. Rule E1
            // (`0008`) makes a sheet a child of the page it covers, so a sheet
            // reachable from everywhere would be a child of everywhere — one identical
            // entry per page, which must not drift, for a panel that covers a page it
            // has nothing to do with.
            //
            // A floating panel toggled by a signal was the other option and is worse:
            // nothing is pushed onto the history stack, so Android's back button closes
            // the **app** rather than the panel. That is the defect rule E1 exists to
            // prevent, and `0031` spent a whole plan repairing the last version of it.
            //
            // `authenticatedGuard` and nothing more. The bot acts as the caller through
            // the gateway with the caller's own token (backend `0039` rule A1), so
            // there is nothing here to authorize that the API does not already.
            //
            // `AssistantStore` and `Dictation` are provided by the **page**, not
            // here. That is the one place this departs from the plan's wording, and it
            // is forced: naming either class in this file is an eager import of the
            // `feature-assistant` barrel, which would pull the panel into the shell's
            // initial payload and break the "keeps every page lazy" assertion that
            // `routes.spec.ts` already makes. Component providers give the identical
            // lifetime — created with the page, destroyed with it — which is what the
            // plan is actually asking for: the conversation survives leaving and
            // coming back within a session and does not survive a reload, and
            // destroying the recorder releases the microphone, so a recording does not
            // survive leaving mid capture.
            path: 'assistant',
            canActivate: [authenticatedGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-assistant').then(
                (m) => m.AssistantPage
              ),
          },
          {
            // Installing the app (plan 0033). A route rather than a sheet, by the same
            // test `0009` section 4.1 used and `0015` applied: it is deep linkable, it
            // is somewhere a person goes deliberately, and it is the URL you would put
            // in a message.
            //
            // **Public, and deliberately so.** The whole point of a link is that it can
            // be sent to somebody who has never signed in, and the page makes no
            // request of any kind. `routes.spec.ts` asserts the absent guard, because
            // an absent guard is easy to read as an oversight and this one is a
            // decision.
            path: 'install',
            loadComponent: () =>
              import('@portfolio/velista/feature-install').then(
                (m) => m.InstallPage
              ),
          },
          {
            /**
             * The shared basket (plan 0044). The screen somebody carries around a
             * shop, which is very often not the person who wrote the list.
             *
             * **No `authenticatedGuard`, and that is the feature.** A guest holding
             * a link has no account and never will through this route; what
             * authorizes them is their participant session, which the server checks
             * on every request. A guard here would refuse exactly the reader this
             * plan exists for.
             *
             * Declared before the empty path, and before plan 0045's
             * `shopping-lists` listing when that lands, with `generatedListIdGuard`
             * so a future `shopping-lists/new` cannot be swallowed as a basket id
             * (rule G1).
             *
             * The path is a literal rather than `BASKET_PATHS.basket`: importing it
             * here is a static import of a lazy loaded library, which eslint refuses
             * and which would pull these pages into the shell's initial payload.
             * `routes.spec.ts` asserts the path, so a rename cannot land half done.
             */
            path: 'shopping-lists/:generatedListId',
            canMatch: [generatedListIdGuard],
            loadComponent: () =>
              import('@portfolio/velista/feature-shopping-lists').then(
                (m) => m.BasketPage
              ),
            providers: [BasketStore],
            children: [
              // Rule E1: each sheet covers the page without losing it, and Android's
              // back button dismisses it. None is guarded, because which of them a
              // caller may **use** is decided from the caller's own facts by the
              // page, and the server refuses the rest regardless of what is drawn.
              sheet({
                path: 'lines/:lineId/settle',
                loadComponent: () =>
                  import('@portfolio/velista/feature-shopping-lists').then(
                    (m) => m.SettleSheet
                  ),
              }),
              sheet({
                path: 'people',
                loadComponent: () =>
                  import('@portfolio/velista/feature-shopping-lists').then(
                    (m) => m.PeopleSheet
                  ),
              }),
              sheet({
                path: 'share',
                loadComponent: () =>
                  import('@portfolio/velista/feature-shopping-lists').then(
                    (m) => m.ShareSheet
                  ),
              }),
            ],
          },
          {
            /**
             * The guest join screen (plan 0044, section 3).
             *
             * A short top level segment because this is the one path in the app that
             * gets pasted into a group chat and read aloud, and **not** under
             * `shopping-lists/`: a stranger holding this link has no shopping lists
             * and is not browsing a section of the app.
             *
             * Public and full screen, like `join/:code` below it and for the same
             * reason: it is a cold arrival from somebody else's message, so there is
             * no page underneath to render over (plan 0008, section 4.1).
             *
             * The URL the owner copies carries **no locale**, on purpose:
             * `localeGuard` inserts the recipient's, and baking the sender's in
             * would open the app in the wrong language for exactly the person it was
             * sent to.
             */
            path: 's/:secret',
            loadComponent: () =>
              import('@portfolio/velista/feature-shopping-lists').then(
                (m) => m.JoinPage
              ),
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
