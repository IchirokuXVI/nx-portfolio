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

  // ...and a remote that has outgrown that host names its own. velista is served from
  // its own origin now (plan 0013), which is a URL no base can produce, so CI passes
  // `MFE_REMOTE_URLS=velista=https://velista.app` (staging passes the staging host)
  // and the tuple below is replaced. It is a domain of its own rather than a label
  // under the portfolio's, which no base URL could produce either way.
  //
  // Read from the environment rather than hardcoded here, because the hostname differs
  // per environment and the shell is built once per environment anyway. Hardcoding it
  // would put the same two hostnames in this file that `values.yaml` already holds,
  // and would have to be edited again the next time a remote moves. This is also what
  // keeps reverting D5's redirect a one line change: the remote keeps working from its
  // new origin whether or not the portfolio still routes to it.
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
