# Shell — Case Study (Foundation & General)

> How the portfolio's foundation was built. Answers (`A:`) are written by Daniel.
> `> Note (Claude):` blocks flag things the code shows that an answer may have missed.
> Docker / CI/CD / Kubernetes are documented in `apps/docker/CASE_STUDY.md`.

## Overview

_(Reference summary compiled from the codebase, for the top of a portfolio detail page.)_

A personal portfolio built as an Angular micro-frontend system. A host application (the
**shell**) owns the router, the locale, and the shared singletons, and lazy-loads
independently built remotes at runtime through Module Federation:

- **shell** — the host. Owns `/:locale/...` routing and mounts the remotes.
- **landingV2** — the root landing / portfolio app (served at `/`), the newest redesign.
- **odontogram** — an interactive dental chart (a real client project, rebuilt here).
- **damoclesSword** — a game studio showcase site.
- **landing** — the original landing app, kept around and being folded into landingV2.

Each remote is its own deployable bundle, loaded only when its route is visited, so the
shell stays small and the browser does not reload Angular and the shared libraries when
moving between projects. It runs on a single k3s cluster behind a reverse proxy, with a
staging and a production environment (see `apps/docker/CASE_STUDY.md`).

**Tech stack.** Angular 21 (standalone components, signals everywhere), Nx 22 monorepo,
webpack Module Federation (`@nx/module-federation`), TypeScript 5.9, RxJS 7.8. Localization
is a hand-rolled i18next wrapper (`RokuTranslator`) rather than an Angular-specific i18n
library. Styling is SCSS. Testing is Jest for unit and contract specs plus Cypress and
Playwright for e2e (all pointed at the shell). Deployment is Docker images built by a
custom Nx plugin, deployed to k3s via Helm and GitHub Actions.

## Why this stack

**Q: Why an Nx monorepo? What did it give you over a plain workspace or polyrepo?**
A: Mostly to learn, but also because I have multiple independent apps and wanted to
be able to deploy each one separately if needed. I would definitely do it again. I
have learnt a lot, especially about Nx and building small libraries, and now that the
project is bigger (though still not huge) everything is easier to understand and
reuse this way. I still have plenty to learn about microfrontends and monorepos, but
the methodology that Nx follows seems great, so I will keep learning as much as
possible.

**Q: Why build a portfolio as runtime Module Federation micro-frontends instead of one bundled Angular app?**
A:

**Mainly a building goal.** First of all, this was primarily a goal in itself: I wanted
to build a real micro-frontend system. I have multiple apps, so it was not completely
arbitrary, though I am genuinely not sure micro-frontends are the right call for a case
like this. In the end I think it worked out fine.

**Not reloading Angular between apps.** I could have deployed several separate apps
without micro-frontends, but then the browser would have to load Angular and all of the
shared libraries again every time you navigate from one project to another. With module
federation the shell and the shared libraries stay loaded, and only the remote for the
route you visit is pulled in.

**Global config for shared libraries.** Module federation also lets me set some library
configuration once, globally, for everything. Today that is mostly localization, but
more could be added if needed. With fully separate apps I would have to configure the
language for each one on its own, or at least find a way to carry the correct locale
across them.

**It enables locale-first routing.** That last point connects to the routing. With
separate deployments I do not think locale-first navigation would even be possible,
because each app path (for example `/odontogram`) would have to be defined in nginx, so
`/en/odontogram` would not work out of the box. I am sure it could be solved, but with
micro-frontends it is easier and it is configured at the Angular level instead of split
between nginx and Angular.

**Honest tradeoff.** I would not use micro-frontends for a project of this size. This
project is already over engineered in many areas, not only the micro-frontends. That is
deliberate: the point is to demonstrate what I can do.

> Note (Claude): This is the honest "why runtime MF" the write-up needed, and it is
> consistent with the code: `loadChildren: () => import('odontogram/Routes')` pulls each
> remote as a separately built bundle at runtime, the shell only fetches a remote when
> its route is hit, and the shared singletons (notably `RokuTranslator`) are configured
> once in the shell. The locale-first point is the strongest concrete technical argument
> here: the shell owns `/:locale/...` in Angular, which a per-app nginx deployment could
> not express as cleanly.

## Module federation topology

