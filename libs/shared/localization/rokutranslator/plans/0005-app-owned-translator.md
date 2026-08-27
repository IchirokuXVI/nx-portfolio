# 0005: An app owned translator (the singleton retires)

## Implementation status

Done, and consumed by `apps/shell/plans/0003-app-owned-locale-routing.md`, which is
now done too. `apps/velista/plans/backlog/0001-own-origin-and-pwa.md` is unblocked.

Two corrections the implementation made to this plan, both recorded in the decisions
they belong to:

- **D3 was half right.** `i18next.use(...).createInstance(...)` does assign the backend
  to the module level default instance, as diagnosed. Fixing only that still left the
  lazy path dead: passing `resources` at init tells i18next the languages are bundled
  and turns the backend off even when one is registered. It needs `use()` on the
  created instance **and** `partialBundledLanguages`, because this library uses both
  paths. Measured with a scratch spec before the fix.
- **The mount cannot reach the guard through DI** (D7). `APP_MOUNT_PATH` exists and is
  what the locale switcher reads, but a guard resolves against the closest environment
  injector Angular has created by the preactivation phase, and a route's own
  `providers` injector is not reliably one of them. The guard reads its whole
  configuration from route `data` instead, deepest definition winning, which also
  splits it along the ownership line: the app's entry route states the mount, the
  feature library's table states the locales.

## Goal

`RokuTranslator` stops being one instance shared by the shell and every remote, and
becomes one instance **per app**. Each app registers its own namespaces, holds its own
active locale, and owns the URL segment that locale lives in.

Nothing about the translation *format* changes. No JSON file moves, no key is renamed,
and `| rokuT` keeps working exactly as it does today. What changes is who owns the
instance, and where the locale sits in the URL.

## Locked decisions (from Daniel)

1. The translator is app based. There is no singleton.
2. Each app routes its locale segment as it needs to, under its own mount, rather than
   the shell owning a locale first `:locale` route for everybody.
3. Every app's translation configuration moves to its shell library, the way velista
   composes `VELISTA_TRANSLATION_PROVIDERS`.
4. App wide providers move onto the entry routes with `provideEnvironmentInitializer`,
   the way velista's `app-providers.ts` does it.
5. Data access services cannot be `providedIn: 'root'`, because the API URL is not
   available in the root injector. This was invisible until velista, the first app here
   with a backend.
6. The locale guard belongs in a shared library rather than being copied into each app.

## Why now

Three separate problems turn out to have one cause.

**The API URL problem, which is rule D5 in velista plan 0004.** Under the shell, "root"
is the *portfolio's* injector. An app's own configuration is provided on the app's route
injector, one level below, and a `providedIn: 'root'` service resolves its dependencies
from above, where that configuration does not exist. velista already works around this
for every one of its services.

**The PWA problem.** A web app manifest's `scope` is a plain path prefix. Today's
`/{locale}/velista` puts the locale *above* the mount, so no prefix covers the app in
every language: `/en/velista/` pins one locale and `/` swallows the whole portfolio.
`/velista/{locale}/...` makes `scope: /velista/` correct in all of them. The locale
reorder is not cosmetic, it is the thing that makes an installable app possible at all.

**The standalone problem.** `RokuTranslator.init()` is called in exactly one place in the
workspace, `apps/shell/src/app/app.config.ts`. Serve any remote on its own origin today
and every `t()` throws `RokuTranslator not initialized`. As long as init belongs to the
shell, no app can run without the shell.

All three are the same fact: **the shell owns state that belongs to each app.**

## Design

### D1: export the class, not a pre made instance

The core is already fully instance based. Every field on it is per instance, and the only
thing making it a singleton is the tail of `rokutranslator.ts`:

```ts
const rokuTranslatorInstance = new RokuTranslator();
export { rokuTranslatorInstance as RokuTranslator };
```

Export the class. That is the whole change to the core's structure. Everything expensive
about this plan is in the consumers, not here.

