import type { AdminApiConfig } from '@portfolio/luna-shopper-admin/models';

/**
 * The app's own environment surface.
 *
 * Deliberately **not** `@portfolio/shared/environments`: that object describes the
 * portfolio's own backend, and this app talks to luna-shopper. Swapped at build time
 * by `fileReplacements` (see project.json), the standard Angular mechanism the rest
 * of the workspace already uses.
 *
 * The gateway URL is read from `process.env` and replaced at compile time by the
 * `DefinePlugin` in `webpack.config.ts`, which supplies the local default. The
 * reason it is worth doing in development as well as production is the dev slots:
 * several worktrees serve this app at once, each pointed at a backend of its own, so
 * it cannot be a literal. `tools/dev/ng-slot.sh` writes it into
 * `apps/luna-shopper-admin/.env` and Nx loads that into this project's tasks, so a
 * build with the variable unset is exactly the single stack workflow.
 *
 * **There is no environment name here**, and there must never be one. Which
 * deployment this is comes from `GET /v1/admin/environment` at runtime (plan 0001,
 * section 6): a compile time value is precisely what is wrong in the scenario the
 * feature guards against.
 */
/**
 * Just enough of `process` for the read below, declared file-locally.
 *
 * This is a browser tsconfig, so `process` is genuinely absent from the types, and
 * it is genuinely absent at runtime too: the `DefinePlugin` replaces the expression
 * with a string literal before any of this reaches a browser. Adding
 * `"types": ["node"]` to tsconfig.app.json would compile, but it would also tell
 * every other file in this app that `fs` and `Buffer` are available, which is the
 * opposite of true.
 */
declare const process: { env: Record<string, string | undefined> };

export const environment: {
  production: boolean;
  api: AdminApiConfig;
  /** Which build this is (backend plan 0080, section 11). Substituted at build time. */
  version: string;
} = {
  production: false,
  api: {
    // The luna-shopper gateway (PORT defaults to 3000 in its config schema).
    gatewayBaseUrl: process.env['LUNA_GATEWAY_URL'] as string,
  },
  version: process.env['LUNA_ADMIN_APP_VERSION'] as string,
};
