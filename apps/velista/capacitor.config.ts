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
  loggingBehavior: 'production',
  server: {
    androidScheme: 'https',
    hostname: appHostname(),
  },
  android: {
    webContentsDebuggingEnabled: process.env.VELISTA_NATIVE_DEBUG === '1',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'native',
      style: 'DARK',
    },
  },
};

export default config;
