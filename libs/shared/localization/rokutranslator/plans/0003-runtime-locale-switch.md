# 0003: Runtime locale switch (no reload, reactive translations, locale-aware data refetch)

> Reverses one locked decision from [[0002-locale-routing-refactor]]: "Keep the full
> page reload ... Do not make translations reactive." This plan makes translations
> reactive, drops the reload from the post-render switch, and introduces a standard,
> reusable way for data-access calls to carry the active locale and refetch when it
> changes. The pre-render correction flow from 0002 (guards, per-app storage,
> locale-first routing) stays; only the post-render user switch changes.
>
> Deliver the detailed design; implement only after Daniel approves.

## Goal

A user changes language from the switcher and the page updates in place: no full
document reload, no flash, in-app state (open modal, form input, scroll, selected
tooth) preserved. Concretely:

1. The `rokuT` pipe becomes `pure: false` so already rendered bindings re-translate
   when the active locale changes at runtime.
2. `switchAppLocale` stops doing `window.location.href = ...`; it changes the locale
   in place (updates `RokuTranslator`, rewrites the URL locale segment via router
   navigation, persists the per-app choice).
3. Data that depends on locale (currently in-memory, later a real backend) is
   refetched through one reusable, documented pattern, so nothing is left rendered in
   the previous language. The locale is sent to the server on every request.

## Non-goals

- No change to the pre-render correction flow (`localeGuard`, `localeCorrectionGuard`,
  `resolveDesiredLocale`, per-app storage). Those already settle the locale before
  first paint and keep working unchanged.
- No new i18n library. Still the hand-rolled `RokuTranslator` singleton over i18next.
- Not switching the whole app to signals or zoneless in this plan. `pure: false` is
  the explicit, minimal mechanism Daniel asked for. A signal based path is listed as a
  future option (Option D below) but is not required here.

## Problems this fixes (recap from analysis)

1. **Dead lazy backend (latent bug).** `loadersByLocaleAndNamespace` is only ever
   `new Map()` at declaration; the inner per-locale maps are never created, so
   `setLocaleNamespaceLoader` runs `.get(locale)?.set(...)` on `undefined` and is a
   silent no-op (`rokutranslator.ts:245`). `getLocaleNamespaceLoader` therefore always
   returns `undefined`, and the i18next custom backend `read` can never load anything.
   Everything works today only because `addTranslations` eagerly `addResources` for the
   current locale. A runtime switch to another locale would find no resources.
2. **`onLocaleChange` is a single mutable callback, not multicast**
   (`rokutranslator.ts:38`). In shell + N remotes, the last assignor wins and clobbers
   the rest. A reactive UI needs every interested party to observe locale changes.
3. **Nothing is reactive to locale.** `RokuTranslatorPipe` is pure and there is no
   locale signal/observable, so today only a reload reflects a switch.
4. **Namespace lifecycle asymmetry.** `RokuTranslatorService` registers (via
   `addNamespace`) only the default namespace and removes only the default namespace,
   forcing `OdontogramUiModule` to manually `addNamespace('odontogram/models')`
   (`odontogram-ui-module.ts:36`). The service should own all its namespaces.

## Design overview

Three layers, each with a single responsibility:

1. **Core (`rokutranslator`): correct + observable.** Fix the loader map so
   `changeLanguage` can load a locale's resources on demand. Replace the single
   `onLocaleChange` callback with a small multicast emitter (framework agnostic, no
   RxJS dependency in the core lib). Make `changeLocale` await resource loading for the
   active namespaces before it notifies, so observers never see a locale whose strings
   are not ready.

2. **Angular (`rokutranslator-angular`): reactive surface.** Add one root-singleton
   `RokuLocaleStore` (`providedIn: 'root'`) that subscribes to the core emitter once
   and exposes the current locale as both a `signal` and a `locale$` observable. This
   is the single source of truth every pipe, component, and data pipeline reads, which
   sidesteps the fact that `RokuTranslatorService` is instantiated per module (per
   remote). `RokuTranslatorService` keeps owning namespace loading but is fixed to
   register/teardown all its namespaces and to eager-load all supported locales. The
   `rokuT` pipe becomes `pure: false`.

