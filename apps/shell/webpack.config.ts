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
  // How the shell resolves its remotes is decided at build time, in this order of
  // precedence (see apps/shell/src/Dockerfile for how these reach the build):
  //
  //   1. MFE_REMOTE_URLS — an explicit per-remote map, e.g.
  //        "landing=http://localhost:8081,odontogram=http://localhost:8082,..."
  //      Use this when each remote lives on its own origin/port (the local "port"
  //      mode, and how velista's own origin is named in production). A name absent
  //      from the map falls back to its default (rules 2 and 3).
  //   2. MFE_BASE_URL — a single micro-frontend host; every remote is loaded from
  //      `${MFE_BASE_URL}/<remote>` (production, staging, and the local mfe-path
  //      mode where the remotes share one host under an /mfe/<remote> prefix).
  //   3. Neither set — plain string remotes, which Nx resolves to each remote's
  //      dev-serve port (localhost:4201..4205). This is what `nx serve` uses.
  //
  // `webpack.prod.config.ts` reads the same two variables through the same helpers, so
  // the two configs cannot drift on precedence.
  const remoteUrlMap = parseRemoteUrls(process.env.MFE_REMOTE_URLS);
  const mfeBaseUrl = process.env.MFE_BASE_URL;

  const remotes = withRemoteUrlOverrides(
    mfeBaseUrl ? remotesFromBase(mfeBaseUrl) : (mfeConfig.remotes ?? []),
    remoteUrlMap
  );

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
