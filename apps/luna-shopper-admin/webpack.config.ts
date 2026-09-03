import { composePlugins } from '@nx/webpack';
import { DefinePlugin } from 'webpack';
import merge from 'webpack-merge';

/**
 * Where the Luna Shopper backend is when nobody says otherwise: the port its config
 * schema defaults to, which is what a lone checkout running the compose stack with
 * no slot gets.
 */
export const DEV_LUNA_GATEWAY_URL = 'http://localhost:3000';

/**
 * The development build.
 *
 * **No `withModuleFederation`**, and that is the whole difference from every other
 * app's webpack config in this workspace. This app is not a micro-frontend (plan
 * 0001): no remote entry, no exposed `./Routes`, and no entry in the shell's
 * `remotes` list. The shell does not know it exists and must not learn.
 *
 * The `DefinePlugin` is load bearing rather than a convenience: `process` does not
 * exist in a browser, so `environment.ts` throws at startup without the
 * substitution. It is applied in development as well as production so a worktree on
 * a dev slot can point this build at that slot's backend
 * (`tools/dev/ng-slot.sh` writes the value into `apps/luna-shopper-admin/.env`,
 * which Nx loads into this project's tasks).
 *
 * The asset rules mirror the other apps'. Angular's builder does not configure them,
 * so every app that imports an asset from TypeScript adds them itself:
 *
 * - a plain import (`import url from './x.svg'`) becomes a URL through
 *   `asset/resource`;
 * - the `?raw` suffix becomes the file's text through `asset/source`, which is how
 *   an icon component inlines an SVG so `currentColor` can reach it.
 *
 * The `resourceQuery` guards are what keep the two apart: without them the plain
 * rule would also swallow `./x.svg?raw` and hand back a URL.
 */
export default composePlugins(async (config) =>
  merge(config, {
    plugins: [
      new DefinePlugin({
        'process.env.LUNA_GATEWAY_URL': JSON.stringify(
          process.env.LUNA_GATEWAY_URL || DEV_LUNA_GATEWAY_URL
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
  })
);
