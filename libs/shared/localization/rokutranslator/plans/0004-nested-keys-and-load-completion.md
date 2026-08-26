# 0004: Nested translation keys, and telling the app when the strings arrive

> Extends [[0003-runtime-locale-switch]], which made the `rokuT` pipe `pure: false` so
> bindings re-translate on a locale change. That mechanism is correct and unchanged.
> This plan fixes two things it does not cover: a namespace whose JSON is **nested**
> registers almost nothing, and a view that has already rendered is never told when
> the strings finish loading.
>
> Both were found while building `velista` (see `apps/velista/plans/0006`), which is
> the first app in the workspace to ship nested translation JSON and the first to be
> written entirely with `OnPush`. Neither problem is velista's, so neither is fixed
> there.

## Goal

1. A `LoaderFunction` may return a **nested** object, and every leaf in it is
   reachable through `t('a.b.c')`. Flat dotted-key files keep working exactly as they
   do today.
2. When a namespace finishes loading, views that have already rendered re-translate
   without needing an unrelated event to wake them.
3. A loader that **fails** settles rather than leaving the app waiting forever.

## Non-goals

- No migration of the four apps that ship flat JSON. After this plan both shapes work
  and there is no functional reason to touch them.
- No change to the pipe's public API, to `provideRokuTranslator`'s options, or to the
  locale routing flow from [[0002-locale-routing-refactor]].
- No new i18n library. Still the hand-rolled singleton over i18next.

## Evidence

Captured from the running app (`localhost:4200/en/velista`) in a real browser, not
reasoned about. `en.json` at the time had `app-title` and a hand added **flat**
`"home.preview.listName"` at the top level, alongside the normal **nested** branches.

Console, from a `loaded$` subscription in the page:

```
Velista            <- t('app-title')               flat key,   resolves
Weekly shop        <- t('home.preview.listName')   flat key,   resolves
zone.role.owner    <- t('zone.role.owner')         nested key, returns the key
```

The rendered DOM for the same binding, before and after forcing a change detection
pass by clicking a button:

```
before any interaction : "home.preview.listName  home.preview.zoneName  ..."
after background click : "home.preview.listName  home.preview.zoneName  ..."
after button action    : "Weekly shop            home.preview.zoneName  ..."
```

Two distinct problems, visible in one screenshot. Nested keys never resolve at all.
The flat key that _does_ resolve was still painted as a raw key until something
happened to check the view.

## Problem 1: a nested namespace registers almost nothing

### The mechanism

`addTranslations` takes the eager path whenever the namespace is already active, which
is the normal case, and that path ends in `loadTranslations`:

```ts
// src/lib/rokutranslator.ts
this.i18nextInstance.addResources(this.formatLocale(locale), namespace, loadedTranslations);
```

`i18next.addResources` is documented for flat maps and behaves accordingly:

```js
addResources(lng, ns, resources, options = { silent: false }) {
  for (const m in resources) {
    if (isString(resources[m]) || Array.isArray(resources[m])) {
      this.addResource(lng, ns, m, resources[m], { silent: true });
    }
  }
  ...
}
```

**A top level value that is an object is skipped.** Not recursed into, not flattened:
dropped, silently. `addResource` then splits each surviving _string_ key on the
`keySeparator`, which is why a flat file written as `"nav.home": "Home"` ends up
correctly nested in the store and resolves.

### Why nobody hit it until now

Every other translation file in the workspace is flat, with dotted strings as literal
top level keys:

```json
{ "app-title": "Damocle'Sword", "nav.home": "Home", "section-projects.main-title": "..." }
```

Every value is a string, so every key survives. That convention was never written down
and never enforced, so the first nested file to arrive found a code path that had never
seen one. `velista`'s file is that first one: five of its six top level values are
objects.

### The fix

Register the bundle with the call that understands nested objects, and unwrap the
module namespace on the way in:

```ts
const loaded = unwrapDefault(await translations());

this.i18nextInstance.addResourceBundle(this.formatLocale(locale), namespace, loaded, /* deep */ true, /* overwrite */ true);
```

