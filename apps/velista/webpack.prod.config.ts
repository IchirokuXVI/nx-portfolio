import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

/**
 * The production build. Identical to `webpack.config.ts` today: this remote exposes
 * routes and consumes none, so there are no remote URLs to override here the way
 * the shell overrides its own.
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
