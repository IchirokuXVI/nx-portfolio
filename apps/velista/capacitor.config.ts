import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The WebView serves the bundle from the app's own origin (plan 0167, D1): the host of
 * `VELISTA_APP_URL`, so a staging build lives on `https://staging.velista.app` and a
 * production build on `https://velista.app`. That origin is already the PWA's entry in
 * the backend's CORS allowlist, so no environment needs a new one; invite and share
 * links built from `location.origin` are the same strings as on the web; and an App
 * Link that opens the app resolves inside the WebView against the bundle.
 */
function appHostname(): string {
  const url = process.env.VELISTA_APP_URL;
  if (url === undefined || url === '') {
    return 'velista.app';
  }

  return new URL(url).hostname;
}

const config: CapacitorConfig = {
  appId: 'app.velista',
  appName: 'Velista',
  webDir: '../../dist/apps/velista',
  zoomEnabled: false,
  // Capacitor's 'production' means "log always", so a release APK would write every
  // plugin call and console line to logcat. 'debug' logs only in a debug build.
  loggingBehavior: 'debug',
  server: {
    androidScheme: 'https',
    hostname: appHostname(),
  },
  android: {
    webContentsDebuggingEnabled: process.env.VELISTA_NATIVE_DEBUG === '1',
    // The bundle is ES2022 output: class static blocks and native class fields need
    // Chromium 94. An older WebView cannot parse it (Chrome 69 on the API 26 emulator
    // drew a blank page with a SyntaxError), so below 94 Capacitor's own "update your
    // WebView" message is the honest answer. A lower bound read from the syntax, not
    // a measured floor.
    minWebViewVersion: 94,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      style: 'DARK',
    },
  },
};

export default config;
