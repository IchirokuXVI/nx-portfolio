import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    /**
     * `docs/research/` is evidence, not code.
     *
     * Those scripts are checked in so that the numbers in the plans they
     * produced can be re-taken by somebody who did not write them. Nothing
     * imports them, no target builds them and CI never runs them, so linting
     * them would fail a pull request over the style of a measurement that has
     * already been made. They live under this project only because the chain
     * they probe is this service's, and each one carries its own README.
     */
    ignores: ['docs/research/**'],
  },
];
