# 0166: velista knows when it runs inside a native shell

> Asked for by the owner on 2026-10-23: "start implementing capacitor for an android/iOS build.
> Before implementing capacitor, you need to analyze the project thoroughly, check if any
> features would need to be moved to the native layer and which ones might have problems.
> Make sure the PWA is working correctly, that it is correctly configured and that it works
> correctly with capacitor. Server side rendering will also be implemented later, you have to
> make the app compatible with it and take decisions that are compatible with SSR."
>
> This is the web half. Plan `0167` adds the Capacitor packages, the Android project and the
> native implementations of the seams this plan opens. Nothing in this plan imports a
> Capacitor package, and every change here is a correct behaviour of the web app on its own.
>
> Every fact below was read on `dev` at `63f740d8` on 2026-10-23. The two reports that hold the
> evidence, with line numbers, are `docs/reports/2026-10-23-velista-capacitor-browser-api-inventory.md`
> (sections 1 to 6 and 8) and `docs/reports/2026-10-23-velista-pwa-and-origin-audit.md`
> (sections 1 and 2). Read both before you start.
>
> Prerequisite reading: plan `0001` D2 (every browser global goes through `BrowserFacade`) and
> D5 (app scoped providers), plan `0013` (the own origin and the installable app), plan `0033`
> (installing), plan `0034` (the app updates itself), plan `0072` (an update the server insists
> on), plan `0150` (not found asks for a newer version), plan `0031` (back never reopens a
> sheet), plan `0130` (one header for every page), plan `0002` (theming),
> `libs/velista/platform/src/lib/browser-facade.ts`, `install-store.ts`, `app-updates.ts`,
> `app-history.ts`, `page-navigation.ts`, `sheet-navigation.ts`, `sheet-fall.ts`,
> `theme-store.ts`, `no-unguarded-history-back.spec.ts`,
> `libs/velista/ui/src/lib/entry/sheet-shell.ts`, `libs/velista/ui/src/lib/layout/page-header.ts`,
> `libs/velista/ui/src/lib/layout/app-layout.ts`, `apps/velista/src/app/app.config.ts`,
> `apps/velista/src/index.html`, `apps/velista/ngsw-config.json`.
>
> Plan `0165` (velista leaves the shell) is being built on a parallel branch. It touches
> `app.config.ts`, `index.html`, `main.ts` and `project.json`. Keep your edits to those four
> files minimal and additive, so the merge is trivial: one new term in the `enabled` expression
> of `provideServiceWorker`, one attribute in the viewport meta, nothing in `main.ts`, nothing
> in `project.json`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code. Load `antislop` and
`antislop-copywriting` before you write any copy.

### Objective

velista can tell, at runtime and through one injection token, that it runs inside a native
shell, and every behaviour that is wrong inside a WebView (the service worker, the install
page, the forced update, Web Share, the hardware back button, the status bar colour) is
routed through a seam that a native implementation can replace by DI. The PWA defects the
audit found are fixed in the same change. Nothing reads `window`, `document` or `navigator`
outside the existing facade rules, and nothing new runs at module load, so the app stays
server renderable.

### Context

- **The seam rule exists.** Plan `0001` D2: browser globals go through `BrowserFacade`
  (`browser-facade.ts`), or through a token with a factory (`AUDIO_CAPTURE`,
  `GEOLOCATION_READER`, `WALK_SENSORS`, `SOCKET_FACTORY` and others, inventory section 3). Root
  services can be overridden only from the application config, because root dependents
  resolve them at the root (inventory 3, "One catch"). `app.config.ts` is the application
  config of the standalone build and never runs under the portfolio shell.
- **Five things break in a WebView** (inventory, "The short version"): the service worker
  update flow, the install flow, Web Share, WebXR camera walks and invite links built from
  `location.origin`. Voice uses `MediaRecorder` and uploads audio (`audio-capture.ts` L101 to
  L131), so the missing Web Speech API costs nothing.
- **The worker registers whenever `!isDevMode()`** (`app.config.ts` L47 to L50). A production
  bundle inside a WebView would register it, and `SwUpdate.isEnabled` stays true even when
  registration fails, so `AppUpdates._check()` (`app-updates.ts` L297 to L310) and
  `demandUpdate` (L187 to L237) can hang waiting for a controller that never comes.