**Q: The shell is the only host. How does it declare and lazy-load remotes (the `damoclesSword/Routes` alias trick)?**
A: _(Compiled from the code rather than a spoken answer.)_ The shell is the only app
whose `module-federation.config.ts` lists `remotes: ['odontogram', 'damoclesSword',
'landingV2', 'velista']`. Each remote exposes a single entry, `./Routes`, pointing
at its `entry.routes.ts`. A TypeScript path alias in `tsconfig.base.json` (for example
`odontogram/Routes`) lets the shell import that exposed module as if it were local:

```ts
loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes)
```

Because the import lives inside `loadChildren`, the remote's bundle is only fetched when
its route is actually visited. The remotes are declared as children of the shell's
`:locale` route, so a remote renders into the shell's root outlet under the active
locale, and the shell keeps ownership of the router, the locale context, and the shared
singletons. The one non-obvious entry is the root path (`''`), which loads `landingV2`
rather than the older `landing` remote.

**Q: Remotes render a blank page on their own port by design. Why did you make that choice and how does it work?**
A: Each remote is built specifically to work inside the shell, so I do not think it
makes much sense to run or test one on its own, since the styles and the rest of the
context the shell provides could differ from how the remote actually renders in
production. I am not certain this is the best approach. Micro frontends and module
federation are still relatively new and not many projects use them, so I could not
find much guidance either way.

How it works: each remote bootstraps a `RemoteEntry` component whose template is
completely empty, and its `remoteRoutes` load the real `feature-shell`. When you open
a remote on its own port the router still matches the routes, but there is no
`router-outlet` to render them into, so the page comes back blank. The shell is what
provides the outlet (and the global styles and locale context) when it lazy loads the
remote.

> Note (Claude): Open decision Daniel raised, worth revisiting. Whether a remote
> "should" be runnable standalone is a real fork. My take: keep production behavior as
> is (remotes only through the shell), because the remotes genuinely depend on shell
> provided globals. If standalone dev/test becomes painful, the clean fix is a thin
> dev-only host harness per remote that supplies the same global styles and
> `RokuTranslator` init, rather than making each remote a full independent app. Low
> priority for a portfolio; not worth investing until the dev loop actually hurts.

## Locale-first routing

**Q: The top-level route is `:locale` (a componentless route guarded by `localeGuard`). Why route locale first?**
A:

**Shareable links that keep their language.** Locale first routing lets me share a
piece of content without changing the language it is shown in. The language travels
with the URL, so whoever opens the link sees the same locale I did.

**Cacheable per language URLs.** Having the locale in the URL also means each language
is a distinct URL, so the pages can be cached per language. That would not be possible
if the language lived only in storage or a header, because every language would share
the same URL.

**Locale less links still work.** Just in case, I also added a redirect for URLs that
arrive without a locale. Entering `domain.tld/damoclesSword` redirects to
`domain.tld/<locale>/damoclesSword`, so content can also be shared without a locale and
the language is then determined when the user loads the page.

> Note (Claude): Verified against `localeGuard` and `localeCorrectionGuard`. The
> locale less redirect happens in two phases. (1) `localeGuard` runs first on the
> `:locale` route (and on the catch-all): if the first segment is not a valid locale it
> redirects to `/{guess}/{path}`, preserving query and fragment. The guess prefers the
> target app's last used locale (persisted as `roku-locale:{appKey}`), then the browser
> locale, then a default, so a returning visitor lands back in their previous language.
> (2) Once the target app loads, its `localeCorrectionGuard` validates that guessed
> locale against the app's own supported set (from route `data`) and, if it is not
> supported there, corrects the URL with a router navigation (no reload). This is also
> why a locale that is valid for one app but not another gets fixed on entry.

**Q: What happens when a user changes the language, and why? (Originally a full page reload; now a soft in-place switch.)**
A:

**What happens now.** Changing the language is a soft switch, with no page reload. The
switcher tells the store to change the locale, which loads the new language and
refetches whatever depends on it, and the UI updates in place. In practice I did not
have to change much to get there: I made the translation pipe impure so an already
rendered binding re-translates on a locale change, and I added a function on
`RokuTranslatorService` that lets code react to the locale change. Anything that should
update when the locale changes goes through that `withLocale` function, so the data
that needs the new locale is refetched and everything else stays put.

**Why I built it this way.** I moved to the soft switch mainly to see how it works and
as a learning exercise. For now I am keeping it.

