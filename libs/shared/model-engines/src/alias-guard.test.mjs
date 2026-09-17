/**
 * No TypeScript path alias may resolve into this library (tools plan 0001).
 *
 * The Angular apps compile every alias in tsconfig.base.json. This library
 * names `process` and spawns child processes, so an alias here is a broken
 * browser build with a confusing message. See the rule in libs/luna-shopper's
 * browser reachable libraries note.
 *
 * The library is reached by a relative path instead, which Nx still draws as a
 * real static edge. Living under libs/shared makes an alias look ordinary, so
 * this test is what stops one being added.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Where this library sits, spelled the way tsconfig.base.json spells a path. */
const LIBRARY_PATH = 'libs/shared/model-engines';

/** The workspace root holds tsconfig.base.json, four directories above here. */
const TSCONFIG_URL = new URL('../../../../tsconfig.base.json', import.meta.url);

/** A tsconfig path target, with the separators and the leading `./` evened out. */
function normalizeTarget(target) {
  return target.split('\\').join('/').replace(/^\.\//, '');
}

/** Whether one target names this library or a file inside it. */
export function resolvesIntoLibrary(target) {
  const path = normalizeTarget(target);
  return path === LIBRARY_PATH || path.startsWith(`${LIBRARY_PATH}/`);
}

test('no tsconfig alias resolves into this library', () => {
  const config = JSON.parse(readFileSync(TSCONFIG_URL, 'utf8'));
  const paths = config.compilerOptions?.paths ?? {};
  const offenders = Object.entries(paths)
    .filter(([, targets]) => targets.some(resolvesIntoLibrary))
    .map(([alias]) => alias);

  assert.deepEqual(
    offenders,
    [],
    `tsconfig.base.json aliases ${offenders.join(', ')} into ${LIBRARY_PATH}. ` +
      'This library is Node only and the Angular apps compile every alias, so ' +
      'it is imported by a relative path. Remove the alias.'
  );
});

test('a target inside the library is recognized however it is spelled', () => {
  assert.equal(resolvesIntoLibrary(`./${LIBRARY_PATH}/src/index.mjs`), true);
  assert.equal(resolvesIntoLibrary(`${LIBRARY_PATH}/src/index.mjs`), true);
  assert.equal(
    resolvesIntoLibrary('.\\libs\\shared\\model-engines\\src'),
    true
  );
  assert.equal(resolvesIntoLibrary(`./${LIBRARY_PATH}`), true);
  assert.equal(resolvesIntoLibrary('./libs/shared/ui/src/index.ts'), false);
  assert.equal(
    resolvesIntoLibrary('./libs/shared/model-engines-x/a.ts'),
    false
  );
});
