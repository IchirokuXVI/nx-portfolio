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

**B2. `RokuTranslatorService` registers and tears down all namespaces.** In the
constructor, `addNamespace` every namespace it is configured with (default plus
`_namespaces`), not just the default; in `ngOnDestroy`, `removeNamespace` all of them.
This removes the need for `OdontogramUiModule`'s manual
`RokuTranslator.addNamespace('odontogram/models')`, which is deleted.

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
  transform(key: string, ns?: string): string {
    return this._serv.t(key, ns);
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

### C. Data: sending the locale and refetching on change

Two orthogonal concerns. Keep them separate.

**C1. Transport: attach the locale to every request (do this regardless of the reload
decision).** An `HttpInterceptor` reads `RokuTranslator.getLocale()` (or
`store.locale()`) and sets it on each outgoing request:

```ts
export const localeHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  const locale = inject(RokuLocaleStore).locale();
  return next(req.clone({ setHeaders: { 'Accept-Language': locale } }));
};
```

Preferred transport is the `Accept-Language` header: standard, requires no change to
any service method signature, and the in-memory services can read it later when they
become HTTP. Alternative transports (a `?locale=` query param, or an explicit method
argument) are discussed under O3. Register once in the shell's `app.config.ts`
(`provideHttpClient(withInterceptors([localeHeaderInterceptor]))`); it applies across
remotes since HttpClient is shared.

**C2. Trigger: re-run the query when the locale changes.** This is the reusable piece
the rest of this plan is really about. See the options section.

## Reusable refetch on locale change: options

All options assume `store.locale$` (Observable) and/or `store.locale()` (Signal) from
B1, and that the actual request carries the locale via the C1 interceptor (so the query
functions below do not each thread a `locale` argument by hand).

### Option A: a `withLocale` source factory (recommended default)

A tiny factory that builds a stream keyed on locale. The query is expressed as a
function of locale; `switchMap` cancels the in-flight previous-locale request when the
locale changes.

```ts
// libs/shared/data-access (or a new shared/util-rxjs)
export function withLocale<T>(
  locale$: Observable<string>,
  project: (locale: string) => Observable<T>
): Observable<T> {
  return locale$.pipe(switchMap(project));
}

// usage in a component/store
treatments$ = withLocale(this.localeStore.locale$, () =>
  this.treatmentService.getList(this.filter)
);
```

- Pros: dead simple, explicit that the stream depends on locale, `switchMap` gives
  free cancellation, no manual trigger management, works with today's `of(...)` memory
  services and tomorrow's HTTP unchanged.
- Cons: only keys on locale; if the query also depends on other reactive inputs
  (filter, route id) you compose with Option C instead.

### Option B: a pipeable operator `refetchOnLocaleChange()`

Same idea expressed as an operator so it reads left to right off an existing cold
source. The locale acts purely as a re-trigger; the source is re-subscribed.

```ts
export function refetchOnLocaleChange<T>(locale$: Observable<string>) {
  return (source$: Observable<T>): Observable<T> =>
    locale$.pipe(switchMap(() => source$));
}

// usage
treatments$ = this.treatmentService
  .getList(this.filter)
  .pipe(refetchOnLocaleChange(this.localeStore.locale$));
```

- Pros: ergonomic pipeable syntax; drop it onto any existing query stream.
- Cons: the `source$` is captured once with a fixed filter, so it only re-fetches on
  locale, not on filter change (fine when the filter is static for that view). `source$`
  must be cold/re-subscribable (HttpClient and `of(...)` are). Slightly less obvious
  that the emitted value ignores locale's actual value.

### Option C: `combineLatest([locale$, params$]) → switchMap` (most general)

When the query depends on locale and other reactive params (filter, selected id),
combine them and switchMap. This is the robust general form; A and B are special cases.

```ts
data$ = combineLatest([this.localeStore.locale$, this.filter$]).pipe(
  switchMap(([, filter]) => this.treatmentService.getList(filter))
);
```

- Pros: correct for multi-input queries; composes cleanly; one obvious pattern for all
  "reactive query" cases in the app.
- Cons: more ceremony; needs params as streams (`filter$`), which pushes components
  toward a reactive style. Consider `debounceTime`/`distinctUntilChanged` on params.

### Option D: Signal-first with `rxResource` / `resource` (future-facing)

Since B introduces a locale signal, components that are already signal based can use
Angular's `rxResource` (Angular 19+) keyed on the locale (and other) signals. Auto
refetches when the request signal changes and gives `value` / `isLoading` / `error`.

```ts
treatments = rxResource({
  request: () => ({ locale: this.localeStore.locale(), filter: this.filter() }),
  loader: ({ request }) => this.treatmentService.getList(request.filter),
});
```

- Pros: no manual subscription/teardown, built-in loading+error state, matches the
  signal direction B opens; the cleanest long-term.
- Cons: depends on Angular version (`rxResource` is newer/experimental in some
  releases); mixing with `pure:false` pipes is fine but two reactivity styles coexist.
  Verify the workspace's Angular version before committing to this (see O4).

### Option E: explicit refetch `Subject` merged with locale (escape hatch)

For imperative "reload now" buttons plus locale, merge a manual trigger with the
locale stream. Most boilerplate; list it only as the escape hatch when a view needs a
user-driven refresh in addition to locale.

```ts
private _refetch$ = new BehaviorSubject<void>(undefined);
data$ = merge(this.localeStore.locale$, this._refetch$).pipe(
  switchMap(() => this.treatmentService.getList(this.filter))
);
```

### Recommendation

Adopt **Option A (`withLocale`)** as the documented default for the common
"fetch keyed on locale" case, and **Option C** (`combineLatest`) as the sanctioned
pattern when the query also depends on other reactive inputs. Ship both as small,
tested helpers in a shared location (either `shared/data-access` or a new
`shared/util-rxjs`), document them in the library README with the odontogram treatment
list as the worked example, and keep **Option D** noted as the future signal-first path
once the Angular version is confirmed. Option B is a nice-to-have alias over A; Option E
is an escape hatch. The C1 interceptor is adopted unconditionally so the transport is
uniform no matter which trigger a given screen uses.

## Rollout / implementation order

1. Core A1 (loader map fix) and A2/A3 (multicast emitter, await resources). Unit tests.
2. Angular B1 (`RokuLocaleStore`), B2/B3 (namespace ownership, eager load), B4 (pipe
   `pure:false`). Delete `OdontogramUiModule`'s manual `addNamespace`.
3. C1 interceptor wired in shell `app.config.ts`.
4. C2 helpers (`withLocale`, `combineLatest` guidance) in the shared lib with tests and
   README.
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
- Data: interceptor sets `Accept-Language` on outgoing requests; `withLocale` /
  `combineLatest` helpers re-emit on locale change and cancel the previous request
  (`switchMap` marble test).
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