**Why I still lean toward a hard reload.** Even so, I think a hard reload is usually the
better choice. With a hard reload you only need the current language loaded, not all of
them, and the browser can serve the page from cache instead of rebuilding the whole
language from scratch and rerunning the key lookups and requests. Reloading everything
live can leave missing strings and inconsistencies in the UI while it loads. On top of
that, I have yet to find a popular website that changes language without a hard reload;
every one I checked reloads to switch.

> Note (Claude): Verified against the code, and the tradeoff Daniel raises is real in
> this implementation. (1) The soft switch is what the deployed apps do today: both
> `DamoclesSwordWrapper.changeLocale` and landingV2's `LanguageSwitch.select` call
> `RokuLocaleStore.switchAppLocale`, which persists the per app choice, calls
> `RokuTranslator.changeLocale` (awaiting i18next `changeLanguage` so strings are ready
> before re-render), emits to the locale listeners, and rewrites only the leading locale
> segment of the URL via a router navigation, no reload. (2) The data refetch is the
> `withLocale` / `refetchOnLocaleChange` operator: it re-runs a locale keyed query with
> `switchMap` on each change, cancelling the previous request. (3) Daniel's "you need all
> languages loaded" concern is accurate for the current design: `addTranslations`
> eager loads every registered locale for the active namespaces, precisely so the switch
> is instant and does not flash missing keys, which is the memory/load cost a hard reload
> would avoid. So the two approaches trade an instant no reload switch against loading
> only one language and reusing the browser cache. This supersedes the previous answer,
> which described a full `window.location.href` reload.

**Q: Which languages does each app enable, why those, and how is the active locale detected and persisted?**
A:

**Why these languages.** I am a native Spanish speaker, but for anything computer
related, from work to video games, I mainly use English. I am only interested in jobs
that need Spanish or English, so those are the two languages the portfolio itself
carries. DamoclesSword is different: its three languages were a requirement from the
client.

**How detection and persistence work.** The resolution order is: if you open a URL that
already has a locale, you get that locale; otherwise you get your stored locale; if you
do not have one, you get your browser locale; and if that is not supported, you get the
default. Preferring the stored choice over the browser language is deliberate. Once a
user has changed the language at some point, it does not make sense to keep using the
browser language, so their previous choice should win. That order felt natural to me.

> Note (Claude): Verified against the per app locale constants. odontogram and landingV2
> ship `['en', 'es']` and damoclesSword ships `['en', 'es', 'fr']`, each defaulting to
> `en`; landingV2 is the root landing app and stores under the `landing` key. Each UI lib
> exposes `*_AVAILABLE_LOCALES` (what it can load) and the feature-shell picks the enabled
> `*_USABLE_LOCALES` subset. The detection order Daniel describes is exactly
> `resolveDesiredLocale`: valid URL locale, then stored `roku-locale:{appKey}`, then
> browser locale, then default. A returning visitor keeps their prior language even if the
> browser prefers another.

## Localization: RokuTranslator

**Q: Why hand-roll an i18next wrapper (`RokuTranslator`) instead of ngx-translate / transloco / Angular i18n?**
A:

**Avoiding Angular specific libraries.** The main reason is that I try not to depend
on Angular specific libraries unless it is strictly necessary. Those libraries tend to
drop support quite early and need constant updates just to keep up with each Angular
version. i18next is framework agnostic, which feels cleaner to me and means far fewer
version headaches over time.

**Sharing config across micro frontends.** The other big reason is that I could not
find a way to share an ngx-translate or Transloco configuration across micro frontends.
I am sure it is possible, but it seemed easier to switch to a plain JavaScript library
that is not tied to Angular and then write my own wrapper around it, which is not that
much work. I started with a simple wrapper, and over time it has grown a bit. In my
opinion it is still relatively simple, small enough to be called a wrapper around
i18next rather than a library of its own that merely depends on i18next.

**Per library namespaces.** In a micro frontend I think each app and remote should own
its localization, even down to supporting different languages. The same applies to
libraries, so I made a provide function for `RokuTranslatorService` that ships all the
configuration it needs to `RokuTranslator`. Part of that configuration is a namespace,
whose main job is to isolate translations between libraries. Libraries can still read
translations from other namespaces, although I may remove that ability later.

**Per app locales.** DamoclesSword is a good example of why locales must be per app. It
is the business site of a game studio, so it needs several languages. Right now it has
three, but it could easily grow to many more, and I do not want to carry all of those
languages in landing, odontogram, or any other app or library that does not need them.

