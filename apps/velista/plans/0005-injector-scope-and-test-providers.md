# 0005. Injector scope, and one place to declare test providers

> Prerequisite reading: `0004` section 9 (the DI token inventory), `0001` section 5
> (the extraction contract). This plan changes no design decision in either. It fixes
> a wiring mistake that makes most of `0004` section 9 inert at runtime, and it
> removes the duplication in the specs that hid the mistake.

## 1. What was reported, and what is actually true

Three things were raised. Two are confirmed, one is confirmed as a fact but turns out
to be a deliberate decision rather than an oversight.

| Reported | Verdict |
| --- | --- |
| `APP_BRAND` has a token but no provider, and tests only pass because they provide it | **Confirmed, and worse than reported.** It has a provider, but in an injector no consumer of it can see. It is not only `APP_BRAND`: every entry in `appProviders` is affected |
| Tests should share one function for whatever has to be provided globally | **Confirmed.** Four specs hand write an `AppBrand` literal and six hand write a `BrowserFacade` double |
| `HomePage` injects `ZoneStore` directly instead of an interface | **Confirmed as fact, but it is intentional.** `0004` section 9.1 puts stores outside the token set on purpose. See section 5 |

The first one is a live defect. Under the shell, which is the only way this app runs
today, `/en/velista` cannot render at all.

## 2. Finding 1: the app providers sit in an injector that no service can reach

### 2.1 The mechanism

`apps/velista/src/app/remote-entry/entry.routes.ts` attaches `appProviders` to a
route:

```ts
export const remoteRoutes: Route[] = [
  { path: '', providers: [...appProviders], loadChildren: () => ... },
];
```

The router turns `route.providers` into a **child** `EnvironmentInjector`
(`@angular/router`, `createEnvironmentInjector(route.providers, injector, ...)`).
A child environment injector carries the scope `environment`, never `root`.

Angular resolves a `providedIn: 'root'` injectable only in an injector whose scope
set contains `root` (`R3Injector.injectableDefInScope`). A request that starts at the
route injector therefore walks up to the root injector, and the **instance is created
there**, so every `inject()` in its constructor resolves against the root injector.
The route injector is invisible to it.

The comment in `app-providers.ts` states the intent correctly: the shell never calls
this remote's `bootstrapApplication`, so the route is the only injector the app layer
can reach. The intent is right. The consequence, that a root scoped service cannot
see anything put there, is what was missed.

### 2.2 The evidence

Verified against this workspace's own Angular build, reproducing the exact topology
the router creates. A `providedIn: 'root'` class asking for a token provided on a
child environment injector:

```
NG0201: No provider found for `InjectionToken APP_BRAND`.
Path: ThemeStoreLike -> InjectionToken APP_BRAND
```

The same class, with the token moved to the root injector instead, resolves, and the
instance is identical to the one the root injector creates. That is the proof that
the dependency is read from root and not from the route.

### 2.3 What is actually broken

Every one of these follows from the same cause.

| Consumer | Needs | Provided at | Result today |
| --- | --- | --- | --- |
| `ThemeStore` (root) | `APP_BRAND` | route | **NG0201 at first render.** `AppLayout` injects it, and `AppLayout` is the parent route component of every route in the app, so nothing renders |
| `ApiUrl` (root) | `APP_API_CONFIG` | route | NG0201 as soon as any gateway URL is built |
| `ZoneStore` (root) | `ZONE_SERVICE` | route, bound to `ZoneApi` | Resolves the token's **default** from root, so it silently uses `ZoneMemory`. The backend wiring from the last commit never takes effect |
| `ZoneApi` (root) | `HttpClient` | route, via `provideHttpClient` | Resolves from root. Nothing in the shell provides `HttpClient`, so NG0201; and `gatewayInterceptor` would not apply even if something did |
| `ConnectionRecovery` | `provideAppInitializer` | route | Never constructed. `APP_INITIALIZER` is read once by `ApplicationInitStatus` at bootstrap, from the root injector. On a route injector it is inert |
| `APP_BASE_PATH` | nothing | route | No consumer exists yet, so it is only dormant, not broken |

The first row is the one that matters immediately: the app is dead under the shell.
The third row is the one that would have been hardest to find later, because it fails
silently and looks like working software served from the wrong data.

### 2.4 Why every test passes anyway

