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

A resolver on the `AppLayout` route in `AppShellRoutes`, awaiting the subject the
service already exposes:

```ts
// libs/velista/feature-shell/src/lib/translations-ready.ts
export const translationsReadyResolver: ResolveFn<boolean> = () => {
  const translator = inject(RokuTranslatorService);
  return firstValueFrom(translator.loaded$);
};
```

`loaded$` is a `ReplaySubject(1)`, so a later navigation resolves synchronously and
this costs nothing after the first entry. Injecting the service is also what
**constructs** it, which is what starts the load, so the resolver is the thing that
kicks it off rather than something that races it.

It goes on the same route as `localeCorrectionGuard`, and after it: that guard awaits
`changeLocale`, so the locale is settled before anything is waited on, and there is no
risk of loading one locale's strings and then rendering another's.

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

### 4.4 The failure mode this introduces, and the guard on it

Blocking on a promise means caring about the promise never settling.
`RokuTranslatorService` currently does `Promise.all(promises).then(...)` with **no
rejection path**, so one failed chunk would leave `loaded$` pending forever and this
resolver would hang the app on a blank screen. rokutranslator `0004` Problem 3 fixes
that at the source, and this plan **depends on it**: do not ship the resolver against a
library version that can hang.

Belt and braces, because a blank app is the worst outcome on this list and the resolver
is one line from being safe:

```ts
return Promise.race([firstValueFrom(translator.loaded$), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000))]);
```

Rendering keys is bad. Rendering nothing is worse. The timeout means the worst case
degrades to today's behaviour, which `0004`'s signal then repairs as soon as the
strings do arrive.

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

**Cleanup this plan owns.** `libs/velista/ui/assets/i18n/en.json` currently carries a
hand added flat `"home.preview.listName"` at the top level, from debugging. It comes
out, and it is the one thing in this plan that must not be forgotten, because it works
and would therefore hide a regression in exactly one key.

The debug `ngOnInit` and its `console.log`s in `home-page.ts` come out too, but that
file is rewritten wholesale by `0007`, so they are listed there to avoid two plans
editing one file for the same reason.

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
5. A loader that rejects does not hang the app: the page renders within the timeout,
   with keys, and repairs itself if the strings arrive later. Testable with a source
   whose loader rejects.
6. The debug flat `home.preview.listName` key is gone from `en.json`, and
   `t('home.preview.listName')` still returns "Weekly shop" from the nested branch.
7. `npx nx run-many --all --target=test` and `--target=lint` pass, and
   `npx nx build velista` succeeds.

## 7. Files touched

| File                                                          | Change                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `libs/velista/ui/src/lib/translations.ts`                     | **new.** The `VELISTA_UI_TRANSLATIONS` descriptor, next to the assets  |
| `libs/velista/ui/src/lib/translation-providers.ts`            | **deleted.** Its reasoning is preserved in the two new files, not lost |
| `libs/velista/ui/src/index.ts`                                | export swap                                                            |
| `libs/velista/ui/assets/i18n/en.json`                         | remove the debug flat key. **Also touched by `0007`**                  |
| `libs/velista/feature-shell/src/lib/translation-providers.ts` | **new.** The composition                                               |
| `libs/velista/feature-shell/src/lib/translations-ready.ts`    | **new.** The resolver                                                  |
| `libs/velista/feature-shell/src/lib/routes.ts`                | the resolver on the `AppLayout` route. **Also touched by `0007`**      |
| `libs/velista/feature-shell/src/index.ts`                     | export both. **Also touched by `0007`**                                |
| `apps/velista/src/app/app-providers.ts`                       | one import path                                                        |

## 8. Dependencies and overlap

### On rokutranslator `0004`

| Needs                         | For                                            | If it is not merged yet                                                                 |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `TranslationSource`           | Section 3.2                                    | Declare it locally in `feature-shell` and delete it when `0004` lands. Cheap either way |
| `loaded$` settling on failure | Section 4.4                                    | **Blocking.** Do not ship the resolver without it, or a bad chunk hangs the app         |
| `addResourceBundle`           | Anything on screen actually reading in English | Everything in this plan is still buildable and testable. The screen stays raw keys      |

The composition and the move can land first and be verified by unit tests. Only
acceptance criteria 3, 4 and 6 need `0004` on disk.

### On `0007`

Three shared files, all trivial, all different lines.

| File                              | `0006`                              | `0007`                                           |
| --------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `feature-shell/src/index.ts`      | exports the providers and resolver  | exports the auth guards                          |
| `feature-shell/src/lib/routes.ts` | adds a resolver to the parent route | replaces the child route with two guarded routes |
| `ui/assets/i18n/en.json`          | removes one debug key               | adds five preview line keys                      |

`routes.ts` is the only one worth coordinating, since both edit the same route table.
They touch different properties of different routes, so a merge is mechanical, but
whoever goes second should read the file rather than trust the diff.

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
