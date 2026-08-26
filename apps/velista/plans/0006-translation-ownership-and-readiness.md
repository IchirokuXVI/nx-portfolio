# 0006. Translation ownership: feature-shell composes, and waits

> Prerequisite reading: `0005` (injector scope), `0001` section 5 (the extraction
> contract), and **`libs/shared/localization/rokutranslator/plans/0004`**, which fixes
> the library defect that makes this app render raw keys.
>
> **The bug is not in this app.** An earlier draft of this plan carried the diagnosis
> and the library fix. Both now live in rokutranslator `0004`, where they belong: a
> nested namespace registering nothing is a fact about the translation library, and
> fixing it here would have been fixing somebody else's code from inside a consumer.
> What is left is what velista actually owns.
>
> **Developed in parallel with `0007` (landing and home split).** Section 6 lists every
> file both plans touch.

## 1. What this plan owns

| Concern                                                           | Owner                                     |
| ----------------------------------------------------------------- | ----------------------------------------- |
| Nested keys resolve at all                                        | rokutranslator `0004`. Nothing to do here |
| An already rendered `OnPush` view re-translates when strings land | rokutranslator `0004`. Nothing to do here |
| **Who declares this app's translations, and where**               | This plan, section 3                      |
| **What this app does while the strings are still loading**        | This plan, section 4                      |
| **Whether velista's JSON stays nested**                           | This plan, section 5                      |

## 2. Why the page shows raw keys, in one paragraph

`velista` ships the only **nested** translation JSON in the workspace. The library's
eager load path registers a namespace with `i18next.addResources`, which silently skips
any top level value that is an object, so five of this app's six branches never reach
the store. Verified in the browser: `t('app-title')` returns "Velista" and
`t('zone.role.owner')` returns `zone.role.owner`. The full diagnosis, the evidence and
the fix are in rokutranslator `0004`. **Nothing in this app is miswired**, which is
worth stating plainly because `0005` fixed a real wiring bug in exactly these files and
the two look identical from the outside.

## 3. Moving the registration to `feature-shell`

### 3.1 What moves, and what cannot

The comment in `libs/velista/ui/src/lib/translation-providers.ts` argues the providers
must stay in `ui` because "the loader is a relative dynamic import of this library's own
asset folder, so it has to be resolved from a file that sits next to those assets".
That is **correct about the loader** and wrong about the providers. Splitting the two is
the whole move:

| Thing                                        | Owner                                 | Why                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The loader, and the namespace name it serves | The library that owns the asset files | A relative `import()` resolves against the file it is written in, and `CLAUDE.md` forbids a relative path across a library boundary. It genuinely cannot live anywhere else |
| The `provideRokuTranslator(...)` call        | `feature-shell`                       | There is one per app injector, it names the default namespace, and it is the **app's** composition rather than any one library's                                            |

### 3.2 The shape

Each contributing library exports a descriptor next to its assets:

```ts
// libs/velista/ui/src/lib/translations.ts
export const VELISTA_UI_TRANSLATIONS: TranslationSource = {
  namespace: 'velista',
  locales: APP_AVAILABLE_LOCALES,
  loader: (locale) => import(`../../assets/i18n/${locale}.json`),
};
```

and `feature-shell` composes every descriptor into the one call:

```ts
// libs/velista/feature-shell/src/lib/translation-providers.ts
const sources: TranslationSource[] = [VELISTA_UI_TRANSLATIONS];

export const VELISTA_TRANSLATION_PROVIDERS: Provider[] = provideRokuTranslator({
  locales: APP_AVAILABLE_LOCALES,
  defaultNamespace: 'velista',
  namespaces: sources.map((s) => s.namespace).filter((ns) => ns !== 'velista'),
  loader: (locale, namespace) => (sources.find((s) => s.namespace === namespace) ?? sources[0]).loader(locale),
});
```

`TranslationSource` comes from `@portfolio/localization/rokutranslator-angular`
(rokutranslator `0004`, API additions). The dispatching loader is not invented here:
`odontogram` already switches on the `namespace` argument inside a single loader. What
is new is that each library states its own entry instead of the composition site
knowing everybody's asset folders.

### 3.3 Adding the second library later

Stated so the next person does not re-derive it: a future `feature-lists` that ships
its own `assets/i18n` exports its own `TranslationSource`, and `feature-shell` adds it
to `sources`. One line, in the layer that already knows every library the app is made
of. Nothing in `ui` changes, and no library learns about another library's assets.

