import { composePlugins } from '@nx/webpack';
import { DefinePlugin } from 'webpack';
import merge from 'webpack-merge';

/**
 * The gateway this app talks to in production, and the single place it is written
 * down.
 *
 * The same host velista uses, on different routes (plan 0001, section 7). The back
 * office administers luna-shopper, so it talks to luna-shopper's API; there is no
 * second backend and no `LUNA_REALTIME_URL`, because this app polls and never
 * subscribes.
 */
export const DEFAULT_LUNA_GATEWAY_URL = 'https://api.velista.app';

/**
 * The production build. It differs from `webpack.config.ts` in one thing: the
 * gateway URL baked into the bundle.
 *
 * It arrives as a build argument rather than through a third Angular configuration,
 * which is the workspace's existing pattern (`MFE_BASE_URL` in the shell,
 * `LUNA_GATEWAY_URL` in velista). A `staging` Angular configuration would be bound
 * to `NODE_ENV=staging` by the Dockerfile, which is a lie to every tool that reads
 * it, and would force CI to special case this app while every other one builds with
 * `production`.
 *
 * That makes this the **second** image in the workspace that is not environment
 * agnostic, and both CI workflows carry a line for it beside velista's. It is not a
 * build arg on the Dockerfile: there is no build stage in that file, so the pair of
 * workflows set the variable on the `nx build` that produces the bundle, with
 * `docker run -e` on the builder container.
 *
 * A build with the variable unset produces exactly the intended production image, so
 * `nx build luna-shopper-admin --configuration production` on a developer machine is
 * the production bundle rather than a broken one.
 *
 * The asset rules are repeated rather than shared because the two files are separate
 * webpack entry points and a missing rule fails the build only in the configuration
 * that lacks it, which is the worst place to find out.
 */
export default composePlugins(async (config) =>
  merge(config, {
    plugins: [
      new DefinePlugin({
        'process.env.LUNA_GATEWAY_URL': JSON.stringify(
          process.env.LUNA_GATEWAY_URL || DEFAULT_LUNA_GATEWAY_URL
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
