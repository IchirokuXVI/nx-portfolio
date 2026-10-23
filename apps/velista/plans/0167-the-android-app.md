# 0167: the Android app

> Asked for by the owner on 2026-10-23, with plan `0166`: "start implementing capacitor for an
> android/iOS build. Along with the development, I also want an android and iOS build that I
> can install manually so I can test them (the iOS one is optional, the android build is
> required). Try to target all versions from within the last 5 years, or even more if it is
> possible and does not hinder performance nor functionality." The owner later ruled iOS out:
> do not build it and do not generate or commit the iOS project, because it cannot be tested
> on this machine.
>
> This is the native half. Plan `0166` opened the seams (`APP_RUNTIME`, `detectNativeShell`,
> `SHARE_TARGET`, `SYSTEM_BARS`, `BackStack`, `AppBack`, `APP_STORE_URL`) and fixed the PWA
> metadata. Build on its branch; do not start before it is merged into yours.
>
> Every fact below was read on `dev` at `63f740d8` on 2026-10-23, plus the Capacitor 8.5
> documentation. Evidence with line numbers:
> `docs/reports/2026-10-23-velista-capacitor-browser-api-inventory.md` (sections 2, 3, 6, 7
> and 8.1) and `docs/reports/2026-10-23-velista-pwa-and-origin-audit.md` (sections 1 "Serving",
> 2, 3, 4 and 5). Read both before you start.
>
> Prerequisite reading: plan `0166` in full, plan `0013`, plan `0014` (per environment API
> configuration), `apps/velista/project.json`, `apps/velista/webpack.prod.config.ts`,
> `apps/velista/src/environments/environment.prod.ts`, `apps/velista/src/app/app.config.ts`,
> `libs/velista/platform/src/lib/geolocation-reader.ts`, `browser-facade.ts`,
> `apps/docker/local-http-server/src/nginx-static-app.conf`, `.github/workflows/docker-ci.yml`
> L347 to L358, `tools/dev/ng-slot.sh` L213 and L645 to L651, `nx.json` (`namedInputs`),
> `apps/velista/eslint.config.mjs`, `apps/velista/jest.config.cts`, `.dockerignore`, `.gitignore`.
>
> Plan `0165` (velista leaves the shell) may land before or after you. It gives velista its
> own `apps/velista/src/nginx.conf`, a copy of the shared file. Apply the nginx fixes of this
> plan to whichever file velista's image uses on your branch at the time, and say which.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write Angular code and the
`nx-generate` skill before you create the library. Load `antislop` before any copy.

### Objective

velista ships as an Android app built with Capacitor 8 from the same web bundle as the
origin, installable from an APK for each of staging and production, with the seams of plan
0166 implemented natively, a signed release build, App Links, the PWA serving fixes, and a
verified smoke test on the emulator.

### Context

- **The toolchain is on this machine and reachable from Git Bash.** Android SDK at
  `C:\Users\Ichi\AppData\Local\Android\Sdk` (`ANDROID_HOME` is not set; export it per command
  or write `android/local.properties`, which is git ignored). Installed: platforms 33, 35 and
  36, build tools 34.0.0, 35.0.1 and 36.0.0, platform tools (adb 37.0.1), the emulator (WHPX
  works), command line tools at `cmdline-tools/latest` (`sdkmanager.bat` is a wrapper over the
  new `android.exe sdk install "<package>"` syntax). System images: `android-35`
  (google_apis_playstore x86_64), `android-37.0` (same), `android-26` (google_apis x86).
  AVD `Medium_Phone_API_37.0` exists; boot it headless with
  `emulator -avd Medium_Phone_API_37.0 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect`
  and wait for `getprop sys.boot_completed` to print 1. Create other AVDs with `avdmanager`.
  JDK: use Temurin 17 on the PATH (`C:\Program Files\Eclipse Adoptium\jdk-17.0.10.7-hotspot`)
  as `JAVA_HOME` for Gradle; the Android Studio bundled JBR is JDK 25, which Gradle 8.14 does
  not run on. Node 22.17, npm 11.