- **The refused build loops.** On `too-old`, `demandUpdate` reloads the same bundle once,
  then shows the dead end face in `app-layout.ts`, whose "Try again" (`reloadByHand`, L246)
  reloads it again. Inside an APK a newer bundle only ever arrives as a new APK.
- **The install UI is wrong inside the app.** `install-store.ts` L82 to L103 reports `manual`
  with guide `android-menu` when no `beforeinstallprompt` fires and `display-mode` is not
  standalone. The install page (`feature-install`) and the account row (`account-page.ts`
  about L235 to L262) then tell a person inside the installed app to install it.
- **Web Share is read at four call sites** through the facade window: `home-page.ts` L413 and
  L556 to L563, `group-page.ts` L261 and L545 to L552, `share-sheet.ts` L175 and L506 to L513,
  plus the walk lab `walk-files.ts` (lab only, out of scope). Each falls back to copy.
- **Invite links use the document origin.** `home-page.ts` L549 to L550 and `group-page.ts`
  L538 to L539 call `shareUrl(this._browser.location?.origin ?? '', ...)`. The basket share
  sheet already prefers `APP_STANDALONE_ORIGIN` (`share-sheet.ts` L254).
- **No hardware back handler and no registry it could call** (inventory 6.3). Back controls
  are the page header's `back` output (`page-header.ts` L70), each page's own
  `PageNavigation.back(fallback)`, and `SheetShell`'s `dismiss` output (`sheet-shell.ts` L152)
  on Escape, scrim and Cancel. Overlays that are not routes close on Escape only:
  `order-menu`, `hold-menu`, `quantity-reel`, `photo-viewer`, `list-viewers` (L61),
  `member-row` (L47), `profile-selector`, `leave-question`, the `app-bar` menu
  (`document:keydown.escape`, L47) and the tour card. `AppHistory.hasEntryBehind()`
  (`app-history.ts` L122) says whether a pop is safe. `no-unguarded-history-back.spec.ts`
  (regex at L58) forbids a bare `.back()` under `libs/velista` and `apps/velista/src`.
- **The status bar colour is fixed.** `index.html` L39 holds one `theme-color` of `#0a0c14`,
  nothing updates it, and `ThemeStore` (`theme-store.ts`) knows the theme. The top bar paints
  `--app-surface-ground` (`page-header.scss`), which is `#0a0c14` in Night and `#f7f8fc` in
  Day (`_themes.scss` L83 and L197).
- **PWA defects** (audit section 1): no `viewport-fit=cover` in the viewport meta
  (`index.html` L17 to L20) while `_semantic.scss` L144 to L147 reads `env(safe-area-inset-*)`;
  the hashed `.woff2` fonts match no `ngsw-config.json` glob; the `theme-color` meta never
  follows the theme.
- **SSR is not built yet and is not this plan.** The rules that keep the door open are in
  section 4. The inventory's section 8.2 lists what SSR will need later; none of it is yours.

### Target state

1. `libs/velista/platform` exports `APP_RUNTIME`, an `InjectionToken<AppRuntime>` with
   `AppRuntime = 'web' | 'native'`, `providedIn: 'root'` with factory `() => 'web'`, and
   `detectNativeShell(): boolean`, a pure function that returns true only when
   `globalThis.Capacitor` exists and its `isNativePlatform()` returns true, inside a
   try/catch, with no import. Nothing in this plan provides `'native'`; plan 0167 does.
2. `provideServiceWorker` in `app.config.ts` is enabled only when `!isDevMode()` and
   `!detectNativeShell()`. The condition is computed where it is today, in the config.
3. `AppUpdates` injects `APP_RUNTIME`. When it is `'native'`: `_check()` resolves false without
   touching `SwUpdate`, `checkNow()` does nothing, the visibility and interval checks are not
   installed, `newerVersionForUnknownPage()` resolves false, and `demandUpdate()` goes straight
   to the dead end state without a reload. The dead end face in `app-layout` shows, when the
   runtime is native and `APP_STORE_URL` is not null, one action "Get the newer version" that
   calls `BrowserFacade.openExternal(storeUrl)`, instead of "Try again". `APP_STORE_URL` is a
   new `InjectionToken<string | null>` in platform, `providedIn: 'root'`, factory `() => null`.
