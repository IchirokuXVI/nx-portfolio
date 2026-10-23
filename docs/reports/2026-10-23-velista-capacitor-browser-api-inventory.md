# Velista in a Capacitor Android shell and under Angular SSR: what the code does today

I made no edits. Worktree: `D:\Projects\nx-portfolio\.claude\worktrees\velista-capacitor` at `63f740d8`. Paths below are relative to it. Line numbers come from `grep -n` or `cat -n` on each file.

The short version:

* Nearly every browser global is already behind `BrowserFacade` or behind a DI token, as plan 0001 D2 requires. A native implementation can be swapped in by DI for most features.
* Five things break in a WebView:
  * the service worker based update flow;
  * the install flow;
  * Web Share;
  * WebXR camera walks;
  * share links built from `location.origin`.
* The hardware back button has no handler and no registry it could call.
* The voice features use `MediaRecorder` and upload the audio. They do not use `SpeechRecognition`, so the missing Web Speech API in WebView costs nothing.
* SSR is structurally blocked by the build shape (a webpack module federation browser build, no `@angular/ssr`), not by browser access.

## 1. Browser API inventory

**SSR column legend.** "Safe" means the code runs only in a handler, in an `afterNextRender`, behind `isPlatformBrowser`, or through the facade, which returns null on the server. "Construction" means it runs in a constructor or field initializer but through the facade, so it degrades to null or false on the server and does not throw.

### 1.1 The facade itself: `libs/velista/platform/src/lib/browser-facade.ts`

This root service is the sanctioned seam (plan 0001 D2).

* **`isBrowser`** (line 68) from `isPlatformBrowser(PLATFORM_ID)`.
* **Constructor work, browser only** (lines 67 to 96):
  * reads `navigator.onLine` at line 78;
  * listens to window `online` and `offline` at lines 82 and 83;
  * reads `document.visibilityState` and listens to `visibilitychange` at lines 86 to 89.
  * Serves plans 0001 D6, 0035, 0071 and 0159. Guarded, so safe.
* **`window`, `document`, `location` getters** (lines 99 to 111). `window` and `location` are null on the server.
* **`matchMedia(query)`** (line 128): memoised signal, false on the server. Used for `prefers-color-scheme: light` (plan 0002) and `display-mode: standalone` (plan 0033).
* **`observeIntersection`** (line 173): `IntersectionObserver` for plan 0093.
* **Storage** (lines 230 to 370):
  * `readStorage`, `writeStorage`, `removeStorage` and `watchStorage` (the `storage` event, plan 0067);
  * `localStorage`, switched to `sessionStorage` while a support session is active (plan 0133, line 214);
  * `readSessionStorage`, `writeSessionStorage`, `removeSessionStorage` and `removeSessionStorageWhere`;
  * every call is wrapped in try/catch.
* **`openExternal(url)`** (line 382): `window.open(url, '_blank', 'noopener')`.
* **`reload()`** (line 391): `location.reload()`.
* **`replaceDocument(url)`** (line 418): `location.replace`, with a "leaving" latch that freezes session storage writes (plan 0133).

### 1.2 Navigator APIs (share, clipboard, media, geolocation, permissions, wake lock, user agent, standalone)

**Web Share (`navigator.share`).** The feature files read it through `BrowserFacade.window`. Every `canShare` is a class field read once. Under SSR it is false and does not throw.

* `feature-home/src/lib/home-page/home-page.ts`
  * line 413: `canShare` field;
  * lines 556 to 563: share the group invite (plan 0008 section 9);
  * fallback is `copyCode`.
* `feature-zones/src/lib/group-page/group-page.ts`: line 261 (`canShare`), lines 545 to 552 (share invite).
* `feature-shopping-lists/src/lib/share-sheet/share-sheet.ts`
  * line 175: `canShare`;
  * lines 506 to 513: share the basket link (plans 0044, 0094);
  * fallback is copy.
* `feature-walk-lab/src/lib/storage/walk-files.ts`
  * lines 42 and 67: `navigator.canShare` and `navigator.share({ files })` for GeoJSON walk files (walk lab, plans 0126 and 0127);
  * reached through an injected `DOCUMENT.defaultView`, in handlers.

**Clipboard (`navigator.clipboard`).**

* `writeText` in handlers, all through the facade:
  * `home-page.ts` lines 526 and 583 (invite code, support reference);
  * `group-page.ts` line 518;
  * `shopping-lists-page.ts` line 451;
  * `share-sheet.ts` line 484.
* `readText` in a handler: `feature-entry/src/lib/join-code-sheet/join-code-sheet.ts` lines 120 to 126, a paste into the join code field.

**Microphone (`navigator.mediaDevices.getUserMedia`, `MediaRecorder`).**

* `platform/src/lib/audio-capture.ts`
  * `MediaRecorderCapture.supported()` at lines 136 to 143;
  * `open()` at lines 146 to 207, which calls `getUserMedia({ audio: true })` and `new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })`;
  * `isTypeSupported` negotiation at line 219.
* It runs only when the user presses record. It sits behind the `AUDIO_CAPTURE` token (line 55, `providedIn: 'root'`, factory `MediaRecorderCapture`).
* Serves:
  * plan 0032 (assistant voice);
  * plan 0038 (adding a line by saying it);
  * plan 0039 (voice comments);
  * plan 0041 (one recorder).

**Geolocation and the Permissions API.**

* `platform/src/lib/geolocation-reader.ts`
  * `BrowserGeolocationReader.permission()` at line 145 uses `globalThis.navigator?.permissions.query({ name: 'geolocation' })`;
  * `read()` at line 162 uses `globalThis.navigator?.geolocation.getCurrentPosition`, with `enableHighAccuracy` set per call;
  * nothing happens at construction;
  * behind the `GEOLOCATION_READER` token (bottom of the file, factory `new BrowserGeolocationReader()`).
  * Serves plan 0058 (the device says where you shop) and plan 0103 (shop picker, high accuracy).
* `feature-walk-lab/src/lib/capture/walk-capture.ts` line 373: `navigator.geolocation` directly, in the lab only.

**Wake lock.**

* `platform/src/lib/sensors/walk-sensors.ts` line 205: `navigator.wakeLock.request('screen')`, requested again on `visibilitychange` (line 222).
* `feature-walk-lab/src/lib/capture/walk-capture.ts` lines 456 to 477.
* Both run when a walk starts.

**Vibrate.** `walk-capture.ts` line 286 (lab only).

**User agent and touch points.** `platform/src/lib/install-store.ts` lines 99 to 103 feed `installGuideFor` (in `install-state.ts`). It runs in the constructor through the facade, and the user agent is empty on the server.

**`navigator.standalone` (iOS).** `install-store.ts` lines 86 to 88, in the constructor through the facade.

**`navigator.languages` and `navigator.language` (shared localization library).**

* `libs/shared/localization/rokutranslator/src/lib/rokutranslator.ts` lines 254 to 258 (`getBrowserLocale`, called from init at line 174 when no locale is configured). **No guard.**
* `libs/shared/localization/rokutranslator-angular/src/lib/locale-routing/resolve-locale.ts` line 18 has a `typeof navigator` guard. That guard is ineffective on Node 21 and later, where `globalThis.navigator` exists.

**WebXR (`navigator.xr`).**

* `platform/src/lib/sensors/xr-camera.ts`
  * lines 60 to 61: `isSessionSupported('immersive-ar')`;
  * lines 96 to 99: `requestSession('immersive-ar', { optionalFeatures: ['dom-overlay'] })`;
  * a WebGL `xrCompatible` canvas at line 128.
* Used by `WebXrWalkSensors` (`walk-sensors.ts` line 98) behind the `WALK_SENSORS` token (line 299).
* Serves plan 0126 (recording a walk with the camera), plans 0129 and 0136, and the walk lab.

**`SpeechRecognition` / `webkitSpeechRecognition`.** **No use anywhere.** The comment in `audio-capture.ts` lines 104 to 126 records that `SpeechRecognition` was tried in commit `ef47f1a` and replaced by `MediaRecorder` once backend plan 0041 added an audio endpoint.

