const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * The library ships as TypeScript through its path alias, so this build is
 * the demo page only: `demo/main.ts` bundled into one classic script beside a
 * copy of `demo/index.html`. A classic script, because a module script does
 * not load from `file://`, and the page is opened from disk. The type check
 * runs over the library and the demo.
 */
module.exports = {
  output: {
    path: join(
      __dirname,
      '../../../../dist/libs/luna-shopper/shop-map/editor/demo'
    ),
    clean: true,
    filename: 'demo.js',
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'web',
      compiler: 'tsc',
      main: './demo/main.ts',
      tsConfig: './tsconfig.demo.json',
      assets: [{ input: './demo', glob: 'index.html', output: '.' }],
      optimization: true,
      outputHashing: 'none',
      sourceMap: false,
      extractLicenses: false,
      runtimeChunk: false,
      vendorChunk: false,
      scriptType: 'text/javascript',
    }),
  ],
};