4. `InstallStore` injects `APP_RUNTIME`. When native, `state` is `installed`, `canPrompt` is
   false and no window listener is attached. The install page and the account row read as
   installed, with the copy they already have for that state.
5. A `SHARE_TARGET` token and a `ShareTargetI` interface in platform:
   `canShare(): boolean` and `share(data: { title?: string; text?: string; url?: string }):
   Promise<'shared' | 'dismissed' | 'unavailable'>`. The web implementation,
   `WebShareTarget`, reads `navigator.share` through `BrowserFacade.window`, maps an
   `AbortError` to `'dismissed'` and a missing API to `'unavailable'`. The three app call sites
   (home page, group page, share sheet) use the token and keep their copy fallback for
   `'unavailable'`. The walk lab keeps its own code.
6. Invite links are built from `APP_STANDALONE_ORIGIN` first and `location.origin` second, the
   way the share sheet already does, in `home-page.ts` and `group-page.ts`.
7. A `BackStack` root service in platform: `register(handler: () => boolean): () => void`
   (the return value unregisters) and `handle(): boolean`, which calls handlers from the most
   recently registered to the oldest and stops at the first that returns true. An `AppBack`
   root service with `request(): 'handled' | 'popped' | 'floor'`: `BackStack.handle()` first;
   then, when `AppHistory.hasEntryBehind()`, one pop through the one guarded pop that
   `PageNavigation` already owns (add a method there if you need one, so the spec at
   `no-unguarded-history-back.spec.ts` still finds no bare `.back()`); otherwise `'floor'`.
   `SheetShell` registers a handler that emits `dismiss` while it is open; `PageHeader`
   registers a handler that emits `back` while it shows a back control; the `app-bar` menu and
   each overlay listed in Context register a handler that closes them while they are open.
   Each registration is released on destroy and on close. The web app does not call
   `AppBack.request()` anywhere yet; plan 0167's native listener will.
8. A `SYSTEM_BARS` token and a `SystemBarsI` interface in platform:
   `apply(theme: 'day' | 'night'): void`. The web implementation writes the
   `<meta name="theme-color">` through Angular's `Meta` service with the ground colour of the
   theme (`#0a0c14` for night, `#f7f8fc` for day, from one exported constant map in `ui` or
   `platform`, not two literals). `ThemeStore` calls `apply` in an effect whenever `theme`
   changes. The static meta in `index.html` stays as the first paint value.
9. PWA fixes: `viewport-fit=cover` added to the viewport meta in `index.html`; `/*.woff2` added
   to the `app` asset group of `ngsw-config.json`. A new spec in `apps/velista/src/app`
   asserts both facts by reading the two files, so a later edit cannot drop them silently.
10. `libs/velista/platform/src/lib/index.ts` exports the new tokens, interfaces, services and
    `detectNativeShell`. English and Spanish copy for the one new string lives in
    `libs/velista/ui/assets/i18n/en.json` and `es.json` under the existing key family of the
    dead end face.
11. Specs: `app-runtime.spec.ts` (the token default and `detectNativeShell` with and without a
    fake global), `back-stack.spec.ts` (order, unregister, `handle` result), `app-back.spec.ts`
    (the three outcomes with a hand built `AppHistory` double), `web-share-target.spec.ts`
    (shared, dismissed, unavailable), the existing `app-updates.spec.ts` and
    `install-store.spec.ts` extended with the native runtime, `theme-store.spec.ts` extended
    with the meta write. `npx nx run-many --target=test --projects=velista,velista-platform,velista-ui,velista-feature-home,velista-feature-zones,velista-feature-shopping-lists,velista-feature-shell,velista-feature-install,velista-feature-account`
    and `npx nx run-many --target=lint` over the same projects are green, and
    `npx nx build velista` succeeds with the budgets as they stand.

### Scope