`unwrapDefault` is the `'default' in x && typeof x.default === 'object'` check that
**already exists**, inline, in the i18next backend `read` callback a few dozen lines
above. Lifting it to a module level helper and using it in both places is part of the
fix rather than tidying: the two load paths disagreeing about the shape of a loader's
return value is what allowed one of them to be wrong for this long.

### The regression this could have caused, and why it does not

`addResourceBundle` with `deep` stores keys **as written**, so a flat file's
`"nav.home"` stays one top level key rather than being split into `{ nav: { home } }`,
while `t('nav.home')` splits on the key separator. That is a real risk to four working
apps, so it was tested rather than assumed. Both shapes, through the proposed call,
against the real asset files:

```
flat via addResourceBundle  nav.home                    -> "Home"
flat via addResourceBundle  section-projects.main-title -> "Relevant Projects"
flat via addResourceBundle  app-title                   -> "Damocle'Sword"
nested via addResourceBundle home.action.newList        -> "New list"
nested via addResourceBundle zone.role.owner            -> "OWNER"
```

i18next's lookup tries the joined key as well as the split path, so flat files keep
resolving. `damoclesSword`, `landing`, `landingV2`, `odontogram` and `shared/ui`'s
not-found page are unaffected, and section "Acceptance criteria" pins that with a test
rather than with this paragraph.

### A note on what webpack actually hands the loader

Worth recording, because it was guessed wrong once during the investigation. A
`import('./en.json')` resolves to a **module namespace object**, so the value reaching
`addResources` is `{ default: {...}, ...one export per top level key }`. Webpack emits
a named export even for a key that is not a valid identifier, such as `app-title`,
which is why flat keys resolve in the browser exactly as they do in Node. The browser
bundle is **not** empty. Only the object valued branches are lost, which is Problem 1
and nothing more.

## Problem 2: nothing re-renders when a namespace finishes loading

### The mechanism

`RokuTranslatorService`'s constructor starts the loads and keeps a promise:

```ts
Promise.all(promises).then(() => {
  this.loaded$.next(true);
  this.loaded$.complete();
});
```

Nothing waits on it. The injector is created, the service constructs, and the
components render in the same tick, before any dynamic import has resolved. So the
first paint renders keys, which is correct, and the question is what happens a few
milliseconds later when the strings land.

[[0003-runtime-locale-switch]] made the pipe `pure: false`, so it re-runs on every
change detection pass **that checks its view**. In a zone based app with default change
detection that is enough: the promise resolving schedules a pass, the view is checked,
the binding re-translates. That is exactly why the four existing apps look fine.

An `OnPush` view is skipped unless it is marked dirty, and a promise resolving inside a
service marks nothing. The pipe reads `this._serv.locale()` to register a reactive
dependency, but that signal only changes on an explicit locale switch, never on a load
completing. So an `OnPush` app keeps the keys it painted first, which is what the
evidence above shows.

### The fix

Give the service a `loaded` **signal** next to the existing subject, and have the pipe
read it:

```ts
// rokutranslator-service.ts
readonly loaded = signal(false);

// ...in the constructor, replacing the bare .then()
Promise.all(promises)
  .then(() => true)
  .catch(() => false)          // see Problem 3
  .then((ok) => {
    this.loaded.set(true);
    this.loaded$.next(ok);
    this.loaded$.complete();
  });
```

```ts
// rokutranslator-pipe.ts, in transform()
this._serv.locale();
this._serv.loaded();
```

One signal write, so every `OnPush` view holding a `| rokuT` binding is marked dirty
exactly once, at the moment there is something new to show. Cheap, generic, and it
needs nothing from the app.

`loaded$` stays. It is the right shape for a caller that wants to **wait**, and
`apps/velista/plans/0006` uses it that way at the app's entry point.

### This does not replace an app blocking on `loaded$`

The signal removes the _stuck_ keys. It does not remove the _flash_: there is still a
paint with keys in it before the strings arrive. An app that wants neither waits for
`loaded$` before activating its routes, which is an app level decision about its own
entry point and is deliberately not made here. Velista makes it in its `0006`.