### 3.4 Direction check

`feature-shell` already imports from `ui` (`AppLayout`, `APP_KEY`,
`APP_DEFAULT_LOCALE`), and `ui` does not import `feature-shell`. Still true after the
move. No cycle.

### 3.5 The one import site that changes

`apps/velista/src/app/app-providers.ts` imports `VELISTA_TRANSLATION_PROVIDERS` from
`@portfolio/velista/ui` and will import it from `@portfolio/velista/feature-shell`. The
providers stay exactly where `0005` put them, on the app injector, and the comment
explaining why stays where it is and stays true.

## 4. `feature-shell` also owns readiness

### 4.1 Why here

The provider now lives in `feature-shell`, and `feature-shell` owns the route table,
which makes it the app's entry point in the only sense that matters: it is the last
place that runs before any page of this app exists. Waiting for translations is a
decision about **entering the app**, so it belongs next to the thing that declares
them, not in `ui` (which must not know about load state) and not in a page (which would
have to repeat it for every page ever added).

### 4.2 What it does

Two pieces, and the split between them is deliberate: one **starts** the load, the
other **waits** for it. Nothing does both, so there is no ordering to get right.

**Starting.** An environment initializer, appended to the providers in section 3.2, so
constructing the service is a consequence of creating the app injector rather than of
whoever happens to inject it first:

```ts
// libs/velista/feature-shell/src/lib/translation-providers.ts
export const VELISTA_TRANSLATION_PROVIDERS: Provider[] = [
  ...provideRokuTranslator({ ... }),
  provideEnvironmentInitializer(() => void inject(RokuTranslatorService)),
];
```

This is the pattern `app-providers.ts` already uses for `ConnectionRecovery`, and the
reasoning there applies here too: the service is a thing that has to be _running_, and
nothing in a template injects it directly, so without this its construction time is an
accident of which component renders first.

**Waiting.** A resolver on the `AppLayout` route in `AppShellRoutes`:

```ts
// libs/velista/feature-shell/src/lib/translations-ready.ts
export const translationsReadyResolver: ResolveFn<boolean> = () => firstValueFrom(inject(RokuTranslatorService).loaded$);
```

`loaded$` is a `ReplaySubject(1)`, so once it has emitted, every later navigation
resolves from the buffer and this costs nothing at all after first entry.

### 4.2.1 Ordering, stated so nobody has to reason about it

Three things happen in a fixed order, none of it timing dependent:

1. The app injector is created (route providers on the remote entry route), and the
   environment initializer constructs `RokuTranslatorService`, which registers the
   namespace and starts every loader. This is the earliest point at which the app
   exists at all.
2. `localeCorrectionGuard` runs on the `AppLayout` route and awaits `changeLocale`.
   Angular runs a route's `canActivate` to completion before its `resolve`, so this is
   settled before step 3 begins.
3. `translationsReadyResolver` awaits `loaded$`.

Step 1 registers **every** configured locale eagerly, not just the active one, so step
2 cannot land on a locale whose strings were never requested. That is existing
behaviour in `RokuTranslatorService`, not something this plan adds, and it is the
reason the guard and the loads do not have to be ordered against each other.

### 4.3 Why block, when `0004` already makes the pipe repaint

Because they fix different halves, and this app needs both.

rokutranslator `0004`'s `loaded` signal removes **stuck** keys: a view that painted
keys gets marked dirty and re-translates. That is the generic fix and every app gets
it. It does not remove the **flash**, because there is still a paint with keys in it.
We watched that flash persist through a whole page load in the browser, and on this
app it is not a flash so much as the entire first impression: the anonymous screen is
almost nothing but text.

The cost of waiting is one already bundled chunk, on a route that is lazily loaded
anyway, so the wait overlaps work the router is doing regardless. `0002` section 6
makes the opposite call for the display face and picks `font-display: swap`, and the
difference is that a fallback font is still readable words while a fallback string is
`home.hero.headline`.

### 4.4 The failure mode: `loaded$` must always settle

Blocking on a promise means caring about whether that promise can fail to settle. Today
it can, and this section is the whole reason rokutranslator `0004` Problem 3 is a hard
prerequisite rather than a nicety.

#### The mechanism

`RokuTranslatorService`'s constructor ends with:

```ts
Promise.all(promises).then(() => {
  this.loaded$.next(true);
  this.loaded$.complete();
});
```

