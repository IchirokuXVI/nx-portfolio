import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

/**
 * `environment.ts` reads the gateway URL from `process.env` and webpack's
 * `DefinePlugin` substitutes it (see `webpack.config.ts` for why it cannot be a
 * literal). Jest has no webpack, so without this the app's `ADMIN_API_CONFIG` would
 * resolve to `undefined` under test and a spec that looked at a request URL would
 * see `undefined/v1/...` with nothing to say why.
 *
 * Set to the same default the dev build uses. Assigned only when unset, so a run
 * that deliberately points somewhere else keeps its own value.
 */
process.env['LUNA_GATEWAY_URL'] ??= 'http://localhost:3000';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
