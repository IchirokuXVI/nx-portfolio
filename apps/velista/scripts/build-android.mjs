#!/usr/bin/env node
// Builds an installable velista APK for one flavor (plan 0167): the web bundle for that
// environment's hosts, `cap sync`, then Gradle. Plain Node 22 and no dependency, so it
// runs before anything else is installed for Android.
//
//   node apps/velista/scripts/build-android.mjs --flavor staging|production [--bundle] [--no-ota]
//
// --bundle also builds the Android App Bundle (.aab) that Google Play takes, beside the APK.
// --no-ota builds an APK that never asks for an over the air bundle (plan 0180). Use it for
//          an APK built from a branch and pointed at a real cluster: without it, the
//          cluster's bundle replaces the branch's at the first check. Play never gets one,
//          so --bundle refuses it.
//
// Environment it reads, all optional:
//   VELISTA_APP_VERSION                  the bundle's version and the APK's versionName
//   VELISTA_ANDROID_VERSION_CODE         the APK's versionCode, default 1
//   VELISTA_ANDROID_KEYSTORE_PROPERTIES  the signing properties file, default
//                                        apps/velista/android/keystore.properties
//   VELISTA_ANDROID_SDK                  the Android SDK, default the per user location
//   VELISTA_JAVA_HOME                    the JDK Gradle runs on (Capacitor 8 needs 21)
//   VELISTA_APP_URL, LUNA_GATEWAY_URL, LUNA_REALTIME_URL
//                                        override the flavor's hosts, to point at a slot;
//                                        any of them also turns OTA off
//   VELISTA_OTA_URL                      the OTA base URL, which wins over the flavor's and
//                                        over a host override. An http URL may only name
//                                        localhost, for a test on the emulator through
//                                        adb reverse, and the APK then allows cleartext to
//                                        localhost alone
//   VELISTA_OTA_PUBLIC_KEY               a PEM file that replaces the flavor's committed
//                                        public key, for a throwaway key pair in a test

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');
const androidRoot = join(appRoot, 'android');
const windows = process.platform === 'win32';

export const HOSTS = {
  staging: {
    VELISTA_APP_URL: 'https://staging.velista.app',
    LUNA_GATEWAY_URL: 'https://api.staging.velista.app',
    LUNA_REALTIME_URL: 'https://rt.staging.velista.app',
  },
  production: {
    VELISTA_APP_URL: 'https://velista.app',
    LUNA_GATEWAY_URL: 'https://api.velista.app',
    LUNA_REALTIME_URL: 'https://rt.velista.app',
  },
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The flags this script takes. An unknown flavor is an error message, not an exit. */
export function parseArgs(argv) {
  const index = argv.indexOf('--flavor');
  const flavor = index === -1 ? 'staging' : argv[index + 1];
  return {
    flavor,
    bundle: argv.includes('--bundle'),
    noOta: argv.includes('--no-ota'),
    error:
      flavor in HOSTS
        ? null
        : `--flavor must be staging or production, not ${flavor}`,
  };
}

/**
 * Where the APK asks for its manifest, or '' for never (plan 0180, target state item 3).
 * `VELISTA_OTA_URL` wins. Otherwise a host override means the APK talks to a slot, and a
 * slot APK must never pull a cluster bundle, so OTA is off. Otherwise the flavor's own
 * host serves `/ota/android/`.
 */
export function otaBaseUrl({ flavor, env, noOta }) {
  if (noOta) {
    return '';
  }
  if (env.VELISTA_OTA_URL) {
    return env.VELISTA_OTA_URL;
  }
  if (Object.keys(HOSTS[flavor]).some((key) => env[key])) {
    return '';
  }
  return `${HOSTS[flavor].VELISTA_APP_URL}/ota/android/`;
}

/** True when the APK must allow cleartext to localhost, for an http OTA URL. */
export function needsCleartextLocalhost(url) {
  return url.startsWith('http:');
}

/** The first reason this build must not run, or null. */
export function refusal({ bundle, noOta, otaUrl, otaDirExists }) {
  if (bundle && noOta) {
    return '--bundle refuses --no-ota: a Play build always asks its cluster for bundles';
  }
  if (otaUrl !== '') {
    let parsed;
    try {
      parsed = new URL(otaUrl);
    } catch {
      return `VELISTA_OTA_URL is not a URL: ${otaUrl}`;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return `VELISTA_OTA_URL must be https or http, not ${parsed.protocol}`;
    }
    if (!otaUrl.endsWith('/')) {
      return `VELISTA_OTA_URL must end with a slash, as the manifest is read below it: ${otaUrl}`;
    }
    if (parsed.protocol === 'http:') {
      if (!LOCAL_HOSTS.has(parsed.hostname)) {
        return `an http VELISTA_OTA_URL may only name localhost, not ${parsed.hostname}`;
      }
      if (bundle) {
        return '--bundle refuses an http VELISTA_OTA_URL: a Play build allows no cleartext';
      }
    }
  }
  if (otaDirExists) {
    return 'dist/apps/velista/ota exists, and cap sync would copy the OTA files into the APK. Delete it first';
  }
  return null;
}

/** The id of the bundle the APK carries (plan 0180, D8). */
export function builtinBundleId(version, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`not a full commit hash: ${commit}`);
  }
  return `${version}+${commit.slice(0, 12)}`;
}

