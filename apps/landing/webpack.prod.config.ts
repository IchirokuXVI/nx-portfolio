import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

export default composePlugins(async (config, { options, context }) => {
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
          test: /\.(pdf|png|jpe?g|gif|ico|bmp|webp)$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[path][name].[hash][ext]',
          },
        },
      ],
    },
  });
});