Keep the exported name `RokuTranslator`, so the type name and the mental model survive.
Every existing `RokuTranslator.foo()` call site becomes an injected instance instead.

### D2: keep the module federation sharing, it was never the singleton

**Correction to an assumption worth writing down, because getting it backwards costs
roughly 40KB of i18next per remote.** "Stop being a singleton" and "stop being shared"
are different changes, and only the first is wanted.

Module federation shares a **module**. Today that module exports a pre made instance, so
sharing the module shares the instance. Once the module exports only a class it holds no
mutable state, and sharing it means every remote downloads one copy of the code while
each still calls `new` for itself.

So `module-federation.shared.ts` keeps its `SINGLETON_LIBRARIES` entry unchanged. What
changes is its status: it stops being load bearing for correctness and becomes a plain
deduplication win. Update the prose in that file at the same time, because it currently
explains at length that two copies means two locales, and after this plan that sentence
is false.

One consequence worth banking. That file records that `strictVersion` was rejected
because staging deploys only the affected remotes, so a version bump leaves a mixed fleet
and strict enforcement turns an ordinary deploy window into a blank page. With no shared
mutable state, a mixed fleet stops being a correctness problem at all. Not a task, but it
closes a standing hazard.

### D3: the i18next backend is registered on the wrong instance

Found while evaluating this plan. `init()` does:

```ts
this.i18nextInstance = i18next.use({ type: 'backend', read }).createInstance(opts, cb);
```

In the installed source, `use()` assigns `this.modules.backend` on the **module level
default instance** (`node_modules/i18next/dist/cjs/i18next.js:1952`), while
`createInstance` is `new I18n(options, callback)` whose constructor sets
`this.modules = { external: [] }` fresh (`:1747`, `:2166`). The backend is therefore never
attached to the instance this library actually uses.

**What that means today.** The lazy backend `read` path is dead. Everything works through
the eager `addResourceBundle` path in `addTranslations` / `loadTranslations`, which is why
nobody has noticed. The comment in `addTranslations` claiming that "the lazy backend
`read` path still covers anything registered after init" is wrong, and so is the apparent
purpose of the `read` implementation.

**Why it stops being harmless.** With N instances, `i18next.use()` writes to one shared
object N times. The moment the backend is made to work without also moving the `use()`
call onto the created instance, the last app to init wins the backend for every app, and
app B silently reads app A's loaders. That failure is quiet and locale shaped, which is
the worst combination to debug.

**Do.** Call `use()` on the created instance:

```ts
const instance = i18next.createInstance();
instance.use({ type: 'backend', read });
await instance.init(opts);
```

Then either make the lazy path work or delete it deliberately, but do not leave it half
wired. Pin the behaviour with a test that registers a namespace **after** init and asserts
it loads, which is the only thing that distinguishes the two paths.

This is read from the installed source and not yet executed, so the test comes first and
confirms the diagnosis before the fix lands.

### D4: who creates the instance, and how a component reaches it

An injection token holding one instance, provided by the app, with the service reading it
instead of importing a module global.

```ts
export const ROKU_TRANSLATOR = new InjectionToken<RokuTranslator>('ROKU_TRANSLATOR');
```

`provideRokuTranslator` grows the responsibility of creating it. It already takes the
locales, namespaces, default namespace and loader, so it has everything the constructor
needs, and no call site has to learn a new shape.

`RokuTranslatorService` then injects `ROKU_TRANSLATOR` rather than importing
`RokuTranslator`. Its public surface (`t`, `locale`, `locale$`, `withLocale`, `loaded`,
`loaded$`) does not change, so no component, pipe or spec that uses the *service* is
touched by this plan. That is deliberate: the blast radius should be the composition
sites, not the consumers.

### D5: `RokuLocaleStore` stops being `providedIn: 'root'`

This is rule D5 applied to the localization layer, and it is not optional.