- Work only in: `libs/velista/platform/src/**`, `libs/velista/ui/src/lib/entry/sheet-shell.*`,
  `libs/velista/ui/src/lib/layout/page-header.*`, `libs/velista/ui/src/lib/layout/app-layout.*`,
  `libs/velista/ui/src/lib/layout/app-bar.*`, the overlay components named in Context (under
  `libs/velista/ui/src/lib/**` and the feature libraries that own them), `libs/velista/ui/assets/i18n/en.json`
  and `es.json`, `libs/velista/feature-home/src/lib/home-page/home-page.ts`,
  `libs/velista/feature-zones/src/lib/group-page/group-page.ts`,
  `libs/velista/feature-shopping-lists/src/lib/share-sheet/share-sheet.ts`,
  `libs/velista/feature-install/src/**` and `libs/velista/feature-account/src/**` (only what
  the installed state needs), `libs/velista/feature-shell/src/lib/not-found-page/**` (only if
  the native branch needs a change there), `apps/velista/src/app/app.config.ts`,
  `apps/velista/src/index.html`, `apps/velista/ngsw-config.json`, new specs under
  `apps/velista/src/app/`.
- Do not touch: `package.json`, `package-lock.json`, `apps/velista/project.json`,
  `apps/velista/src/main.ts`, `apps/velista/src/app/app-root-route.ts`, the webpack configs,
  `module-federation.config.ts`, anything under `apps/luna-shopper-backend`, `k8s`, `tools`,
  `apps/shell`, the walk lab, and any file of another app.

### Constraints

- Angular 21, zoneless, standalone components, signals. Follow the conventions in the skill:
  `inject()`, `input()`/`output()`, `DestroyRef`, no `rxjs-interop` in shared services
  (CLAUDE.md, locale routing section).
- No new npm dependency. No Capacitor import anywhere in this plan.
- SSR rules (section 4) apply to every line you add.
- The `no-unguarded-history-back.spec.ts` scan stays green; do not add a file to its
  allowlist.
