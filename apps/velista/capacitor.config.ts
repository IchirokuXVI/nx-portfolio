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

/**
 * An OTA test on the emulator reads its files over http from localhost (plan 0180,
 * section 5), and the updater refuses every URL that is not https unless told otherwise.
 * build-android.mjs accepts an http VELISTA_OTA_URL for localhost only, and refuses
 * --bundle with it, so a Play build always keeps the refusal.
 */
function otaOverCleartext(): boolean {
  // Read through URL, as build-android.mjs reads it, so `HTTP://` counts too. This file
  // must never throw, so a value that is not a URL counts as not http.
  try {
    return new URL(process.env.VELISTA_OTA_URL ?? '').protocol === 'http:';
  } catch {
    return false;
  }
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
    // Over the air web bundles from the app's own cluster (plan 0180). Manual mode: the
    // app reads its own signed manifest and calls download, set and reset itself. The
    // three URLs are empty so the plugin never talks to Capgo's cloud (D11); the build
    // spike proved that an empty string stays empty. A bundle that does not call
    // notifyAppReady in time rolls back (D7): appReadyTimeout is the window of a bundle
    // that has booted well once, and the updater gives a pending bundle at least 30 s.
    // A new APK from Play drops every downloaded bundle and boots its own (D1).
    CapacitorUpdater: {
      autoUpdate: 'off',
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
      appReadyTimeout: 20000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
      httpsOnly: !otaOverCleartext(),
    },
  },
};

export default config;
