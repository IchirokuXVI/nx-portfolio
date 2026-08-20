import { withModuleFederation } from '@nx/module-federation/angular';
import { composePlugins } from '@nx/webpack';
import merge from 'webpack-merge';
import mfeConfig from './module-federation.config';

/**
 * Parse the MFE_REMOTE_URLS env var — a comma-separated list of `name=url` pairs
 * (e.g. "landing=http://localhost:8081,odontogram=http://localhost:8082") — into a
 * `{ name: url }` map. Returns undefined when unset or empty. Splits each pair on
 * its first `=` so URLs may themselves contain `=`.
 */
function parseRemoteUrls(
  raw: string | undefined
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const url = pair.slice(eq + 1).trim();
    if (name && url) map[name] = url;
  }
  return Object.keys(map).length ? map : undefined;
}

export default composePlugins(async (config) => {
  // How the shell resolves its remotes is decided at build time, in this order of
  // precedence (see apps/shell/src/Dockerfile for how these reach the build):
  //
  //   1. MFE_REMOTE_URLS — an explicit per-remote map, e.g.
  //        "landing=http://localhost:8081,odontogram=http://localhost:8082,..."
  //      Use this when each remote lives on its own origin/port (the local "port"
  //      mode). A name absent from the map falls back to its default (rule 3).
  //   2. MFE_BASE_URL — a single micro-frontend host; every remote is loaded from
  //      `${MFE_BASE_URL}/<remote>` (production, staging, and the local mfe-path
  //      mode where the remotes share one host under an /mfe/<remote> prefix).
  //   3. Neither set — plain string remotes, which Nx resolves to each remote's
  //      dev-serve port (localhost:4201..4204). This is what `nx serve` uses.
  const remoteUrlMap = parseRemoteUrls(process.env.MFE_REMOTE_URLS);
  const mfeBaseUrl = process.env.MFE_BASE_URL;

  const remotes = remoteUrlMap
    ? mfeConfig.remotes?.map((remote) => {
        const name = typeof remote === 'string' ? remote : remote[0];
        return remoteUrlMap[name] ? ([name, remoteUrlMap[name]] as const) : remote;
      })
    : mfeBaseUrl
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