- `no-dynamic-viewport-units.spec.ts` stays green: no `dvh`, no `lvh`.
- Copy goes through RokuTranslator keys, never literals in templates.
- Prose in files has no dashes as punctuation (the owner's rule).
- Only make the changes this plan names. No feature, refactor or abstraction beyond them.

### Action boundaries

- Proceed with reversible, in scope edits, specs, lint, builds and reads.
- Stop and ask before adding a dependency, deleting a file outside the listed scope, changing
  a route table, or touching a file that plan 0165 also changes beyond what Context allows.

### Progress evidence

Report when a numbered target is done, and at the end. Ground each claim in a tool result:
the spec run, the lint run, the build output. Name every decision you had to take that the
plan did not settle, in the section "What the build decided" at the end of this file.

## 1. Decisions

- **D1. One bundle, a runtime axis.** Native is not a third mount of `appRootRoute(mount)`. The
  native app runs the standalone mode (`mount = ''`, `APP_STANDALONE_ORIGIN = https://velista.app`)
  and differs only through `APP_RUNTIME`. The route factory and `app-providers.ts` do not change.
  Reason: the native app ships the same bundle as the origin, and a build time fork would double
  every e2e. Plan 0167 decides native at runtime from the Capacitor global.
- **D2. Detection by global, provision by DI.** `detectNativeShell()` reads `globalThis.Capacitor`
  so that platform has no package dependency and the service worker condition can be evaluated
  in `app.config.ts` before any injector exists. Everything else reads `APP_RUNTIME` and never
  the global.
- **D3. The native update path is "open the store".** The Play in app update API is out of
  scope. The native app shows the dead end face with a link to its store listing; plan 0167
  provides the URL. The gateway floor keeps working because the APK bundle carries its own
  `VELISTA_APP_VERSION`.
- **D4. The back registry is a stack of closures, not a route concept.** Sheets, headers and
  overlays already know their own fallback and close path; the registry only orders them. The
  web app never reads it. A later web feature (Escape to close everything) may.
- **D5. Share goes through a token with a three state result.** `'dismissed'` matters: a
  person who closed the system sheet must not see the copy fallback.
- **D6. The theme writes the meta.** The static `theme-color` stays as the first paint; the
  store corrects it on every theme change. No media variant in `index.html`, because a pinned
  theme (plan 0002) can disagree with the system preference.

## 2. SSR rules that bind this plan and the next

1. No browser global at module load, in a field initializer or in a constructor, outside
   `BrowserFacade`. New code reads `BrowserFacade.window` or runs in an effect, handler or
   `afterNextRender`.
2. Every environment initializer that touches the browser checks `BrowserFacade.isBrowser`
   first and does nothing on the server.
3. Tokens default to the web value (`'web'`, `null`, a no op) through `providedIn: 'root'`
   factories, so a server injector that provides nothing native behaves as the web app.
4. `app.config.ts` stays composable: a future `app.config.server.ts` merges into it. Nothing
   in it may throw when `window` is absent, including `detectNativeShell()`.
5. Angular's `Meta` and `DOCUMENT` are the only sanctioned way to touch `<head>`.

## 3. Not in this plan

- The Capacitor packages, the Android project, the native implementations of
  `SHARE_TARGET`, `SYSTEM_BARS`, `GEOLOCATION_READER`, the `BrowserFacade` override, the
  hardware back listener and the deep link listener (plan 0167).
- The nginx MIME and cache fixes, the `VELISTA_APP_URL` CI and slot fixes, `assetlinks.json`
  (plan 0167, because they ship with the Android identity).
- WebXR camera walks in the native app. They stay unavailable there, as `WALK_SENSORS.supported()`
  already reports; a native ARCore implementation is a separate project.
- The walk lab's Web Share and blob downloads.
- Web Push, Google sign in, the support handoff inside the app.
- SSR itself, hydration, server probes, the `navigator.languages` guard in the shared
  translator (inventory 8.2).

## 4. Choices that are mine

- The names `APP_RUNTIME`, `detectNativeShell`, `SHARE_TARGET`, `ShareTargetI`, `BackStack`,
  `AppBack`, `SYSTEM_BARS`, `SystemBarsI`, `APP_STORE_URL`.
- The ground colours as the status bar colours, rather than a dedicated token.
- Minimizing, not exiting, at the floor (plan 0167 acts on `'floor'`).

## What the build decided

Built on `feat/velista-capacitor-android` from `07e4ceb3`. Every numbered target is in. Nothing was left out.

### The platform surface plan 0167 codes against

All exported from `@portfolio/velista/platform` (the barrel is `libs/velista/platform/src/index.ts`; the plan's `src/lib/index.ts` does not exist).

- `app-runtime.ts`: `type AppRuntime = 'web' | 'native'`, `APP_RUNTIME: InjectionToken<AppRuntime>` (root, `'web'`), `APP_STORE_URL: InjectionToken<string | null>` (root, `null`), `detectNativeShell(): boolean`.
- `back-stack.ts`: `type BackHandler = () => boolean`, `BackStack` (root) with `register(handler: BackHandler): () => void` and `handle(): boolean`, and `handleBackWhile(active: () => boolean, act: () => void): void`.
- `app-back.ts`: `type AppBackOutcome = 'handled' | 'popped' | 'floor'`, `AppBack` (root) with `request(): AppBackOutcome`.
- `page-navigation.ts`: `PageNavigation.popIfOurs(): boolean`, new.
- `share-target.ts`: `ShareTargetData { title?; text?; url? }`, `type ShareOutcome = 'shared' | 'dismissed' | 'unavailable'`, `ShareTargetI { canShare(): boolean; share(data: ShareTargetData): Promise<ShareOutcome> }`, `WebShareTarget` (root), `SHARE_TARGET: InjectionToken<ShareTargetI>` (root, `inject(WebShareTarget)`).
- `system-bars.ts`: `THEME_GROUND_COLORS: Readonly<Record<AppTheme, string>>`, `SystemBarsI { apply(theme: AppTheme): void }`, `WebSystemBars` (root), `SYSTEM_BARS: InjectionToken<SystemBarsI>` (root, `inject(WebSystemBars)`).

### Decisions the plan left open

1. **A helper for the registrations.** Twelve components register with `BackStack`, so `handleBackWhile(active, act)` in `back-stack.ts` does it once: an effect that registers while `active()` is true and releases in its cleanup, which covers both "on close" and "on destroy". The handler reads `active()` again when it fires and declines when it is false, because a press can land between a close and the next change detection.
2. **What each overlay registers.** `app-bar`, `order-menu`, `quantity-reel`, `list-viewers`, `member-row` and `profile-selector` register while their own open signal is true and call the close their Escape already calls. `photo-viewer`, `leave-question` (Stay), `tour-card` (Skip) and `hold-menu` (dismiss) exist only while open, so they register for their whole life. `hold-menu` lives in `feature-shop-map`, so that project was tested and linted too.
3. **A sheet that may not close takes the press anyway.** `SheetShell` returns true while `dismissible` is false, so the press does not fall through to the page header beneath while a request is in flight. `requestDismiss()` already ignores it.
4. **The pop for `AppBack`** is `PageNavigation.popIfOurs()`, which checks `AppHistory.hasEntryBehind()` itself and pops once. `AppBack` does not read `AppHistory` directly. `no-unguarded-history-back.spec.ts` stays green with no allowlist change.
5. **A share that the browser refuses for a reason other than `AbortError`** (a spent gesture, `NotAllowedError`) maps to `unavailable`, so the caller copies. Before this the home and group pages swallowed every rejection. A dismissal still copies nothing, and the three doc comments that said otherwise now say so.
6. **The no share case copies synchronously.** The home and group pages check `canShare` and copy before any `await`, because the clipboard needs the click's gesture and the existing specs assert the copy in the same tick. `WebShareTarget.share` calls `navigator.share` synchronously for the same reason.
7. **The status bar is left alone in the mounted mode.** `ThemeStore` writes the meta only when `APP_BASE_PATH` is `''`. Under the portfolio the document and its `theme-color` belong to the portfolio, and the colour would stay after velista's routes are left. This is the plan 0013 D4 reasoning the service worker already follows.
8. **The colour map lives in `platform`** (`THEME_GROUND_COLORS`), beside `SYSTEM_BARS`. `system-bars.spec.ts` reads `_themes.scss` and `_primitives.scss` and fails if the map and the stylesheet disagree.
9. **The store action decides once.** `AppLayout` reads `APP_STORE_URL` only when `APP_RUNTIME` is `native`, and `updateFromStore` is a plain boolean. The label key is `update.failed.store`: "Get the newer version" and "Obtener la versión nueva". `UpdateScreen` did not change; `AppLayout` passes the label and branches in `reloadForUpdate()`.
10. **`AppUpdates` native order.** `demandUpdate()` keeps its latch and its spent attempt check first, then gives up at once when native. It writes no attempt flag, because nothing reloads.
11. **`app.config.ts` and `index.html` got exactly the term and the attribute** the plan allows, plus the one import of `detectNativeShell`. No comment was added there, to keep the merge with plan 0165 trivial.
12. **Extra specs beyond the list:** `system-bars.spec.ts`, the native dead end in `app-layout.spec.ts`, the back press in `sheet-shell.spec.ts` and `page-header.spec.ts`, and the standalone origin invite in `home-page.spec.ts` and `group-page.spec.ts` (plus a dismissed share copying nothing on home). The PWA spec is `apps/velista/src/app/velista-pwa-shell.spec.ts`.

### Known limits, for plan 0167

- **Registration order is creation order.** The tour card registers once and stays while the tour moves between pages, so a page header created at a later stop sits above it in the stack, and a native back press during the tour goes to that header instead of Skip. The same holds for any long lived overlay that outlives a navigation. A priority on `register`, or the tour registering again per stop, would fix it; nothing in the web app reads the stack today.
- **The dead end body copy** still says "open it in your browser once", which is wrong inside the app. The plan allowed one new string, so it was not changed.
- **No feature in `feature-install`, `feature-account` or `not-found-page` changed.** Both install surfaces read `InstallStore.state` with mount `''` and already have copy for `installed`. The not found page draws `missing` at once because `newerVersionForUnknownPage` resolves false.
- The production build reports a budget warning on `libs/velista/ui/src/lib/layout/app-layout.scss` (13.81 kB against 12 kB). This change does not touch that file.