/** The `nativeApi` of `native-api.json`, which must be a positive integer. */
export function nativeApiOf(json) {
  const value = JSON.parse(json).nativeApi;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `nativeApi in native-api.json must be a positive integer, not ${value}`
    );
  }
  return value;
}

function fail(message) {
  console.error(`build-android: ${message}`);
  process.exit(1);
}

// Read off the file rather than imported: it is TypeScript, and this script stays
// plain Node so it needs no loader.
function defaultAppVersion() {
  const source = readFileSync(join(appRoot, 'app-version.ts'), 'utf8');
  const match = /DEFAULT_APP_VERSION\s*=\s*'([^']+)'/.exec(source);
  if (match === null) {
    fail('DEFAULT_APP_VERSION not found in apps/velista/app-version.ts');
  }
  return match[1];
}

function run(command, args, options) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  // The Windows shell joins arguments with spaces, so a path with one must be quoted.
  const quoted = windows
    ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    : args;
  const program = windows && /\s/.test(command) ? `"${command}"` : command;
  const result = spawnSync(program, quoted, {
    stdio: 'inherit',
    shell: windows,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} exited with ${result.status ?? result.signal}`);
  }
}

function headCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail('git rev-parse HEAD failed, and the built-in bundle id needs it');
  }
  return result.stdout.trim();
}

// The newest build tools' apksigner, to print which certificate the APK carries.
function apksigner(sdk) {
  const tools = join(sdk, 'build-tools');
  if (!existsSync(tools)) {
    return null;
  }
  const versions = readdirSync(tools).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  for (const version of versions.reverse()) {
    const candidate = join(
      tools,
      version,
      windows ? 'apksigner.bat' : 'apksigner'
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function certificateDigest(signer, apk, env) {
  if (signer === null) {
    return 'unknown (no apksigner found)';
  }
  const result = spawnSync(signer, ['verify', '--print-certs', apk], {
    encoding: 'utf8',
    shell: windows,
    env,
  });
  const match = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(
    result.stdout ?? ''
  );
  return match === null ? 'unknown (apksigner could not read it)' : match[1];
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error !== null) {
    fail(args.error);
  }
  const { flavor, bundle, noOta } = args;
  const Flavor = flavor[0].toUpperCase() + flavor.slice(1);
  const version = process.env.VELISTA_APP_VERSION || defaultAppVersion();
  // Play takes each version code once, so a bundle never falls back to the default.
  if (bundle && !process.env.VELISTA_ANDROID_VERSION_CODE) {
    fail(
      '--bundle needs VELISTA_ANDROID_VERSION_CODE, above the last one uploaded to Play'
    );
  }
  const versionCode = process.env.VELISTA_ANDROID_VERSION_CODE || '1';
  if (!/^[1-9][0-9]*$/.test(versionCode)) {
    fail(
      `VELISTA_ANDROID_VERSION_CODE must be a positive integer, not ${versionCode}`
    );
  }

  const otaDir = join(workspaceRoot, 'dist/apps/velista/ota');
  let otaUrl = otaBaseUrl({ flavor, env: process.env, noOta });
  const early = refusal({ bundle, noOta, otaUrl, otaDirExists: false });
  if (early !== null) {
    fail(early);
  }

  // The key that judges the next bundle is compiled in (D5). Until the owner commits the
  // flavor's public key, the APK carries none and asks for no manifest.
  const keyFile = process.env.VELISTA_OTA_PUBLIC_KEY
    ? resolve(process.env.VELISTA_OTA_PUBLIC_KEY)
    : join(appRoot, 'ota-keys', `${flavor}.pub.pem`);
  let otaPublicKey = '';
  if (existsSync(keyFile)) {
    otaPublicKey = readFileSync(keyFile, 'utf8').replace(/\r\n/g, '\n').trim();
  } else {
    console.warn(
      `build-android: warning: no OTA public key at ${relative(workspaceRoot, keyFile)}, so this APK never asks for an OTA bundle`
    );
    otaUrl = '';
  }
  const cleartext = needsCleartextLocalhost(
    process.env.VELISTA_OTA_URL && !noOta ? process.env.VELISTA_OTA_URL : ''
  );

  let nativeApi;
  try {
    nativeApi = nativeApiOf(
      readFileSync(join(appRoot, 'native-api.json'), 'utf8')
    );
  } catch (error) {
    fail(error.message);
  }
  const builtinBundle = builtinBundleId(version, headCommit());

  const sdk =
    process.env.VELISTA_ANDROID_SDK ||
    process.env.ANDROID_HOME ||
    (windows
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
          'Android',
          'Sdk'
        )
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Android', 'sdk')
        : join(homedir(), 'Android', 'Sdk'));

  // A host already exported wins over the flavor's, which is how a build points at a slot.
  const hosts = Object.fromEntries(
    Object.entries(HOSTS[flavor]).map(([key, value]) => [
      key,
      process.env[key] || value,
    ])
  );

  const env = {
    ...process.env,
    ...hosts,
    VELISTA_APP_VERSION: version,
    ANDROID_HOME: sdk,
    ...(process.env.VELISTA_JAVA_HOME
      ? { JAVA_HOME: process.env.VELISTA_JAVA_HOME }
      : {}),
  };
  // The native facts reach Gradle as project properties through the environment, which
  // carries the PEM's line breaks and needs no quoting by the Windows shell.
  const gradleEnv = {
    ...env,
    ORG_GRADLE_PROJECT_velistaNativeApi: String(nativeApi),
    ORG_GRADLE_PROJECT_velistaOtaBaseUrl: otaUrl,
    ORG_GRADLE_PROJECT_velistaOtaPublicKey: otaPublicKey,
    ORG_GRADLE_PROJECT_velistaBuiltinBundle: builtinBundle,
    ORG_GRADLE_PROJECT_velistaCleartextLocalhost: String(cleartext),
  };

  const keystoreProperties = process.env.VELISTA_ANDROID_KEYSTORE_PROPERTIES
    ? resolve(process.env.VELISTA_ANDROID_KEYSTORE_PROPERTIES)
    : join(androidRoot, 'keystore.properties');
  const releaseKey = existsSync(keystoreProperties);
  // Play refuses a bundle signed with the debug key, so a bundle needs the release key.
  if (bundle && !releaseKey) {
    fail(
      `--bundle needs the release key, and ${keystoreProperties} does not exist`
    );
  }

  console.log(`velista ${flavor} ${version} (${versionCode})`);
  for (const [key, value] of Object.entries(hosts)) {
    console.log(`  ${key}=${value}`);
  }
  console.log(`  nativeApi=${nativeApi}`);
  console.log(`  builtinBundle=${builtinBundle}`);
  console.log(`  otaBaseUrl=${otaUrl === '' ? '(off)' : otaUrl}`);
  if (cleartext) {
    console.log('  cleartext allowed to localhost only');
  }

  run(
    'npx',
    ['nx', 'build', 'velista', '--configuration=production', '--skip-nx-cache'],
    {
      cwd: workspaceRoot,
      env,
    }
  );
  // The OTA files land inside the Capacitor webDir (plan 0180, target 3), and the APK
  // must never carry them.
  const late = refusal({
    bundle,
    noOta,
    otaUrl,
    otaDirExists: existsSync(otaDir),
  });
  if (late !== null) {
    fail(late);
  }
  run('npx', ['cap', 'sync', 'android'], { cwd: appRoot, env });

  const gradleArgs = [
    `assemble${Flavor}Release`,
    ...(bundle ? [`bundle${Flavor}Release`] : []),
    `-PvelistaVersionName=${version}`,
    `-PvelistaVersionCode=${versionCode}`,
  ];
  if (process.env.VELISTA_ANDROID_KEYSTORE_PROPERTIES) {
    gradleArgs.push(`-PvelistaKeystoreProperties=${keystoreProperties}`);
  }
  // By full path: cmd.exe does not always look in the working directory.
  run(join(androidRoot, windows ? 'gradlew.bat' : 'gradlew'), gradleArgs, {
    cwd: androidRoot,
    env: gradleEnv,
  });

  const built = join(
    androidRoot,
    'app/build/outputs/apk',
    flavor,
    'release',
    `app-${flavor}-release.apk`
  );
  if (!existsSync(built)) {
    fail(`Gradle finished but ${built} does not exist`);
  }

  const outDir = join(workspaceRoot, 'dist/apps/velista-android');
  mkdirSync(outDir, { recursive: true });
  const apk = join(outDir, `velista-${flavor}-${version}.apk`);
  copyFileSync(built, apk);

  const megabytes = (statSync(apk).size / (1024 * 1024)).toFixed(2);
  console.log(`\nAPK: ${relative(workspaceRoot, apk)}`);
  console.log(`Size: ${megabytes} MB`);
  console.log(
    `Signed with: ${releaseKey ? 'the release key' : 'the debug key (no keystore properties found)'}`
  );
  console.log(
    `Certificate SHA-256: ${certificateDigest(apksigner(sdk), apk, env)}`
  );

  if (bundle) {
    const builtBundle = join(
      androidRoot,
      'app/build/outputs/bundle',
      `${flavor}Release`,
      `app-${flavor}-release.aab`
    );
    if (!existsSync(builtBundle)) {
      fail(`Gradle finished but ${builtBundle} does not exist`);
    }
    const aab = join(outDir, `velista-${flavor}-${version}.aab`);
    copyFileSync(builtBundle, aab);
    console.log(`\nBundle: ${relative(workspaceRoot, aab)}`);
  }
}

// Run only as a script, so the spec can import the rules above.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