> Note (Claude): Verified against the current (post refactor) code and accurate.
> (1) `RokuTranslator` wraps i18next and is Angular free; the Angular surface lives in
> a separate `rokutranslator-angular` adapter, so the "small wrapper, not a library
> with an i18next dependency" framing holds.
> (2) The provide function is `provideRokuTranslator`, which supplies the
> `ROKU_TRANSLATOR_LOCALES` / `_NAMESPACES` / `_DEFAULT_NAMESPACE` / `_LOADER` tokens to
> a per module `RokuTranslatorService`.
> (3) Namespace isolation is now enforced: `RokuTranslatorService.t(key, ns?)` scopes
> the lookup to the library's own namespace via i18next's `{ ns }`, and `init` sets
> `nsSeparator: false` so a `:` inside a key cannot leak into another namespace. Cross
> namespace reads still work by passing an explicit `ns`, which is the ability Daniel
> may remove.
> (4) Per app locales are real: a UI lib exposes `*_AVAILABLE_LOCALES` (what it can
> load) and each feature-shell declares `*_USABLE_LOCALES` (what the app turns on),
> placed on the top route `data` and validated by the locale correction guard.
> Not covered here and captured in the next question: the reason `RokuTranslator` must
> be a shared singleton at all (only the shell can run `provideAppInitializer`, so init
> lives in one place). See `apps/shell/src/app/app.config.ts`.

**Q: How do remotes and libraries contribute their own translations, given the shell does not know about them upfront?**
A:

**Translations belong to the library.** A library should work on its own, so I think its
translations should be assets of that library rather than something the shell owns.
Following that principle, each library defines the languages it has. Declaring a language
does not mean the library must use it; it only means the library CAN load that language.

**Portability.** Doing it this way keeps the libraries portable. If I install one of them
in a different project, I only need to set the correct language in `RokuTranslator` and
every library picks it up. If I end up using these libraries outside this project, I also
plan to add an option to set the language directly and to override any text by key, so a
consumer has more freedom configuring the library.

> Note (Claude): Matches the code. Each UI lib registers through `provideRokuTranslator`
> (`RokuTranslatorModule.withConfig`) and hands over a loader that dynamically `import()`s
> its per locale JSON asset (for example `libs/damoclesSword/ui/assets/i18n/es.json`). The
> "can load vs actually uses" split is the `*_AVAILABLE_LOCALES` (declared by the UI lib)
> vs `*_USABLE_LOCALES` (enabled by the feature-shell) pair. Mechanics worth stating in the
> write-up: loaders are stored per locale and per namespace in `RokuTranslator`; a custom
> i18next `backend.read` pulls a namespace's loader lazily the first time it is needed
> (returning a `No loader found` error if none is registered), while `addTranslations`
> eager loads the registered locales of active namespaces so a runtime switch is instant.
> Namespace order gives priority (a later `addNamespace` is unshifted to the front); this
> is the cross namespace read that the per lib `t(key, ns?)` scoping now contains.

**Q: In MF config `roku-translator` is forced `singleton: true, strictVersion: true`. What broke, or would break, without it?**
A:

**Early initialization for locale first routing.** `RokuTranslator` has to be
initialized very early, before routing runs, because the app uses locale first
routing and the router needs the translator already available. The only place that
can happen is the shell. The remotes do not initialize on their own; they are loaded
through the shell. `provideAppInitializer` runs exactly once, when the page loads, and
that load is owned by the shell, so the shell is the natural and only home for the
initialization.

**One shared, already configured instance.** Because the library is configured in the
shell, that configuration has to be shared with every consumer. Once the translator is
initialized there is little reason to create more instances of the core library. I
would rather reuse the instance that already exists and put all the utility on top of
it in a wrapper, which can have multiple instances that all call into the same
underlying library.

**What breaks without it.** With the code as it is today, removing the singleton would
cause two problems. First, the language would no longer stay in sync between apps and
libraries, since each copy would hold its own locale. Second, translations could no
longer be shared between apps and libraries, though that sharing is more of a quirk
than something I intend to rely on right now.