### 1.3 Audio output

* `platform/src/lib/notification-tone.ts`
  * `WebAudioNotificationTone` (line 76) opens the `AudioContext` lazily (`_open`, line 125);
  * token `NOTIFICATION_TONE` (line 149);
  * plays when an event arrives (`feature-lists/src/lib/list-page/list-page.ts` line 1849).
* `platform/src/lib/silence-detector.ts`
  * `WebAudioSilenceDetector` (line 165) uses `AudioContext` or `webkitAudioContext` (lines 174 to 191) on the recording stream;
  * token `SILENCE_DETECTOR` (line 125);
  * plans 0038 and 0041.
* `platform/src/lib/sensors/walk-tones.ts`: `AudioContext` lazily (line 86), token `WALK_TONES` (line 96), walk feedback.
* `ui/src/lib/list/audio-player.ts`: `new Audio(url)` at line 243 and `play()` at line 197, in a handler.
  * The URL is a blob URL from `data-access/src/lib/comments/comment-api.ts` lines 109 to 117. That code fetches `/v1/comments/:id/audio` with the bearer token and calls `URL.createObjectURL` (plan 0039).

### 1.4 Device orientation and motion

* `platform/src/lib/sensors/orientation-stream.ts`
  * the Generic Sensor API (`AbsoluteOrientationSensor` / `RelativeOrientationSensor`, `startSensor`, around lines 104 to 160);
  * falls back to the `deviceorientationabsolute` or `deviceorientation` window events (lines 56 to 71);
  * starts on a walk.
* `feature-walk-lab/src/lib/capture/walk-capture.ts`
  * `DeviceMotionEvent.requestPermission` and `DeviceOrientationEvent.requestPermission` at lines 300 to 313 (iOS);
  * `devicemotion` listener at lines 322 to 327;
  * lab only, in a handler.

### 1.5 Viewport and keyboard

* **`visualViewport`.**
  * `platform/src/lib/sensors/keyboard-inset.ts` line 25 (`watchKeyboardInset`, plans 0126 and 0127).
  * It is called by `feature-shop-map/src/lib/record/mark-sheet.ts` line 117 and by `suggestion-sheet.ts` line 139, inside the WebXR DOM overlay.
  * Also used by `feature-walk-lab/src/lib/pages/record-page.ts` line 430.
  * Also used by `ui/src/lib/tour/tour-spotlight.ts` lines 238 and 305, inside an effect, through `target.ownerDocument`.
* **Viewport meta.** `apps/velista/src/index.html` lines 17 to 20: `width=device-width, initial-scale=1, interactive-widget=resizes-content` (plan 0008 section 7). There is **no `viewport-fit=cover`**.
* **`svh` everywhere.**
  * `ui/src/lib/layout/app-layout.scss` line 126 (`block-size: 100svh`), with the rationale at lines 85 to 115 (velista 0106).
  * `apps/velista/src/app/app-root.ts` line 42.
  * `apps/velista/src/styles.scss` (`body { min-height: 100svh }`).
  * `--app-sheet-max-height: calc(86svh - ...)` in `ui/src/lib/styles/_semantic.scss` line 497.
  * `--app-photo-viewer-max-height` at line 382.
  * `list-viewers.scss` line 132, `reset-password-page.scss` line 19, walk lab pages.
* **`dvh` and `lvh` are banned** by `ui/src/lib/layout/no-dynamic-viewport-units.spec.ts`.
* **Safe areas.**
  * `_semantic.scss` lines 144 to 147 define `--app-safe-top`, `-right`, `-bottom` and `-left` from `env(safe-area-inset-*)`.
  * Line 449: `--app-nav-safe-bottom`.
  * Line 475: `--app-support-strip-safe-top`.
  * `ui/src/lib/photo/photo-viewer.scss` line 70.
  * `ui/src/lib/layout/page-header.scss` (`.header` pads `padding-block-start: var(--app-safe-top)`).
* **`display-mode`.** Only in TypeScript, at `install-store.ts` line 82. There is no `display-mode` query in SCSS.

### 1.6 Storage

* **`localStorage` and `sessionStorage`** go only through the facade, with one exception: `libs/shared/localization/rokutranslator-angular/src/lib/locale-routing/app-locale-storage.ts` lines 6 and 16 call bare `localStorage` inside try/catch, so they are SSR tolerant.
* **Keys.** `platform/src/lib/storage-keys.ts` line 22 onward:
  * `session` (the token pair);
  * `theme`, `lastList`, `installed`, `basketView`, `listView`, `boughtShop`, `shopAskOff`, `shopMap`, `mappingSettings`, `walkBaselines`, `fakeWalk`;
  * `updateAttempt` and `notFoundUpdate` (session storage, plans 0072 and 0150);
  * `droppedWrites` (session storage, plan 0159);
  * `supportSession` (plan 0133);
  * plus `basketSessionKey(id)` (guest participant secret, `data-access/src/lib/baskets/basket-session-store.ts` lines 51 to 113) and `visitNoticeKey(id)`.
* **IndexedDB.** Only `feature-walk-lab/src/lib/storage/walk-db.ts` lines 47 and 234 to 255, through `inject(DOCUMENT).defaultView` and lazily.

### 1.7 Notifications, push and install events

* **Notifications and push.** No `Notification`, `PushManager` or `SwPush` anywhere.
* **`beforeinstallprompt` and `appinstalled`.** `install-store.ts` lines 153 to 171, browser only (it returns when `window` is null). The store is constructed by an environment initializer in `apps/velista/src/app/app-providers.ts` line 374.

### 1.8 Lifecycle events

* **`visibilitychange`.**
  * The facade (above).
  * `app-updates.ts` lines 439 to 444, only when the service worker is enabled.
  * `walk-sensors.ts` line 222.
  * `data-access/src/lib/shops/walk-entry-saver.ts` lines 538 to 553, which sends a `keepalive` save when the page hides.
* **`pagehide`.** `walk-entry-saver.ts` line 550 and `feature-shop-map/src/lib/record/record-walk-page.ts` line 435.
* **`pageshow` with `persisted`.** `platform/src/lib/app-resumed.ts` line 95 (plan 0035).
* **`beforeunload`.** `feature-shop-map/src/lib/edit/edit-map-page.ts` line 185 and `record-walk-page.ts` line 434 (plans 0123, 0126).
* **`focus`.** No window focus listener.

### 1.9 History and location

* **`Location.back()`** only in:
  * `platform/src/lib/page-navigation.ts` line 56 (`back`);
  * `platform/src/lib/sheet-navigation.ts` line 38 (`dismiss`).
* **`historyGo(-n)`** at `page-navigation.ts` line 79 (`backTo`).
* **The guard spec.** `platform/src/lib/no-unguarded-history-back.spec.ts` (regex at line 58) scans `libs/velista` and `apps/velista/src` for raw pops.
* **Router event listeners.** `AppHistory` (router events, no `history` reads) and `TourStore` (`tour/tour-store.ts` line 159, popstate trigger).
* **`Location.replaceState`.** `feature-auth/src/lib/impersonate-page/impersonate-page.ts` line 82, which strips the fragment.
* **`location.origin` reads.**
  * `home-page.ts` line 550 and `group-page.ts` line 539 (`shareUrl(this._browser.location?.origin ?? '', ...)`).
  * `share-sheet.ts` line 254, used only after `APP_STANDALONE_ORIGIN`.
* **`location.search`.** `walk-sensors.ts` line 305 (`?fakeWalk`, development builds only).
* **Reloads.** `location.reload()` through the facade from:
  * `ReloadBlocker.reloadWhenIdle` (`reload-blocker.ts` line 66);
  * `AppUpdates` (`app-updates.ts` lines 247, 285, 332, 408);
  * `feature-auth/src/lib/reset-password-page/reset-password-page.ts` line 381;
  * `feature-auth/src/lib/recovery-link-sheet/recovery-link-sheet.ts` line 120.
* **`location.replace`.** Through `replaceDocument` from `data-access/src/lib/auth/impersonation-session.ts` lines 189 and 264.

### 1.10 New windows, links and downloads

