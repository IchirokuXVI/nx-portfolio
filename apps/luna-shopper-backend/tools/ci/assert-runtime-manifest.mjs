#!/usr/bin/env node
// Every bundle in the image can find every package it requires.
//
// `apps/luna-shopper-backend/<svc>/package.json` is a HAND WRITTEN runtime
// manifest. `nx prune` turns it into the `package-lock.json` the Dockerfile
// installs from with `npm ci --omit=dev`, so a package the webpack bundle
// requires but the manifest does not list is simply absent from the image, and
// the container exits at boot with MODULE_NOT_FOUND.
//
// Webpack's `generatePackageJson` would find those imports on its own, but it is
// set on the `main.ts` plugin alone: two writers would race for the same file
// (webpack.config.js says so where it declares the second entry). So the
// generator sees the main bundle and nothing else, while the IMAGE runs every
// entry point the service emits. catalog emits three, auth emits three, core and
// harvester two each. A package reachable only from one of the secondary entries
// is invisible to the generator, invisible to the type checker, invisible to
// lint, and invisible to the unit and e2e suites, because none of them ever load
// that bundle.
//
// That gap has cost three staging releases:
//
//   2026-08-28  ioredis, tslib, @socket.io/redis-adapter, the OpenTelemetry SDK
//               missing from all five manifests. Every image dead at boot.
//   2026-09-01  the gateway gained @nestjs/jwt and the manifest did not.
//   2026-09-03  `uuid`, required by catalog's seed-reference.js for the
//               deterministic ids in app/db/reference/ids.ts and by nothing on
//               the main path:
//
//                 Error: Cannot find module 'uuid'
//                 Require stack: - /app/seed-reference.js
//
//               The service itself started perfectly. But the Job that runs that
//               bundle is a Helm pre-upgrade hook, so it did not cost one dead
//               pod, it failed the hook, and --atomic rolled the whole release
//               back.
//
// This is the check that closes it. It reads the built bundles rather than the
// TypeScript sources, which is the only way to answer the real question: a type
// only import is erased and must NOT be listed, `data-source.ts` is a TypeORM
// CLI path that is never bundled, and tslib is emitted by the compiler rather
// than written by anyone. The source says none of that. The bundle does.
//
// It compares against the pruned LOCKFILE rather than the manifest, for the same
// reason: the lockfile is what `npm ci` installs, so it is the file that decides
// whether the package is in the image.
//
// Usage:
//   node assert-runtime-manifest.mjs <dist-dir> [<dist-dir> ...]
//
// Exits 0 when every bundle is satisfied, 1 when any package is missing.

import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join } from 'node:path';

const BUILTINS = new Set(builtinModules);

// A bare specifier as it appears in an emitted CommonJS bundle. The plugin
// builds with `target: 'node'`, which leaves every node_modules import as a
// literal `require(...)` rather than inlining it, so this finds exactly the
// packages the image has to provide. Both quote styles, because the emitted
// quote character is webpack's choice and not a contract.
const REQUIRE = /require\(\s*(?:"([^"\n]+)"|'([^'\n]+)')\s*\)/g;

/** The installable package name for a specifier, or null if nothing installs it. */
function packageOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (BUILTINS.has(name)) return null;
  return name;
}

/** Every package each bundle at the root of `dir` requires, as name -> bundles. */
function requiredPackages(dir) {
  // The root only. Each entry point is emitted here beside the others, while
  // `assets` and `workspace_modules` are directories, so this is exactly the set
  // of bundles the image can be told to run. Source maps are `.js.map` and fail
  // this test already.
  const bundles = readdirSync(dir).filter((f) => f.endsWith('.js'));
  if (bundles.length === 0) {
    throw new Error(
      `${dir} holds no .js bundle at its root. Was the service built?`
    );
  }

  const required = new Map();
  for (const bundle of bundles) {
    const source = readFileSync(join(dir, bundle), 'utf8');
    for (const match of source.matchAll(REQUIRE)) {
      const name = packageOf(match[1] ?? match[2]);
      if (name === null) continue;
      if (!required.has(name)) required.set(name, new Set());
      required.get(name).add(bundle);
    }
  }
  return { bundles, required };
}

/**
 * The packages the image will actually have.
 *
 * The pruned lockfile lists them under `node_modules/<name>`. Workspace
 * libraries are copied in beside the bundle by `copy-workspace-modules` and
 * appear as `file:workspace_modules/...` entries, so they resolve too, which is
 * why this reads the lockfile's own keys rather than the manifest's
 * `dependencies` and does not need to special case `@portfolio/*`.
 */
function installedPackages(dir) {
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const installed = new Set();
  for (const path of Object.keys(lock.packages ?? {})) {
    if (path === '') continue;
    const at = path.lastIndexOf('node_modules/');
    if (at === -1) continue;
    installed.add(path.slice(at + 'node_modules/'.length));
  }
  return installed;
}

function check(dir) {
  const service = basename(dir);
  const { bundles, required } = requiredPackages(dir);
  const installed = installedPackages(dir);

  const missing = [...required.entries()]
    .filter(([name]) => !installed.has(name))
    .sort(([a], [b]) => a.localeCompare(b));

  if (missing.length === 0) {
    console.log(
      `  ok      ${service}: ${required.size} packages across ${bundles.length} bundle(s) (${bundles.join(', ')})`
    );
    return 0;
  }

  console.error(`  MISSING ${service}:`);
  for (const [name, from] of missing) {
    console.error(`            ${name}  required by ${[...from].join(', ')}`);
  }
  return missing.length;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: node assert-runtime-manifest.mjs <dist-dir> [...]');
  process.exit(2);
}

console.log(
  'Checking each bundle against the lockfile its image installs from.'
);
let failures = 0;
for (const dir of dirs) failures += check(dir);

if (failures > 0) {
  console.error('');
  console.error(
    `${failures} package(s) are required by a bundle and absent from the image.`
  );
  console.error(
    "Add each one to the service's apps/luna-shopper-backend/<svc>/package.json"
  );
  console.error(
    'dependencies, at the range the root package.json or the lockfile resolves.'
  );
  console.error(
    'Left alone, the container exits at boot with MODULE_NOT_FOUND; when the'
  );
  console.error(
    'bundle is one a Helm hook runs, it fails the deploy and rolls the release back.'
  );
  process.exit(1);
}

console.log('');
console.log('Every bundle can resolve every package it requires.');
