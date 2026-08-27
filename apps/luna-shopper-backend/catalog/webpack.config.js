const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/luna-shopper-backend-catalog'),
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
  ],
};