`TestBed.configureTestingModule({ providers })` puts providers in the **testing
environment injector**, which does carry the `root` scope. A `providedIn: 'root'`
service therefore sees them. Production puts the same providers one level lower,
where it does not. The reported diagnosis is exactly right: the specs pass because
they provide the token in the one place the app does not.

### 2.5 Why no other gate caught it

- `velista-e2e/src/mount.spec.ts` asserts `.app-root` is visible under the shell.
  That is precisely this failure, and it is the one suite that fails on it.
- **It does fail.** Run on 2026-08-26 against a freshly served shell, once the
  Playwright browsers were updated: 10 of 10 tests failed, every browser
  (Mobile Chrome, Mobile Safari, chromium, firefox, webkit) and both locales, with
  `element(s) not found` waiting for `.app-root` at `mount.spec.ts:24`. The app
  renders nothing at `/en/velista` and `/es/velista`. This is the empirical
  confirmation of section 2.3, row one.
- The suite had been unrunnable before that: the installed browsers were build 1217
  and the pinned Playwright wanted 1234, so every test died at browser launch. A
  failure that looks identical in the summary and has nothing to do with the app is
  a good way to lose a real regression, which is roughly what happened here.
- CI runs affected e2e, but only on push to `main`. This work is on `dev`, so the
  suite had not run against it yet.

## 3. The fix: the app injector owns the app's services

### 3.1 The rule

> **Rule D5. A service that depends, directly or transitively, on anything the app
> layer provides must be provided by the app layer too. It may not be
> `providedIn: 'root'`.**

`providedIn: 'root'` means "this belongs to whoever bootstrapped the page". Under
module federation that is the shell, and the shell knows nothing about this app. Only
services with no app level dependency may keep it.

This holds for the standalone phase as well, and costs nothing there: `appConfig`
spreads the same `appProviders` into the bootstrap, where they land in the root
injector and the classes resolve exactly as before. One list, correct in both modes,
which is what makes the extraction contract in `0001` cheaper rather than more
expensive.

### 3.2 Who moves

Drop `@Injectable({ providedIn: 'root' })` and list the class in `appProviders`:

- `ThemeStore` (`platform`), for `APP_BRAND`.
- `ApiUrl` (`data-access`), for `APP_API_CONFIG`.
- `ZoneApi` (`data-access`), transitively through `ApiUrl` and `HttpClient`.
- `ConnectionRecovery` (`data-access`), transitively through `ApiUrl`, and because
  its initializer has to run in an injector that actually runs initializers.
- `ZoneStore` (`data-access`). It injects no app token, but it must resolve
  `ZONE_SERVICE` in the injector where `provideService(ZONE_SERVICE, ZoneApi)` lives,
  otherwise it keeps picking up the memory default.
- `TokenStore` (`data-access`), which injects `ApiUrl` and `HttpClient` directly.
- `SessionStore` (`data-access`), transitively through `TokenStore`.

Who stays `providedIn: 'root'`, because nothing they need comes from the app layer:
`BrowserFacade`, `ConnectionState`, `ReloadBlocker`, `ZoneMemory`, `RealtimeMemory`,
and `Mutations`, which injects nothing at all.
Keeping the memory implementations root provided is what preserves the workspace
convention that a spec resolves a service token with no setup at all.

### 3.3 `provideAppInitializer` has no equivalent here

`ConnectionRecovery` is a listener that nothing injects, so moving it into
`appProviders` as a class provider is not enough: nothing would construct it. Replace
`provideAppInitializer` with `provideEnvironmentInitializer`, which runs when the
**environment injector it is declared on** is created, which is the route injector.
That is the correct primitive for an app mounted on a route, and it keeps working
unchanged in the standalone bootstrap.

### 3.4 The guard that stops this coming back

Add one integration spec in `apps/velista` that drives the **real** route table
through the router, from a `TestBed` whose root has nothing velista specific in it:

```ts
TestBed.configureTestingModule({ providers: [provideRouter(remoteRoutes)] });
```

Navigate to `''` and assert the layout renders. The router creates the route child
injector for `route.providers` exactly as it does in production, so this reproduces
the topology instead of the convenient version. Every failure in the table in 2.3
fails this spec. It is the cheapest possible substitute for an e2e that cannot
currently run, and it belongs to the app project because the app layer is what it
tests.