## Problem 3: a failed loader never settles

Discovered while designing Problem 2's fix, and it becomes serious the moment an app
blocks on `loaded$`. `Promise.all(...).then(...)` has no rejection path, so a single
loader that throws, a 404 on a chunk, a malformed JSON file, leaves `loaded$` pending
**forever** and produces an unhandled rejection. An app that waits on it would hang on
a blank screen with no error.

The `.catch(() => false)` in the snippet above is the fix: `loaded$` always settles,
and it carries whether the load actually succeeded. A caller that only wants to know
"is it safe to render now" ignores the value; a caller that wants to report a failure
has it. The `loaded` signal flips either way, because a partially loaded namespace
still has strings worth painting.

## API additions

| Symbol                         | Where                                              | Why                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RokuTranslatorService.loaded` | `rokutranslator-angular`                           | Problem 2. A signal, so reading it in a template, a pipe or a `computed` is enough                                                                                                                                                                   |
| `unwrapDefault`                | `rokutranslator` (module private)                  | Problem 1. Shared by the eager and lazy load paths                                                                                                                                                                                                   |
| `TranslationSource`            | `rokutranslator-angular`, next to `LoaderFunction` | `{ namespace, locales, loader }`. Lets an app compose one `provideRokuTranslator` call from several libraries that each own their own asset folder. Requested by `apps/velista/plans/0006`, and `odontogram` already hand rolls this dispatch inline |

`TranslationSource` is a type and a convention, not a behaviour: `provideRokuTranslator`
is unchanged, and an app that does not compose keeps calling it exactly as before.

## Acceptance criteria

1. `addTranslations` with a **nested** object makes `t('home.hero.headline', { ns })`
   return the sentence. Covers the **eager** path specifically, which is the one that
   never had a test.
2. The same suite covers a loader returning `{ default: {...} }`, which is what every
   `import()` of a JSON file actually returns.
3. A **flat** dotted-key file still resolves, including a key that is not a valid
   identifier (`app-title`). This is the regression gate for the four working apps.
4. A rejecting loader settles `loaded$` with `false` and flips `loaded` to `true`,
   within one tick, with no unhandled rejection.
5. `RokuTranslatorPipe` re-renders an `OnPush` host when a load completes: render with
   a deferred loader, assert the key, resolve the loader, `await fixture.whenStable()`,
   assert the string, with **no** `detectChanges()` forcing it.
6. `npx nx run-many --all --target=test` and `--target=lint` pass. The four other apps'
   suites are the real gate for criterion 3.

## Files touched

| File                                                       | Change                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `rokutranslator/src/lib/rokutranslator.ts`                 | `unwrapDefault` helper; `loadTranslations` uses `addResourceBundle(deep, overwrite)`; `read` uses the helper |
| `rokutranslator/src/lib/rokutranslator.spec.ts`            | criteria 1, 2, 3                                                                                             |
| `rokutranslator-angular/src/lib/rokutranslator-service.ts` | `loaded` signal; `loaded$` settles on failure                                                                |
| `rokutranslator-angular/src/lib/rokutranslator-pipe.ts`    | reads `loaded()` in `transform`                                                                              |
| `rokutranslator-angular/src/lib/provide-rokutranslator.ts` | exports the `TranslationSource` interface                                                                    |
| `rokutranslator-angular/src/index.ts`                      | export the type                                                                                              |

## Open questions

**O1. Should flat JSON be migrated to nested?** No, and not here. Once this lands both
shapes work. If it is ever done it is one app per commit with that app's suite as the
gate, and it buys nothing but consistency.

**O2. Should the nested shape become the documented default?** Probably, in the
library's README, once an app other than velista uses it. Not worth writing a
convention down on a sample of one.

**O3. Should `loaded$` become a per namespace signal rather than per service
instance?** Today one service instance owns every namespace it registered and reports
them as one. That is right for an app that registers everything at its entry point,
and wrong for one that adds a namespace lazily later. Nothing needs it yet. Revisit
when a second app composes sources the way `velista/0006` does.