`Promise.all` rejects as soon as **any** input promise rejects. There is no `.catch`
and no rejection handler on the chain, so on rejection the `.then` callback never runs.
`loaded$.next` is never called, `loaded$.complete()` is never called, and the subject
stays open with an empty buffer for the lifetime of the page. The rejection surfaces
only as an unhandled promise rejection in the console.

Today that is invisible, because nothing waits on `loaded$`: the app renders keys,
`0004`'s signal never flips, and you get a permanently untranslated page. Once a
resolver awaits it, the same rejection means the resolver's promise never settles, the
router never finishes the navigation, and **no route is ever activated**. Not a slow
app: a blank one, permanently, with no error boundary and nothing on screen to explain
it.

What can actually reject: a chunk that 404s after a deploy replaces the hashed asset a
still-open tab is asking for, a malformed JSON file, or an `import()` rejected by the
browser. None of these are exotic, and the first one is routine on a mutable staging
tag.

#### Why a timeout was the wrong answer

An earlier draft of this plan raced the resolver against a 3 second timer, so the app
rendered keys instead of hanging. That is removed, and it deserves an explanation
rather than a silent deletion, because on the surface it looks like cheap insurance.

It is not insurance, it is **nondeterminism**. A timeout makes the app's behaviour a
function of wall clock time, which is the property that makes a race hard to live with:

- **The outcome depends on the device and the network, not on the code.** The same
  build renders translated text on a developer's machine and raw keys on a cheap phone
  on supermarket 3G. Nothing in the source says which, and neither result is a bug you
  can reproduce on demand.
- **It cannot distinguish "failed" from "slow".** A loader that is going to succeed in
  3.2 seconds is treated identically to one that has already rejected. It punishes the
  case that would have worked.
- **It makes a test suite lie.** Any test of the failure path has to either wait three
  real seconds or fake timers, and a passing test then proves something about the timer
  rather than about the loader.
- **It hides the bug it is compensating for.** With the timeout in place, a library
  that never settles produces a page that looks _almost_ right, which is exactly the
  kind of defect that survives for months.

#### The correct fix, and where it lives

Make the promise always settle, at the source. rokutranslator `0004` Problem 3 changes
the chain to `.then(() => true).catch(() => false)` before publishing, so `loaded$`
emits exactly once in every case and carries whether the load actually succeeded. With
that in place the resolver has nothing left to defend against: there is no code path
where `loaded$` stays silent, so there is no reason to time it out.

That gives `loaded$` a contract this plan depends on, and it is worth stating because
`firstValueFrom` is unforgiving about the edge:

> `loaded$` emits **exactly one** value and then completes, in both the success and the
> failure case.

If a future change ever completed the subject **without** emitting, `firstValueFrom`
would reject with `EmptyError`, the resolver would reject, and the router would cancel
the navigation. That is the same blank screen by a different route, so the contract is
"emits then completes", never just "completes".

#### Why the resolver adds no new hang risk beyond that

Worth being precise, because "blocking the route on a network request" sounds worse
than it is here. The route this resolver sits on is already lazily loaded: the router
is already awaiting `import('@portfolio/velista/feature-shell')` and, one level down, a
page component chunk. If chunk loading hangs rather than rejects, the app never renders
**with or without** this resolver. The resolver does not introduce a dependency on the
network that the route did not already have; it adds one more chunk to a wait that was
already happening, and webpack's own `chunkLoadTimeout` bounds it in the pathological
case.

So the entire new failure surface is the rejection path described above, and `0004`
Problem 3 closes it completely.

### 4.5 What this does not do

It does not make `t()` safe to call at construction time in a component, and nothing
should rely on it that way. It guarantees the strings are there **before any page of
this app is created**, which is what `0007` section 7 needs for the preview lines.

## 5. The JSON stays nested

Flattening `en.json` and `es.json` to dotted top level keys would also make the page
work, today, with no library change at all. It is rejected:

- It fixes one app and leaves the trap armed for the next one. rokutranslator `0004`
  exists precisely so the next nested file does not spend an afternoon on this.
- The nested shape is the better one at this file's size. `home.action.*` as a branch
  is legible; sixty dotted keys at one indent level is not.
- The library's own `LoaderFunction` type already claims to accept it.

So this plan changes **no** translation JSON at all. The flat `"home.preview.listName"`
key and the `console.log` probes that produced the evidence in rokutranslator `0004`
were scratch work and are already gone from `dev`; nothing needs cleaning up after
them, and neither file appears in section 7.

## 6. Acceptance criteria

