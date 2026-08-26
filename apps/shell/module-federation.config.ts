import { ModuleFederationConfig } from '@nx/module-federation';
import { sharedSingletons } from '../../module-federation.shared';

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
  remotes: ['landing', 'odontogram', 'damoclesSword', 'landingV2', 'velista'],
  /**
   * One `RokuTranslator` across the shell and every remote, so the locale is a
   * property of the page rather than of whichever bundle asked. See
   * `module-federation.shared.ts`, which also records why the rule that used to live
   * here never matched the library it named.
   */
  shared: sharedSingletons,
};

/**
 * Nx requires a default export of the config to allow correct resolution of the module federation graph.
 **/
export default config;
