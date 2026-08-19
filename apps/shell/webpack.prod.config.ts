import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

export default composePlugins(async (config) => {
  // The remotes live on a per-environment micro-frontend host. The base URL is
  // baked into the shell bundle at build time, so it is supplied via MFE_BASE_URL
  // (production by default; staging builds set it to the staging host). Every
  // remote is loaded from this base, which keeps the remote images environment
  // agnostic and lets a release promote the exact tested artifacts.
  const mfeBaseUrl = process.env.MFE_BASE_URL || 'https://mfe.ichirokuxvi.com';

  const federatedModules = await withModuleFederation(
    {
      ...mfeConfig,
      remotes: [
        ['landing', `${mfeBaseUrl}/landing`],
        ['odontogram', `${mfeBaseUrl}/odontogram`],
        ['damoclesSword', `${mfeBaseUrl}/damoclesSword`],
        ['landingV2', `${mfeBaseUrl}/landingV2`],
      ],
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
      ],
    },
  });
});