> Note (Claude): Verified against `apps/shell/module-federation.config.ts`
> (`singleton: true, strictVersion: true, requiredVersion: 'auto'`) and the listener
> wiring. Two details for the write-up. (1) The locale sync claim is exactly what the
> code does: the root `RokuLocaleStore` subscribes once to the singleton's
> `onLocaleChange`, and `switchAppLocale` calls `RokuTranslator.changeLocale`, so a
> single shared instance is what lets a switch in the shell reach every remote. Two
> copies would each keep their own locale and the switch would not propagate. (2)
> `strictVersion: true` is the guard that makes this fail loudly: on a version mismatch
> module federation errors instead of silently loading a second copy, which is what
> would reintroduce the desync.

## Testing

**Q: What's the testing strategy across the workspace (unit vs e2e, the `*.shared-spec.ts` pattern, why e2e points at the shell)?**
A:
**Shared specs for data access.** The shared specs came out of testing the data
access layer. I know the types each service is supposed to return, so I thought: why
not write one shared spec that every implementation of that service must pass? It
covers the basic functionality that all implementations have in common. On top of
that, each implementation has its own specific spec, and the first thing that
specific spec does is run the shared one. So every implementation gets the shared
contract tests plus its own detailed tests. I am not sure there is a better way to do
this, but it seems to work great.

**e2e through the shell.** All the e2e tests point at the shell rather than each
remote's own url, because the end user is meant to use the shell, not a remote on its
own. The tests are still organized per remote; they simply use the shell url instead
of the remote's url. I am still learning e2e testing, especially with micro
frontends, so I will probably change how this works at some point. There is always
room for improvement.

> Note (Claude): Confirmed against `odontogram-service.shared-spec.ts` and
> `odontogram-memory.spec.ts`: the implementation spec calls
> `runSharedOdontogramServiceTests(factory)` before its own `describe`, as described.
> One idea for later: the shared suite currently asserts mostly the method contract
> (each call returns an Observable, the service is created), while the real CRUD
> behavior (correct results, `NotFoundResourceError`) lives in the per-implementation
> spec. If you want the memory and API implementations guaranteed to behave
> identically, you could push more of those behavioral assertions into the shared
> suite so both are held to the same contract.

## Shared foundation

**Q: How are shared libs organized (`libs/shared/*`: environments, data-access, ui/icons) and what rules do you follow for using them?**
A:
**When something earns its own library.** I create a new library for things that are
either a new feature of a specific app, or something that could be heavily reused, not
just in this project but in general. Small components or services go into an existing
library instead, either the app specific one or the shared one if I am going to use it
in multiple apps. The clearest candidates for their own library are things that have
nothing to do with the interface and do not depend on Angular. My best example is
RokuTranslator: I use it across all the apps and gave it two dedicated libraries,
because I know I will revise it often and I do not want to destabilize the shared
library with something big that changes constantly.

**How something reaches the shared library.** I usually build a component first inside
the app specific library, and only move it to the shared one once I actually need to
reuse it. The rule I follow is that everything in the shared library must be truly
shareable without much configuration. If it is not, I would rather keep two similar
components in different libraries than one big component with a lot of configuration.
In that case I extract the common part into a smaller component in the shared library,
and each app specific component uses that reusable piece.

> Note (Claude): Matches the codebase. RokuTranslator has its two dedicated libs (the
> framework agnostic `rokutranslator` core plus `rokutranslator-angular`), and
> `libs/shared/ui` holds small standalone icon components rather than one configurable
> mega component, exactly the pattern described. One rule worth stating explicitly in
> the write-up: libraries are always imported through their `@portfolio/<scope>/<lib>`
> path alias, never via relative paths across library boundaries.

**Q: Any deliberate performance / change-detection choices (e.g. `provideZoneChangeDetection({ eventCoalescing: true }))`?**
A:
**Event coalescing.** Nx already sets `eventCoalescing` to true, but in my opinion it
should always be on. There is no reason to keep it false unless your logic depends on
DOM manipulation, which I do not think is good practice these days. I have never had
any problems with it.

**Lazy and async by default.** Beyond that, I try to load everything lazily and
asynchronously. For example, the odontogram images are loaded through JavaScript and
the odontogram is only shown once all of the images have finished loading.

**Signals everywhere.** I use signals for everything, to keep change detection to a
minimum. Instead of relying on Angular to notice changes to plain variables in the
template, I update the signals myself when needed.

> Note (Claude): Confirmed, signals are used throughout the component libraries
> (dozens of `signal` / `computed` usages). The odontogram image preloading detail is
> a good concrete example and belongs in `apps/odontogram/CASE_STUDY.md`; recorded
> here at the foundation level, to be expanded when covering odontogram.
