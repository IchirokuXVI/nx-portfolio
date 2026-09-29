import baseConfig from '../../../../eslint.config.mjs';

const RULE = '@nx/enforce-module-boundaries';

/**
 * The `build` target here bundles the demo page and type checks the library.
 * The library itself ships as TypeScript through its path alias, like the
 * model it imports, so the buildable library check does not apply. Every
 * other option of the workspace rule is kept as it is.
 */
const notBuildable = baseConfig
  .filter((c) => c.rules?.[RULE])
  .map((c) => {
    const [level, options] = c.rules[RULE];
    return {
      ...(c.files ? { files: c.files } : {}),
      rules: {
        [RULE]: [level, { ...options, enforceBuildableLibDependency: false }],
      },
    };
  });

export default [...baseConfig, ...notBuildable];
