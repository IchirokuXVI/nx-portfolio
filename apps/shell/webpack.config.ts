import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

export default composePlugins(async (config) => {
  // By default (plain `nx serve`) the remotes are plain string entries, which Nx
  // resolves to each remote's local dev port (localhost:4201..4204). That is what
  // we want for local development against the dev servers.
  //
  // When MFE_BASE_URL is set (the containerized dev build, see apps/shell/src/Dockerfile),
  // the remotes live behind the reverse proxy on a single micro-frontend host, so
  // switch to absolute tuple remotes pointing at that base. This keeps the dev
  // build usable both on bare localhost ports and behind the proxy.
  const mfeBaseUrl = process.env.MFE_BASE_URL;

  const remotes = mfeBaseUrl
    ? ([
        ['landing', `${mfeBaseUrl}/landing`],
        ['odontogram', `${mfeBaseUrl}/odontogram`],
        ['damoclesSword', `${mfeBaseUrl}/damoclesSword`],
        ['landingV2', `${mfeBaseUrl}/landingV2`],
      ] as [string, string][])
    : mfeConfig.remotes;

  const federatedModules = await withModuleFederation(
    {
      ...mfeConfig,
      remotes,
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