3. **Data (`shared/data-access` + per-scope services): locale-aware fetch.** One HTTP
   interceptor attaches the active locale to every outgoing request (transport), and
   one reusable RxJS/Signal helper re-runs a query when the locale changes (trigger).
   The options for that helper are the main deliverable and are enumerated below.

```
 core emitter (locale changed)
        │
        ▼
 RokuLocaleStore (root singleton)
   ├── locale  : Signal<string>     ← pipe (pure:false) + components read
   └── locale$ : Observable<string> ← data pipelines key off this
        │
        ├─► HttpInterceptor: attach Accept-Language to every request
        └─► refetch helper: re-run query on locale change
```

## Detailed changes

### A. Core: `libs/shared/localization/rokutranslator`

**A1. Initialize the inner loader map (fix the dead backend).** In
`setLocaleNamespaceLoader`, create the per-locale map if absent instead of relying on
optional chaining:

```ts
setLocaleNamespaceLoader(locale, namespace, loader) {
  const key = this.formatLocale(locale);
  let byNs = this.loadersByLocaleAndNamespace.get(key);
  if (!byNs) {
    byNs = new Map();
    this.loadersByLocaleAndNamespace.set(key, byNs);
  }
  byNs.set(namespace, loader);
}
```

Also remove the double `formatLocale(formatLocale(locale))` call. After this, the
i18next custom backend `read` can resolve a loader, so `changeLanguage` lazily loads a
locale's namespaces that were registered but not yet materialized.

**A2. Replace `onLocaleChange` with a multicast emitter.** Keep the core free of RxJS.
A minimal listener registry:

```ts
private localeListeners = new Set<(locale: string) => void>();

onLocaleChange(listener: (locale: string) => void): () => void {
  this.localeListeners.add(listener);
  return () => this.localeListeners.delete(listener);
}

private emitLocaleChange(locale: string) {
  for (const l of this.localeListeners) l(locale);
}
```

`changeLocale` calls `emitLocaleChange(locale)` at the end. This is backward compatible
in intent with 0002's note that `onLocaleChange` becomes "a notification hook".
Migrate any existing single-callback assignment to `onLocaleChange(fn)`.

**A3. `changeLocale` awaits resources before notifying.** After
`i18nextInstance.changeLanguage(locale)`, ensure the active namespaces for the new
locale are loaded (i18next's `changeLanguage` already triggers backend loads for
active `ns`; await its completion) so observers never render missing keys. Only then
`emitLocaleChange`.

### B. Angular: `libs/shared/localization/rokutranslator-angular`

**B1. New `RokuLocaleStore` (root singleton).**

```ts
@Injectable({ providedIn: 'root' })
export class RokuLocaleStore {
  private _locale = signal(RokuTranslator.getLocale());
  readonly locale = this._locale.asReadonly();
  readonly locale$ = toObservable(this._locale); // or a BehaviorSubject bridge

  constructor() {
    RokuTranslator.onLocaleChange((l) => this._locale.set(l));
  }
}
```

One instance app wide, so shell and every remote observe the same locale. The signal
`set` schedules change detection (under zone.js the awaited promise resolution already
ticks CD; the signal makes it explicit and keeps the door open for zoneless later).
`locale$` is the hook data pipelines subscribe to. (If `toObservable` injection context
is awkward from a service, back the store with a `BehaviorSubject` and derive the signal
via `toSignal`; pick one direction in implementation.)

