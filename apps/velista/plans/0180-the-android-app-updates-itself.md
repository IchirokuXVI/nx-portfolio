# 0180: the Android app updates itself

> Asked for by the owner on 2026-11-04. Release `0.19.0` (version code `19000`) went to the
> internal testing track at 00:31 and reached the owner's phone about an hour later. Every
> web release also needs a new AAB build and a manual upload today, although most releases
> change no native code. The owner asked for "option 3": the app keeps its bundled web
> code, fetches newer web bundles over the air from our own servers, and uses Google Play
> In-App Updates when the native layer itself must change.
>
> **This plan reverses D10 of plan `0167`** ("No live update channel. Updates are new APKs.
> Capgo or Appflow would be a separate decision of the owner."). This plan is that
> decision. It also extends D3 of plan `0166` ("The native update path is open the store"):
> the store link stays, but as the last resort and not the only path.
>
> Paths are written as they are on `dev` today. If docs `0003` (the rename to
> `velista-client`) is merged before you start, use its names: `apps/velista-client`,
> `libs/velista-client/*`, `@velista/client/*`, and `VELISTA_GATEWAY_URL` for
> `LUNA_GATEWAY_URL`.
>
> Prerequisite reading: plan `0013` section 6.4 (reload at the next navigation), `0034`
> (the version header, D3 the `critical` flag, D6 a version that does not parse is never
> compared), `0072` (the refused build and its dead end face), `0166` (the runtime axis, D3),
> `0167` (the Android project, D1 the WebView origin, D3 one version string, D10),
> `0177` (a local Java plugin beside `MainActivity`), `0178` (the runtime `config.json`, D7
> the Android build stays per deployment). In the code: the files named in "Context".

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write Angular code. This plan
draws no new screen. It reuses the dead end face of plan `0072` and the store link of plan
`0166`. Load `antislop` only if you change copy.

### Objective

The velista Android app replaces its web bundle over the air. On launch and on resume, it
reads a signed manifest from its own cluster, downloads the zip of a newer web bundle in
the background, checks its SHA-256, and applies it at the next navigation, or sooner when
the bundle is critical. A bundle that does not confirm its boot rolls back to the previous
one and is never tried again. A bundle that needs a newer native layer is never applied.
In that case, or when the server refuses the native build, the app asks Google Play for an
immediate in-app update. A newer native build on Play gets a flexible in-app update.

### Context

Every statement below was read in the checkout on 2026-11-04.

- **The native layer.** Capacitor 8.5.3 (`package.json`: `@capacitor/core`, `android`,
  `cli` `^8.5.3`, plus `app`, `browser`, `geolocation`, `share`). `capacitor.config.ts`
  sets `webDir: '../../dist/apps/velista'`, `server.androidScheme: 'https'` and
  `server.hostname` to the host of `VELISTA_APP_URL`. `MainActivity.java` registers one
  local plugin, `VelistaGooglePlugin`, before `super.onCreate`.
- **Only `libs/velista/native` imports `@capacitor/*`.** `native-plugins.ts` declares the
  plugin shapes the app calls (`NativePlugins`) and loads them with a dynamic import in
  `loadCapacitorPlugins()`. `provide-native-shell.ts` binds the native implementations of
  the platform tokens when `APP_RUNTIME` is `native`. `native-shell.ts` has
  `storeUrlFor(appId)` and reads the app id from `App.getInfo()`.
- **The runtime axis.** `libs/velista/platform/src/lib/app-runtime.ts` has `APP_RUNTIME`
  (`'web' | 'native'`), `APP_STORE_URL` and `detectNativeShell()`.
- **`AppUpdates` is inert on native today** (`libs/velista/platform/src/lib/app-updates.ts`).
  `_native` short circuits `checkNow()`, `_check()` and `newerVersionForUnknownPage()`.
  `demandUpdate()` on native calls `_giveUp()` at once, so the dead end face shows the
  store action. On the web, a downloaded version sets `_reloadAtNextNavigation`, and the
  next `NavigationEnd` calls `ReloadBlocker.reloadWhenIdle()`. A critical version
  (`isCriticalUpdate(appData)`) calls `reloadWhenIdle()` at once. The attempt counter is
  `StorageKeys.updateAttempt` in session storage. The resume check listens to
  `visibilitychange` itself and does not use `AppResumed`.
- **`AppResumed`** (`app-resumed.ts`) counts resumes from `BrowserFacade.visible` and
  `pageshow` with `persisted`, collapsed within 1 s. Its counter starts at zero.
- **`ReloadBlocker`** (`reload-blocker.ts`) defers `reloadWhenIdle()` while a blocker is
  held and reloads through `BrowserFacade.reload()`. It exposes `isBlocked()`.
- **The version.** `APP_VERSION` (`libs/velista/models/src/lib/app-version.ts`) is bound in
  `apps/velista/src/app/app-providers.ts:168` from `environment.version`, which the
  `DefinePlugin` fills from `VELISTA_APP_VERSION`. `gateway-interceptor.ts` sends it as
  `x-client-version`. `lib-app-version` (`libs/velista/ui/src/lib/brand/app-version.ts`)
  draws the same token. So both values already come from the bundle that runs, not from
  the APK. Staging builds call themselves `staging` (`stage-unit.yml:233`), which by
  plan `0034` D6 never compares. Releases use the tag's version (`release-unit.yml:206`).
- **The floor.** `MinClientVersionGuard` (`apps/luna-shopper-backend/gateway/src/app/client-version/min-client-version.guard.ts`)
  sets `x-min-client-version` on every response and refuses a lower parseable
  `x-client-version`. It is off unless `MIN_CLIENT_VERSION` is set.
  `values.production.yaml:59` sets `minClientVersion: '0.17.0'`. The refusal reaches
  `BackendReadiness` as `too-old`, and `AppUpdates._watchRefusals()` turns that into
  `demandUpdate()`.
- **The Android build.** `scripts/build-android.mjs` runs `nx build velista
  --configuration=production` with the flavor's three hosts (`HOSTS`), then `cap sync`,
  then Gradle with `-PvelistaVersionName` and `-PvelistaVersionCode`. A host exported in
  the environment wins over the flavor's (that is how a build points at a slot).
  `android/app/build.gradle` has the `staging` flavor (`applicationIdSuffix ".staging"`)
  and the `production` flavor. The version code comes from `VELISTA_ANDROID_VERSION_CODE`.
  The owner's scheme is `major * 1000000 + minor * 1000 + patch` (`0.19.0` is `19000`).
- **The image.** `apps/velista/src/Dockerfile` copies `dist/apps/velista` into
  `/var/www/html` and moves `nginx.conf` into place. `nginx.conf` marks `index.html`,
  `ngsw.json`, `ngsw-worker.js` and `manifest.webmanifest` `no-cache`, marks hashed files
  `immutable`, and serves other `*.json` files with no cache header.
- **CI.** `stage-unit.yml` and `release-unit.yml` build every bundle of the unit in one
  `docker run` of the builder image, then build the images. The `build` job names no
  GitHub environment. Only the `deploy` job does (`environment: ${{ inputs.unit }}-staging`
  and `-production`), so the `build` job sees no environment secret today.
- **Plan `0178` is not built yet.** When it lands, the production bundle carries no URL and
  reads `config.json` at boot. In the APK, `build-android.mjs` writes that file into the
  bundle before `cap sync` (`0178` target 13). The image writes its own `config.json` at
  container start, so the file is not part of the CI build output.
- **`ngsw-config.json`** carries `appData.critical` (false today). The built `ngsw.json` in
  `dist/apps/velista` carries the same `appData`.
- **Toolchain on this machine.** Gradle runs on a Temurin 21 JDK named by
  `VELISTA_JAVA_HOME`. The AVD `Medium_Phone_API_37.0` exists (Play Store image, WebView
  145). The release keystore lives outside the repository in the main checkout's
  `tmp/velista-android/`.

### Target state

1. `@capgo/capacitor-updater` (8.x, manual mode) and `@capawesome/capacitor-app-update`
   (8.x) are dependencies. `capacitor.config.ts` configures the updater with
   `autoUpdate: false`, `updateUrl: ''`, `statsUrl: ''`, `channelUrl: ''`,
   `appReadyTimeout` per D7, `autoDeleteFailed: true`, `autoDeletePrevious: true` and
   `resetWhenUpdate: true`. No request goes to a Capgo host (build target 1 and row 13 of section 5 prove it).
2. `apps/velista/native-api.json` holds `{ "nativeApi": <int>, "fingerprint": "<sha256>" }`.
   `scripts/native-api.mjs --check` recomputes the fingerprint of the native surface (D4)
   and fails with a message that names `--bump` when it differs. `--bump` increments
   `nativeApi` and writes the new fingerprint. A `velista:native-api` target runs
   `--check` with explicit inputs, and `velista:test` depends on it.
3. `build-android.mjs` reads `native-api.json`, the flavor's OTA public key
   (`apps/velista/ota-keys/<flavor>.pub.pem`, committed) and the OTA base URL, and passes
   them to Gradle. `build.gradle` writes them as `BuildConfig` fields. A new local plugin,
   `VelistaNativeInfoPlugin.java`, answers `info()` with `{ nativeApi, otaBaseUrl,
   otaPublicKey }`. `otaBaseUrl` is empty when any host override is exported, unless
   `VELISTA_OTA_URL` names one, so a slot APK never pulls a cluster bundle.
4. `libs/velista/platform` exports a `LIVE_UPDATES` token (interface `LiveUpdatesI`,
   root default: unavailable) and an `APP_STORE_UPDATES` token (interface
   `AppStoreUpdatesI`, root default: unavailable). It also exports `BundleUpdates`, the
   orchestrator, and two pure functions: `parseOtaManifest(unknown)` (rule D4) and
   `verifyOtaManifest(bytes, signature, publicKeyPem)` over WebCrypto ECDSA P-256.
5. `libs/velista/native` implements both tokens over the two packages and
   `VelistaNativeInfo`. The manifest is fetched with native HTTP (D3), never with the
   WebView `fetch`. `provide-native-shell.ts` binds both tokens when native.
6. `AppUpdates` on native delegates to `BundleUpdates` instead of short circuiting:
   `checkNow()` asks for the manifest, `demandUpdate()` follows D9, and a downloaded bundle
   applies at the next navigation or, when critical, when `ReloadBlocker` is idle.
   `newerVersionForUnknownPage()` answers true when a verified bundle is waiting.
   The web path of `AppUpdates` does not change.
7. The bundle confirms its boot (D7). A bundle that failed is recorded and never applied
   again.
8. `scripts/ota-bundle.mjs` turns `dist/apps/velista` into `dist/apps/velista/ota/android/`:
   one zip named by its SHA-256, `manifest.json` and `manifest.json.sig`. `nginx.conf`
   serves `/ota/android/manifest.json` and its signature `no-cache`, and the zip
   `immutable`.
9. CI writes and signs the OTA files in the `build` job of both pipelines for the velista
   unit only, with the private key from a GitHub environment secret (D5).
10. `apps/velista/README.md` explains the OTA path, the native key, the bump and the key
    ceremony. `CLAUDE.md` gains one bullet under "Docker & CI/CD" on the OTA files in the
    velista image.

### Scope

In: `package.json` and the lock file (two dependencies), `apps/velista/capacitor.config.ts`,
`apps/velista/android/app/build.gradle`, `MainActivity.java`, `VelistaNativeInfoPlugin.java`
(new), the files `cap sync` rewrites under `apps/velista/android`, `apps/velista/scripts/`
(`build-android.mjs`, `native-api.mjs` new, `ota-bundle.mjs` new, `ota-keygen.mjs` new),
`apps/velista/native-api.json` (new), `apps/velista/ota-keys/` (new, public keys only),
`apps/velista/project.json` (two targets, one asset rule), `apps/velista/src/nginx.conf`,
`apps/velista/README.md`, `libs/velista/platform/src/lib/` (`app-updates.ts` and spec, new
`live-updates.ts`, `bundle-updates.ts`, `ota-manifest.ts`, `app-store-updates.ts` with
specs, `index.ts`), `libs/velista/native/src/lib/` (`native-plugins.ts`, new
`native-live-updates.ts`, `native-app-store-updates.ts` with specs,
`provide-native-shell.ts` and spec, `index.ts`), `.github/workflows/stage-unit.yml`,
`.github/workflows/release-unit.yml`, `k8s/units/velista/unit.env` (one key),
`tools/deploy/units.mjs` (the optional key), `CLAUDE.md` (one bullet).

Out: the web service worker path (`ngsw-config.json` stays, `AppUpdates` on the web stays),
iOS, Capgo cloud, delta or partial bundles, percentage rollouts, any backend change, the
dead end copy (plan `0166` left it, and this plan draws no screen).

### Constraints

- Only `libs/velista/native` imports `@capacitor/*`, `@capgo/*` or `@capawesome/*`. Platform
  holds the tokens, the orchestrator and the pure functions.
- Do not use `@angular/core/rxjs-interop` in platform code (CLAUDE.md).
- Map the manifest from `unknown` into own models (rule D4). Never trust a field that the
  signature does not cover.
- The APK always carries a complete bundle. Nothing in this plan removes it.
- Never print, log or commit the OTA private key. CI reads it from the environment variable
  that the secret fills, and GitHub masks it. No `set -x` in that step.
- The keystore, its passwords and the OTA private keys stay outside the repository.
- Prettier per file with `--end-of-line auto`, never over a directory.

### Action boundaries

Stop and ask before: creating or rotating the OTA key pair, setting a GitHub secret,
naming a GitHub environment on the `build` job (D5 needs the owner's yes), touching a
cluster, uploading to the Play Console, adding a dependency other than the two named here,
or changing `namespace`, `applicationId` or the Java package. Generate a throwaway key pair
under your scratch directory for local tests only.

### Progress evidence

- `npx nx test velista-platform` and `npx nx test velista-native` (check the project names
  with `npx nx show projects`) pass, with the spec cases listed under each target.
- `npx nx run velista:native-api` passes on a clean tree and fails after a one byte change
  to `MainActivity.java`.
- `npx nx build velista` then `node apps/velista/scripts/ota-bundle.mjs` with a throwaway
  key writes the three files, and `--verify` with the public key accepts them.
- `npx nx run velista:build:docker` then `curl` on the container shows the cache headers of
  target state item 8.
- The emulator walk of section 5 passes every row, and the evidence names each result.

## 1. Problem

A velista web release today reaches Android users only as a new APK. The owner builds an
AAB by hand (`build-android.mjs --flavor production --bundle`, about three minutes), uploads
it to the Play Console, and waits. On 2026-11-04 the internal track took about an hour to
reach the owner's phone. A public track adds review time.

Most releases change only the web bundle. The APK is a WebView around that bundle, so the
delay buys nothing for them. It also costs the floor: when `minClientVersion` moves, an APK
user is refused until Play delivers the new APK, and the dead end face can only offer the
store link (plan `0166` D3).

The web PWA has no such delay. Its service worker sees a new `ngsw.json` within a check
(plan `0034`). This plan gives the Android app the same property for web changes and keeps
Play for native changes.

## 2. Decisions

- **D1. The bundled code stays.** The APK always contains the bundle it was built with
  (Capgo calls it `builtin`). First launch and an offline launch boot it. An OTA bundle
  only replaces it, and a rollback returns to it. A new APK from Play deletes the
  downloaded bundles (`resetWhenUpdate: true`) and boots its own bundle first.

- **D2. Self hosted on velista's own origin, per cluster. The host is the channel.** The
  velista image already holds the web build. It now also holds the OTA zip of that same
  build and a signed manifest under `/ota/android/`. No new service, no database, no new
  host, no new Gateway route: the existing `/` route of the velista host serves them. The
  staging cluster serves the staging flavor (`https://staging.velista.app/ota/android/`)
  and production serves the production app (`https://velista.app/ota/android/`). A
  rollback of a cluster with `redeploy.yml` rolls back its OTA bundle too, because the
  manifest lives in the image.

  **Is the bundle identical for both clusters?** Not today, and yes after plan `0178`.
  Today the `DefinePlugin` compiles the three URLs per environment, and CI builds each
  environment's image with its own hosts. The staging image's zip therefore carries the
  staging hosts, which are the hosts of the staging flavor. That works with no extra rule.
  After `0178` the bundle carries no URL and reads `config.json`. The image writes that
  file at container start, so it is not in the zip that CI built, and an OTA bundle would
  boot with no configuration. **Decision: in the native runtime the configuration comes
  from the APK, not from the bundle.** The APK already knows its flavor's hosts
  (`build-android.mjs` `HOSTS`, `0178` D7). The builder of whichever plan lands second
  makes `loadRuntimeConfig` read `config.json` from the built-in bundle's copy, which the
  updater does not replace, or from `VelistaNativeInfo.info()`. See question Q2. The
  zip excludes `config.json` and `nginx.conf` in both cases.

- **D3. The manifest is fetched with native HTTP, never with the WebView `fetch`.** The
  WebView origin is the cluster's own host (`0167` D1). Capacitor's local server answers
  requests to `server.hostname` from the bundle, so a WebView `fetch` of
  `https://velista.app/ota/android/manifest.json` never reaches the server. Community
  reports show the interception (Ionic forum, "Capacitor server.hostname same as web
  deployment URL on Android"). The native implementation fetches the manifest and its
  signature through Capacitor's `CapacitorHttp.request`, and the updater downloads the zip
  in native code. Build target 1 proves on the emulator that the request reaches nginx.

- **D4. A native compatibility key.** `nativeApi` is an integer in
  `apps/velista/native-api.json`. The APK compiles it into `BuildConfig`. Each bundle
  declares in its manifest the `nativeApi` it was built against, which is the minimum it
  needs. The app applies a bundle only when `bundle.nativeApi <= installed nativeApi`.
  The fingerprint covers what can change the native surface:
  - Every git tracked file under `apps/velista/android`, with line endings normalized to
    LF (the working tree here flips CRLF on `capacitor.build.gradle`).
  - The resolved versions of every `@capacitor/*`, `@capgo/*` and `@capawesome/*` package
    in `package-lock.json`.
  - `libs/velista/native/src/lib/native-plugins.ts`, which declares every native method a
    bundle can call.
  - `apps/velista/capacitor.config.ts`.

  The check fails on any change to these without a bump. A false alarm costs one bump and
  forces one native release. A missed bump sends a bundle that calls a method the APK
  lacks. Its boot then fails, and D7 rolls it back, so the cost of a miss is bounded too.
  `velista:native-api` gets explicit inputs, because `project.json` excludes
  `{projectRoot}/android/**/*` from `default`, and a cached `test` would otherwise pass
  over an Android change.

- **D5. Integrity: HTTPS, SHA-256 and a signature.** The manifest names the zip's SHA-256,
  and the updater checks the zip against it (Capgo's `download({ checksum })` takes a
  SHA-256). `manifest.json.sig` is an ECDSA P-256 signature over the exact bytes of
  `manifest.json`, in the IEEE P1363 form that WebCrypto reads. The public key of each
  flavor is compiled into the APK (`BuildConfig`, through `VelistaNativeInfo`), so a
  bundle cannot change the key that judges the next bundle. Rotation is a native release.
  P-256 and not Ed25519, because WebCrypto ECDSA is in every WebView above the floor of 94
  (`capacitor.config.ts` `minWebViewVersion`), and Ed25519 arrived in Chromium much later.

  Two key pairs, one per flavor, so a leaked staging secret cannot sign a production
  bundle. `scripts/ota-keygen.mjs` makes a pair, writes the private key to a path the owner
  names (the main checkout's `tmp/velista-android/`, beside the keystore) and prints the
  public key for `apps/velista/ota-keys/<flavor>.pub.pem`. The owner stores each private
  key as the secret `VELISTA_OTA_SIGNING_KEY` of the GitHub environment `velista-staging`
  and `velista-production` with `gh secret set --env`, reading the file on stdin so the
  value never appears in a command line.

  The `build` job of both pipelines must see that secret, and today only the `deploy` job
  names an environment. **Decision: the `build` job names `${{ inputs.unit }}-staging` or
  `${{ inputs.unit }}-production`.** `<unit>-production` allows the unit's tags only
  (CLAUDE.md), which is the ref the release `build` job runs on. Make sure that
  `<unit>-staging` allows `main` before the first run. The portfolio unit's `build` job then names its own
  environment, which holds no OTA secret and skips the step. See question Q4.

- **D6. Apply safely.** The app asks for the manifest after the first navigation of a cold
  start and on each resume (`AppResumed.resumes`), at most once per 10 minutes, and never
  while one check is in flight. A bundle it may apply (D4, D7, D8) downloads in the
  background. A downloaded bundle applies:
  - At the next completed navigation while `ReloadBlocker.isBlocked()` is false, which is
    the moment of plan `0013` section 6.4. The app calls the updater's `set()`, which
    reloads into the new bundle.
  - At the next cold start, through the updater's `next()`.
  - At once when idle, for a critical bundle. The manifest's `critical` is copied from
    `appData.critical` of the built `ngsw.json`, so one flag serves both channels
    (plan `0034` D3).
  - At once, past the blocker, when the server refuses the running build (D9, plan `0072`
    D7).

  The Capgo README does not say whether `next()` in manual mode also applies on a move to
  the background. Target 1 measures it. If it does, the app calls `next()` only when the
  blocker is free and the app goes to the background, so a resume never drops a held form.

- **D7. The new bundle confirms its boot, or the app rolls back.** Each boot calls the
  updater's `notifyAppReady()` once the app is stable: after the first `NavigationEnd`
  and the first render after it (`afterNextRender`), whatever the backend answers. An
  offline boot is a good boot. `appReadyTimeout` is 20 s, twice Capgo's default, because
  the cold boot of an old phone with a slow WebView is the case that matters, and a false
  rollback costs a full download again. Without the call, the updater returns to the
  previous bundle or to the built-in one. On the next boot the app reads the failed bundle
  (the `updateFailed` event or a `list()` entry in error) and records its `bundle` id under
  a new `StorageKeys` entry in local storage. A recorded id is never downloaded again. The
  record clears when the manifest names another bundle.

- **D8. Which bundle is "newer".** The manifest's `bundle` field is
  `<VELISTA_APP_VERSION>+<first 12 characters of the commit>`, compiled into the bundle as
  `VELISTA_BUNDLE_ID`. The app applies a manifest whose `bundle` differs from the running
  one. It does not order them. Staging versions are the literal `staging` and do not
  order, and a cluster that a redeploy rolled back is the server the app talks to, so
  following the cluster down is correct. `APP_VERSION`, the account page and
  `x-client-version` already read the running bundle (`app-providers.ts:168`), so after an
  OTA they show and send the new version with no change. See question Q3 on a downgrade
  below the APK's own bundle.

- **D9. Google Play In-App Updates for the native layer.** `APP_STORE_UPDATES` wraps
  `@capawesome/capacitor-app-update`. Three cases:
  - **Flexible.** Play reports an `availableVersionCode` above `currentVersionCode` and
    `flexibleUpdateAllowed`, and nothing forces it. The app calls `startFlexibleUpdate()`
    once per available version code (recorded in local storage, so a person who declined
    is not asked again for that code). When the download completes, the app calls
    `completeFlexibleUpdate()` at the same idle navigation moment as D6, because it
    restarts the app.
  - **Immediate.** The manifest names a bundle with `nativeApi` above the installed one,
    or the server refuses the build (`too-old`) and no OTA bundle fits. The app calls
    `performImmediateUpdate()` when `immediateUpdateAllowed` is true.
  - **Last resort.** Play cannot help (the staging flavor is not on Play, a sideloaded APK,
    no Play services, the person cancels the immediate flow). The dead end face of plan
    `0072` keeps its store action from plan `0166` D3, unchanged.

  On a `too-old` refusal the order is: a verified OTA bundle already downloaded, then a
  fresh manifest check and download (one attempt per document, the existing
  `StorageKeys.updateAttempt`), then the immediate update, then the dead end face.

- **D10. The version code.** The scheme stays `major * 1000000 + minor * 1000 + patch`.
  With OTA, the version code changes only when an AAB is uploaded, which this plan makes a
  native release (a `nativeApi` bump) or an owner's choice. The APK's `versionName` stays
  the version of its built-in bundle (plan `0167` D3). After an OTA the running version
  and the `versionName` differ, which is correct: the floor and the account page read the
  bundle. A flexible update compares version codes only, never bundle versions.

- **D11. Plugin choice: `@capgo/capacitor-updater` in manual mode.** Checked on 2026-11-04:
  - npm `@capgo/capacitor-updater` 8.54.2, license MPL-2.0, peer `@capacitor/core ^8.0.0`,
    no runtime dependencies. MPL-2.0 is file level copyleft: using it unmodified asks
    nothing of this repository.
  - The README's "No Cloud setup" path downloads zips from any URL with `autoUpdate: false`,
    `download()`, `next()`, `set()`, `notifyAppReady()`, `list()`, `delete()`, `reset()`.
    It names no account or API key for that path. The cloud path starts with one.
  - Rollback: without `notifyAppReady()` within `appReadyTimeout` (default 10 000 ms) the
    app returns to the last good bundle or the built-in one.
  - The defaults point at Capgo: `updateUrl` `https://plugin.capgo.app/updates`, `statsUrl`
    `https://plugin.capgo.app/stats`, `channelUrl`. The settings page says `statsUrl: ''`
    disables stats and that `/updates` still stores data if `updateUrl` stays set. All
    three are set to `''`, and the app never calls `getLatest()` or a channel method.

  Writing our own plugin was the alternative: download, verify, unzip into the app's
  files directory, and point the bridge at it with `setServerBasePath`, plus a boot timer
  and a rollback. It is a few hundred lines of Java that would own the hardest part
  (a boot that never confirms, a process killed mid apply) with no field history. Capgo
  is mature on exactly that part. The cost is a large dependency with cloud defaults,
  which row 13 of section 5 contains by proof. If target 1 finds that manual mode still calls home,
  stop and ask: the own plugin is then the answer.

- **D12. Plugin choice: `@capawesome/capacitor-app-update`.** npm 8.1.1, license MIT, peer
  `@capacitor/core >=8.0.0`, in the `capawesome-team/capacitor-plugins` monorepo. Its
  compatibility table lists 8.x for Capacitor 8 as active. It exposes
  `getAppUpdateInfo()` (`availableVersionCode`, `currentVersionCode`, `updateAvailability`,
  `immediateUpdateAllowed`, `flexibleUpdateAllowed`, `installStatus`),
  `performImmediateUpdate()`, `startFlexibleUpdate()`, `completeFlexibleUpdate()`,
  `openAppStore()` and the `onFlexibleUpdateStateChange` event. Play's own guide says
  in-app updates need Android 5.0 or later, and its test guide says they work only for an
  install from Play with the same application id and signing key. A local plugin over
  Play Core was the alternative. It would save one dependency and cost a Java file and
  its tests for an API that this package already wraps.

- **D13. The store rules allow it.** Google Play's Device and Network Abuse policy forbids
  an app to "download executable code (such as dex, JAR, .so files) from a source other
  than Google Play" and exempts code that runs in a virtual machine or an interpreter
  "such as JavaScript in a webview or browser" (Play Console Help, answer 9888379, read on
  2026-11-04). The OTA bundle is HTML, CSS and JavaScript for the WebView, so it is inside
  the exemption. The same policy still forbids an OTA bundle that changes what the app
  is for. Each bundle is the same app the store reviewed. iOS stays out of scope (the
  owner's rule in plan `0167`).

## 3. The manifest

`/ota/android/manifest.json`, written by `scripts/ota-bundle.mjs`:

```json
{
  "schema": 1,
  "platform": "android",
  "bundle": "0.20.0+0f7476f4e1a2",
  "version": "0.20.0",
  "nativeApi": 1,
  "critical": false,
  "url": "bundles/<sha256>.zip",
  "sha256": "<64 hex>",
  "size": 3145728,
  "builtAt": "2026-11-05T10:00:00Z"
}
```

- `url` is relative to the manifest, so the same image works on any host.
- `parseOtaManifest` refuses any other `schema`, a `platform` other than `android`, a
  `url` that is absolute or leaves `bundles/`, a `sha256` that is not 64 hex characters,
  and a `nativeApi` that is not a positive integer.
- The signature covers the exact bytes. The app verifies before it parses.
- The zip holds `dist/apps/velista` with `index.html` at its root, minus `nginx.conf`,
  `config.json` (D2) and the `ota/` directory itself.

## 4. Build targets, in order

Each target ends green on its own tests before the next starts.

### Target 1: a spike on the emulator

Files: none committed except the findings, written into this plan under "What the build
decided".

Install the two packages on a branch, configure the updater as target state item 1, and
build the staging APK. On the AVD, with a throwaway zip served over HTTP from the machine
(see section 5 for cleartext), answer:

- Does any request reach a Capgo host? Watch with `adb logcat` and a proxy or the emulator's
  `-tcpdump`.
- Does `next()` in manual mode apply on a move to the background, or only on a cold start?
- Does `download()` refuse a zip whose SHA-256 differs, before the bundle is listed as
  ready?
- Does `CapacitorHttp.request` to `https://<server.hostname>/ota/...` reach the network
  (D3)?
- Does `resetWhenUpdate` return to the built-in bundle after `adb install -r` of a higher
  version code?

If a Capgo host is contacted with all three URLs empty, stop and ask (D11).

### Target 2: the native key and the info plugin

Files: `apps/velista/native-api.json`, `scripts/native-api.mjs` with a `node --test` spec,
`project.json` (the `native-api` target with inputs on `{projectRoot}/android/**/*`,
`{projectRoot}/capacitor.config.ts`, `{workspaceRoot}/package-lock.json` and
`{workspaceRoot}/libs/velista/native/src/lib/native-plugins.ts`, and `test` depends on
it), `VelistaNativeInfoPlugin.java`, `MainActivity.java` (register it before `super`),
`build.gradle` (three `buildConfigField` entries and `buildFeatures { buildConfig true }`),
`build-android.mjs`.

Tests: the script spec covers a clean tree, a changed Android file, a CRLF only change
(passes), a changed Capacitor version in a lock file fixture, and `--bump`.

### Target 3: the OTA files

Files: `scripts/ota-bundle.mjs` and `scripts/ota-keygen.mjs` with `node --test` specs,
`project.json` (an `ota-bundle` target), `nginx.conf`.

`ota-bundle.mjs` reads `VELISTA_APP_VERSION`, the commit (`GITHUB_SHA` or `git rev-parse`),
`native-api.json` and `appData.critical` from `dist/apps/velista/ngsw.json`. It writes the
zip with a fixed file order and fixed timestamps, so the same build gives the same SHA-256.
With `VELISTA_OTA_SIGNING_KEY` set, it signs. Without it, it writes the manifest and no
signature, and the app ignores an unsigned manifest. `--verify <public key>` checks the
three files.

The APK must never carry `ota/`. The output lands inside `dist/apps/velista`, which is also
the Capacitor `webDir`, so `build-android.mjs` refuses to run `cap sync` while
`dist/apps/velista/ota` exists, and its spec covers that refusal.

`nginx.conf` gains, above the generic `*.json` block:

- `location = /ota/android/manifest.json` and `.sig`: `Cache-Control: no-cache`.
- `location ^~ /ota/android/bundles/`: `Cache-Control: public, max-age=31536000, immutable`.

Tests: the specs cover a deterministic SHA-256 over two runs, the exclusions of section 3,
a signature that `crypto.subtle` verifies in Node with the public key, and a refusal when
`ngsw.json` is missing. `velista-index-markup.spec.ts` stays green.

### Target 4: the platform half

Files: `libs/velista/platform/src/lib/live-updates.ts`, `app-store-updates.ts`,
`ota-manifest.ts`, `bundle-updates.ts`, `app-updates.ts`, `storage-keys.ts`, their specs,
`index.ts`.

- `LiveUpdatesI`: `available()`, `info()` (`nativeApi`, `otaBaseUrl`, `otaPublicKey`),
  `fetchText(url)`, `download({ bundle, url, sha256 })`, `apply(bundle)`,
  `applyAtNextStart(bundle)`, `confirmBoot()`, `failedBundles()`.
- `AppStoreUpdatesI`: `info()`, `startFlexible()`, `completeFlexible()`, `immediate()`,
  and a `flexibleReady` signal.
- `BundleUpdates` holds the rules of D6 to D9 and nothing native. `AppUpdates` on native
  calls it where it returns early today.

Spec cases: a manifest with a bad signature is not parsed; a valid manifest naming the
running bundle downloads nothing; a recorded failed bundle downloads nothing; a higher
`nativeApi` downloads nothing and asks for the immediate update; a critical bundle applies
when the blocker frees; a normal bundle applies at the next `NavigationEnd` and not before;
two resumes within 10 minutes make one check; a `too-old` follows the order of D9 and
spends one attempt; the web runtime never touches either token. Use hand built doubles,
as the existing `app-updates.spec.ts` does.

### Target 5: the native half

Files: `libs/velista/native/src/lib/native-plugins.ts` (the three new plugin shapes and
their dynamic imports), `native-live-updates.ts`, `native-app-store-updates.ts`, their
specs, `provide-native-shell.ts` and spec, `index.ts`, `capacitor.config.ts`, the files
`cap sync` rewrites.

`confirmBoot()` runs from an environment initializer after the first `NavigationEnd` and
`afterNextRender` (D7). Spec cases: the bindings on web and native, the `updateFailed`
record, and a plugin that rejects (each path resolves to "unavailable", never throws into
the app).

### Target 6: CI

Files: `.github/workflows/stage-unit.yml`, `release-unit.yml`, `k8s/units/velista/unit.env`
(`OTA_PROJECTS="velista"`), `tools/deploy/units.mjs` and its test (the key is optional).

After "Build the bundles in the pinned image" and before "Build & push", one step runs
`node apps/velista/scripts/ota-bundle.mjs` for each project in `OTA_PROJECTS`, with
`VELISTA_OTA_SIGNING_KEY: ${{ secrets.VELISTA_OTA_SIGNING_KEY }}` in its `env`. The step
fails when the unit lists OTA projects and the secret is empty, so an unsigned production
manifest never ships. The `build` job names the environment (D5). Stage builds pass
`VELISTA_APP_VERSION=staging`, and the bundle id still differs per commit (D8).

Tests: `node --test tools/deploy/units.test.mjs`. `actionlint` if it is installed.

### Target 7: docs

Files: `apps/velista/README.md`, `CLAUDE.md`. The README explains how to bump `nativeApi`,
when a change needs an AAB, the key ceremony, and how to test OTA on the emulator.

## 5. Verification on the Android emulator

Boot `Medium_Phone_API_37.0` headless. Build with `VELISTA_JAVA_HOME` set to the JDK 21.
Serve OTA files from the machine: build the velista image locally, run it, and point the
APK at it with `VELISTA_OTA_URL=http://localhost:<port>/ota/android/` and `adb reverse`.
Android blocks cleartext by default, so `build-android.mjs` adds a network security
configuration that allows cleartext to `localhost` only when `VELISTA_OTA_URL` is `http`,
and refuses `--bundle` in that case. Use a throwaway key pair for the local signature.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Install, airplane mode, launch | The built-in bundle boots. No crash, no update face. |
| 2 | Online, serve the same bundle id | No download (logcat shows one manifest request). |
| 3 | Serve a newer bundle, launch | Download in the background. Applies at the next navigation. The account page shows the new version. |
| 4 | Serve a newer bundle, hold a sheet form open, navigate | No reload while held. Applies after the form closes and the next navigation. |
| 5 | Serve a critical bundle | Applies at once when nothing is held. |
| 6 | Serve a zip whose SHA-256 differs from the manifest | Download refused. The running bundle stays. |
| 7 | Serve a manifest with a wrong signature | No download at all. |
| 8 | Serve a bundle whose `main.js` throws at boot | Rollback within 20 s. The id is recorded. A relaunch does not download it again. |
| 9 | Serve a bundle with a higher `nativeApi` | Not downloaded. The immediate update is asked and fails (not installed from Play). The dead end face shows only on a refusal. |
| 10 | Background the app, resume | One manifest request per resume, at most one per 10 minutes. |
| 11 | `adb install -r` a higher version code | The new APK boots its own bundle (`resetWhenUpdate`). |
| 12 | Point the APK at a slot gateway with `MIN_CLIENT_VERSION` above the bundle | The refusal pulls the served bundle and boots it. Without one, the dead end face with the store action. |
| 13 | Throughout, capture traffic | No request to a Capgo host. |

The owner tests In-App Updates on a phone through internal app sharing, as Play's test
guide describes: install one version from an internal sharing link, open the link of a
higher version code without installing it, then open the app. Flexible and immediate each
get one run. This needs the Play Console and stays an owner step.

## 6. CI and deploy changes

- The velista image gains `/ota/android/` with three files. Its size grows by one zip,
  about the size of the bundle.
- The `build` job of `stage-unit.yml` and `release-unit.yml` names the unit's environment
  and reads `VELISTA_OTA_SIGNING_KEY` (D5).
- `unit.env` of velista gains `OTA_PROJECTS`. `units.mjs` treats it as optional.
- No Helm change. The existing HTTPRoute for the velista host serves `/ota/`.
- `redeploy.yml` needs no change: an older image carries its own signed manifest.
- A native release (`nativeApi` bumped) still needs the AAB by hand, as today. Upload it
  before or with the release that deploys a bundle needing it. Otherwise phones see
  "needs a newer native layer" and wait on Play.

## 7. Failure cases

| Case | What happens | Why it is safe |
| --- | --- | --- |
| No network on launch | Built-in or last good bundle boots. No check. | D1. |
| Manifest 404 or not JSON | Check ends. Nothing changes. | Same as no update. |
| Signature wrong or missing | Manifest ignored. | D5. |
| Zip SHA-256 wrong | Download refused by the updater. | D5, proved in target 1. |
| Download stops halfway | Bundle not listed as ready. Next check tries again. | Updater keeps partial data out. |
| New bundle crashes at boot | Rollback after 20 s. Id recorded, never retried. | D7. |
| New bundle boots but is broken later | Not detected. Fix by a new release or a cluster redeploy, which the app follows. | D8. |
| Bundle needs newer native layer | Not applied. Immediate update, else store link. | D4, D9. |
| Server refuses the build | OTA first, then Play, then dead end face. | D9. |
| Cluster rolled back | App follows the cluster's bundle. | D8. |
| `nativeApi` bump forgotten | Check fails in the PR. If it slips, boot fails and rolls back. | D4, D7. |
| Private key leaked | Attacker can sign for that flavor only, and still needs to serve from the cluster host over HTTPS. Rotate with a native release. | D5. |
| Capgo default host contacted | Target 1 and row 13 catch it. Stop and ask. | D11. |
| Slot APK | OTA off unless `VELISTA_OTA_URL` is set. | Target state item 3. |
| Staging flavor and Play | Not on Play. In-app updates answer unavailable, store link stays. | D9. |

## 8. Backlog note (not scheduled)

Delta or partial bundles, a percentage rollout (a `rollout` field compared with a stable
per install number), Capgo cloud, and iOS are out of scope. A percentage rollout fits the
manifest later without a schema change to anything else, by a `schema: 2`.

## 9. Questions for the owner

- **Q1. Capgo or our own plugin** (D11). Recommendation: Capgo in manual mode, with the
  cloud URLs empty and target 1 as proof. Our own plugin if target 1 finds a call home.
- **Q2. Where the native app's configuration lives after plan `0178`** (D2). This plan
  needs either the built-in bundle's `config.json` to stay readable after an OTA, or the
  three URLs in `VelistaNativeInfo`. Recommendation: the native plugin, because it does
  not depend on how the updater lays out its directories. `0178` target 13 would then
  write the URLs into Gradle as well as into `config.json`.
- **Q3. Downgrades below the APK's own bundle** (D8). The app follows the cluster, also
  down. If the APK's built-in bundle is newer than the cluster's (an AAB uploaded before
  the deploy), the app would replace a newer bundle with an older one. Recommendation:
  allow it, because the older bundle matches the server. The alternative is to refuse a
  manifest whose parseable version is lower than the built-in one.
- **Q4. The `build` job names a GitHub environment** (D5). This adds a deployment entry per
  build in both units and ties the build to the environment's ref rules. The alternative
  is a separate `sign-ota` job with the environment that the image build waits for.
  Recommendation: the environment on the `build` job, because it is one line.
- **Q5. `nativeApi` as a minimum** (D4). As written, a bundle built against 1 runs on an
  APK with 2. That holds only while a native release adds methods and removes none.
  Recommendation: keep the minimum and add one README rule: a native release never removes
  a method in `native-plugins.ts` in the same release that stops calling it.
- **Q6. The flexible prompt.** Play draws its own dialog. Plan `0013` adds no prompt of
  ours, and this keeps that. Recommendation: ask once per version code, as D9 says.
- **Q7. The staging store link.** `storeUrlFor('app.velista.staging')` names a listing that
  does not exist, because only `app.velista` is on Play. The dead end face of a staging
  APK therefore links to nothing useful today. Recommendation: no change in this plan.
  It is noted here because D9's last resort reaches it.

## Sources checked on 2026-11-04

- `@capgo/capacitor-updater`: npm registry (`/latest`, 8.54.2, MPL-2.0, peer
  `@capacitor/core ^8.0.0`), `github.com/Cap-go/capacitor-updater` README, and
  `capgo.app/docs/plugins/updater/settings/` and `/api/`.
- `@capawesome/capacitor-app-update`: npm registry (`/latest`, 8.1.1, MIT, peer
  `@capacitor/core >=8.0.0`) and `capawesome.io/plugins/app-update`.
- Google Play In-App Updates: `developer.android.com/guide/playcore/in-app-updates` and
  `/in-app-updates/test`.
- Google Play Device and Network Abuse policy: `support.google.com/googleplay/android-developer/answer/9888379`.
- The Capacitor local server and `server.hostname`: `forum.ionicframework.com/t/capacitor-server-hostname-same-as-web-deployment-url-on-android/243700`
  (community report, so target 1 proves it).