`RokuLocaleStore` is `providedIn: 'root'` and subscribes to the singleton's
`onLocaleChange`. Under the shell, root is the portfolio's injector. It works today only
by an accident that `module-federation.shared.ts` documents at length:
`rokutranslator-angular` is deliberately **not** shared, so each remote carries a
duplicated copy of the class, which is a distinct DI token, which is a distinct instance
in the same root injector. Those copies stay in step **only because every one of them
subscribes to the same shared core**.

Remove the singleton and that property is gone. A store in the portfolio's root injector
cannot see an app scoped translator instance provided below it, and N stores subscribing
to N different instances is not a bug, it is the point, as long as each one belongs to its
own app.

So the store becomes part of `provideRokuTranslator`'s output and lives on the app's
injector next to the instance it watches. Update the long note in
`module-federation.shared.ts` at the same time: it currently reasons that not sharing this
library is survivable, and the reason it gives expires with this plan.

### D6: one locale guard, not two

The guard does not need moving. Both guards **already live** in
`libs/shared/localization/rokutranslator-angular/src/lib/locale-routing/`, and
`localeGuard` is already exported from that library's barrel. The shell simply happens to
be its only consumer.

What they need is merging. Today the work is split by *who* runs it:

- `localeGuard`, on the shell's `:locale` route, handles a first segment that is not a
  locale at all: it resolves a locale and **keeps** the segment, so `/damoclesSword/about`
  becomes `/en/damoclesSword/about`.
- `localeCorrectionGuard`, on each app's route, handles a segment that is locale shaped
  but not one the app supports: it **replaces** the segment.

Under this plan every app needs both behaviours at its own mount, so two guards means
every app wiring up two. Collapse them into one guard configured from route `data`
(`appKey`, `supportedLocales`, `defaultLocale`).

#### The invariant

**The segment immediately after the mount is a supported, canonical locale before anything
below it renders.** That is the whole contract, and it is what every case below serves.

The reason it has to hold *before* rendering rather than during is that **the 404 page is
localized too**. There is no page an app can show, not even a failure, until it knows what
language to show it in. So the guard never declines a URL and never routes to a not found
page itself: it always settles a locale, then hands the rest of the path to normal routing,
which is free to 404 afterwards.

#### The four cases

| Segment after the mount | Action | Effect on the active locale |
| --- | --- | --- |
| Supported and canonical (`es`) | proceed | **adopt it** |
| Supported, non canonical (`en-US`) | rewrite the segment to its canonical form | **adopt the canonical form** |
| Locale shaped but unsupported (`zz`, `de`) | **replace** the segment | resolve, as below |
| Absent, or not locale shaped (`home`, `qwfp`) | **insert** the resolved locale before it, keep it | resolve, as below |

"Resolve" is unchanged from plan 0002 D5: the app's last used locale from
`roku-locale:{appKey}`, then the browser locale, then the app's default.

**A supported URL locale outranks the stored preference and replaces it.** Arriving at
`/velista/en` when the app remembers `es` switches the app to English and persists that,
because a link someone followed is a stronger signal than what they last picked. This is
already what `resolveDesiredLocale` documents as "a valid URL locale wins"; it is spelled
out here because the old three row table hid it behind the word "proceed".

#### Worked examples

Daniel's, with supported locales `en` and `es` and the visitor's resolved locale `es`. The
resolved locale is **not** a constant; every row below that resolves lands on `es` because
that is this visitor's, and would land on `en` for a visitor whose is `en`.

