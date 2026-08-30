const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/luna-shopper-backend-harvester'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    // The migration entry point (plan 0027, section 2.1), emitted as migrate.js
    // beside main.js so the chart's Job can run `node migrate.js` inside the
    // image. The harvester owns a database, so it needs one exactly like auth,
    // core and catalog do.
    //
    // generatePackageJson is false here: the entry above already writes the
    // pruned manifest, and two writers would race for the same file.
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/migrate.ts',
      outputFileName: 'migrate.js',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
    }),
  ],
};