* **`window.open`.** Only through `openExternal`, from:
  * `feature-install/src/lib/install-page/install-page.ts` line 160;
  * `feature-account/src/lib/account-page/account-page.ts` line 255;
  * both send the mounted copy to `APP_STANDALONE_ORIGIN`.
* **`target="_blank"` anchors.** `feature-account/src/lib/attribution-note/attribution-note.html` lines 7 and 10 (OSM, GeoNames).
* **Downloads.** `walk-files.ts` lines 20 to 37 make a blob URL and click an anchor with `download`. They are called from walk lab pages: `walk-list-page.ts` line 139, `viewer-page.ts` line 305, `record-page.ts` line 365.
* **Blob URLs** are also used for comment audio (above).

### 1.11 Network transports

* **socket.io.** `data-access/src/lib/realtime/socket-factory.ts` line 2 imports `io` from `socket.io-client`. The `SOCKET_FACTORY` token is at line 74.
  * `RealtimeSocket` opens the user socket at `realtime-socket.ts` line 308, with `auth: { token }`, `transports: ['websocket']`, `reconnection: false` and `autoConnect: false`.
  * It is skipped when `!this._browser.isBrowser` (line 272).
  * `data-access/src/lib/baskets/basket-socket.ts` line 278 opens a second socket for guests, with `auth: { token: session.socketToken }`.
* **No `EventSource`.** The comment in `environment.ts` mentions an SSE fallback, but none exists. `socket-factory.ts` lines 18 to 20 say it is deferred.
* **HttpClient.** `provideHttpClient(withFetch(), withInterceptors([gatewayInterceptor]))` in `app-providers.ts` line 196. The interceptor is `data-access/src/lib/gateway-interceptor.ts`.

### 1.12 Fullscreen and orientation

There is no Fullscreen API use and no `screen.orientation` use. `lib-fullscreen-icon` (`ui/src/lib/icons/icons.ts` line 802) is only a glyph. The manifest declares `orientation: "portrait"`.

### 1.13 Build time constants

* **The four variables.** `process.env.LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL`, `VELISTA_APP_URL` and `VELISTA_APP_VERSION`.
  * They are read in `apps/velista/src/environments/environment.ts` lines 57 to 67 and `environment.prod.ts` lines 49 to 55.
  * Both files declare `process` locally (line 34 and line 31) and read the variables at module load.
* **Substitution.** `DefinePlugin` in `apps/velista/webpack.config.ts` lines 60 to 77 (development defaults `http://localhost:3000`, `:3001`, `:4205`, `0.0.0-dev`) and in `webpack.prod.config.ts` lines 75 to 95 (`https://api.velista.app`, `https://rt.velista.app`, `https://velista.app`).
* **Consistency check.** `apps/velista/src/app/velista-env-substitution.spec.ts` asserts the two files agree.
* **No `import.meta.env`.** `import.meta` is not used.
* **A dangling reference.** The comment in `environment.prod.ts` refers to a `velista-bundle.spec.ts`. That file does not exist in the repository.

## 2. Android WebView verdict per feature

Assumed environment: Capacitor's Android WebView serving the bundle from `https://localhost` (Capacitor's default `androidScheme: https`). It is a secure context, the origin is not `velista.app`, there is no browser chrome, and there is no service worker unless the app registers one.

### 2.1 Works unchanged

* **REST over HttpClient with a bearer token.** No cookies anywhere, so SameSite does not matter. The gateway must allow the new origin in CORS; see section 8.
* **socket.io over WebSocket.** The realtime server allows any origin: `apps/luna-shopper-backend/realtime/src/app/socket/realtime.gateway.ts` line 81 sets `cors: { origin: true }`.
* **`localStorage`, `sessionStorage` and IndexedDB.** They persist in the app's data directory. `sessionStorage` lives as long as the WebView process does.
* **Theme.** `matchMedia('(prefers-color-scheme: light)')` follows the system theme in WebView. `ThemeStore` is `platform/src/lib/theme-store.ts`.
* **Audio output.** `AudioContext`, `new Audio(blobUrl)` and blob URLs all work. Autoplay depends on the WebView setting `setMediaPlaybackRequiresUserGesture`. The tones play after user interaction in practice. This needs a check on a device.
* **Device orientation events** (`deviceorientation`, `deviceorientationabsolute`, `devicemotion`) work. The Generic Sensor API path may or may not be exposed in WebView. The code falls back to events either way (`orientation-stream.ts` lines 95 to 100).
* **`visualViewport`** works.
* **`location.reload()` and `location.replace()`.** The local server serves `index.html` for route paths, so a reload lands on the same route.
* **Clipboard `writeText`** in a user gesture on a secure origin should work. Verify on a device.

### 2.2 Needs Android permissions in the manifest

Capacitor's template declares only `INTERNET`.

* **Voice: assistant (0032), say a line (0038), voice comment (0039, 0041).**
  * Needs `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`.
  * The code records with `MediaRecorder` and **uploads the file to the gateway**. Plan 0038 section 7 and `audio-capture.ts` lines 101 to 131 say so. It does not use `SpeechRecognition`.
  * The WebView supports `getUserMedia` audio and `MediaRecorder` (`audio/webm;codecs=opus`, the first entry in `PREFERRED_TYPES`, lines 76 to 82).
  * Capacitor's `BridgeWebChromeClient.onPermissionRequest` turns the web prompt into the Android runtime prompt once the manifest declares the permission.
* **Location: plans 0058, 0103, 0141.**
  * Needs `ACCESS_COARSE_LOCATION`, and `ACCESS_FINE_LOCATION` because the shop picker passes `enableHighAccuracy`.
  * Capacitor's chrome client answers `onGeolocationPermissionsShowPrompt`.
  * **Risk.** `navigator.permissions.query({ name: 'geolocation' })` in WebView may not reflect the Android grant state. `GeolocationReader.permission()` is what lets a sheet "open straight into its denied copy" (`geolocation-reader.ts` lines 79 to 95). A WebView that answers `denied` or `prompt` wrongly changes the copy. This needs a check on a device, or a native reader behind `GEOLOCATION_READER`.
* **Network state.** `ACCESS_NETWORK_STATE` is most likely needed for `navigator.onLine` and the `online` and `offline` events to track the network in Chromium WebView. Without it they may stay `true`. That input feeds `ConnectionState.offline` (`connection-state.ts` line 38) and the 0159 dispatcher. The failed request path still works without it. Verify on a device.
* **Camera.** Nothing in the shipped app asks for a camera through `getUserMedia`. There is no `<input type="file" capture>`. Camera access is only through WebXR, which the WebView lacks (section 2.3).
* **Wake lock.** No permission. The Screen Wake Lock API may be missing in WebView, and the code tolerates that (`walk-sensors.ts` lines 203 to 214). A native keep awake would replace it.
* **Vibration.** `VIBRATE` would be needed for the walk lab only.

### 2.3 Needs a Capacitor plugin or a native path because the WebView lacks the API

* **Web Share (`navigator.share`) is absent in Android WebView.**
  * `canShare` is false at home-page line 413, group-page line 261 and share-sheet line 175, so each control falls back to copying. That works, but it loses the system share sheet the plans designed for (plan 0008 section 9, plan 0094).
  * The walk lab file share (`walk-files.ts`) fails.
  * A `@capacitor/share` implementation needs a seam first. Today each page reads `navigator.share` itself, through the facade, at four call sites.
* **Clipboard `readText`.** The paste in `join-code-sheet.ts` lines 119 to 130 most likely rejects in WebView, because no clipboard read permission UI exists. It fails silently by design, and the person can type the code.
* **Install (plan 0033).**
  * `beforeinstallprompt` never fires and `display-mode: standalone` is never true in a WebView.
  * The user agent contains `Android`, so `InstallStore.state` is `manual` with guide `android-menu` (`install-store.ts` lines 90 to 103, `install-state.ts` lines 273 to 275).
  * Result: the install page (`feature-install`) and the account screen's app row (`account-page.ts` around lines 235 to 262) tell a person inside the installed native app to add the site to their home screen from the browser menu.
  * Needs a native state of `installed`, or the row hidden.