1. `VELISTA_TRANSLATION_PROVIDERS` is exported from `@portfolio/velista/feature-shell`
   and no longer from `@portfolio/velista/ui`. `ui` exports `VELISTA_UI_TRANSLATIONS`
   instead, and still owns the loader and the assets.
2. Adding a second `TranslationSource` requires an edit to exactly one file in
   `feature-shell`. Demonstrated by a unit test that composes two fake sources and
   asserts the dispatching loader routes each namespace to its own loader.
3. `/en/velista` renders **no** raw translation key at first paint. Not "resolves
   shortly after": the resolver means there is no frame with a key in it.
4. `/es/velista` renders Spanish, and switching the locale in place still works
   (`0003` of the rokutranslator plans, unchanged by any of this).
5. A loader that **rejects** still activates the route. The page renders, with keys for
   the namespace that failed, and no timer is involved anywhere in making that happen.
   Tested with a source whose loader rejects, asserting the route activates within the
   same microtask queue rather than after any elapsed time.
6. `nx build velista` produces no `Promise.race`, no `setTimeout` and no other
   time-based fallback anywhere in the translation path. This is a criterion rather
   than a note because it is the thing most likely to be reintroduced by somebody
   debugging a slow load.
7. `npx nx run-many --all --target=test` and `--target=lint` pass, and
   `npx nx build velista` succeeds.

## 7. Files touched

| File                                                          | Change                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `libs/velista/ui/src/lib/translations.ts`                     | **new.** The `VELISTA_UI_TRANSLATIONS` descriptor, next to the assets  |
| `libs/velista/ui/src/lib/translation-providers.ts`            | **deleted.** Its reasoning is preserved in the two new files, not lost |
| `libs/velista/ui/src/index.ts`                                | export swap                                                            |
| `libs/velista/feature-shell/src/lib/translation-providers.ts` | **new.** The composition, plus the environment initializer             |
| `libs/velista/feature-shell/src/lib/translations-ready.ts`    | **new.** The resolver                                                  |
| `libs/velista/feature-shell/src/lib/routes.ts`                | the resolver on the `AppLayout` route. **Also touched by `0007`**      |
| `libs/velista/feature-shell/src/index.ts`                     | export both. **Also touched by `0007`**                                |
| `apps/velista/src/app/app-providers.ts`                       | one import path                                                        |

## 8. Dependencies and overlap

### On rokutranslator `0004`

| Needs                         | For                                            | If it is not merged yet                                                                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TranslationSource`           | Section 3.2                                    | Declare it locally in `feature-shell` and delete it when `0004` lands. Cheap either way                                                                                                                                                                                  |
| `loaded$` settling on failure | Section 4.4                                    | **Blocking, with no workaround.** The resolver awaits a promise that a rejected loader leaves pending forever, and the timeout that used to paper over it is deliberately gone. Ship the resolver against a library that can hang and one 404 is a permanently blank app |
| `addResourceBundle`           | Anything on screen actually reading in English | Everything in this plan is still buildable and testable. The screen stays raw keys                                                                                                                                                                                       |

The composition and the move can land first and be verified by unit tests. Only
acceptance criteria 3, 4 and 5 need `0004` on disk, and **criterion 5 is the one that
must not be waived**: it is the difference between a degraded page and no page.

### On `0007`

Two shared files, both trivial, both different lines.

| File                              | `0006`                              | `0007`                                           |
| --------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `feature-shell/src/index.ts`      | exports the providers and resolver  | exports the auth guards                          |
| `feature-shell/src/lib/routes.ts` | adds a resolver to the parent route | replaces the child route with two guarded routes |

`routes.ts` is the only one worth coordinating, since both edit the same route table.
They touch different properties of different routes, so a merge is mechanical, but
whoever goes second should read the file rather than trust the diff. This plan touches
no translation JSON at all (section 5), so `en.json` and `es.json` belong to `0007`
alone.

**Neither plan blocks the other from starting.**

## 9. Open questions

**O1. Should the resolver live on the remote entry route instead?**
`apps/velista/src/app/remote-entry/entry.routes.ts` is arguably the true entry point,
and it is where `appProviders` are attached. It is not chosen because that file is
scaffolding the extraction phase will change, while `AppShellRoutes` is the app's own
route table in its own library. Revisit during extraction.

**O2. Should `feature-shell` expose readiness as a signal for pages to read?** Not
until something needs it. The resolver means no page can observe a not-ready state, so
an exposed signal would be a constant `true` and an invitation to write code that
handles a case that cannot happen.
