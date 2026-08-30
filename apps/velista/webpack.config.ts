import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import { DefinePlugin } from 'webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

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
 * DTS Plugin is disabled in Nx Workspaces as Nx already provides Typing support for Module
 * Federation. The DTS Plugin can be enabled by setting dts: true.
 * Learn more about the DTS Plugin here: https://module-federation.io/configure/dts.html
 *
 * The asset rules mirror the other remotes' (see `apps/damoclesSword/webpack.config.ts`).
 * Angular's builder does not configure them, so every app that imports an asset from
 * TypeScript adds them itself:
 *
 * - a plain import (`import url from './x.svg'`) becomes a URL through
 *   `asset/resource`, which is what carries module federation's public path and so
 *   is the one asset route that is reliably scoped to *this* remote's origin;
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
export default composePlugins(async (config) => {
  const federatedModules = await withModuleFederation(mfeConfig, {
    dts: false,
  });

  return merge(federatedModules(config), {
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