A second, narrower assertion is worth having next to it: resolve each service the app
provides and assert it comes back, so a service added later without the rule in 3.1
fails immediately with a readable message rather than in a rendering test.

> **What was built.** `apps/velista/src/app/app-providers.spec.ts`, which builds the
> child injector with `createEnvironmentInjector(appProviders, ...)` exactly as the
> router does and names each service. The router-driven variant was not built: it drags
> in the locale guard and the translation loader for no extra coverage of the thing this
> is guarding, and the e2e already covers the full stack. The narrower version fails on
> every row of 2.3.

### 3.5 The second one, found by fixing the first

Fixing the injector scope made the app render far enough to hit a second, independent
provider placement bug that had been hidden behind it the whole time:

```
NG0201: No provider found for `RokuTranslatorService`. Source: Route: .
```

`AppUiModule` registered the translation namespace with
`RokuTranslatorModule.withConfig(...)`, and `AppLayout` imported it, on the reasoning
written in that file: *as the parent route component it passes them down to every
page.* It does not. A standalone component's imported NgModule contributes its
providers to **that component's own injector**, and a page reached by `loadComponent`
on a child route is not created against it: the router gives a routed component the
route's environment injector. So `AppLayout` could use the `| rokuT` pipe and every
page below it could not.

Nobody saw it because `AppLayout` threw on `APP_BRAND` first, so no page below it had
ever rendered.

The fix is the same shape as the rest of this plan. The providers moved to
`VELISTA_TRANSLATION_PROVIDERS`, exported from `velista/ui` so the loader still sits
beside the asset folder it dynamically imports, and installed by `appProviders`.
`AppUiModule` keeps the plain `RokuTranslatorModule` for the pipe, which is all a
template needed from it.

**Worth generalising, because it is the same mistake in a different costume:** "a
parent provides for its children" is true of the **injector** tree and only sometimes
true of the **component** tree. A route's providers reach every page below it. A
standalone component's imports reach that component. Neither `providedIn: 'root'` nor
a component `imports` is a way to supply a lazily loaded route.

## 4. Finding 2: one place to declare what tests provide

### 4.1 What the duplication looks like now

- An `AppBrand` literal is written out in `home-page.spec.ts`, `theme-store.spec.ts`,
  `brand-rename.spec.ts` and `app-layout.spec.ts`. Three of the four are the same
  object with the same field values.
- A `BrowserFacade` double is written out in six specs across `data-access`,
  `platform` and `feature-home`.
- `home-page.spec.ts` additionally builds a full `ZoneServiceI` and a full
  `SessionStore` by hand.

Every one of these is a copy of the same setup, and the copies are what let the app
and the tests disagree about where providers live without anyone noticing.

### 4.2 The shape: an exported function, not a jest global

> **Changed during implementation.** This section originally proposed a new
> `libs/velista/testing`. It does not exist, and section 4.3 explains why. The helpers
> ship from the libraries they belong to instead, which is what this workspace already
> does with `RokuTranslatorTestingModule`. Everything below about the **shape** stands.

The helpers live in `libs/velista/platform/src/lib/testing/velista-testing.ts`,
exported from `@portfolio/velista/platform`:

- `TEST_BRAND`, one `AppBrand` fixture, deliberately **not** named Velista, so a spec
  that accidentally asserts the real product name fails (rule N1 keeps earning its
  keep here).
- `provideVelistaTesting(overrides?)`, returning the provider list a velista spec
  needs: the app level tokens, with `useValue` test data, and any double that more
  than one spec wants. Overrides let a single spec vary one entry without rebuilding
  the list.
- `fakeBrowserFacade(storage?)`, the `Map` backed double the six specs already share.

**Why a function and not a global jest setup file.** A `beforeEach` in
`src/test-setup.ts` looks tidier, but `home-page.spec.ts` calls
`TestBed.resetTestingModule()` inside its own `render()` helper so one test can render
twice, and a reset discards anything a global hook configured. A spec that opts in by
calling a function is immune to that, reads at the point of use, and does not make
every spec in the project pay for providers it does not want. It is also the only
version that survives someone reaching for `resetTestingModule` again later.

### 4.3 Where it sits in the graph, and why there is no `velista/testing` library

A separate library cannot work, and finding out why is what changed 4.2.

