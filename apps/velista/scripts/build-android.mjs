#!/usr/bin/env node
// Builds an installable velista APK for one flavor (plan 0167): the web bundle for that
// environment's hosts, `cap sync`, then Gradle. Plain Node 22 and no dependency, so it
// runs before anything else is installed for Android.
//
//   node apps/velista/scripts/build-android.mjs --flavor staging|production [--bundle]
//
// --bundle also builds the Android App Bundle (.aab) that Google Play takes, beside the APK.
//
// Environment it reads, all optional:
//   VELISTA_APP_VERSION                  the bundle's version and the APK's versionName
//   VELISTA_ANDROID_VERSION_CODE         the APK's versionCode, default 1
//   VELISTA_ANDROID_KEYSTORE_PROPERTIES  the signing properties file, default
//                                        apps/velista/android/keystore.properties
//   VELISTA_ANDROID_SDK                  the Android SDK, default the per user location
//   VELISTA_JAVA_HOME                    the JDK Gradle runs on (Capacitor 8 needs 21)
//   VELISTA_APP_URL, LUNA_GATEWAY_URL, LUNA_REALTIME_URL
//                                        override the flavor's hosts, to point at a slot

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
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appRoot, '../..');
const androidRoot = join(appRoot, 'android');
const windows = process.platform === 'win32';

const HOSTS = {
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

function fail(message) {
  console.error(`build-android: ${message}`);
  process.exit(1);
}

function flavorArg() {
  const index = process.argv.indexOf('--flavor');
  const flavor = index === -1 ? 'staging' : process.argv[index + 1];
  if (!(flavor in HOSTS)) {
    fail(`--flavor must be staging or production, not ${flavor}`);
  }
  return flavor;
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

const flavor = flavorArg();
const bundle = process.argv.includes('--bundle');
const Flavor = flavor[0].toUpperCase() + flavor.slice(1);
const version = process.env.VELISTA_APP_VERSION || defaultAppVersion();
const versionCode = process.env.VELISTA_ANDROID_VERSION_CODE || '1';
if (!/^[1-9][0-9]*$/.test(versionCode)) {
  fail(
    `VELISTA_ANDROID_VERSION_CODE must be a positive integer, not ${versionCode}`
  );
}

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

run(
  'npx',
  ['nx', 'build', 'velista', '--configuration=production', '--skip-nx-cache'],
  {
    cwd: workspaceRoot,
    env,
  }
);
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
  env,
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
