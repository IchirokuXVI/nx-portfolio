import { composePlugins } from '@nx/webpack';
import { DefinePlugin } from 'webpack';
import merge from 'webpack-merge';
import { DEFAULT_APP_VERSION } from './app-version';

/**
 * Where the Luna Shopper backend is when nobody says otherwise: the ports its
 * config schema defaults to, which is what a lone checkout running the compose
 * stack with no slot gets. These are the values `environment.ts` used to state as
 * literals, so a plain `nx serve velista` behaves exactly as it did.
 */
export const DEV_LUNA_GATEWAY_URL = 'http://localhost:3000';
export const DEV_LUNA_REALTIME_URL = 'http://localhost:3001';

/**
 * Where this app answers on its own origin in development: the port `project.json`
 * serves velista on (plan 0033 D10). A worktree on a dev slot overrides it through
 * `apps/velista/.env`, like the two backend URLs above.
 */
export const DEV_VELISTA_APP_URL = 'http://localhost:4205';

/**
 * Angular's builder does not configure asset imports from TypeScript, so the three
 * rules below add them:
 *
 * - a plain import (`import url from './x.svg'`) becomes a URL through
 *   `asset/resource`. The URL is relative, so it resolves against the document's
 *   `<base>`, which is what keeps it right under the portfolio's `/velista` path
 *   (plan 0165 D2);
 * - the `?raw` suffix becomes the file's text through `asset/source`, which is how
 *   an icon component inlines an SVG so `currentColor` can reach it.
 *
 * The `resourceQuery` guards are what keep the two apart: without them the plain
 * rule would also swallow `./x.svg?raw` and hand back a URL.
 *
 * The `DefinePlugin` is the same mechanism `webpack.prod.config.ts` uses, for the
 * same reason, applied to development. It exists so a worktree on a dev slot can
 * point this build at that slot's backend (`tools/dev/ng-slot.sh` writes the pair
 * into `apps/velista/.env`, which Nx loads into this project's tasks). Without it
 * the two URLs are literals in `environment.ts` and every worktree talks to the
 * one backend on 3000, which is precisely the collision the slots exist to stop.
 *
 * It is load bearing in the same way as the production one: `process` does not
 * exist in a browser, so `environment.ts` throws at startup without the
 * substitution. `velista-env-substitution.spec.ts` asserts the two files agree.
 */
export default composePlugins((config) => {
  return merge(config, {
    plugins: [
      new DefinePlugin({
        'process.env.LUNA_GATEWAY_URL': JSON.stringify(
          process.env.LUNA_GATEWAY_URL || DEV_LUNA_GATEWAY_URL
        ),
        'process.env.LUNA_REALTIME_URL': JSON.stringify(
          process.env.LUNA_REALTIME_URL || DEV_LUNA_REALTIME_URL
        ),
        'process.env.VELISTA_APP_URL': JSON.stringify(
          process.env.VELISTA_APP_URL || DEV_VELISTA_APP_URL
        ),
        // Which build this is (plan 0034 D4). Substituted in development as well
        // as production for the same reason as the URLs above: `environment.ts`
        // reads it, and an unsubstituted `process.env` throws at startup in a
        // browser. Nothing sets it locally, so a served app is always the default.
        'process.env.VELISTA_APP_VERSION': JSON.stringify(
          process.env.VELISTA_APP_VERSION || DEFAULT_APP_VERSION
        ),
      }),
    ],
    module: {
      rules: [
        {
          test: /\.(jpe?g|png|avif|svg|mp4|pdf)$/,
          type: 'asset/resource',
          resourceQuery: { not: [/raw/] },
        },
        {
          test: /\.svg$/,
          type: 'asset/source',
          resourceQuery: /raw/,
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          type: 'asset/resource',
        },
      ],
    },
  });
});