To type a `BrowserFacade` double, `velista/testing` would have to depend on
`platform`. But `platform`'s own specs want these helpers too: `theme-store.spec.ts`
needs `APP_BRAND` and, after rule D5, needs `ThemeStore` provided. `platform`
importing a library that imports `platform` is a cycle in the project graph. The
helpers would then be available to every velista library **except** one that needs
them, which is the tell that the boundary is in the wrong place.

They live in `platform` instead, which every other velista library already depends on,
so they reach every spec with no cycle anywhere:

- `platform` exports `TEST_BRAND`, `TEST_API_CONFIG`, `provideVelistaTesting()`,
  `fakeBrowserFacade()` and `provideFakeBrowserFacade()`.
- `data-access` exports the doubles that need its own types, `fakeZoneStore()` and
  `fakeSessionStore()` with their provider wrappers, from
  `src/lib/testing/store-doubles.ts`. `feature-home` already depends on `data-access`,
  so there is no cycle and each double sits beside the thing it stands in for.

Nothing under any `src` imports these files, so they are never bundled. It also means
no new project, no new tsconfig and no new path alias, which is a real saving for two
small modules.

**`provideVelistaTesting` deliberately does not fake `BrowserFacade`.**
`theme-store.spec.ts` and `browser-facade.spec.ts` test against the real one, and a
helper that silently replaced it would leave those specs asserting on a stub. The
double is asked for explicitly, which is one extra line in the specs that want it and
correctness for the ones that do not.

### 4.4 What gets rewritten

`theme-store.spec.ts`, `app-layout.spec.ts` and `home-page.spec.ts` drop their local
brand literals; `home-page.spec.ts`, `zone-store.spec.ts`, `zone-api.spec.ts` and
`gateway-interceptor.spec.ts` drop their hand written `BrowserFacade` doubles. This is
the step that makes 4.1 true rather than aspirational, so it is part of this plan and
not a follow up.

`brand-rename.spec.ts` keeps its `AppBrand` literal, and should. Its second brand is
not duplication, it is the subject of the test: the whole spec is the rename rehearsal
required by plan `0002`, and a rename needs two brands to be a rename.

## 5. Finding 3: `HomePage` injects `ZoneStore` directly

### 5.1 What is true

`HomePage` injects the concrete `ZoneStore`, and also the concrete `SessionStore` and
`BrowserFacade`. Only `ZONE_SERVICE` and `REALTIME_CLIENT` sit behind interfaces
today. `HomePage` is the only container in the app, so this is a question about
exactly one component, not a pattern spreading through the codebase.

### 5.2 It is a decision already taken, not an omission

`0004` section 9.1 lists the token set explicitly: `AUTH_SERVICE`, `ZONE_SERVICE`,
`LIST_SERVICE`, `REALTIME_CLIENT`. `ZoneStore`, `ListStore` and `PresenceStore` are
listed in the same table as plain classes. The seam for swapping an implementation is
the service **underneath** the store, which is where the memory versus backend choice
actually lives. The store above it is this app's own logic: a cache, the realtime
application rules, and the room bookkeeping. There is no second implementation of
that, and there is no scenario in the plans where there would be.

### 5.3 Recommendation: keep it concrete, and fix the real irritation

An interface with exactly one implementation costs a re-declaration of every signal
member and buys substitutability nobody is going to use. The substitutability the app
needs already exists one layer down.

What is genuinely awkward is the **test**, and that is probably what prompted the
observation. `home-page.spec.ts` fakes `ZONE_SERVICE`, fakes `SessionStore`, and then
reaches in with `TestBed.inject(ZoneStore).load()` to drive the page, which couples
the page's spec to the store's lifecycle. The fix for that is a test seam, not a
production interface: a `fakeZoneStore()` double in `data-access`'s `testing/` folder
(section 4.3) that a page spec provides with `{ provide: ZoneStore, useValue: ... }`.
Angular substitutes a class token as happily as an interface token, so no production
code has to change for the test to get what it wants.

### 5.4 Decided: no token. `ZoneStore` stays concrete

> **User's decision, 2026-08-26.** `HomePage` keeps injecting `ZoneStore` directly.
> Nothing in production changes. The awkwardness in the spec is addressed by the test
> double in 5.3, which is where the problem actually was.