> **Design principle: locale is read, not passed.** No translation getter and no
> refetch helper takes the locale (or a locale stream) as a required argument. They all
> read the active locale from `RokuTranslatorService`, which delegates to
> `RokuLocaleStore`. A `locale` argument appears only as an **optional override** for the
> "give me this in another language" case, and only on `t()` (a one-off lookup), never on
> the reactive refetch stream, whose whole job is to follow the current locale.
>
> `RokuTranslatorService` is instantiated per module (each remote configures its own
> namespaces), so it cannot be the single global holder by itself. The single source of
> truth is the root `RokuLocaleStore`; the service just re-exposes it, so from a
> consumer's point of view "the service holds the current locale" holds true.

**B2. `RokuTranslatorService` re-exposes the locale and owns its namespaces.**

The service injects `RokuLocaleStore` and re-exposes the locale so callers read it off
the service they already inject:

```ts
private _store = inject(RokuLocaleStore);
getLocale() { return this._store.getLocale(); }
get locale()  { return this._store.locale; }   // Signal<string>
get locale$() { return this._store.locale$; }   // Observable<string>

// optional `locale` overrides the current one for a different language (i18next `lng`)
t(key: string, ns?: string, locale?: string): string {
  return RokuTranslator.t(key, {
    ns: ns ?? this._defaultNamespace ?? this._namespaces[0],
    lng: locale,
  });
}
```

It also fixes the namespace asymmetry: in the constructor `addNamespace` **every**
namespace it is configured with (default plus `_namespaces`), not just the default; in
`ngOnDestroy`, `removeNamespace` all of them. This removes the need for
`OdontogramUiModule`'s manual `RokuTranslator.addNamespace('odontogram/models')`, which
is deleted.

**B3. Eager-load all supported locales at init.** Today the service loads only
`this._locales` for the current run and relies on reload for the other locale. For a
runtime switch, load every supported locale's namespaces up front (the payloads are
small; odontogram has 2 locales). This makes the switch instant with no fetch and does
not depend on the lazy backend at switch time. (A1 still matters for correctness and for
future large locale sets where eager loading all is undesirable.)

**B4. `rokuT` pipe becomes `pure: false`.**

```ts
@Pipe({ name: 'rokuT', pure: false })
export class RokuTranslatorPipe implements PipeTransform {
  private _serv = inject(RokuTranslatorService);
  // `locale` stays optional (defaults to the service's current locale); pass it only
  // to force a key into a specific language.
  transform(key: string, ns?: string, locale?: string): string {
    return this._serv.t(key, ns, locale);
  }
}
```

With `pure: false` the pipe re-evaluates every change-detection cycle and returns the
current locale's string, so runtime switches show immediately. Trade-off: it runs on
every CD tick for every `| rokuT` in the view. For this app's binding counts that is
acceptable; if a hot template ever shows up in profiling, migrate that template to the
signal path (read `store.locale()` in a `computed`, Option D) without changing the pipe
API elsewhere. Note this trade-off in the pipe's doc comment.

**B5. `switchAppLocale` drops the reload.**

```ts
export function switchAppLocale(appKey, locale, deps): void {
  writeAppLocale(appKey, locale);
  RokuTranslator.changeLocale(locale);        // await inside; emits → store updates
  // rewrite the URL locale segment via Router navigation (not window.location)
  deps.router.navigate([...segmentsWithLocaleReplaced]);
}
```

Because the guards already accept a valid locale in the URL, a `router.navigate` that
only swaps the leading segment does not trigger a reload and does not re-run the remote
bootstrap. The awaited `changeLocale` updates the store, which flips the signal, which
re-renders the pure:false pipes and re-triggers the data pipelines (section C). Decide
whether `switchAppLocale` stays a free function taking injected deps or becomes a small
method on `RokuLocaleStore` (recommended, so it can inject `Router` and the store
itself). Ordering (change locale first vs navigate first) is an open question, see O2.

### C. Data: refetching on change (and how the locale reaches the server)

