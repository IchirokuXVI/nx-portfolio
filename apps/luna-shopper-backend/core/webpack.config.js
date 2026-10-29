const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/luna-shopper-backend-core'),
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
    // The migration entry point (plan 0027, section 2.1). A SECOND
    // NxAppWebpackPlugin rather than an extra `entry`, because the plugin owns
    // the node target, the tsc compiler and the tsconfig; emitted beside main.js
    // so the deploy Job's `node migrate.js` finds it inside the image.
    //
    // generatePackageJson is false here on purpose: the entry above already
    // writes the pruned manifest that `npm ci --omit=dev` installs from, and two
    // writers would race for the same file.
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
    // The one off reconcile command (plan 0232, section 7). A third entry, for
    // the same reason as the second: release task 0005 runs `node
    // reconcile-deletions.js` inside the core pod, so it has to be in the image.
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/reconcile-deletions.ts',
      outputFileName: 'reconcile-deletions.js',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
    }),
  ],
};