The rest of this section is kept as the record of what was weighed, so this is not
re-opened from scratch later. Declaring `ZoneStoreI` with the readonly signals and
the two methods the page uses would have meant:

```ts
export const ZONE_STORE = serviceToken<ZoneStoreI>('ZONE_STORE', () =>
  inject(ZoneStore)
);
```

and it carried the same trap as section 2: that default factory resolves `ZoneStore`
from the **root** injector, so once rule D5 moves `ZoneStore` into `appProviders` the
default would either fail or quietly build a second instance. It would have needed
`provideService(ZONE_STORE, ZoneStore)` in `appProviders` and no usable default.
That is a second copy of the bug this plan exists to remove, for a seam with one
implementation, which is what settled it.

## 6. Build order

1. [x] **Write the failing test first** (3.4). It failed with exactly the predicted
   error, and the trace was more useful than expected:
   `ZoneStore -> ZONE_SERVICE -> ZoneMemory -> TokenStore -> ApiUrl -> APP_API_CONFIG`
   is the silent fallback of 2.3 row three, printed by Angular itself.
2. [x] Apply rule D5 to `ThemeStore`, and watch the failure walk down the table.
3. [x] Apply D5 to the rest of 3.2, and swap `provideAppInitializer` for
   `provideEnvironmentInitializer` (3.3).
4. [x] Add the service resolution assertions (3.4, second paragraph).
5. [x] Add the shared test providers and rewrite the specs onto them (section 4).
6. [x] Add the `ZoneStore` double and lift `home-page.spec.ts` off
   `TestBed.inject(ZoneStore).load()` (5.3).
7. [x] Record rule D5 in `0004`, as its new section 9.0, so the inventory table and
   the rule live together.

Section 5.4 is deliberately outside this order. It is a decision, not a task.

**One discovery worth recording**: `ZoneMemory` had to move under D5 as well, which
3.2 did not anticipate. It injects `TokenStore` to answer as the current caller, so it
reaches `ApiUrl` and therefore `APP_API_CONFIG`. That breaks the workspace convention
that a service token's in-memory default resolves with no setup at all
(`nx-portfolio-angular-developer`, non negotiable 2) for this app only. The convention
assumes a memory implementation depends on nothing, which stops being true the moment
it has to know who is asking.

## 7. Acceptance criteria

- [x] `/en/velista` renders under the shell. Verified in a real browser: the layout,
      the app bar, the hero and every card render, with **no console errors at all**,
      where before the page was empty.
- [x] The app's zones come from `ZoneApi`, not `ZoneMemory`, when the app runs under
      the shell. Asserted, not eyeballed: the failure mode is silent.
- [x] `gatewayInterceptor` runs on requests made by `ZoneApi`. `HttpClient` and
      `ZoneApi` now resolve in the same injector, which is what that depends on.
- [x] `ConnectionRecovery` is constructed when the app mounts.
- [x] The topology spec fails if any app provider is moved back to a place a root
      scoped service cannot see.
- [x] No spec in `libs/velista` declares its own `AppBrand` literal or its own
      `BrowserFacade` double, except `brand-rename.spec.ts`, whose second brand is the
      subject of the test (4.4).
- [x] `nx run-many --target=test` and `--target=lint` pass for every velista project:
      270 tests. Workspace-wide, the only failure is
      `luna-shopper-backend-gateway`'s committed `openapi.json` being stale, which is
      unrelated to this plan and predates it.
- [x] **`npx nx e2e velista-e2e` passes.** 40 of 40, both locales, all five browser
      projects, against a shell served with `--devRemotes=velista`. It was left open
      here for the two reasons in section 9, and both are now closed: the library
      defect was fixed by rokutranslator `0004` and wired up by `0006`, and the stale
      `<h1>` assertion was rewritten to check the heading is **not** a raw key rather
      than to pin one piece of copy, which is what the suite was always for.

## 8. Open questions

1. ~~**Does `ZONE_STORE` get created?**~~ **No, decided 2026-08-26.** `ZoneStore`
   stays concrete; the test double in 5.3 is the fix. See 5.4.
2. **Does rule D5 belong in `0001` rather than `0004`?** It is an extraction contract
   concern as much as a data access one, and `0001` is where the "runs under the
   shell, later runs standalone" rules live. Recorded here as `0004`'s D5, the next
   free number in that plan's own sequence, because that is where the token inventory
   is. Note that the two plans number their D rules independently and already overlap
   (`0001` runs D1 to D6), so a rule from another plan is always cited with its plan
   number, the way `0004` already writes "`0001` D6". Moving this one into `0001`
   would make it D7 there.
