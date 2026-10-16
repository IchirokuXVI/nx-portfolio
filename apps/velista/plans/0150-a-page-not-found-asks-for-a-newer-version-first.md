# 0150: a page not found asks for a newer version first

> Asked for by the owner on 2026-10-16, after the question of what a 0.13.x install does with
> a password reset link. The reset page arrived in [`0148`](./0148-a-forgotten-password-has-a-way-back.md),
> after `v0.13.4`. An installed app on 0.13.x opens the mail link from its service worker
> cache, finds no route, and draws the 404. The new version downloads in the background and
> takes over only at the next navigation, which leaves the token URL behind. The owner asked:
> "on a 404, would it be possible to first check if there is an available update, tell the
> user that the app is updating and then show the 404 (if it's still a 404) after the
> reload?", and agreed to the smaller points as proposed.
>
> This does not rescue 0.13.x. Only a build that ships this check can run it. It covers the
> next link that names a route an older install lacks.
>
> Every fact below was read on `dev` at `0a9b9c7c` on 2026-10-16.
>
> Prerequisite reading: plan `0034` (updates), plan `0072` (refused builds),
> `libs/velista/platform/src/lib/app-updates.ts`, `storage-keys.ts` (`updateAttempt`) and the
> `'**'` route at the end of `libs/velista/feature-shell/src/lib/routes.ts`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

When velista reaches its catch all route, ask the service worker for a newer version before
drawing the 404. If one is ready, say that velista is updating and reload on the same URL. If
none is, draw the 404.

### Context

- **The catch all is the shared `NotFoundComponent`** (`@portfolio/shared/ui`), a bare
  heading with its own translator. It runs after the locale guard, so the URL it sits on
  always carries a canonical locale, and the guard keeps `queryParams` and `fragment` when
  it inserts one (`locale-guard.ts:79`). A reload on that URL keeps a mailed token.
- **`AppUpdates._check()` is the one way to ask.** It shares one `checkForUpdate()` among
  callers, and it resolves `false` with no worker (development builds, velista under the
  shell) and on a rejection. The worker answers `true` only after it has installed the new
  version, so a reload right after it gets the new bundle.
- **A downloaded version can already be waiting.** `VERSION_READY` for a release that is not
  `critical` sets `_reloadAtNextNavigation`. `checkForUpdate()` then answers about versions
  newer than that one, so it says `false` while the right bundle sits in the cache.
- **`_reloadOnce()` cannot be reused.** When its `updateAttempt` latch is spent it calls
  `_giveUp()`, which turns on the dead end screen of plan `0072`. That screen means "the
  server refuses this build", which a 404 does not.
- **`velista/ui` may not inject `Router`** (`layering.spec.ts`). The page needs the URL.

### Target state

1. `AppUpdates.newerVersionForUnknownPage(url)` resolves `true` when a newer version is
   ready: at once when `_reloadAtNextNavigation` is set, else from `_check()`. It resolves
   `false` without asking when this tab already reloaded once for that same URL.
2. `AppUpdates.reloadForUnknownPage(url)` records the URL in a new `sessionStorage` key,
   `StorageKeys.notFoundUpdate`, clears `_reloadAtNextNavigation` and reloads through
   `BrowserFacade`. It bypasses `ReloadBlocker`: a 404 holds no form.
3. A `NotFoundPage` in `libs/velista/feature-shell` replaces `NotFoundComponent` on the
   `'**'` route. It has four faces:
   - **quiet** for the first 300 ms, so a quick answer never flashes a status;
   - **checking** after that, while the check runs;
   - **updating** once a version is ready, until the reload;
   - **missing**, the 404, on `false` or after 10 s with no answer. An answer of `true`
     that comes after the 10 s still reloads, as long as the page is still drawn.
4. The page reads its URL from `router.currentNavigation()?.finalUrl`, falling back to
   `router.url`, because it is built while its own navigation is still running.
5. The copy is in the `velista/ui` translation files under `notFound`, in English and
   Spanish, short and plain.

### Scope

`app-updates.ts`, `storage-keys.ts`, a new `not-found-page` folder in `feature-shell`, the
`'**'` route, the two `velista/ui` translation files, and specs for the new methods and the
four faces.

### Constraints

- One reload per URL per tab. After the reload the page asks again, finds nothing newer and
  draws the 404, and the latch covers a worker that keeps answering `true`.
- A page that is destroyed before the answer never reloads.
- No change to the refused build flow of plan `0072` or to `updateAttempt`.
- `NotFoundComponent` stays in `shared/ui` for the other apps.

### Action boundaries

No change to `ngsw-config.json`, to `critical`, or to the update schedule. No home link or
other new content on the 404.

### Progress evidence

`nx test velista/platform`, `nx test velista/feature-shell`, `nx lint` on both and
`nx build velista` pass.
