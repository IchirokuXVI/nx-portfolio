import { ModuleFederationConfig } from '@nx/module-federation';
import { sharedSingletons } from '../../module-federation.shared';

const config: ModuleFederationConfig = {
  name: 'landing',
  exposes: {
    './Routes': 'apps/landing/src/app/remote-entry/entry.routes.ts',
  },
  /**
   * The same singleton rule the shell declares. It has to be repeated per build:
   * webpack consumes a shared module on the terms of the build doing the consuming,
   * so a remote without this would take its own copy of `RokuTranslator` and drift
   * out of the shell's locale. See `module-federation.shared.ts`.
   */
  shared: sharedSingletons,
};

/**
 * Nx requires a default export of the config to allow correct resolution of the module federation graph.
 **/
export default config;