* **Service worker updates (plans 0034, 0072, 0150).** Need a native path; see section 5.
* **Web Push.** Not used. Nothing to migrate.
* **WebXR `immersive-ar` (plan 0126 camera walks, 0129, 0136, walk lab).**
  * Not available in Android WebView.
  * `immersiveArSupported` returns false, so `WALK_SENSORS.supported()` is false (`walk-sensors.ts` line 110). Opening fails with `stage: 'unavailable'` (`xr-camera.ts` lines 83 to 90).
  * The camera tracked walk is therefore unavailable in the app unless a native ARCore plugin implements `WalkSensorsI`.
  * The seam exists: the `WALK_SENSORS` token, with a scripted implementation already swapped by `fileReplacements`.
* **File downloads.** The walk lab's blob download (`walk-files.ts` lines 20 to 37) does nothing in a WebView. Capacitor's download listener cannot fetch a `blob:` URL. Needs the Filesystem and Share plugins. Lab only.
* **External links.**
  * `openExternal` (`window.open(url, '_blank', 'noopener')`) and the two `target="_blank"` anchors in `attribution-note.html`.
  * Capacitor opens navigations to other hosts in the system browser. `window.open` behaviour depends on WebView multiple window settings.
  * `@capacitor/browser` behind `openExternal` is the clean seam. One method already exists.
  * In the standalone build, `openExternal` is reached only in the mounted mode (`mounted = basePath !== ''`), so the app itself mostly calls it for attribution.
* **`beforeunload`.** It never prompts in a WebView, and it never prompts on app kill. The edit map and record walk pages rely on it as well as on their route `canDeactivate` (`leaves-with-unsaved-work.ts`). The route guard still works.
* **`pagehide` and `keepalive`.**
  * Swiping the app away kills the process with no `pagehide`.
  * `visibilitychange` on backgrounding is the only hook (`walk-entry-saver.ts` lines 539 to 543).
  * Whether Capacitor's WebView raises `visibilitychange` on Activity pause needs a check on a device. `@capacitor/app` `appStateChange` is the native signal.
* **Back/forward cache `pageshow` with `persisted`** never happens in a WebView. Resume then depends only on `visibilitychange`, with the same caveat.

## 3. Platform seams that already exist

The provisioning pattern matters for what can be swapped by DI:

* **App scoped (rule D5).** `VELISTA_PLATFORM_PROVIDERS` (`platform/src/lib/platform-providers.ts` line 30) holds `ThemeStore`, `InstallStore` and `TourStore`. They are provided on the route injector built by `appRootRoute`.
* **Root scoped.** `BrowserFacade`, `AppHistory`, `PageNavigation`, `SheetNavigation`, `AppUpdates`, `AppResumed`, `ReloadBlocker`, `ConnectionState`, `BackendReadiness`, `StartupGate`, `NavChrome`, `ImpersonationState`, `ListSearchNavigation`, `OpenSheet` and `MediaRecorderCapture`.
  * A root service can still be overridden by adding `{ provide: X, useClass: NativeX }` to `appProviders`. Consumers resolve from the nearest injector.
  * One catch: another root service that injects X resolves X at the root and does not see the override. For example, `AppUpdates` injects `BrowserFacade` and `ReloadBlocker`. Overriding a root service means overriding its root dependents too, or providing the override in the application config, which only the standalone build runs.
  * For a Capacitor build, `app.config.ts` is the right place: it never runs under the portfolio shell.
* **Tokens with factories.** `AUDIO_CAPTURE`, `GEOLOCATION_READER`, `NOTIFICATION_TONE`, `SILENCE_DETECTOR`, `SILENCE_LIMITS`, `RECORDING_LIMITS`, `WALK_SENSORS`, `WALK_TONES`, `SOCKET_FACTORY` and `REALTIME_CLIENT`. Each can be replaced by a provider.

### 3.1 The seams, one by one

* **`BrowserFacade`.** API surface:
  * `isBrowser`, `onLine` (signal), `visible` (signal), `window`, `document`, `location`;
  * `matchMedia(q): Signal<boolean>`, `observeIntersection`;
  * `readStorage`, `writeStorage`, `removeStorage`, `watchStorage`;
  * `readSessionStorage`, `writeSessionStorage`, `removeSessionStorage`, `removeSessionStorageWhere`;
  * `openExternal`, `reload`, `replaceDocument`.
  * Swapping it by DI is possible, but the class mixes many concerns. A native subclass could feed `visible` from `appStateChange`, `onLine` from `@capacitor/network`, and `openExternal` from `@capacitor/browser`.
* **`AppHistory`** (`app-history.ts`). `watch()` (line 100), `hasEntryBehind()` (line 122), `depth()` (line 134), `arrivingByPop()` (line 146). Pure router events. Works the same in a WebView.
* **`PageNavigation`** (`page-navigation.ts`). `back(fallbackUrl)` at line 54, `backTo(depth, fallbackUrl)` at line 76.
* **`SheetNavigation`** (`sheet-navigation.ts`). `dismiss(fallbackUrl)` at line 36, `leaveTo(url)` at line 53.
* **`ListSearchNavigation`** (`list-search.ts`). `open(route)` pushes `?search=1`, and `close(route)` calls `PageNavigation.back` (plan 0109).
* **`OpenSheet` and `sheetFallGuard`** (`sheet-fall.ts`). A registry of the one visible sheet, with `fall()` only. No dismiss.
* **`InstallStore`** (`install-store.ts`, `@Injectable()`, app scoped). `state` (`installed`, `ready` or `manual`), `guide`, `canPrompt` and `prompt()`. Constructed by an initializer (`app-providers.ts` line 374). It can be swapped by DI through a provider in `appProviders` or `appConfig`.
* **`AppUpdates`** (`app-updates.ts`, root):
  * `checkNow()` (line 166), `demandUpdate()` (line 187), `reloadByHand()` (line 246);
  * `newerVersionForUnknownPage(url)` (line 262), `reloadForUnknownPage(url)` (line 282);
  * `updateFailed` signal (line 135).
  * Injects `SwUpdate` optionally (line 90). It can be swapped; a native one would talk to the Play in-app update API.
* **`AppResumed`** (`app-resumed.ts` line 56). The `resumes` counter, from `BrowserFacade.visible` and `pageshow` with `persisted`. Swappable, or fed natively through the facade.
* **`ConnectionState`** (`connection-state.ts`). `offline` (line 38), `reportNetworkFailure`, `reportReachable`.
* **`BackendReadiness`** (`backend-readiness.ts` line 67) and **`StartupGate`** (`startup-gate.ts` line 74). Plan 0071. Route data flags: `RENDERS_WHILE_CONNECTING` and `WORKS_WITHOUT_BACKEND`.
* **`ReloadBlocker`** (`reload-blocker.ts`). `block()` and `reloadWhenIdle()`.
* **`ThemeStore`** (`theme-store.ts`, app scoped). `preference`, `theme`, `themeClass`, `isPinned` and `setPreference`.
* **`ImpersonationState`** (root). It decides whether persisted keys go to `sessionStorage`.
* **Clipboard, share and status bar.** **No seam.** Clipboard and share are read at seven call sites through the facade window (section 1.2). There is no seam for theme-color or the status bar either.
* **Geolocation.** `GEOLOCATION_READER`, with `GeolocationReaderI { permission(); read(options) }`. Swappable for `@capacitor/geolocation`.
* **Audio.** `AUDIO_CAPTURE`, with `AudioCaptureI { supported(); open() }`. `AudioRecorder` (`audio-recorder.ts` line 89) is component provided and built on it.
* **Device heading and walks.** `WALK_SENSORS`, with `WalkSensorsI { supported(); start(overlayRoot, listener) }`, plus `listenToOrientation` (a free function, no token).
* **Keyboard.** `watchKeyboardInset(win, cb)` is a free function, not a token.
* **`DroppedWrites`** (`data-access/src/lib/mutations.ts`). Session storage through the facade.

### 3.2 How the app files fit together

