# 0005: An app owned translator (the singleton retires)

## Implementation status

Not started. This plan is the **contract**; `apps/shell/plans/0003-app-owned-locale-routing.md`
is the migration that consumes it, and `apps/velista/plans/backlog/0001-own-origin-and-pwa.md`
is blocked on both. Write the library first, migrate the apps second.

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
(`appKey`, `supportedLocales`, `defaultLocale`), with three cases:

| Segment after the mount | Action | Example at `/velista` |
| --- | --- | --- |
| A supported locale | proceed | `/velista/es/home` stays |
| Absent, or not locale shaped | **insert** the resolved locale, keep the segment | `/velista/home` becomes `/velista/en/home` |
| Locale shaped but unsupported | **replace** the segment | `/velista/zz/home` becomes `/velista/en/home` |

**The third row is a judgement call and Daniel may overrule it.** A literal reading of
"the locale part will be used as the next url segment after the locale" would preserve
`zz` and produce `/velista/en/zz/home`, matching row two's shape. It is written as a
replacement because `zz` is not a route in any app, so preserving it guarantees a 404
where replacing it renders the page the visitor asked for. Row two preserves its segment
precisely because that segment usually *is* a real route.

Resolution order for "the resolved locale" is unchanged from plan 0002 D5: the app's last
used locale from `roku-locale:{appKey}`, then the browser locale, then the app's default.

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

There is a loose end this plan should tidy rather than inherit. Because `entry.routes.ts`
lazy loads the shell library, the app cannot import its barrel statically, so
`app-providers.ts` currently reaches in by relative path
(`../../../../libs/velista/feature-shell/src/lib/translation-providers`). That works, and
it keeps the entry chunk to one file rather than a whole barrel, but it is a relative
import across a library boundary, which CLAUDE.md forbids. The clean fix is for the
composed translation providers to live in a library the app can import normally, which for
velista means moving `translation-providers.ts` out of `feature-shell`. Decide it here so
all four apps land the same way rather than each inventing an escape.

### D10: the shell loses the ability to translate route titles

`RokuTitleStrategy` is `providedIn: 'root'` in the shell and calls the singleton's `t()`
with a `titleNs` from route data, so today the shell localizes titles on behalf of every
remote. With per app instances the shell has no translator to call, and route `data`
naming another app's namespace stops meaning anything.

Options, with a recommendation:

1. **Each app sets its own title.** The app already has its translator and its strings.
   The shell keeps a `TitleStrategy` that handles only a literal `title` and a fallback,
   and each app's parent route sets the document title from its own service.
   **Recommended:** it puts the string next to the instance that owns it, and it is the
   only option that survives an app running standalone.
2. Keep a shell strategy that injects the *active* app's translator. Requires the shell to
   know which app is mounted, which is the coupling this plan removes.
3. Drop localized titles. Cheapest, and a real regression on a portfolio.

Whichever is chosen, the shell's `titleNs` / `titleFallback` route data goes away, and
`0002` D8 (localized document titles) is superseded.

## The new public API

What a composing app writes after this plan:

```ts
// libs/<scope>/feature-shell/src/lib/translation-providers.ts
export const APP_TRANSLATION_PROVIDERS = [
  ...provideRokuTranslator({
    locales: APP_AVAILABLE_LOCALES,
    defaultNamespace,
    namespaces,
    loader: composeTranslationLoader(sources),
  }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
```

`provideRokuTranslator` now returns, in addition to what it returns today, the
`ROKU_TRANSLATOR` instance and the `RokuLocaleStore` bound to it. No call site changes
shape; the array simply carries more.

What disappears from the workspace:

- the `RokuTranslator` instance export, replaced by the class
- `provideAppInitializer(() => RokuTranslator.init(...))` in the shell's `app.config.ts`
- `RokuTranslatorModule.withConfig` as the way an app registers translations, since every
  app moves to the provider array (the module stays, for the pipe)
- `localeCorrectionGuard` as a separate export, folded into `localeGuard`

## Acceptance criteria

1. `libs/shared/localization/rokutranslator` exports a class and no instance.
2. Two instances in one test hold two different active locales at once, and neither sees
   the other's namespaces. This is the test that would have caught D3.
3. A namespace registered **after** `init` loads through the backend path, proving D3 is
   fixed rather than still dead.
4. `RokuLocaleStore` is not `providedIn: 'root'` anywhere, and resolving it from an
   injector with no `provideRokuTranslator` above it is an error rather than a silent
   second instance.
5. One guard handles all three rows of the D6 table, driven only by route `data`, with a
   test per row.
6. No file outside the localization libraries reads `segments[0]` to find a locale.
7. `nx run-many --all --target=test` and `--target=lint` are green.

## Out of scope

Anything about *which* URL each app uses, which is `apps/shell/plans/0003`. Anything about
velista's own origin or its manifest, which is its backlog plan. Translation content,
namespace names, and the JSON files, none of which move.

## Open questions

1. **D6 row three**, replace or preserve an unsupported locale shaped segment. Written as
   replace; Daniel's sentence reads as preserve. Settle before the guard is written.
2. **D10**, which of the three title options. Recommended is per app titles.
3. **D9's loose end**, where composed translation providers live so the app can import
   them without a relative cross boundary path.
