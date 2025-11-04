import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

export default composePlugins(async (config, { options, context }) => {
  const federatedModules = await withModuleFederation(
    {
      ...mfeConfig,
      remotes: [
        ['landing', 'https://mfe.ichirokuxvi.com/landing'],
        ['odontogram', 'https://mfe.ichirokuxvi.com/odontogram'],
      ],
    },
    { dts: false }
  );

  return merge(federatedModules(config), {
    module: {
      rules: [
        {
          test: /\.svg$/,
          oneOf: [
            {
              resourceQuery: /raw/,
              type: 'asset/source',
            },
            {
              type: 'asset/resource',
              generator: {
                filename: 'assets/[path][name].[hash][ext]',
              },
            },
          ],
        },
      ],
    },
  });
});