> **Revision (as implemented).** Two decisions here changed once the data layer was
> surveyed:
>
> 1. **The data-access services take `locale` as an explicit method argument**
>    (`getList(locale, filter)`, `getByDetailSlug(slug, locale)`). So there is no
>    header to send today; the "transport" question only arises for a future HTTP
>    backend that localizes by `Accept-Language`. The blanket `localeHeaderInterceptor`
>    was therefore removed (it was dead: every real service reads the locale as an
>    argument). When the HTTP backend lands, attach the header at request-build time,
>    ideally via an **opt-in `HttpContext` interceptor** so only requests you mark carry
>    it, not blanket. See C1 below.
> 2. **A pipe/operator cannot add a header to the request it is piped onto.** By the
>    time any operator runs, HttpClient has already built and dispatched the request;
>    the operator only sees the response stream. So "the `withLocale` pipe adds the
>    header" is not achievable, and coupling the generic refetch to HTTP would break its
>    reuse for non-request work (restart an animation, reload an asset). Refetch and
>    transport stay separate.
> 3. **`withLocale` provides the current locale to the projection** (`(locale) => ...`),
>    because the services need it as an argument. The call site still never reads the
>    locale by hand; projects that do not need it ignore the parameter.

**C1. Transport (only when the server localizes by header).** Not needed today. When a
real HTTP backend exists, attach the locale at request-build time via an opt-in
interceptor gated on an `HttpContext` token, so it is explicit per call:

```ts
// future: only requests that opt in carry the header
export const localeHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.context.get(LOCALE_AWARE)) return next(req);
  const locale = inject(RokuLocaleStore).getLocale();
  return next(req.clone({ setHeaders: { 'Accept-Language': locale } }));
};
// usage: this.http.get(url, { context: localeAware() })
```

Because `withLocale` re-subscribes the source on a locale change, a re-issued request
is a fresh request, and the interceptor stamps the current locale at dispatch, so the
two compose without either knowing about the other. Alternative transports (a `?locale=`
query param, an explicit argument as the in-memory services already use) are under O3.

**C2. Trigger: re-run the query when the locale changes.** This is the reusable piece
the rest of this plan is really about. See the options section.

## Reusable refetch on locale change: options

The caller never passes a locale stream. `withLocale` reads `locale$` from
`RokuTranslatorService` (delegating to `RokuLocaleStore`) and hands the current locale
to the projection, because the data-access services take it as an argument. Projects
that do not need it (an animation, an asset reload) ignore the parameter.

A and B are the **same mechanism**: A is the primitive, B is a pipeable wrapper that
calls A. C is a **separate**, more general shape for the rarer case where a query
depends on more than the locale; it is kept as its own option rather than folded into A,
so A stays as small as possible.

### Option A: `withLocale(project)` primitive on the service (recommended default)

Builds a stream keyed on the current locale. `switchMap` cancels the in-flight
previous-locale subscription when the locale changes. The current locale is passed to
the projection; the caller passes only the query.

```ts
// method on RokuTranslatorService
withLocale<T>(project: (locale: string) => Observable<T>): Observable<T> {
  return this._store.locale$.pipe(switchMap((locale) => project(locale)));
}

// usage — refetches whenever the language changes
projects$ = this.i18n.withLocale((locale) => this.projectService.getList(locale));
```

- Pros: as small as it gets; caller passes neither locale nor locale$; `switchMap` gives
  free cancellation; works unchanged with today's `of(...)` memory services and
  tomorrow's HttpClient.
- Cons: keys on locale only. When a query also depends on a reactive parameter, reach
  for Option C instead (they do not stack on one stream).

### Option B: `refetchOnLocaleChange()` pipeable operator (sugar over A)

The same idea as a left-to-right operator dropped onto an existing cold source. It
**delegates to A**; the source is re-subscribed on each locale change. The operator
`inject()`s the service itself, so the caller passes nothing:

```ts
export function refetchOnLocaleChange<T>(): MonoTypeOperatorFunction<T> {
  // Called at pipe-build time, so this runs in the caller's injection context
  // (a field initializer / constructor). If used outside one, inject() throws
  // NG0203 by design — that is the "raise an error" behavior, no custom guard needed.
  const i18n = inject(RokuTranslatorService);
  return (source$) => i18n.withLocale(() => source$);
}

// usage — a plain field initializer is an injection context, so inject() resolves
treatments$ = this.treatmentService
  .getList(this.filter)
  .pipe(refetchOnLocaleChange());
```

- Pros: ergonomic pipeable syntax, and the caller passes no service; nothing new to
  learn since it is A underneath.
- Cons: `inject()` fixes *where* it may be called (a field initializer or constructor,
  not a later method); calling it outside an injection context throws at construction,
  which is the intended fail-fast. `source$` is captured once (fixed filter), so it
  refetches on locale only, and must be cold/re-subscribable (HttpClient and `of(...)`
  are). Use A directly, not A+B stacked, on any single query; B is a stylistic alias.

> Note on `inject()` timing: call it in the **factory body** (as above), which runs when
> `.pipe(refetchOnLocaleChange())` is evaluated in the field initializer, not inside the
> returned operator (which runs at subscribe time, outside any injection context). If a
> call site genuinely cannot be an injection context, fall back to the explicit form
> `refetchOnLocaleChange(this.i18n)` overload.

### Option C: `combineLatest([locale$, params$]) → switchMap` (multi-input queries)

When a query depends on the locale **and** other reactive parameters (a search box, a
filter dropdown, a route id), combine them and `switchMap`. This is the general form; A
is the locale-only special case of it.

```ts
// refetches when locale OR the filter changes
treatments$ = combineLatest([this.i18n.locale$, this.filter$]).pipe(
  switchMap(([, filter]) => this.treatmentService.getList(filter))
);
```

- Pros: correct for multi-input queries; one obvious inline pattern, no bespoke helper.
- Cons: more ceremony; needs the parameters as streams (`filter$`), which nudges the
  component toward a reactive style. Consider `distinctUntilChanged` / `debounceTime` on
  noisy parameter streams.

**You only need C when a query depends on more than locale.** If every query in a view
has static parameters (fetch once, refetch only on language change), A/B are enough and
C never appears.

### Option D: Signal-first with `rxResource` / `resource` (future-facing)

Because B1 introduces a locale signal, signal-based components can use Angular's
`rxResource` (Angular 19+) keyed on `this.i18n.locale()` (and other signals). Auto
refetches when the request signal changes and gives `value` / `isLoading` / `error`.

```ts
treatments = rxResource({
  request: () => ({ locale: this.i18n.locale(), filter: this.filter() }),
  loader: ({ request }) => this.treatmentService.getList(request.filter),
});
```

- Pros: no manual subscription/teardown, built-in loading+error state, matches the
  signal direction B1 opens; the cleanest long-term.
- Cons: depends on Angular version (`rxResource` is newer/experimental in some
  releases); two reactivity styles then coexist with the pure:false pipe. Verify the
  workspace's Angular version before committing (see O4).

### Recommendation

Adopt **Option A (`withLocale`)** as the documented default for locale-only queries, and
**Option C** (`combineLatest`) as the sanctioned inline pattern for the rarer query that
also depends on reactive parameters. Ship **Option B** as the thin pipeable alias over A
for call sites that read better left-to-right. Keep **Option D** noted as the future
signal-first path once the Angular version is confirmed. Put `withLocale` on
`RokuTranslatorService` (so locale stays "read, not passed") and the `refetchOnLocaleChange`
operator alongside it in `rokutranslator-angular`; document A, B, and C in the library
README with the odontogram treatment list as the worked example. The C1 interceptor is
adopted unconditionally so the transport is uniform no matter which trigger a screen uses.

## Rollout / implementation order

1. Core A1 (loader map fix) and A2/A3 (multicast emitter, await resources). Unit tests.
2. Angular B1 (`RokuLocaleStore`), B2/B3 (namespace ownership, eager load), B4 (pipe
   `pure:false`). Delete `OdontogramUiModule`'s manual `addNamespace`.
