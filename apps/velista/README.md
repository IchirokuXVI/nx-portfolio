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
