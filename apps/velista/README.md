# velista

## The Android app

velista ships as an Android app built with Capacitor 8 from the same web bundle as
`https://velista.app` (plan `0167`). There are two flavors, and both can be installed
on one phone: `staging` (`app.velista.staging`, named "Velista Staging", talks to the
staging hosts) and `production` (`app.velista`, named "Velista").

### Prerequisites

- Node 22 and the workspace's `npm install`.
- The Android SDK with platform 36 and build tools 35 or later. The script looks in
  the per user default location (`%LOCALAPPDATA%\Android\Sdk` on Windows); set
  `VELISTA_ANDROID_SDK` to use another one.
- A JDK 21. The Capacitor 8 plugins compile against a Java 21 toolchain, so a JDK 17
  fails with "Cannot find a Java installation matching languageVersion=21". Set
  `VELISTA_JAVA_HOME` to it when `JAVA_HOME` points elsewhere.

### Build an APK

```sh
npx nx run velista:android            # staging, the default
npx nx run velista:android:production
```

Each run builds the web bundle for that flavor's hosts, runs `cap sync`, runs Gradle,
and copies the APK to `dist/apps/velista-android/velista-<flavor>-<version>.apk`. It
prints the path, the size, which key signed it and the certificate's SHA-256.

The version is `VELISTA_APP_VERSION` (default `DEFAULT_APP_VERSION` in
`app-version.ts`). The same string is the bundle's version and the APK's
`versionName`, so the gateway's client floor can retire an old APK. Set
`VELISTA_ANDROID_VERSION_CODE` (default `1`) higher for every APK that must install
over an older one.

`npx nx run velista:cap:sync` copies the last web build into the Android project
without building anything, for work in Android Studio.

### Install it

```sh
adb install -r dist/apps/velista-android/velista-staging-0.0.0-dev.apk
```

`-r` keeps the app's data. An APK signed with a different key than the installed one
does not install over it: uninstall first (`adb uninstall app.velista.staging`).

### Point it at a slot

Export the three hosts before the target, and they win over the flavor's. The ports
are the slot's (`tools/dev/ng-slot.sh --list` and
`bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list` print them):

```sh
export VELISTA_APP_URL=http://localhost:<velista port>
export LUNA_GATEWAY_URL=http://localhost:<gateway port>
export LUNA_REALTIME_URL=http://localhost:<realtime port>
npx nx run velista:android
adb reverse tcp:<gateway port> tcp:<gateway port>
adb reverse tcp:<realtime port> tcp:<realtime port>
```

An emulator or a phone reaches the machine's `localhost` only through `adb reverse`.

**The WebView origin is then `https://localhost`, not the slot's velista origin.**
Capacitor takes only the host name from `VELISTA_APP_URL` and always serves on
`https` with no port, while a slot's `CORS_ORIGINS` lists `http://localhost:<port>`
origins. REST calls from the app to a slot therefore fail CORS until that backend
also allows `https://localhost`. The socket accepts any origin.

### The signing key

Release builds are signed with the key named by a `keystore.properties` file
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Its path is
`VELISTA_ANDROID_KEYSTORE_PROPERTIES`, else `apps/velista/android/keystore.properties`,
which git ignores. Without either, the build signs with the debug key and says so, so
it always installs.

**The keystore and its passwords never enter the repository.** Keep them outside the
checkout and pass the path. The App Links statement in
`public/.well-known/assetlinks.json` names the release key's SHA-256; a build signed
with another key opens its links in the browser.

### Over the air updates

The app replaces its web bundle by itself (plan `0180`). A web release then needs no new
APK. Only a change to the native layer goes through Google Play.

**How the channel works.** The velista image serves the OTA files of its own build under
`/ota/android/`:

- `bundles/<sha256>.zip`: the web bundle, with `index.html` at its root. Cached for a
  year, because the name is the content.
- `manifest.json`: the bundle id, the version, the `nativeApi` it needs, the `critical`
  flag of `ngsw-config.json`, the zip's path and its SHA-256. Never cached.
- `manifest.json.sig`: an ECDSA P-256 signature over the exact bytes of the manifest.
  Never cached.

The host is the channel. The staging cluster serves the staging flavor
(`https://staging.velista.app/ota/android/`) and production serves the production app.
A redeploy of an older version also rolls back its OTA bundle, because the manifest is
in the image.

The bundle id is `<VELISTA_APP_VERSION>+<first 12 characters of the commit>` (D8). The app
applies a bundle whose id differs from the running one. It does not order them, so it
follows the cluster down after a rollback. The APK knows the id of its own bundle, and a
manifest that names it returns the app to that bundle with no download.

On launch and on resume, at most once in 10 minutes, the app reads the manifest and its
signature over native HTTP. It checks the signature with the flavor's public key, which
is compiled into the APK. It then downloads the zip in the background, and the updater
checks the SHA-256. The new bundle applies at the next navigation when no form holds
the screen, when the app goes to the background, or at once for a critical bundle. A
bundle that does not confirm its boot within 30 s rolls back, and the app never
downloads that id again.

nginx serves the manifest as `text/plain` on purpose. Android parses every body whose
`Content-Type` names JSON, and the parsed copy no longer matches the signed bytes.

**The native key.** `apps/velista/native-api.json` holds `nativeApi`, an integer, and a
fingerprint of the native surface: the Android project, the Capacitor, Capgo and
Capawesome versions in the lock file, `libs/velista/native/src/lib/native-plugins.ts`
and `capacitor.config.ts`. Every bundle declares the `nativeApi` it was built against.
A phone applies a bundle only when its APK has that number or a higher one.

`npx nx run velista:native-api` fails when the fingerprint moved, and `velista:test`
runs it. Choose one of two answers:

```sh
node apps/velista/scripts/native-api.mjs --bump     # a bundle can see the change
node apps/velista/scripts/native-api.mjs --accept   # no bundle can see the change
```

`--bump` is for a method added, changed or removed in `native-plugins.ts`, a new
plugin, a Capacitor major, or a plugin setting in `capacitor.config.ts` that the bundle
relies on. Every bundle after a bump waits for the matching APK from Play, so a bump for
nothing stops OTA for every phone. `--accept` is for a change that no bundle can see: a
manifest flag, a resource, a Gradle or dependency bump that adds no method. The number
stays and OTA goes on.

**A native release never removes a method from `native-plugins.ts` in the same release
that stops calling it** (Q5). `nativeApi` is a minimum, so a bundle built against 1 still
runs on an APK with 2, and it may still call the method. Remove the method one native
release later.

**When a change needs an AAB.** After a `--bump`, build and upload a new AAB before or
with the release that deploys a bundle needing it. Until Play delivers it, phones keep
their bundle and Play offers a flexible update once per version code. Every other
release reaches phones over the air. A new AAB from Play drops every downloaded bundle
and boots its own.

**The key ceremony.** One key pair for each flavor, so a leaked staging key cannot sign
a production bundle. The owner makes each pair:

```sh
node apps/velista/scripts/ota-keygen.mjs --out <main checkout>/tmp/velista-android/ota-staging.pem
```

The private key goes to the path named, beside the keystore and outside the repository.
The script prints the public key. Commit it as `apps/velista/ota-keys/<flavor>.pub.pem`.
Store the private key as a secret of the GitHub environment, reading the file on stdin
so the value never appears in a command line:

```sh
gh secret set VELISTA_OTA_SIGNING_KEY --env velista-staging < <private key path>
gh secret set VELISTA_OTA_SIGNING_KEY --env velista-production < <private key path>
```

Until `apps/velista/ota-keys/<flavor>.pub.pem` exists, the build prints a warning and
the APK never asks for a manifest. A new key is a native release, because the APK holds
the key that judges the next bundle.

**CI.** The `build` job of `stage-unit.yml` and `release-unit.yml` names the unit's
environment (`velista-staging` or `velista-production`), so it sees
`VELISTA_OTA_SIGNING_KEY`. After the bundles are built, the step "Write and sign the OTA
files" runs `ota-bundle.mjs` for each project in `OTA_PROJECTS` of
`k8s/units/velista/unit.env`. It fails when the unit lists a project and the secret is
empty, so an unsigned manifest never ships. The image build then copies the files in.

**Build an APK with OTA off.** `--no-ota` builds an APK that never asks for a manifest.
Use it for an APK built from a branch and pointed at a real cluster; without it, the
cluster's bundle replaces the branch's at the first check. An APK that points at a slot
has OTA off already, unless `VELISTA_OTA_URL` names a channel. `--bundle` refuses
`--no-ota`.

**Test OTA on the emulator.** Use a throwaway key pair under a scratch directory, never
a real one.

1. Make the pair: `node apps/velista/scripts/ota-keygen.mjs --out <scratch>/private.pem
   > <scratch>/public.pem`.
2. Build the APK with the public key and a local channel. An `http` channel may name
   `localhost` only, and the APK then allows cleartext to `localhost` alone:

   ```sh
   VELISTA_NATIVE_DEBUG=1 VELISTA_APP_VERSION=0.90.1 \
   VELISTA_OTA_PUBLIC_KEY=<scratch>/public.pem \
   VELISTA_OTA_URL=http://localhost:8787/ota/android/ \
   node apps/velista/scripts/build-android.mjs --flavor staging
   ```

3. Build a second bundle with another `VELISTA_APP_VERSION` and the staging hosts
   (`VELISTA_APP_URL`, `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL`), then write its OTA
   files with the private key in the environment:

   ```sh
   VELISTA_APP_VERSION=0.90.2 VELISTA_OTA_SIGNING_KEY="$(cat <scratch>/private.pem)" \
     node apps/velista/scripts/ota-bundle.mjs
   node apps/velista/scripts/ota-bundle.mjs --verify <scratch>/public.pem
   ```

   Move `dist/apps/velista/ota` out of `dist` right away. `build-android.mjs` refuses to
   run `cap sync` while it exists, because the APK must never carry it.
4. Serve that `ota/` directory on port 8787 with velista's `nginx.conf` (an `nginx`
   container that mounts it at `/var/www/html/ota`), so the content types are the
   cluster's. Then `adb reverse tcp:8787 tcp:8787`.
5. Launch the app. `adb logcat` under the tag `CapgoUpdater` shows the download, the
   switch and `notifyAppReady`. The version line of the landing and the account page
   shows the new version after the next navigation.

nginx writes no access log (k8s plan 0018), so put a small logging proxy in front of it
to see each request.

**The script specs.** The four scripts have `node --test` specs. CI runs the first two
on every pull request:

```sh
node --test apps/velista/scripts/ota-bundle.node-test.mjs apps/velista/scripts/ota-keygen.node-test.mjs
node --test apps/velista/scripts/native-api.node-test.mjs apps/velista/scripts/build-android.node-test.mjs
```

### Watch the socket on a device

`apps/velista/scripts/android-reconnect/` holds the probes plan `0168` was verified
with. Build the APK with `VELISTA_NATIVE_DEBUG=1` so the WebView accepts DevTools, run
`scenario.sh <name> devtools` once per app start, then attach `ws-monitor.mjs` and drive
a scenario with `scenario.sh` (screen off and on, airplane mode, forced Doze). The
monitor prints every socket opened and closed, every frame and a poll of the header
mark. The header of `scenario.sh` lists the steps and the scenarios, and
`docs/reports/2026-10-23-velista-socket-reconnect-on-android.md` explains how to read a
trace.