3. C1 interceptor wired in shell `app.config.ts`.
4. C2 helpers: `withLocale` on `RokuTranslatorService` plus the `refetchOnLocaleChange`
   operator (and the Option C inline idiom documented), with tests and README.
5. Migrate one data-access consumer (odontogram treatment list) to the pattern as the
   reference, verify a runtime switch updates both static UI copy and fetched data.
6. B5: flip `switchAppLocale` to in-place. Remove the reload.
7. Migrate remaining locale-dependent consumers.

Each step builds and tests green before the next; the reload is removed last so the app
is always shippable.

## Testing

- Core: loader map now stores/returns loaders; `changeLocale` loads the target locale's
  resources and notifies all registered listeners (multicast); unregister works.
- Angular: `RokuLocaleStore.locale` signal and `locale$` emit on core change; pipe
  re-renders after a runtime `changeLocale` without a reload (component test); service
  registers and tears down all namespaces (odontogram `odontogram/models` present after
  init, absent after destroy) with no manual module `addNamespace`.
- Data: interceptor sets `Accept-Language` on outgoing requests; `withLocale` re-emits
  on locale change and cancels the previous request (`switchMap` marble test);
  `refetchOnLocaleChange` delegates to it and throws when built outside an injection
  context; the Option C `combineLatest` shape re-emits on locale or parameter change.
  `t(key, ns, locale)` returns the overridden language when `locale` is passed and the
  current one otherwise.
- e2e (through the shell, per repo convention): switch language from the switcher, URL
  locale segment updates, page content and fetched data update, no full reload, and a
  piece of in-app state (an open modal or form value) survives the switch.

## Risks and mitigations

- **`pure: false` performance.** Runs every CD tick per binding. Accepted for current
  size; mitigation path is the signal/`computed` route (Option D) for any hot template,
  no API change elsewhere.
- **Change detection not firing after an async switch.** Under zone.js the awaited
  promise resolution ticks CD, and the signal `set` reinforces it. If a switch ever
  fails to paint, `ApplicationRef.tick()` or `markForCheck` on the store consumer is the
  fallback; investigate zoneless separately.
- **Missing keys mid-switch.** Prevented by A3 (await resources) plus B3 (eager load all
  locales), so the target locale's namespaces are always present before the signal flips.
- **Multicast migration.** Any code still assigning `onLocaleChange = fn` breaks when it
  becomes a registration method; grep and migrate (only the core and, historically, the
  now-removed `LocaleWrapperComponent` used it).

## Open questions

- **O1.** Core stays RxJS free (listener Set) versus exposing an RxJS `Subject`
  directly. Recommendation: keep core framework agnostic; bridge to RxJS in the Angular
  store.
- **O2.** In `switchAppLocale`, change locale before navigating or navigate first? If
  the URL is the source of truth via the correction guard, navigating to the new locale
  segment could itself drive `changeLocale`; decide whether the switcher calls
  `changeLocale` directly or only navigates and lets the guard do it (avoids a double
  change). Leaning: navigate and let the existing `localeCorrectionGuard` call
  `changeLocale`, so there is one code path for both URL-driven and switcher-driven
  changes.
- **O3.** Transport: `Accept-Language` header (recommended) versus `?locale=` query
  param versus explicit service argument. Header is cleanest but a caching CDN may need
  `Vary: Accept-Language`; note for the real backend.
- **O4.** Confirm the workspace Angular version supports `rxResource` before promising
  Option D; otherwise Option D is `toSignal` + `computed` + manual `effect`.
- **O5.** Does removing the reload change the per-app "remembered locale" semantics from
  0002 when moving between apps? The store is global but persistence is per app; verify
  an in-place switch still writes the right `roku-locale:{appKey}` and that navigating
  to another app still adopts that app's stored locale.
