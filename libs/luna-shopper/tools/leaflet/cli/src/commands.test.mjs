import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkPageCommand,
  finishCommand,
  formatPageList,
  resumeCommand,
  shellWord,
  updateBaselineCommand,
} from './commands.mjs';
import { localEngineNotice } from './notice.mjs';
import { parsePages } from './run.mjs';

test('a page list is written the way --pages reads it back', () => {
  assert.equal(formatPageList([5, 6, 7, 9, 12, 13]), '5-7,9,12-13');
  assert.equal(formatPageList([6, 5]), '5-6');
  assert.equal(formatPageList([]), '');
  assert.deepEqual(
    parsePages(formatPageList([1, 2, 3, 31]), 40),
    [1, 2, 3, 31]
  );
});

test('the printed resume command carries --pages when the run was not all pages', () => {
  const partial = resumeCommand({
    outDir: 'tmp/leaflet/el-jamon-2026-09-24',
    engineName: 'claude',
    model: 'sonnet',
    pages: [5, 6],
    pageCount: 40,
  });
  assert.equal(
    partial,
    'npx nx run luna-shopper/leaflet-cli:read -- --out tmp/leaflet/el-jamon-2026-09-24 --resume --engine claude --model sonnet --pages 5-6'
  );
  const whole = resumeCommand({
    outDir: 'tmp/x',
    engineName: 'manual',
    model: null,
    pages: [1, 2, 3],
    pageCount: 3,
  });
  assert.equal(
    whole,
    'npx nx run luna-shopper/leaflet-cli:read -- --out tmp/x --resume --engine manual'
  );
});

test('a printed path pastes as is: forward slashes, and quoted when it has a space', () => {
  assert.equal(shellWord('tmp\\leaflet\\x'), 'tmp/leaflet/x');
  assert.equal(shellWord('C:/My Leaflets/x'), "'C:/My Leaflets/x'");
  assert.equal(
    checkPageCommand({ outDir: 'tmp\\x', page: 5 }),
    'npx nx run luna-shopper/leaflet-cli:read -- --out tmp/x --check-page 5'
  );
  assert.equal(
    finishCommand({ outDir: 'tmp/x' }),
    'npx nx run luna-shopper/leaflet-cli:read -- --out tmp/x --finish'
  );
});

test('the baseline command is the build with --update-baseline, whole', () => {
  const command = updateBaselineCommand({
    importDir: 'tmp/x/import',
    leafletPath: 'tmp/x/import/leaflet.json',
    document: 'tmp/x/el-jamon.harvest-document.json',
    slug: 'el-jamon',
    // The workspace root, where nx runs the command.
    cwd: fileURLToPath(new URL('../../../../../../', import.meta.url)),
  });
  assert.equal(
    command,
    'node libs/luna-shopper/tools/leaflet/cli/src/build-document.mjs --readings tmp/x/import --leaflet tmp/x/import/leaflet.json --chain el-jamon --out tmp/x/el-jamon.harvest-document.json --update-baseline'
  );
});

test('the local engine notice says local vision models are unreliable on leaflets', () => {
  assert.match(
    localEngineNotice('ollama', 'gemma4:12b'),
    /Local vision models are unreliable on leaflets/
  );
});
