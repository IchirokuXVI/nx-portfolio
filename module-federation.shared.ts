import type { ModuleFederationConfig } from '@nx/module-federation';

/**
 * The library every micro-frontend must share **one instance** of, and the rule that
 * forces it.
 *
 * ## What was wrong
 *
 * `apps/shell/module-federation.config.ts` carried this rule alone, and it named
 * `@portfolio/localization/roku-translator`, hyphenated. The real path alias in
 * `tsconfig.base.json` is `@portfolio/localization/rokutranslator`, no hyphen, so the
 * condition had never matched anything since the day it was written. The comment above
 * it described a guarantee the workspace did not have.
 *
 * It was also in the wrong number of places. A `shared` callback governs only the build
 * it is written in: webpack decides how a module is consumed from the config of the
 * build doing the consuming, so a rule the host declares alone leaves five remotes
 * consuming on their own terms. It has to be stated in all six configs to mean
 * anything, and six copies of a rule is how a rule drifts. Hence one file, next to
 * `tsconfig.base.json` where the alias it names actually lives.
 *
 * ## Why this library, and what changed about the reason
 *
 * It used to hold the i18next instance and the active locale as module state behind a
 * singleton export, so two copies meant two locales: the shell switched language and a
 * remote carried on in the old one. That is no longer true, and getting the correction
 * backwards costs roughly 40KB of i18next per remote, so it is worth stating plainly.
 *
 * **"Stop being a singleton" and "stop being shared" are different changes, and plan
 * 0005 made only the first.** Module federation shares a *module*. That module used to
 * export a pre made instance, so sharing it shared the instance; it exports only a
 * class now, holds no mutable state, and sharing it means every remote downloads one
 * copy of the code while each still calls `new` for itself.
 *
 * So this entry stays, and what changed is its status: it stopped being load bearing
 * for correctness and became a plain deduplication win.
 *
 * ## What Nx already does, and what this adds
 *
 * Measured rather than assumed, by logging the config Nx hands this callback during a
 * real build. Nx shares workspace libraries it discovers and gives one `singleton: true`
 * **only when it can find a version**, which in practice means only when the library has
 * a package.json. `rokutranslator` has one (`0.0.1`, private), so it already arrives as
 * `{ requiredVersion: '0.0.1', singleton: true }`. Every other workspace library arrives
 * as `{ requiredVersion: false }`, with no singleton at all.
 *
 * So this is close to a no-op today, and not quite one: the callback runs against **two**
 * configurations per build, and in the second the entry arrives as `{}`, with no
 * singleton. Saying it explicitly closes that gap and, more usefully, stops the
 * guarantee from resting on a private version field that nobody would think to keep
 * when tidying up a package.json.
 *
 * ## Why it merges instead of replacing
 *
 * Nx applies this callback's return by **assignment**, not by merge
 * (`applySharedFunction` in `@nx/module-federation`): whatever comes back becomes the
 * whole entry. Returning a bare object would therefore have dropped the
 * `requiredVersion` Nx worked out, which is how a rule meant to strengthen sharing ends
 * up weakening it. Spreading the incoming config keeps everything Nx decided and
 * overrides the one field this is about.
 *
 * ## Why not `strictVersion`
 *
 * The rule this replaces asked for it, and it is deliberately not carried over.
 * `strictVersion` turns a version mismatch from a console warning into a hard runtime
 * failure, and this workspace deploys remotes **independently**: staging builds only the
 * affected micro-frontends and restarts only those deployments. A version bump on this
 * library would then leave a mixed fleet, and strict enforcement turns that ordinary
 * window into a blank page.
 *
 * With no shared mutable state left, a mixed fleet has stopped being a correctness
 * problem at all: two versions of a stateless class in one page is two copies of some
 * code, not two locales. That closes a standing hazard rather than opening a case for
 * strictness.
 */
const SINGLETON_LIBRARIES = ['@portfolio/localization/rokutranslator'];

/**
 * `@portfolio/localization/rokutranslator-angular` is **not** on that list, and the
 * omission cost enough to establish that it is worth writing down.
 *
 * It looks like it belongs. It contributes `RokuLocaleStore`, which is
 * `providedIn: 'root'`, so a duplicated copy is a second class, a second DI token and a
 * second instance in the shell's root injector. It is also genuinely passed to this
 * callback, so adding it appears to work.
 *
 * It does not work. Nx passes it under the name `localization/rokutranslator-angular`,
 * its **Nx project name**, while the core arrives under its tsconfig path alias. Webpack
 * matches a shared module by the request string an `import` actually writes, and nothing
 * imports `localization/rokutranslator-angular`: every import says
 * `@portfolio/localization/rokutranslator-angular`. So an entry under that name is never
 * consulted. Confirmed from the built output rather than reasoned about. With
 * `singleton: true` set on it, no app's `mf-manifest.json` listed it under `shared`,
 * while the core appears in all six with a chunk of its own.
 *
 * Listing it would therefore have been a second rule that silently does nothing, which
 * is precisely the bug this file exists to correct, so it is left out rather than left
 * in looking reassuring. Sharing it for real needs `additionalShared` keyed by the
 * import path, which is the supported route for something Nx did not discover under the
 * name its callers use.
 *
 * Not sharing it is survivable, and the reason has changed. It used to survive because
 * every duplicated copy of `RokuLocaleStore` subscribed to the same shared core, so the
 * copies stayed in step. That reason expired with plan 0005 D5: the store is no longer
 * `providedIn: 'root'`, it is provided by `provideRokuTranslator` next to the translator
 * it watches, and each app has exactly one of each. A duplicated class is now simply a
 * duplicated class, with no instance anybody resolves twice.
 *
 * The standing caveat holds: this library still carries no module level state, and if it
 * ever grows some it needs the `additionalShared` treatment before it does.
 */
export const sharedSingletons: ModuleFederationConfig['shared'] = (
  lib,
  config
) => {
  if (SINGLETON_LIBRARIES.includes(lib)) {
    return { ...config, singleton: true };
  }

  // No opinion: every other library keeps whatever Nx decided for it.
  return undefined;
};