* **`src/main.ts`.** `import('./bootstrap')`. This is the module federation async boundary.
* **`src/bootstrap.ts`.** `bootstrapApplication(AppRoot, appConfig)`.
* **`app.config.ts`, standalone only.** It holds `provideBrowserGlobalErrorListeners()`, `provideRouter(appRoutes)` and `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })` (lines 47 to 50).
  * There is no `provideZonelessChangeDetection` call and no zone.js polyfill in `project.json`. Angular 21 runs zoneless, and `test-setup.ts` uses the zoneless environment.
  * There is no `provideClientHydration`.
* **`app.routes.ts`.** `[appRootRoute('')]`.
* **`remote-entry/entry.routes.ts`.** `[appRootRoute('/velista')]`.
* **`app-root-route.ts`** (lines 45 to 58). Route `''` with `providers: [...appProviders, { provide: APP_BASE_PATH, useValue: mount }]`, `data: { mountPath: mount }`, and a lazy `AppShellRoutes` from `@portfolio/velista/feature-shell`.
* **`app-root.ts`.** Selector `app-velista-root`, a router outlet, `:host { display:flex; min-block-size:100svh }`.
* **`app-providers.ts`** (lines 134 to 459):
  * `APP_BRAND`;
  * `APP_MOUNT_PATH` aliased to `APP_BASE_PATH`;
  * `APP_API_CONFIG = environment.api`, `APP_VERSION = environment.version`, `APP_STANDALONE_ORIGIN = environment.appUrl`;
  * translations, the HTTP client, platform and data-access providers, every `*_SERVICE` binding, and `REALTIME_CLIENT` bound to `RealtimeSocket`;
  * environment initializers for `ConnectionRecovery`, `StartupProbe`, `SessionValidation`, `ImpersonationSession`, `AppUpdates`, `InstallStore` and `AppHistory.watch()`;
  * effects that wire `NavChrome`, `CatalogAddStore` and `TourStore`.
* **`index.html`.**
  * `<base href="/">`, the viewport meta (lines 17 to 20), the manifest link (line 38), `<meta name="theme-color" content="#0a0c14">` (line 39), the apple touch icon, and `<app-velista-root>`.
  * No body background.
* **`public/manifest.webmanifest`.** `display: standalone`, `orientation: portrait`, `theme_color` and `background_color` `#0a0c14`, icons 192, 512 and maskable 512, two screenshots.
* **`ngsw-config.json`.** `appData.critical: false`. The `app` group prefetches `index.html`, the manifest, CSS, JS and MJS. The `assets` group is lazy. Navigation URLs are all except files.
* **`app-version.ts`.** `DEFAULT_APP_VERSION = '0.0.0-dev'`.
* **`webpack.config.ts`.** `withModuleFederation(mfeConfig)`, the `DefinePlugin` with the development defaults, and asset rules (`asset/resource`, `?raw` as `asset/source`, fonts).
* **`webpack.prod.config.ts`.** The same, with the production defaults.
* **`module-federation.config.ts`.** `name: 'velista'`, exposes `./Routes`, `shared: sharedSingletons`.
* **`src/Dockerfile`.** `FROM local-http-server`, `COPY . /var/www/html/`, nginx. The build context is `dist`.

### 3.3 `project.json` targets

* **`build`** (`@nx/angular:webpack-browser`, output `dist/apps/velista`, `customWebpackConfig: webpack.config.ts`).
  * The `production` configuration (the default) adds:
    * `serviceWorker: true` and `ngswConfigPath`;
    * budgets of 500 kb warning and 1 mb error initial, 12 kb and 20 kb per component style;
    * `outputHashing: all` and `webpack.prod.config.ts`;
    * `fileReplacements`: `environment.ts` becomes `environment.prod.ts`, and `scripted-walk-loader.ts` becomes `scripted-walk-loader.prod.ts`.
  * The `development` configuration turns off optimization and adds source maps.
* **`build:docker`** (`@portfolio/docker:build`). `context: dist`, `forwardEnv: [BUILDER_TAG]`. The development configuration tags `dev`; the production configuration pushes `latest`.
* **`serve`** (`@nx/angular:dev-server`). Port 4205, `publicHost http://localhost:4205`, `dependsOn: ['shell:serve']`.
* **`serve-static`** (`@nx/web:file-server`). Port 4205.
* **`extract-i18n`**, **`lint`** (`@nx/eslint:lint`, no options) and **`test`** (`@nx/jest:jest`).
* **Inferred by `@nx/webpack/plugin`** because `webpack.config.ts` exists: `webpack:build`, `webpack:serve`, `preview`, `webpack:serve-static`, `build-deps` and `watch-deps`.

### 3.4 How the gateway and realtime URLs reach the code (plan 0014)

1. The CI environment, or `apps/velista/.env` written by `ng-slot.sh`, sets `LUNA_GATEWAY_URL` and the other variables.
2. The `DefinePlugin` replaces `process.env.X` with string literals at compile time.
3. `environment.ts` or `environment.prod.ts` builds `{ version, appUrl, api: { gatewayBaseUrl, realtimeBaseUrl } }`.
4. `app-providers.ts` binds `APP_API_CONFIG`, `APP_VERSION` and `APP_STANDALONE_ORIGIN`.
5. `data-access/src/lib/api-url.ts` builds `gateway(path)` and `realtime(path)`, and its `isGateway` prefix match scopes the bearer token.

`velista-api-hosts.spec.ts` asserts:

* that the production defaults match the routed hosts in `k8s/helm/values*.yaml`;
* that `velista.app` is in `corsOrigins` (line 110);
* that `mailVerifyBaseUrl` points to a declared route (line 131).

**The URLs are build time only. There is no runtime config file.**

## 4. Auth and session

**Storage.** `TokenStore` (`data-access/src/lib/auth/token-store.ts`, app scoped) keeps the access and refresh pair as JSON in `localStorage` under `session:<appKey>`:

* restored at construction (`_restore`, line 403, called at line 96);
* written by `set` (line 140);
* followed across documents with `watchStorage` (lines 121 to 135, plan 0067);
* refreshed single flight;
* the file header (lines 37 to 50) records the XSS trade off and names a future httpOnly refresh cookie as a backend change.

**Requests.** `gatewayInterceptor` (`gateway-interceptor.ts`) is the only place that sets headers, and only for gateway URLs (line 60). It sets:

* `x-client-version` (line 91);
* `Authorization: Bearer`, `Accept-Language` and `x-correlation-id` (lines 332 to 343).

Other request behaviour:

* It reads `x-min-client-version`, which the gateway exposes through `exposedHeaders`; see `apps/luna-shopper-backend/gateway/src/main.ts` line 64.
* It retries a 401 once after a refresh.
* Guests holding a basket send `x-participant-secret` from `localStorage` (`basket-api.ts` line 56, `basket-session-store.ts`).
* **No `withCredentials`, no cookies, no `document.cookie`, no `document.referrer`.** A grep over `libs/velista` and `apps/velista` found none.

**Realtime.**

* The account socket sends `auth: { token: <access token> }` in the socket.io handshake (`realtime-socket.ts` line 309, after `ensureFreshToken`).
* The guest basket socket sends `auth: { token: socketToken }` from `POST .../participant-token` (`basket-socket.ts` line 278, `basket-api.ts` line 596).
* WebSocket transport only.

**Origin dependence.**

* **CORS.** The gateway takes an explicit allowlist (`apps/luna-shopper-backend/gateway/src/main.ts` lines 54 to 64), set from `corsOrigins` in `k8s/helm/values.production.yaml` line 90 and `values.staging.yaml` line 64. `https://localhost` is not on it. The realtime gateway allows any origin.
* **Shared storage between documents.** Plan 0067's cross document adoption assumes the installed app and a browser tab share one `localStorage`. In Capacitor the app's origin storage is separate from Chrome's `velista.app` storage. Nothing races, but a guest account made in the browser does not exist in the app.
* **Share links from the current origin.** `home-page.ts` line 550 and `group-page.ts` line 539 build share URLs from `location.origin`; see section 8.
* **Support sessions (plan 0133).** `ImpersonationState` and `BrowserFacade` put persisted keys in `sessionStorage` per tab. The handoff arrives as `auth/impersonate#code`, opened by the back office in a browser tab, so it would not reach the app without App Links.
* **Google sign in.** `feature-auth/src/lib/auth-callback-page/auth-callback-page.ts` expects a gateway 302 to `auth/callback#tokens`. It is not wired yet (`continueWithGoogle` only records, `sign-in-page.ts` line 198). If wired, it needs a custom scheme or App Link redirect, and a system browser OAuth flow inside the app.
* **Mail links.** Verify, reset password and the recovery link (plan 0148) point at `https://velista.app/...` (`mailVerifyBaseUrl`). In the app they open the browser unless Android App Links (`/.well-known/assetlinks.json`) are set up. No such file exists in `apps/velista/public`.

