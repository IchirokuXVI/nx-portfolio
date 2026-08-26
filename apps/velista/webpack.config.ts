import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

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
 */
export default composePlugins(async (config) => {
  const federatedModules = await withModuleFederation(mfeConfig, {
    dts: false,
  });

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
