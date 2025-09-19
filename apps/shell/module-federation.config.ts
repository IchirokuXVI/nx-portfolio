import { ModuleFederationConfig } from '@nx/module-federation';

const config: ModuleFederationConfig = {
  name: 'shell',
  /**
   * To use a remote that does not exist in your current Nx Workspace
   * You can use the tuple-syntax to define your remote
   *
   * remotes: [['my-external-remote', 'https://nx-angular-remote.netlify.app']]
   *
   * You _may_ need to add a `remotes.d.ts` file to your `src/` folder declaring the external remote for tsc, with the
   * following content:
   *
   * declare module 'my-external-remote';
   *
   */
  remotes: ['landing', 'odontogram'],
  shared: (lib, config) => {
    // roku-translator is a singleton as it holds the current locale and i18next instance
    // We want all micro-frontends to use the same instance to avoid configuration issues
    // and to be able to change the locale from the shell and have it reflected in the remotes
    if (lib === '@portfolio/localization/roku-translator') {
      return {
        singleton: true,
        strictVersion: true,
        requiredVersion: 'auto',
      };
    }
  },
};

/**
 * Nx requires a default export of the config to allow correct resolution of the module federation graph.
 **/
export default config;