| In | Out | Case | Locale after |
| --- | --- | --- | --- |
| `/velista/es` | unchanged | supported | `es` |
| `/velista/en` | unchanged | supported | **`en`** |
| `/velista/en/home` | unchanged | supported | **`en`** |
| `/velista/en-US` | `/velista/en` | non canonical | **`en`** |
| `/velista/es-ES` | `/velista/es` | non canonical | `es` |
| `/velista/zz` | `/velista/es` | unsupported | `es` |
| `/velista/zz/home` | `/velista/es/home` | unsupported | `es` |
| `/velista/zz/qwfp` | `/velista/es/qwfp` | unsupported | `es` |
| `/velista/de` | `/velista/es` | unsupported (passes the regex, is not supported) | `es` |
| `/velista/home` | `/velista/es/home` | insert | `es` |
| `/velista/qwfp` | `/velista/es/qwfp` | insert | `es` |

`/velista/qwfp` and `/velista/zz/qwfp` end on a 404, and that is correct rather than a case
to design around. `qwfp` is not a route, so the app's own not found page renders, in
Spanish, which is only possible because the guard settled the locale first.

#### Why an unsupported locale is consumed and an unknown word is not

The asymmetry between the last two cases is deliberate and is the one thing a reader is
likely to get wrong. A locale shaped segment is **consumed**, because it was occupying the
locale slot and a supported locale now takes that slot. A segment that is not locale shaped
was never in the locale slot, so the locale is inserted **in front of it** and it keeps its
place in the path. `zz` and `de` disappear; `home` and `qwfp` survive and are routed to.

#### One behaviour change to be deliberate about

The non canonical case does not happen today. `localeCorrectionGuard` compares
`RokuTranslator.formatLocale(urlLocale)` against the desired locale, and `formatLocale`
already strips the region, so `en-US` compares equal to `en` and no redirect fires. The URL
keeps `en-US`.

The merged guard has to compare against the **raw** segment instead, so that a segment
which is supported but not canonical is still rewritten. Small change, and it needs its own
test, because the two locales being equal after formatting is exactly what makes it look
correct today.

`isLocaleSegment` already distinguishes rows two and three (`^[a-z]{2}(-[A-Z]{2})?$`), so
no new matching logic is needed.

### D7: three call sites hardcode "the locale is segment 0"

All three break under the reorder, and all three are the mechanical core of the migration:

| Site | What it does |
| --- | --- |
| `locale-routing/locale-guard.ts:29` | reads `segments[0]` to decide whether a locale is present |
| `locale-routing/locale-correction-guard.ts:35` | writes `primary.segments[0].path` |
| `roku-locale-store.ts:78` | writes `primary.segments[0].path` on a post render switch |

The fix is one shared helper that finds the locale segment **relative to the app's mount**
rather than at a fixed index, used by all three. The mount is already a value each app
holds: velista has `APP_BASE_PATH`, and the other apps need the equivalent. Deriving the
index from the mount rather than passing an integer keeps the "how many empty path routes
are above me" question out of it, which is the same reasoning `appPath` in
`libs/velista/platform` already records.

`appPath` itself builds `['', locale, ...mount, ...segments]` and flips to
`['', ...mount, locale, ...segments]`. In the standalone build the mount is `''`, so the
result is `/{locale}/...` under both shapes and nothing about that file's contract
changes.

### D8: init stops being an app initializer

`provideAppInitializer` runs once, from the root injector, at bootstrap. It is the wrong
hook for something an app owns, and under the shell an app is not bootstrapping at all.

Use `provideEnvironmentInitializer`, which runs when the injector declaring it is created,
and is therefore true in both the mounted and the standalone case. velista already relies
on exactly this for `ConnectionRecovery` and for `RokuTranslatorService`, and the note on
`VELISTA_TRANSLATION_PROVIDERS` explains why `APP_INITIALIZER` silently never ran.

Because that initializer cannot *block*, waiting for strings stays where velista already
puts it: a route `resolve` on the parent route, reading `loaded$`.

### D9: the interceptor ordering constraint, generalised

velista hit this and fixed it in `fc337b4`, and the reason belongs in this library's
documentation, because any app that gains a backend will hit it identically.