## 5. Update and install flows

**Plan 0033, install** (`InstallStore`, `install-state.ts`, `feature-install/src/lib/install-page/install-page.ts`, `account-page.ts`).

* **What it does.**
  * Captures `beforeinstallprompt` at bootstrap and calls `preventDefault()`.
  * `prompt()` must be the first statement of a click handler.
  * Persists `installed:<key>` on `appinstalled`.
  * `state` is `installed` if `display-mode: standalone`, `navigator.standalone` or the stored flag says so.
  * The mounted mode (`basePath !== ''`) offers `openExternal(APP_STANDALONE_ORIGIN)` instead.
* **In a native app.** No event fires and `display-mode` is `browser`, so the app tells people inside it to install it from the menu. Needs a native `InstallStore` that reports `installed`, or hiding the install route and the account row.

**Plan 0034, self update** (`AppUpdates`).

* **What it does, with an enabled worker.**
  * Checks on `visibilitychange` to visible and every 30 minutes (`UPDATE_CHECK_INTERVAL_MS`, lines 433 to 455).
  * Checks when the interceptor sees a higher `x-min-client-version`.
  * On `VERSION_READY`:
    * a critical release (`appData.critical`) gets `ReloadBlocker.reloadWhenIdle()`;
    * otherwise it reloads at the next `NavigationEnd`, through the blocker (lines 373 to 431).
  * `unrecoverable` triggers an immediate reload.
* **Without an enabled worker** it checks nothing.

**Plan 0072, the server insists** (`demandUpdate`, lines 187 to 237).

* **What it does.** The `effect` on `BackendReadiness.state() === 'too-old'` (lines 354 to 371) calls it. The steps:
  1. If the session flag `update-attempt:<key>` is present, it gives up (`updateFailed`).
  2. If a version is waiting, it reloads once.
  3. If no worker is enabled, it writes the flag and reloads once (`_reloadOnce`, lines 324 to 333).
  4. Otherwise it calls `checkForUpdate()`. False means give up. True starts a 20 second backstop timer (`UPDATE_DOWNLOAD_TIMEOUT_MS`).
* `ready` clears the flag.
* The dead end face in `app-layout.ts` offers "Try again", which calls `reloadByHand` (line 239).

**Plan 0150, not found asks for a newer version** (`feature-shell/src/lib/not-found-page/not-found-page.ts` lines 60 to 100).

* **What it does.** It calls `newerVersionForUnknownPage(url)`, which:
  * returns false if this tab already reloaded for that URL (session key `notFoundUpdate`);
  * returns true if a version is waiting;
  * otherwise calls `_check()`.
* True leads to `reloadForUnknownPage`, which writes the key and reloads.
* The two timers (quiet, then a limit that ends on `missing`) bound the wait.

**Plan 0035, back from the background** (`AppResumed`).

* **What it does.** `resumes` increments on the hidden to visible edge, and on `pageshow` with `persisted`. Two resumes within 1 second collapse into one.
* Consumers:
  * `RealtimeSocket` reconnects (`realtime-socket.ts` line 187);
  * `StartupProbe` (`startup-probe.ts` line 104) and `ConnectionRecovery` (`connection-recovery.ts` line 56) probe again while offline;
  * `AppUpdates` checks on visible.

**Plan 0071, wait for the backend** (`StartupProbe` in data-access, `BackendReadiness`, `StartupGate`).

* **What it does.**
  * `GET /health/ready` on the gateway, anonymous.
  * States: `connecting`, `ready`, `unreachable`, `too-old`.
  * A slow sentence after 3 seconds (`STARTUP_SLOW_AFTER_MS`).
  * A cover drawn during rendering. Routes flagged `WORKS_WITHOUT_BACKEND` or `RENDERS_WHILE_CONNECTING` are exempt.
  * Retries on resume and on Try again.
* `ConnectionRecovery` probes every 10 seconds while offline. On success it calls `ReloadBlocker.reloadWhenIdle()` (line 137).