3. ~~**Are the other remotes affected?**~~ **No.** Checked: `landing`, `landingV2`,
   `odontogram` and `damoclesSword` attach nothing to their remote routes, and their
   only provider lists are in `app.config.ts`, which the shell never runs. Velista is
   the first remote in this workspace that needs app level providers at all, which is
   why it is the first to meet this. Nothing to audit, but the next remote that grows
   an app layer inherits rule D5 along with the pattern.

## 9. Closed: velista renders its translation keys raw

> **Resolved.** Both problems below were real and both are fixed. (1) was the library
> defect, diagnosed and fixed in rokutranslator `0004`: `addResources` silently drops
> any top level value that is an object, and velista ships the workspace's only nested
> JSON. The last bullet in this section guessed the shape of the JSON as the likelier
> cause, and that guess was right. (2) was fixed here, in `mount.spec.ts`. The section
> is kept as written because the eliminations in it are the useful part: they are the
> paths somebody would otherwise search again.
>
> The hyphen mismatch in the shell's module federation config **is now fixed** as well.
> It did not cause this one, and it was a genuine bug on its own terms: the rule named
> `@portfolio/localization/roku-translator`, which does not exist, so it had never
> matched anything. Fixing it turned up two further faults the bullet below could not
> have known about. A `shared` callback governs only its own build, so the rule was
> also in one config instead of six; and Nx applies the callback's return by
> assignment, so the obvious repair would have replaced the `requiredVersion` Nx had
> worked out rather than adding to it. The rule now lives in one file,
> `module-federation.shared.ts`, which every config imports.

Not caused by this plan, not fixed by it, and only visible **because** of it: until the
injector was fixed the page rendered nothing, so nobody could see that its text was
wrong. It is the last thing between `velista-e2e` and green, and it needs its own plan.

The e2e's final assertion is:

```ts
await expect(page.getByRole('heading', { level: 1 })).toHaveText('Velista');
```

and it now resolves a real `<h1>` containing `home.hero.headline`, the raw key.

**Two separate problems are tangled here, and both need a decision.**

1. **The keys do not resolve.** Every `| rokuT` binding on the page renders its key.
2. **The assertion is stale anyway.** That `<h1>` is the home hero, whose `en.json`
   value is "One list. Everyone in sync.", not "Velista". The spec was written against
   an earlier layout whose `<h1>` was the app title. Even with translations working it
   would fail, so it needs rewriting whatever the answer to (1) is. It should probably
   assert that the heading is **not** a raw key, which is what its own comment says it
   is for, rather than pinning one piece of copy.

What was ruled out, so the next person does not repeat it:

- **Not the loader.** Both chunks are fetched and return 200:
  `libs_velista_ui_assets_i18n_en_json.js` and the `es` one, from the remote on 4205.
- **Not change detection.** Clicking empty space and clicking a real in-page button
  both leave the key on screen, so it is not an OnPush view that was never marked.
- **Not provider placement.** There is no `NG0201` any more, and no console error of
  any kind. `RokuTranslatorService` resolves and its constructor runs.
- **Not `keySeparator`.** It is never configured anywhere in the localization library,
  so i18next's default `'.'` applies and nested lookup is supported.

What is still worth checking, in the order the evidence favours:

- **Which `RokuTranslator` instance the remote registers into versus queries.** The
  shell's module federation config forces `singleton: true` for the lib named
  `@portfolio/localization/roku-translator`, but the real path alias is
  `@portfolio/localization/rokutranslator`, **with no hyphen**
  (`apps/shell/module-federation.config.ts` against `tsconfig.base.json`). That rule
  has therefore never matched anything. It is a genuine bug on its own terms and worth
  fixing regardless of whether it turns out to cause this one.
- **The shape of the JSON.** velista's `en.json` is nested (`home.hero.headline` is
  three levels of object). `damoclesSword` and `landingV2`, which both render
  translated text under the same shell right now, use flat keys with literal dots
  (`"nav.home": "..."`). velista is the only app in the workspace whose translation
  files are nested, which makes it the only one exercising that path.