A functional `HttpInterceptorFn` resolves its `inject()` calls from **the injector that
declares `provideHttpClient`**. `gatewayInterceptor` injects `RokuTranslatorService` to
set `Accept-Language`. Providers on a route are visible downward only, so translation
providers installed on the route table are invisible to an interceptor declared on the app
injector, and every gateway request throws `NG0201`.

**Rule.** Translation providers go on the same injector as `provideHttpClient`, or above
it. Injector membership decides this, not array position, but writing them above
`provideHttpClient` is how a reader learns the constraint exists.

There is a loose end this plan tidies rather than inherits, and D11 is where it lands.

Because `entry.routes.ts` lazy loads the shell library, the app cannot import its barrel
statically, so `app-providers.ts` currently reaches in by relative path
(`../../../../libs/velista/feature-shell/src/lib/translation-providers`). That works, and
it keeps the entry chunk to one file rather than a whole barrel, but it is a relative
import across a library boundary, which CLAUDE.md forbids. `daa1795` suppressed the lint
error with a pointer to this plan rather than working around it, so the debt is visible
and the suppression comes out with D11.

### D11: the composition lives in the app, not in the shell library

The reason `translation-providers.ts` sits in `feature-shell` has expired. Plan 0006 put it
there because the providers were installed by the route table, and the route table lives in
that library. D9 moved the providers to the app injector; the file did not follow, and
every awkward thing about it since is a symptom of it sitting in a library the app is
forbidden to import statically.

The file's own docblock already argues for the move: the `provideRokuTranslator` call "has
to live in the app's composition layer", and which namespaces an app has "is composition
and belongs to the app's entry point". `feature-shell` was never the intended home, it was
the reachable one.

Three pieces, three homes, and the same shape for all four apps:

| Piece | Home | Why |
| --- | --- | --- |
| `composeTranslationLoader` | `rokutranslator-angular` | Generic. `odontogram-ui-module.ts` hand rolls the same namespace dispatcher inline, so lifting it deletes a duplication rather than copying one into four apps. |
| The `TranslationSource` descriptor and its loader | the library that owns the assets (`ui`, `models-localization`) | Unchanged. The loader is a relative `import()` of that library's own asset folder, so it genuinely cannot move. |
| The source list, the default namespace, and the `provideRokuTranslator` call | **`apps/<app>/src/app/translation-providers.ts`** | Statically importable by `app-providers.ts`. No boundary violation and no suppression. |

**The one cost, measured rather than assumed.** The app then statically imports
`@portfolio/<app>/ui` for the descriptor, which for velista is a barrel of 40 component
exports, and that pulls `ui` into the remote's entry chunk. It is close to free: `ui`
already lands in the `feature-shell` chunk, because that library's `routes.ts` imports
`AppLayout` statically, and both chunks are fetched before first paint since the parent
route is the entry point. So `ui` moves between two chunks that are always fetched
together. The pages stay lazy either way, which is the property plan 0007 was protecting.

The spec moves with the file. Each app project already has a jest config, so
`composeTranslationLoader`'s tests follow it into `rokutranslator-angular` and the
composition test lives in the app.

### D10: the shell loses the ability to translate route titles

`RokuTitleStrategy` is `providedIn: 'root'` in the shell and calls the singleton's `t()`
with a `titleNs` from route data, so today the shell localizes titles on behalf of every
remote. With per app instances the shell has no translator to call, and route `data`
naming another app's namespace stops meaning anything.

**Decision, from Daniel: each app sets its own title.**

The app already holds its translator and its strings, so the title goes next to the
instance that owns it. It is also the only option that survives an app running standalone,
which velista's backlog plan depends on.

Two alternatives, recorded because they will look attractive to somebody later. Keeping a
shell strategy that injects the *active* app's translator requires the shell to know which
app is mounted, which is exactly the coupling this plan removes. Dropping localized titles
is cheapest and is a real regression on a portfolio whose whole point is being multilingual.