**Plan 0159, a dropped write** (`DroppedWrites` in `data-access/src/lib/mutations.ts`, the gateway interceptor's dispatcher).

* **What it does.** A write that got no response is recorded in session storage (`dropped-writes:<key>`). The recovery reload then happens, and the page shows the entries once and clears them. It is not an outbox.

**What has to change when the bundle ships inside an APK.**

* **Do not register the worker.**
  * `app.config.ts` registers whenever `!isDevMode()`, and the production configuration emits `ngsw-worker.js`.
  * Inside the WebView a worker would control `https://localhost` and cache a bundle that only changes with the APK.
  * If a build sets `serviceWorker: false` but stays in production mode, registration of the missing `ngsw-worker.js` fails. `SwUpdate.isEnabled` then still reads true, because it reflects the `enabled` option and browser support, not a successful registration.
  * `checkForUpdate()` then waits on a controller that never comes. That has two effects:
    * `demandUpdate` never reaches either branch, because the D5 timer starts only after the check resolves true, so the updating face can hang;
    * the not-found page waits for its limit timer.
  * The `enabled` flag must follow a native build flag, not `isDevMode()`.
* **Updates come from a new APK.** A server refusal (`too-old`) produces one reload of the same local bundle, the same refusal, then the dead end face whose "Try again" reloads the same bundle again. The native answer is "open the store" or the Play in-app update flow, behind an `AppUpdates` replacement.
* **The version must keep reaching the gateway.** `VELISTA_APP_VERSION` must be set to the APK's release version at build time, or the gateway floor cannot tell old APKs apart.
* **Reloads keep working.** `ConnectionRecovery` and `ReloadBlocker` reloads fetch the local `index.html` and work.
* **Plan 0150's reload becomes pointless.** The bundled version never knows a newer route, so not found pages are real 404s, which is acceptable.

## 6. Back navigation, sheets, keyboard and theme

### 6.1 How `AppHistory` decides a pop is safe

* It records the navigation ids this document pushed, with a cursor:
  * a push (`NavigationEnd`, not replace, not popstate, URL changed) trims the list to the cursor and appends;
  * a replace renames the entry under the cursor;
  * a popstate moves the cursor to the index of `restoredState.navigationId`, or to `-1` when that id is unknown.
* `hasEntryBehind()` is `cursor >= 0`. Unknown cases count as "no entry" (`app-history.ts` lines 160 to 239).

### 6.2 Where the back controls are called

* **`PageNavigation.back` and `backTo`.** 38 files inject `PageNavigation`, across feature-account, assistant, auth, catalog, install, lists, setup, shop-map, shopping-lists and zones, plus platform's `ListSearchNavigation`.
  * The page header (`ui/src/lib/layout/page-header.ts`, plan 0130) emits a `back` output (line 70), and each page calls `PageNavigation.back(fallback)` with its own fallback.
* **`SheetNavigation.dismiss` and `leaveTo`.** 44 or more call sites in feature-account, auth, catalog, entry, home, lists, shop-map, shopping-lists and zones.
  * `SheetShell` (`ui/src/lib/entry/sheet-shell.ts`) emits `dismiss` (line 152) on Escape (host `(keydown.escape)`, line 106), on the scrim and on Cancel. The routed container then calls `SheetNavigation.dismiss(fallback)`.
  * `sheetFallGuard` and `OpenSheet` animate the exit for navigations that start outside the shell, popstate included.

### 6.3 What a hardware back handler would need

* **There is none today.** With no listener, Capacitor's default calls `webView.goBack()` when it can go back, and otherwise exits the app.
* **What already works.** `goBack()` produces a popstate. `AppHistory` handles it, and a sheet route closes with its fall animation. Sheets, list search (`?search=1`) and pushed pages therefore close correctly by default.
* **What fails.**
  1. On the floor entry (a deep link or App Link arrival on a nested page, or after `PageNavigation.back` replaced its way up), the WebView has nothing behind it, so the app exits instead of walking to the fallback.
  2. Overlays that are not routes do not close on back. They listen to Escape or their own close:
     * `order-menu`, `hold-menu`, `quantity-reel`, `photo-viewer`, `list-viewers` (line 61), `member-row` (line 47);
     * `profile-selector`, `leave-question`, the `app-bar` menu (`document:keydown.escape`, line 47);
     * the tour card.
* **What a handler would have to call.**
  * If an overlay is open, close it.
  * If a sheet is open, call `SheetNavigation.dismiss(itsFallback)`.
  * If `AppHistory.hasEntryBehind()`, call `Location.back()`.
  * Otherwise, call `PageNavigation.back(pageFallback)`, and at home, exit.
* **The obstacle.** The fallbacks are known only to each component, through the page header's `back` output and the sheet's `dismiss` handler. There is no registry. `OpenSheet` knows the open sheet but exposes only `fall()`.
* **The guard spec.** A handler that calls `history.back()` or `Location.back()` with no arguments would trip `no-unguarded-history-back.spec.ts` if placed under `libs/velista` or `apps/velista/src`. Native Java code is out of its scope.

### 6.4 Keyboard (plans 0008, 0040, 0106, 0127)

* **The main mechanism** is the viewport meta `interactive-widget=resizes-content`. The layout viewport shrinks, so `100svh` and the bottom anchored sheet (`sheet-shell.scss` comment, lines 25 to 35) sit above the keyboard.
* **Plan 0040** moved the sheet's footer into a column (grabber, scrolling body, footer).
* **Plan 0106** makes `AppLayout` exactly `100svh`, with the page slot scrolling inside it.
* **`visualViewport`** is used only inside the WebXR DOM overlay (`watchKeyboardInset`, plans 0126 and 0127) and in the tour spotlight.
* **In a WebView** the meta attribute does not govern resizing. The Activity's `windowSoftInputMode` (`adjustResize`) and `@capacitor/keyboard` `resize` decide it. On targetSdk 35 and later, edge to edge needs inset handling for `adjustResize` to take effect.

### 6.5 Theme (plan 0002)

* **Resolution.** `ThemeStore` resolves the stored preference first, then `prefers-color-scheme: light`, then Night. `AppLayout` binds `[class] = "app-root " + themeClass` on its host (`app-layout.ts` lines 77, 78 and 248).
* **Tokens.** In `ui/src/lib/styles/`:
  * `_themes.scss`: `app-theme-night` at line 83 (`--app-surface-ground: var(--app-ink-950)`, which is `#0a0c14`), `app-theme-day` at line 197 (`--app-neutral-50`, which is `#f7f8fc`);
  * `_primitives.scss` lines 20, 21 and 30.
* **Top bar color.** `ui/src/lib/layout/page-header.scss` paints `.header { background: var(--app-surface-ground); padding-block-start: var(--app-safe-top); }`. The top bar color is the ground token.
* **`theme-color` meta.** Static `#0a0c14` (`index.html` line 39), the same as the manifest. Nothing updates it at runtime: there is no `Meta` service use. In Day theme the browser status bar stays dark. For native, a status bar plugin would need to follow `ThemeStore.theme`, and no seam exists for that.
* **No body background.** The theme class is on `AppLayout`, not on `html` or `body`. `AppLayout` paints a large `box-shadow` in the ground color (`app-layout.scss` line 128) to cover the strip.

### 6.6 Safe areas

* **The tokens** are listed in section 1.5. The rule is that the bottom bar alone carries the bottom inset (`_semantic.scss` lines 444 to 452). The page header and the support strip carry the top inset.
* **No `viewport-fit=cover`** is in the viewport meta. In browsers, `env(safe-area-inset-*)` is therefore 0 unless the page opts into cover.
* **In an edge to edge WebView** (Android 15 and later enforce it), whether the WebView reports insets depends on the WebView version and on Capacitor's `adjustMarginsForEdgeToEdge`. This needs a device check.

## 7. Build and lint shape

**Project inference** (`nx.json` plugins):

* The plugins are `@nx/cypress`, `@nx/eslint`, `@nx/playwright` and `@nx/webpack`. **There is no `@nx/gradle`.**
* A Gradle project at `apps/velista/android` (no `project.json` or `package.json`) would not become a project of its own. Its files would belong to the `velista` project.

**Hashing and affected:**

* `namedInputs.default` is `{projectRoot}/**/*`, and `production` excludes only spec, lint and Cypress files.
* Every tracked Java, XML or Gradle file under `apps/velista/android` therefore:
  * becomes an input of `velista:build`, `lint` and `test`;
  * marks `velista` affected, so CI (`nx affected`) rebuilds and deploys the velista image on an Android only change.
* Git ignored files are excluded from hashing (Nx respects `.gitignore`). There is no `.nxignore`.

**Lint:**

* The `lint` target is `@nx/eslint:lint` with no `lintFilePatterns`, so ESLint runs over the whole of `apps/velista`.
* Flat ESLint does not read `.gitignore`. Only `apps/velista/eslint.config.mjs` ignores apply (`**/plans/mocks/**`), plus the root `**/dist` and `**/docs/research/**`.
* The root config lints `**/*.json` with `jsonc-eslint-parser` and every JS and TS file with `@nx/enforce-module-boundaries`. The velista config adds `flat/angular-template` for `**/*.html`.
* So Capacitor's generated files would be linted:
  * `android/app/src/main/assets/public/**` (a copy of the built bundle: minified JS, `index.html`);
  * `capacitor.config.json`, `capacitor.plugins.json`;
  * the Gradle wrapper JSON;
  * a root `capacitor.config.ts`.
* The minified bundle would fail or be very slow. There is no root `.eslintignore`, and `nx.json` lists it only as an input.

**Jest:**

* `apps/velista/jest.config.cts` uses `rootDir` `apps/velista`, with the testMatch from the Nx preset.
* Jest's haste map would crawl `android/`, including the copied bundle and the Gradle build directories when they exist. That is slow, but it should match no tests unless a `*.spec.*` or `*.test.*` file lands there.
* `tsconfig.spec.json` includes only `src/**`.

**TypeScript.** `tsconfig.app.json` includes `src/**/*.ts` and `../../types/**/*.d.ts`, so it is unaffected. A `capacitor.config.ts` at `apps/velista/` would be outside both tsconfigs.

**Prettier:**

* `.prettierignore` does not list `apps/velista/android`.
* Prettier has no parser for Java, Gradle or XML in this repo. The plugins are organize-imports, organize-attributes and go-template, the last for `*.yaml.tpl`.
* It would format JSON, JS and HTML under `android/` if run over the directory. The memory note says never to run it over a directory.

**Docker:**

* `build:docker` uses `context: dist`, so the app image is unaffected.
* The **builder image** takes the workspace as its context, filtered by the root `.dockerignore`, which does not exclude `apps/velista/android`. Gradle caches and build outputs would be sent into that context.

**Git.** The root `.gitignore` has no Android entries (`build/`, `.gradle/`, `local.properties`, `*.keystore`, `app/src/main/assets/public`). Capacitor writes its own `android/.gitignore`, which covers most of them.

**`npx nx show project velista --json`** lists these targets:

* `lint`, `webpack:build`, `webpack:serve`, `preview`, `webpack:serve-static`, `build-deps`, `watch-deps` (all inferred);
* `build`, `build:docker`, `serve`, `extract-i18n`, `test`, `serve-static` (all explicit).

Tags are empty.

## 8. Risks and open questions

### 8.1 Capacitor

1. **CORS origin.** `https://localhost` is not in `corsOrigins` (`k8s/helm/values.production.yaml` line 90, `values.staging.yaml` line 64), so every REST call fails. `velista-api-hosts.spec.ts` line 110 only asserts that `velista.app` is present. The realtime service has `origin: true` (`realtime.gateway.ts` line 81).
2. **Share links name the app's local origin.** `home-page.ts` lines 549 to 550 and `group-page.ts` lines 538 to 539 call `shareUrl(location.origin, ...)`, which gives `https://localhost/join/CODE` inside the app. The basket share sheet already prefers `APP_STANDALONE_ORIGIN` (`share-sheet.ts` line 254).
3. **The service worker registers in a WebView.** `app.config.ts` lines 47 to 50 use `enabled: !isDevMode()`, and the production configuration sets `serviceWorker: true`. A native build without the worker but in production mode leaves `SwUpdate.isEnabled` true with no controller, so `AppUpdates._check()` can hang (`app-updates.ts` lines 297 to 310, and `demandUpdate` lines 220 to 236).
4. **The refused build loops.** `AppUpdates._reloadOnce` (line 324) and the dead end "Try again" (`reloadByHand`, line 246) reload the same APK bundle. There is no store or in-app update path.
5. **The install UI is wrong inside the app.** `install-store.ts` lines 82 to 103 report `manual` and `android-menu` in a WebView.
6. **Web Share is missing**, so every share falls back to copying (four call sites). The walk lab file share fails (`walk-files.ts`).
7. **WebXR is missing.** Camera walks (plan 0126) are unavailable (`xr-camera.ts`, `walk-sensors.ts`). A native ARCore implementation of `WALK_SENSORS` is a separate project.
8. **Hardware back.** No handler or registry exists (section 6.3). Floor entries exit the app, and overlays that are not routes stay open.
9. **Visibility and resume.** Does Capacitor's WebView raise `visibilitychange` on Activity pause and resume? `BrowserFacade.visible`, `AppResumed`, the realtime reconnect, `walk-entry-saver` keepalive saves and wake lock reacquisition all depend on it. `pageshow` with `persisted` never fires.
10. **Online state.** `navigator.onLine` and the `online` and `offline` events in WebView probably need `ACCESS_NETWORK_STATE` (`browser-facade.ts` lines 78 to 83).
11. **Geolocation permission state.** The WebView's Permissions API may not match Android grants (`geolocation-reader.ts` line 145).
12. **Keyboard, insets and edge to edge.** `interactive-widget` (`index.html` line 18) does not govern a WebView. `windowSoftInputMode` and the keyboard plugin do. There is no `viewport-fit=cover`, and `--app-safe-*` relies on `env()` (`_semantic.scss` lines 144 to 147).
13. **Status bar color.** It is fixed at `#0a0c14` (`index.html` line 39, manifest), and nothing follows `ThemeStore.theme`.
14. **Deep links.** Mail links, invite links (`/join/CODE`), basket share links (`/s/...`), the support handoff (`auth/impersonate#code`) and a future Google callback (`auth/callback#tokens`) all point at `https://velista.app`. App Links need `/.well-known/assetlinks.json` on that origin. There is none in `apps/velista/public`, and plans 0001 and 0013 only planned it for a TWA.
15. **Accounts in the browser and the app are separate.** A guest's account in the browser's `localStorage` (`session:<key>`) is invisible to the app's origin. Plan 0067's two-documents reasoning does not hold, so a migration story is needed.
16. **Development builds.** The development defaults are `http://localhost:3000` and `:3001` (`webpack.config.ts` lines 14 and 15). From an `https://localhost` WebView on a device that is mixed content and the wrong host. Live reload needs `server.url` or cleartext config. `ng-slot.sh` writes `apps/velista/.env` for desktop ports only.
17. **Images and mixed content.** Product photo URLs from chain hosts are loaded as given. Any `http:` image is blocked on an `https` WebView page unless mixed content is allowed. Not verified.
18. **Downloads and external links.** `walk-files.ts` blob download does nothing. `openExternal` (`browser-facade.ts` line 382) and the `attribution-note.html` anchors depend on Capacitor's external navigation handling.
19. **Workspace hygiene** (section 7):
    * `apps/velista/android` becomes an input of every velista target and makes velista affected;
    * lint crawls `android/` (`apps/velista/eslint.config.mjs` has no ignore);
    * the builder Docker context includes Gradle outputs (`.dockerignore`).
20. **Build version.** `VELISTA_APP_VERSION` must be the APK version (`webpack.prod.config.ts` lines 92 to 94). Otherwise the client version floor (plan 0034 D4) cannot retire old APKs.

### 8.2 SSR

1. **The build cannot be server rendered as it is.**
   * The `build` target is `@nx/angular:webpack-browser` with module federation (`webpack.config.ts`, `webpack.prod.config.ts`, `module-federation.config.ts`). `main.ts` is an async federation boundary.
   * `@angular/ssr` and `@angular/platform-server` are not installed (`package.json`).
   * Plan 0001 D2 requires the shell to become an SSR host before a remote can render on the server, or SSR in a standalone build without federation.
   * velista must stay a remote for the shell (plan 0013), so SSR implies a second, federation free standalone build.
2. **The `DefinePlugin` constants.** `environment.ts` and `environment.prod.ts` read `process.env` at module load. On Node the server bundle would read the real environment if not substituted. That is a different semantic, not a crash, but the server bundle needs the same plugin, or deliberate runtime config.
3. **`navigator` in the shared translator.** `rokutranslator.ts` lines 254 to 258 read `navigator.languages` without a guard (Node 21 and later define `navigator`, older Node throws). `resolve-locale.ts` line 18's `typeof navigator` guard does not detect a server on Node 21 and later, so the server's locale, not `Accept-Language`, seeds the guess.
4. **Signed in pages render as signed out on the server.** `TokenStore` reads `localStorage` through the facade, which is null there. Authenticated routes would render signed out and hydrate differently. Plan 0001 section 4.3 expects SSR only for public routes.
5. **Theme flash.** `ThemeStore` renders Night on the server (the facade's `matchMedia` is false, storage is null). A Day client then changes the class on the `AppLayout` host after hydration.
6. **Server side probes and timers.** Environment initializers start `StartupProbe` (an HTTP probe plus a `setTimeout`), `BackendReadiness` (3 second slow timer), `ConnectionRecovery` and `SessionValidation` during a server render. `StartupGate` decides a cover "during rendering", so the server output may be the connecting cover. The not-found page starts two timers in its constructor (`not-found-page.ts` lines 60 to 72). `RealtimeSocket` is guarded (`realtime-socket.ts` line 272).
7. **No hydration provider.** `provideClientHydration` is absent from `app.config.ts`. The app is zoneless, so SSR stability depends on `PendingTasks`, not on zone timers.
8. **Direct `document` use is server safe today.** `inject(DOCUMENT).defaultView` is used directly in `walk-entry-saver.ts` line 193, `walk-db.ts` line 47, `walk-files.ts`, `edit-map-page.ts` line 178, `record-walk-page.ts` line 416, the `mark-sheet.ts` and `suggestion-sheet.ts` initializers, `settle-sheet.ts` line 876 and `tour-spotlight.ts`. Each degrades on a server `DOCUMENT` because `defaultView` is null there, but this bypasses the facade rule.
9. **Observers.** `chip-row.ts` lines 196 to 197 and `section-chips.ts` lines 134 to 135 create a `ResizeObserver` in the constructor behind `typeof` guards. Safe, but they run on the client before hydration completes.

### 8.3 Open questions for the plan

* Is the Capacitor app an additional distribution beside the PWA on `velista.app`, or a replacement?
  * Plan 0001 open question 2 and plan 0013 O4 assumed a TWA.
  * The answer decides whether `InstallStore`, `AppUpdates` and the worker gain a third run mode, beside mounted and standalone.
  * The Android variant needs a mount (`''`) and an origin (`APP_STANDALONE_ORIGIN = https://velista.app`). It sits next to `appRootRoute(mount)`.
* Which origin should the WebView use (`https://localhost`, or a custom hostname such as `app.velista.app` through Capacitor `server.hostname`)? The answer decides the CORS entry and whether App Links can share an origin.