- **Capacitor 8.5.3** (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`) requires
  Node 22, AGP 8.13, Gradle 8.14.3, compileSdk 36, targetSdk 36, minSdk 24 (Android 7, 2016).
  Edge to edge is handled by the SystemBars core plugin (`plugins.SystemBars.insetsHandling`,
  default `css`; `native` recommended; `EdgeToEdge.enable(this)` in `MainActivity.onCreate`).
  `android.adjustMarginsForEdgeToEdge` no longer exists. Add `density` to `configChanges`.
  Config keys that matter: `webDir`, `server.hostname` (default `localhost`),
  `server.androidScheme` (default `https`), `android.webContentsDebuggingEnabled`,
  `android.buildOptions` (keystore, `releaseType: 'APK'`), `android.flavor`, `zoomEnabled`,
  `loggingBehavior`.
- **The web bundle is environment specific at build time** (audit section 2): four
  `DefinePlugin` values, `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL`, `VELISTA_APP_URL`,
  `VELISTA_APP_VERSION`, read from the environment of `nx build velista`. The production
  defaults are the production hosts. Staging needs the three staging hosts. The output is flat
  at `dist/apps/velista` with `index.html` at its root.
- **The backend allows the origin of the PWA and nothing else** (audit section 3): CORS is an
  exact allowlist with `https://velista.app` in production and `https://staging.velista.app`
  in staging; the socket accepts any origin; there are no cookies, tokens are bearer headers
  from `localStorage`. The invite link now uses `APP_STANDALONE_ORIGIN` (plan 0166).
- **Permissions the WebView needs** (inventory 2.2): `RECORD_AUDIO` and
  `MODIFY_AUDIO_SETTINGS` for the voice features (`getUserMedia` audio through Capacitor's
  `BridgeWebChromeClient.onPermissionRequest`), `ACCESS_COARSE_LOCATION` and
  `ACCESS_FINE_LOCATION` for plans 0058, 0103 and 0141, `ACCESS_NETWORK_STATE` for
  `navigator.onLine` (`browser-facade.ts` L78 to L83). No camera: WebXR is the only camera user
  and the WebView lacks it.
- **Deep link shapes** (audit section 4): `/s/*`, `/join/*`, `/auth/verify`,
  `/auth/reset-password` (query), `/{locale}/auth/callback` and `/{locale}/auth/impersonate`
  (fragment), and any `/{en|es}/…` page. The origin is `https://velista.app` or
  `https://staging.velista.app`. `apps/velista/public/.well-known/assetlinks.json` is copied
  into `dist` by the build and served by nginx as `application/json` (audit section 5); the
  one image serves both environments, so the file lists both package names.
- **The signing key exists outside the repository.** `D:\Projects\nx-portfolio\tmp\velista-android\velista-release.jks`
  with `keystore.properties` beside it (`storeFile`, `storePassword`, `keyAlias=velista`,
  `keyPassword`). Its certificate SHA256 is
  `08:96:62:0D:8C:9E:B8:A9:10:C8:3C:AD:D0:7D:6B:15:F3:2B:0E:42:AB:D0:EC:31:2B:D6:B7:1B:B3:C0:B1:92`.
  Never copy the keystore or the passwords into the repository, a plan, a log line or a
  commit. Read the properties file at build time only.
- **Workspace hygiene** (inventory section 7): there is no `@nx/gradle`; everything under
  `apps/velista/android` becomes an input of `velista:build`, `lint` and `test` and marks
  velista affected; flat ESLint does not read `.gitignore`, so the copied bundle under
  `android/app/src/main/assets/public` would be linted; Jest's haste map crawls `android/`;
  the builder image's context (`.dockerignore`) would include Gradle outputs.
- **Serving defects** (audit section 1 "Serving" and section 2 item 6): `manifest.webmanifest`
  is served as `application/octet-stream`; hashed `*.js`, `*.css` and `*.woff2` carry no
  `Cache-Control`; the staging CI build (`docker-ci.yml` L347 to L358) and `ng-slot.sh`
  (`DERIVED_KEYS[velista]`, L213, L645 to L651) do not set `VELISTA_APP_URL`.
- **The emulator at API 37 runs WebView 145.** Capacitor's `minWebViewVersion` default is 60.
  The API 26 image carries whatever WebView it shipped with; use it to learn where the floor
  really is and record the result.

### Target state

1. **Packages.** `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app`,
   `@capacitor/share`, `@capacitor/geolocation`, `@capacitor/browser` and `@capacitor/assets`
   (dev) at the current 8.x, in the root `package.json` through `npm install`, lock file
   committed as npm writes it (then `git checkout -- package-lock.json` is **not** done here,
   because this plan adds dependencies on purpose; commit the lock file diff that the install
   produced, and nothing else of it).
2. **`apps/velista/capacitor.config.ts`**: `appId: 'app.velista'`, `appName: 'Velista'`,
   `webDir: '../../dist/apps/velista'`, `server.androidScheme: 'https'`, `server.hostname`
   taken from the host of `process.env.VELISTA_APP_URL` with the default `velista.app`,
   `android.webContentsDebuggingEnabled` true only when `process.env.VELISTA_NATIVE_DEBUG` is
   `'1'`, `plugins.SystemBars: { insetsHandling: 'native', style: 'DARK' }`, `zoomEnabled: false`,
   `loggingBehavior: 'production'`. A comment names why the hostname is the app's own origin:
   same CORS entry as the PWA, invite and share links identical, App Links resolve inside the
   WebView.
3. **`apps/velista/android`**, generated by `npx cap add android` from `apps/velista` and
   committed, with these edits and no other hand edit to generated files than the ones named:
   - `app/build.gradle`: two product flavors in dimension `env`, `staging`
     (`applicationIdSuffix ".staging"`, `resValue "string", "app_name", "Velista Staging"`,
     `manifestPlaceholders = [appLinkHost: "staging.velista.app"]`) and `production`
     (`app_name` "Velista", `appLinkHost: "velista.app"`); `versionName` and `versionCode` from
     Gradle properties `velistaVersionName` (default `0.0.0-dev`) and `velistaVersionCode`
     (default `1`); a `release` signing config read from a `keystore.properties` whose path is
     the Gradle property `velistaKeystoreProperties`, else `android/keystore.properties`, and
     when neither exists a printed warning and the debug signing config, so a release build
     always produces an installable APK; `minSdkVersion` left at Capacitor's 24,
     `compileSdkVersion` and `targetSdkVersion` at 36.
   - `app/src/main/AndroidManifest.xml`: the permissions listed in Context; an `intent-filter`
     with `android:autoVerify="true"` for `https` on host `${appLinkHost}` with no path filter
     (the whole host is the app); `density` in `configChanges`; `app_name` from the flavor
     resource, so the static string is removed from `strings.xml`.
   - `MainActivity`: `EdgeToEdge.enable(this)` before `super.onCreate`, as the SystemBars
     documentation prescribes for Capacitor 8.
   - Icons and splash generated by `@capacitor/assets` from a 1024 px logo derived with
     ImageMagick (on the PATH) from `apps/velista/public/icons/icon-maskable-512.png` and
     `icon-512.png`, background `#0a0c14`, the source logo committed under
     `apps/velista/assets-src/` (or the path `@capacitor/assets` expects) so the generation is
     repeatable.
   - `android/.gitignore` kept, plus root `.gitignore` entries for
     `apps/velista/android/local.properties`, `apps/velista/android/keystore.properties`,
     `apps/velista/android/app/src/main/assets/public/`, `apps/velista/android/**/build/`,
     `apps/velista/android/.gradle/` if the generated ignore file does not already cover them.
4. **`libs/velista/native`** (`@portfolio/velista/native`, generated with the Nx Angular
   library generator, no routes, no components): the only library that imports `@capacitor/*`.
   It exports `provideNativeShell(): EnvironmentProviders`, consumed only by
   `apps/velista/src/app/app.config.ts`. The providers it returns are **inert on the web**: each
   factory checks `inject(APP_RUNTIME) === 'native'`, or the `APP_RUNTIME` provider itself
   resolves `'native'` only when `isPlatformBrowser(inject(PLATFORM_ID)) && detectNativeShell()`.
   When native it provides:
   - `APP_RUNTIME` as `'native'`.
   - `SHARE_TARGET` backed by `@capacitor/share` (`canShare` true, `share` maps a cancel to
     `'dismissed'`).
   - `GEOLOCATION_READER` backed by `@capacitor/geolocation` (`checkPermissions` for
     `permission()`, `getCurrentPosition` for `read()`, same `enableHighAccuracy` semantics as
     the web reader, same error mapping as `geolocation-reader.ts`).
   - `SYSTEM_BARS` backed by the core `SystemBars` plugin: `apply('night')` sets style `DARK`,
     `apply('day')` sets style `LIGHT`, and it also keeps the web meta write.
   - `BrowserFacade` overridden by a subclass whose `openExternal` uses `@capacitor/browser`,
     everything else inherited.
   - `APP_STORE_URL` as `https://play.google.com/store/apps/details?id=<appId>`, where the
     app id comes from `@capacitor/app` `getInfo()` at the time the dead end face asks, or is
     cached once at startup in the initializer below.
   - An environment initializer, guarded by `BrowserFacade.isBrowser`, that registers:
     `App.addListener('backButton')` calling `AppBack.request()` and `App.minimizeApp()` on
     `'floor'`; `App.addListener('appUrlOpen')` that turns the URL into `pathname + search + hash`
     and calls `Router.navigateByUrl` on it (the locale guard inserts the locale);
     `App.addListener('appStateChange')` only if the device test in target 8 shows that
     `visibilitychange` does not fire on pause and resume, in which case it feeds
     `BrowserFacade.visible` through a method the subclass adds.
   - Everything above is written so that no `window` access happens at import time, and the
     plugin calls happen only inside the native branch.
5. **Nx targets on `velista`** (`project.json`, run-commands, `cache: false`):
   - `cap:sync`: `npx cap sync android` with `cwd: apps/velista`.
   - `android`: runs `node apps/velista/scripts/build-android.mjs --flavor <staging|production>`,
     with configurations `staging` (the default) and `production`. The script, in plain
     Node 22 with no new dependency: sets the four env vars for the flavor (staging hosts or
     production hosts, version from `VELISTA_APP_VERSION` else `DEFAULT_APP_VERSION` in
     `apps/velista/app-version.ts`), runs `npx nx build velista --configuration=production
     --skip-nx-cache`, runs `npx cap sync android`, runs `gradlew assemble<Flavor>Release`
     (`.bat` on Windows) with `-PvelistaVersionName`, `-PvelistaVersionCode` (from
     `VELISTA_ANDROID_VERSION_CODE`, default `1`) and `-PvelistaKeystoreProperties` when
     `VELISTA_ANDROID_KEYSTORE_PROPERTIES` is set, and copies the APK to
     `dist/apps/velista-android/velista-<flavor>-<version>.apk`, printing its path, size and
     whether it was signed with the release key or the debug key. `ANDROID_HOME` is exported
     from `VELISTA_ANDROID_SDK` or the default SDK location when unset, and `JAVA_HOME` from
     `VELISTA_JAVA_HOME` when set.
   - Both targets are documented in `apps/velista/README.md` (create it if absent) in a short
     section "The Android app": prerequisites, the two commands, where the APK lands, how to
     install it with `adb install -r`, how to point at a slot for local testing (`VELISTA_APP_URL`,
     `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL` all exported before the target; the WebView origin
     then becomes the slot host, which the backend slot already allows), and the keystore rule.
6. **Workspace hygiene.** `apps/velista/eslint.config.mjs` ignores `android/**`;
   `apps/velista/jest.config.cts` sets `modulePathIgnorePatterns` for `<rootDir>/android`;
   `apps/velista/project.json` overrides `namedInputs.default` and `production` to exclude
   `{projectRoot}/android/**/*` and `{projectRoot}/capacitor.config.ts` from `build`, `lint`
   and `test` inputs while the `android` target stays uncached; `.dockerignore` adds
   `apps/velista/android`; `.prettierignore` adds `apps/velista/android`. `npx nx show project
   velista` confirms no inferred Gradle target appeared.
7. **Serving and environment fixes.** In the nginx conf velista's image uses: `types` gains
   `application/manifest+json webmanifest;`; a location for hashed asset names
   (`\.[0-9a-f]{16,}\.(js|mjs|css|woff2)$`) sets `Cache-Control: public, max-age=31536000,
   immutable`, placed so the five no-cache names keep winning. `docker-ci.yml` sets
   `VELISTA_APP_URL=https://staging.velista.app` beside the two `LUNA_*` values at L347 to
   L358; `ng-slot.sh` adds `VELISTA_APP_URL` to `DERIVED_KEYS[velista]` with the slot's velista
   origin, following the pattern of the two keys already there. `apps/velista/public/.well-known/assetlinks.json`
   lists `app.velista` and `app.velista.staging` with the SHA256 fingerprint above, relation
   `delegate_permission/common.handle_all_urls`. `velista-api-hosts.spec.ts` or a new spec
   asserts the file parses and names both package names.
8. **Verified on the emulator**, with the staging flavor APK installed on
   `Medium_Phone_API_37.0` through `adb install -r`, and each check recorded in "What the build
   decided" with the evidence (a screenshot saved under `tmp/` of the main checkout or the job
   directory, a logcat excerpt, an adb command output):
   - cold start reaches the localized entry page within a few seconds, no JS error in logcat
     (`adb logcat -s chromium:E Capacitor:E` plus `console` lines);
   - the status bar colour follows the theme, and the page header sits below the status bar
     (no content under it, no double padding);
   - the keyboard pushes a sheet's footer up (open any sheet with an input, for example sign
     in);
   - the hardware back (`adb shell input keyevent KEYCODE_BACK`) closes an open sheet, then
     pops a pushed page, and at the floor minimizes the app instead of killing it (the app
     stays in `adb shell dumpsys activity activities` as stopped, not finished);
   - a deep link `adb shell am start -a android.intent.action.VIEW -d "https://staging.velista.app/join/ABCDEF" app.velista.staging`
     opens the app on the join route (App Links verification is expected to fail until the
     assetlinks file is deployed; `adb shell pm get-app-links app.velista.staging` records the
     state, and the explicit package in the command bypasses verification for the test);
   - the share control on the home page opens the system share sheet (`dumpsys window` or a
     screenshot shows the chooser), and cancelling it shows no copy fallback;
   - a request to the staging gateway succeeds from the WebView origin (sign in page submit
     with a wrong password returns the backend's error, not a CORS failure);
   - a `location.reload()` path (the offline overlay's recovery, or `adb shell input` on a
     page) lands on the same route;
   - the API 26 AVD: the app installs and either renders, or Capacitor shows its WebView too
     old message; record which, and the WebView version from `dumpsys webviewupdate`.
   - Both APKs exist in `dist/apps/velista-android/`, the production one signed with the
     release key, and their sizes are recorded.
9. **Specs and gates.** `libs/velista/native` has specs for `provideNativeShell` on the web
   (every provider resolves the web default, no plugin call), the share mapping, the
   geolocation mapping, the back listener outcomes and the url open parsing, with the
   Capacitor plugins replaced by hand built doubles (no `jest.mock` of the package if a DI
   seam avoids it). `npx nx run-many --target=test --projects=velista,velista-native,velista-platform`,
   `npx nx run-many --target=lint --projects=velista,velista-native` and `npx nx build velista`
   are green. `npx nx run luna-shopper-backend-gateway:test` is not affected (no backend
   change). `npx nx affected -t lint test build --base=origin/dev` is green on the branch.

### Scope

- Work only in: the root `package.json` and `package-lock.json` (dependencies only),
  `apps/velista/capacitor.config.ts`, `apps/velista/android/**`, `apps/velista/assets-src/**`,
  `apps/velista/scripts/build-android.mjs`, `apps/velista/project.json` (the two targets and
  `namedInputs`), `apps/velista/eslint.config.mjs`, `apps/velista/jest.config.cts`,
  `apps/velista/README.md`, `apps/velista/public/.well-known/assetlinks.json`,
  `apps/velista/src/app/app.config.ts` (one `provideNativeShell()` spread),
  `apps/velista/src/app/velista-api-hosts.spec.ts` or a sibling spec, `libs/velista/native/**`,
  `tsconfig.base.json` (the one alias the generator adds), `.gitignore`, `.dockerignore`,
  `.prettierignore`, the nginx conf velista's image uses, `.github/workflows/docker-ci.yml`
  (the one env line), `tools/dev/ng-slot.sh` (the one derived key).
- Do not touch: `libs/velista/platform` (if a seam is missing, stop and say so),
  `app-providers.ts`, `app-root-route.ts`, `main.ts`, the webpack configs, the route tables,
  anything under `apps/luna-shopper-backend`, `k8s/helm` values, `apps/shell`, other apps.
  Do not generate an iOS project. Do not run prettier over a directory.

### Constraints

- Capacitor 8.x only. Angular 21, zoneless, standalone. No other new dependency.
- The native library follows the SSR rules of plan 0166 section 2: no browser global at
  import time or in a field initializer, every listener behind `isBrowser`, web defaults when
  not native.
- The web build output and the Docker image of velista are byte for byte unaffected by the
  Android project (the Angular build does not read `android/`).
- The keystore and its passwords never enter the repository or the transcript.
- Prose in files has no dashes as punctuation (the owner's rule). Comments explain why, not
  what.
- Only make the changes this plan names. No feature, refactor or abstraction beyond them.

### Action boundaries

- Proceed with reversible, in scope edits, installs of the named packages, Gradle builds,
  emulator runs, `adb` commands against the emulator, and reads.
- Stop and ask before adding a package not named here, changing a backend or Helm file,
  touching the route tables, or anything that would push, publish or deploy.

### Progress evidence

Report when a numbered target is done, and at the end. Ground each claim in a tool result.
Fill "What the build decided" with every decision the plan did not settle, the device test
results of target 8 (with the evidence paths), the WebView floor you observed, and the exact
commands that produced the two APKs.

## 1. Decisions

- **D1. The WebView origin is the app's own origin.** `server.hostname` is the host of
  `VELISTA_APP_URL`, so a staging build lives on `https://staging.velista.app` and a
  production build on `https://velista.app`. Reasons: the CORS allowlist needs no new entry
  in any environment; invite, share and mail links are the same strings as on the web; a
  deep link that reaches the app resolves against the bundle without a redirect. The cost is
  that the app and the browser keep separate storage for one origin, which is already true for
  any installed app.
- **D2. Two flavors, two installable apps.** `app.velista` and `app.velista.staging` can sit on
  one phone. Staging is the default target because that is where unreleased work is tested.
- **D3. One version string.** The bundle's `VELISTA_APP_VERSION` and the APK's `versionName`
  come from the same environment variable, so the gateway floor (plan 0034 D4) can retire old
  APKs. Nobody edits a version in a Gradle file by hand.
- **D4. Release builds always sign.** With the owner's keystore when the properties file is
  present, with the debug key otherwise, and the script says which. An unsigned APK that
  cannot be installed is never an outcome.
- **D5. The whole host is an App Link.** Every `https://velista.app/...` opens the app once the
  assetlinks file is live, because the app is the site. The file ships in `public/` and lists
  both package names under one certificate.
- **D6. Edge to edge through Capacitor's SystemBars in `native` mode.** The app's existing
  `env(safe-area-inset-*)` tokens do the work on a current WebView; an old WebView gets padded
  natively. No CSS custom property is injected, so nothing can double pad.
- **D7. Geolocation goes native.** The WebView's Permissions API is not trusted to mirror the
  Android grant, and the shop picker's denied copy depends on it.
- **D8. Camera walks stay unavailable natively.** WebXR is absent in a WebView; the token
  already reports it. An ARCore implementation is a separate project.
- **D9. Keep the web `MediaRecorder` path for voice.** It works in a WebView with the two
  audio permissions; a native recorder plugin would add a second audio pipeline for nothing.
- **D10. No live update channel.** Updates are new APKs. Capgo or Appflow would be a separate
  decision of the owner.

## 2. Not in this plan

- iOS (the owner's rule), CI for the APK, Play Store listing and upload, in app updates,
  push notifications, Google sign in inside the app, the support handoff, a native keep awake,
  WebXR walks, the walk lab's file share and downloads, a store presence that would make
  `APP_STORE_URL` resolve today.
- Live reload against a slot through `server.url` (the README names the env route instead).

## 3. Choices that are mine

- Package id `app.velista` (the reverse of `velista.app`) and the `.staging` suffix.
- The flavor as the only environment switch inside Gradle; everything else comes from the
  script's environment.
- `loggingBehavior: 'production'` and no WebView debugging unless `VELISTA_NATIVE_DEBUG=1`.
- Minimizing at the floor rather than exiting.

## What the build decided

(The builder fills this section.)
