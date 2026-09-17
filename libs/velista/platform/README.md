# velista/platform

Services that wrap the **runtime environment** rather than the backend: the browser,
the connection, navigation and history, installing and updating the app, audio, and
a few small helpers every feature library reaches for. The full list is below.

It exists so that `ui` and `data-access` can stay siblings that cannot see each other
(plan `0004` section 3). `ui` needs the browser facade for the connection-lost screen
and the theme override, and rule D1 forbids it from importing `data-access`, so what
they share lives here instead.

Layering: `models` → `platform` → { `ui`, `data-access` } → `feature-*`.

## What it exports

### The browser and the connection

- `browser-facade`: `BrowserFacade`, the one place the app reads `window`, `document`,
  `navigator` and `localStorage`. Every accessor degrades to null or a no-op in a
  server render.
- `connection-state`: `ConnectionState`, whether the app believes it can reach the
  backend, from the browser's online events and from requests that got no response.
- `backend-readiness`: `BackendReadiness`, the startup answer (`connecting`, `ready`,
  `unreachable`, `too-old`). The probe that writes it lives in `data-access`.
- `startup-gate`: `StartupGate`, whether the app may draw the page it is on yet, and
  the `RENDERS_WHILE_CONNECTING` route data flag.
- `app-resumed`: `AppResumed`, a counter that moves when the app comes back from the
  background (`visibilitychange`, or a `pageshow` from the back/forward cache).
- `reload-blocker`: `ReloadBlocker`, which defers an automatic reload while a
  component holds unsaved state.
- `storage-keys`: `StorageKeys`, every browser storage key the app writes, namespaced
  with `APP_KEY`.
- `access-token-expiry`: reads the `exp` claim of an access token, only to schedule a
  refresh.
- `geolocation-reader`: `GEOLOCATION_READER` and `BrowserGeolocationReader`, a device
  location as two numbers and one of four outcomes.

### Navigation, history and sheets

- `app-history`: `AppHistory`, whether the entry behind this one is one this document
  pushed, so a back control never leaves the app.
- `page-navigation`: `PageNavigation.back(fallbackUrl)`, a page's back button.
- `sheet-navigation`: `SheetNavigation`, how a sheet leaves the screen (`dismiss`
  pops or replaces, `leaveTo` replaces) so the back button never reopens it.
- `sheet-path`: `SHEET_SEGMENT` and `sheetSegments()`, the `sheet` marker that
  addresses a sheet under the page it covers.
- `sheet-fall`: `OpenSheet` and `sheetFallGuard`, which let a sheet play its exit
  animation before any navigation off its route goes through.
- `app-path`: `appPath()`, an absolute URL inside the app from the mount and the
  locale.
- `share-url`: `shareUrl()`, an absolute URL for somebody else, with no locale in it.
- `route-params`: route parameters as signals (`zoneIdOf`, `listIdOf`, `lineIdOf` and
  others), walked up the route tree.

### Installing, updating and the theme

- `install-state`: the three install states and the manual install guide for a
  browser.
- `install-store`: `InstallStore`, the one place that reads `beforeinstallprompt`,
  `appinstalled` and the display mode.
- `app-updates`: `AppUpdates`, the service worker update checks and critical updates.
- `theme-store`: `ThemeStore`, the active theme and the persisted choice.
- `platform-providers`: `VELISTA_PLATFORM_PROVIDERS` (`ThemeStore` and
  `InstallStore`), which the app layer installs because they depend on values the app
  provides.

### Audio

- `audio-capture`: `AUDIO_CAPTURE` and `MediaRecorderCapture`, a recording session.
- `audio-recorder`: `AudioRecorder` and `RECORDING_LIMITS`, the recording state and
  its warn and pause limits.
- `silence-detector`: `SILENCE_DETECTOR` and `WebAudioSilenceDetector`, which decides
  when somebody has stopped talking.
- `notification-tone`: `NOTIFICATION_TONE` and `WebAudioNotificationTone`, a short
  sound when something left the device.

### Formatting and testing

- `money`: `formatMoney()`, an amount in the reader's language through `Intl`.
- `retry-clock`: `retryClock()`, a wait in seconds as `m:ss`.
- `testing/velista-testing`: `provideVelistaTesting()` and the fakes a velista spec
  needs (`fakeBrowserFacade`, `fakeGeolocationReader` and others). Nothing under
  `src` imports it, so it is never bundled.

## Running unit tests

Run `nx test velista/platform` to execute the unit tests.