Shape: each app's parent route sets the document title from its own `RokuTranslatorService`,
after the locale guard and alongside the `translationsReady` resolve, so the title is set in
the language the page is about to render. The shell keeps a `TitleStrategy` only for a
literal `title` string with no translation.

The shell's `titleNs` / `titleFallback` route data goes away, `RokuTitleStrategy` loses its
`RokuTranslator` dependency, and `0002` D8 (localized document titles) is superseded.

## The new public API

What a composing app writes after this plan, in the **app** rather than in a library
(D11), and imported normally by `app-providers.ts`:

```ts
// apps/<app>/src/app/translation-providers.ts
import { composeTranslationLoader } from '@portfolio/localization/rokutranslator-angular';
import { APP_AVAILABLE_LOCALES, APP_UI_TRANSLATIONS } from '@portfolio/<app>/ui';

const sources = [APP_UI_TRANSLATIONS];

export const APP_TRANSLATION_PROVIDERS = [
  ...provideRokuTranslator({
    locales: APP_AVAILABLE_LOCALES,
    defaultNamespace: APP_UI_TRANSLATIONS.namespace,
    namespaces: sources.map((s) => s.namespace).filter((n) => n !== defaultNamespace),
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
```

Adding a second library that ships assets stays a single entry in `sources`.

`provideRokuTranslator` now returns, in addition to what it returns today, the
`ROKU_TRANSLATOR` instance and the `RokuLocaleStore` bound to it. No call site changes
shape; the array simply carries more.

What disappears from the workspace:

- the `RokuTranslator` instance export, replaced by the class
- `provideAppInitializer(() => RokuTranslator.init(...))` in the shell's `app.config.ts`
- `RokuTranslatorModule.withConfig` as the way an app registers translations, since every
  app moves to the provider array (the module stays, for the pipe)
- `localeCorrectionGuard` as a separate export, folded into `localeGuard`
- `odontogram-ui-module.ts`'s inline namespace dispatcher, replaced by the shared
  `composeTranslationLoader` (D11)
- the `@nx/enforce-module-boundaries` suppression in velista's `app-providers.ts`, added by
  `daa1795` and removed by D11

## Acceptance criteria

1. `libs/shared/localization/rokutranslator` exports a class and no instance.
2. Two instances in one test hold two different active locales at once, and neither sees
   the other's namespaces. This is the test that would have caught D3.
3. A namespace registered **after** `init` loads through the backend path, proving D3 is
   fixed rather than still dead.
4. `RokuLocaleStore` is not `providedIn: 'root'` anywhere, and resolving it from an
   injector with no `provideRokuTranslator` above it is an error rather than a silent
   second instance.
5. One guard handles all four cases of the D6 table, driven only by route `data`, with a
   test per case and a test per worked example, including the two that end on a 404 and the
   three that change the active locale.
6. The guard never routes to a not found page and never declines a URL. Every path below a
   mount reaches normal routing with a supported canonical locale already settled, so an
   app's 404 page is always rendered in a known language.
7. No file outside the localization libraries reads `segments[0]` to find a locale.
8. No app imports anything by a relative path across a library boundary, and the
   `@nx/enforce-module-boundaries` suppression in velista's `app-providers.ts` is gone.
9. `composeTranslationLoader` exists once, in `rokutranslator-angular`, and odontogram's
   inline dispatcher is gone.
10. `nx run-many --all --target=test` and `--target=lint` are green.

## Out of scope

Anything about *which* URL each app uses, which is `apps/shell/plans/0003`. Anything about
velista's own origin or its manifest, which is its backlog plan. Translation content,
namespace names, and the JSON files, none of which move.

## Open questions

None. The three this plan opened were settled by Daniel before implementation started, and
each is recorded in the decision it belongs to rather than here:

- an unsupported locale shaped segment is **replaced**, not preserved (D6, with four worked
  examples)
- **each app sets its own title** (D10)
- the composition lives in **the app**, with `composeTranslationLoader` lifted into
  `rokutranslator-angular` (D11)
