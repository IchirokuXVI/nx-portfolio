import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';
import {
  parseRemoteUrls,
  remotesFromBase,
  withRemoteUrlOverrides,
} from './remote-urls';

export default composePlugins(async (config) => {
  // Most remotes live on a per-environment micro-frontend host. The base URL is baked
  // into the shell bundle at build time, so it is supplied via MFE_BASE_URL
  // (production by default; staging builds set it to the staging host). Loading them
  // from one base keeps those remote images environment agnostic and lets a release
  // promote the exact tested artifacts.
  const mfeBaseUrl = process.env.MFE_BASE_URL || 'https://mfe.ichirokuxvi.com';

  // ...and a remote that outgrows that host names its own through `MFE_REMOTE_URLS`,
  // which replaces its tuple below. No remote does today: velista, the one that did,
  // left the shell in velista plan 0165.
  //
  // Read from the environment rather than hardcoded here, because the hostname differs
  // per environment and the shell is built once per environment anyway.
  const remoteUrlMap = parseRemoteUrls(process.env.MFE_REMOTE_URLS);

  const federatedModules = await withModuleFederation(
    {
      ...mfeConfig,
      remotes: withRemoteUrlOverrides(
        remotesFromBase(mfeBaseUrl),
        remoteUrlMap
      ),
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
