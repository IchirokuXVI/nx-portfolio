import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

/**
 * `environment.ts` reads its two backend URLs from `process.env` and webpack's
 * `DefinePlugin` substitutes them (see `webpack.config.ts` for why they cannot be
 * literals any more). Jest has no webpack, so without this the app's
 * `APP_API_CONFIG` would resolve to a pair of `undefined`s under test and a spec
 * that looked at a request URL would see `undefined/v1/...` with nothing to say
 * why.
 *
 * Set to the same defaults the dev build uses, so a test sees what `nx serve`
 * would produce on a checkout with no slot configured. Assigned only when unset,
 * so a run that deliberately points somewhere else keeps its own value.
 */
process.env['LUNA_GATEWAY_URL'] ??= 'http://localhost:3000';
process.env['LUNA_REALTIME_URL'] ??= 'http://localhost:3001';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
