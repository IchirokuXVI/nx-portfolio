import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import { DefinePlugin } from 'webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

/**
 * The production hosts, and the single place they are written down (plan 0014).
 *
 * `velista-api-hosts.spec.ts` asserts these against the routed Luna services in
 * `k8s/helm/values.yaml`, because the reason the realtime host was wrong for so
 * long is that two files had to agree and nothing checked that they did.
 *
 * They are on `velista.app`, not on the portfolio's domain: the backend serves this
 * app and nothing else, so it followed the app onto its own domain. The chart states
 * the same three names in `hostOverrides`, and the spec compares the two.
 */
export const DEFAULT_LUNA_GATEWAY_URL = 'https://api.velista.app';

/**
 * Note `rt.`, not `api.`. `environment.prod.ts` carried `api.` for both, but the
 * chart routes `luna-shopper-backend-realtime` on its own host, so every socket
 * and SSE connection was being attempted against the REST gateway, which does not
 * serve them. That was wrong in production, not only in staging.
 */
export const DEFAULT_LUNA_REALTIME_URL = 'https://rt.velista.app';

/**
 * The production build. It differs from `webpack.config.ts` in one thing: the two
 * backend URLs baked into the bundle.
 *
 * They arrive as build arguments rather than through a third Angular
 * configuration, which is the shell's existing pattern (`MFE_BASE_URL` in
 * `apps/shell/webpack.prod.config.ts`) and the right one here. A `staging` Angular
 * configuration would be bound to `NODE_ENV=staging` by the Dockerfile, which is a
 * lie to every tool that reads it, and would force CI to special case velista
 * while every other app builds with `production`.
 *
 * The `DefinePlugin` below is not a convenience, it is load bearing: `process.env`
 * does not exist in a browser, so without the substitution `environment.prod.ts`
 * throws at startup.
 *
 * The asset rules are repeated rather than shared because the two files are
 * separate webpack entry points and a missing rule fails the build only in the
 * configuration that lacks it, which is the worst place to find out. See the
 * comment in `webpack.config.ts` for what each rule is for.
 */
export default composePlugins(async (config) => {
  const federatedModules = await withModuleFederation(
    {
      ...mfeConfig,
    },
    { dts: false }
  );

  return merge(federatedModules(config), {
    plugins: [
      new DefinePlugin({
        // A build with neither variable set produces exactly the intended
        // production image, so `nx build velista --configuration production` on a
        // developer machine is the production bundle rather than a broken one.
        'process.env.LUNA_GATEWAY_URL': JSON.stringify(
          process.env.LUNA_GATEWAY_URL || DEFAULT_LUNA_GATEWAY_URL
        ),
        'process.env.LUNA_REALTIME_URL': JSON.stringify(
          process.env.LUNA_REALTIME_URL || DEFAULT_LUNA_REALTIME_URL
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
