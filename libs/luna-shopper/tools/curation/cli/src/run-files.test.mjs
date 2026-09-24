import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadRun as loadGroupsRun } from '../../groups/src/run-dir.mjs';
import { loadRun as loadSuggestionsRun } from '../../suggestions/src/run-dir.mjs';
import {
  readDecisions,
  readRunFile,
  recordRowFailure,
  replayCreations,
  runFileBeside,
  sniffImplementation,
  writeRunFile,
} from './run-files.mjs';

/** A run directory holding a header, the given records and a state. */
function runDir(records = [], state = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'curation-run-files-'));
  const header = { header: true, runId: 'r1', mainUrl: 'http://main' };
  writeFileSync(
    join(dir, 'decisions.jsonl'),
    [header, ...records].map((line) => `${JSON.stringify(line)}\n`).join('')
  );
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      runId: 'r1',
      mainUrl: 'http://main',
      rehearsalUrl: 'http://old-slot',
      decidedIds: [],
      createdRefs: {},
      ...state,
    })
  );
  return dir;
}

const NOW = () => new Date('2026-09-24T10:00:00Z');

test('a failed suggestions row is a REVIEW the decider reads as decided', () => {
  const dir = runDir();
  const record = recordRowFailure({
    implementation: 'suggestions',
    runDir: dir,
    row: {
      entry: { id: 'e7', name: 'Leche entera 1 L' },
      candidates: [{}, {}],
    },
    error: new Error('decide failed: GET /v1/admin/catalog/items answered 400'),
    now: NOW,
  });

  assert.deepEqual(record.issues, [
    {
      code: 'ROW_FAILED',
      detail: 'decide failed: GET /v1/admin/catalog/items answered 400',
    },
  ]);
  assert.equal(record.decision, 'REVIEW');
  assert.equal(record.entryName, 'Leche entera 1 L');
  assert.equal(record.candidateCount, 2);

  // The decider's own reading of the directory, which is what `next` skips on.
  const { state, records } = loadSuggestionsRun(dir);
  assert.ok(state.decidedIds.includes('e7'));
  assert.equal(records.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('a failed groups row is a REVIEW the groups decider reads as decided', () => {
  const dir = runDir();
  const record = recordRowFailure({
    implementation: 'groups',
    runDir: dir,
    row: { item: { id: 'i3', nameEs: 'Arroz redondo', nameEn: 'Round rice' } },
    error: 'the decider exited with code 1',
    now: NOW,
  });

  assert.equal(record.itemId, 'i3');
  assert.equal(record.itemName, 'Arroz redondo');
  assert.equal(record.issues[0].code, 'ROW_FAILED');
  assert.ok(loadGroupsRun(dir).state.decidedIds.includes('i3'));
  rmSync(dir, { recursive: true, force: true });
});

test('a row the decider recorded before it threw is not recorded twice', () => {
  const dir = runDir([{ entryId: 'e1', decision: 'LINK', itemId: 'i1' }]);
  const record = recordRowFailure({
    implementation: 'suggestions',
    runDir: dir,
    row: { entry: { id: 'e1', name: 'x' } },
    error: new Error('late'),
  });
  assert.equal(record.decision, 'LINK');
  assert.equal(readDecisions(join(dir, 'decisions.jsonl')).records.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('a failure is cut to a length a report can hold', () => {
  const dir = runDir();
  const record = recordRowFailure({
    implementation: 'suggestions',
    runDir: dir,
    row: { entry: { id: 'e1', name: 'x' } },
    error: new Error('x'.repeat(5000)),
  });
  assert.equal(record.issues[0].detail.length, 2000);
  rmSync(dir, { recursive: true, force: true });
});

/** A rehearsal gateway that answers every create with a new id, in order. */
function fakeRehearsal({ refuse = null } = {}) {
  const writes = [];
  let next = 1;
  return {
    writes,
    makeSession: ({ baseUrl }) => ({
      fetch: async (path, init) => {
        writes.push({ baseUrl, path, body: init.body });
        if (refuse && JSON.stringify(init.body).includes(refuse)) {
          throw new Error('POST answered 409: slug taken');
        }
        return { id: `new-${next++}` };
      },
    }),
  };
}

test('a resume writes every creation into the new slot and repoints the refs', async () => {
  const dir = runDir(
    [
      {
        entryId: 'e1',
        decision: 'CREATE',
        ref: 'ref-e1',
        rehearsalItemId: 'old-1',
        item: { nameEs: 'Leche', nameEn: 'Milk', brand: 'Pascual' },
      },
      { entryId: 'e2', decision: 'LINK', itemRef: 'ref-e1' },
      { entryId: 'e3', decision: 'REVIEW' },
      {
        entryId: 'e4',
        decision: 'CREATE',
        ref: 'ref-e4',
        rehearsalItemId: 'old-4',
        item: { nameEs: 'Pan', nameEn: 'Bread' },
      },
    ],
    { createdRefs: { 'ref-e1': 'old-1', 'ref-e4': 'old-4' } }
  );
  const rehearsal = fakeRehearsal();

  const answer = await replayCreations({
    implementation: 'suggestions',
    runDir: dir,
    rehearsalUrl: 'http://localhost:43100',
    makeSession: rehearsal.makeSession,
  });

  assert.deepEqual(answer, { created: 2, decided: 4 });
  assert.deepEqual(
    rehearsal.writes.map((write) => [write.baseUrl, write.path]),
    [
      ['http://localhost:43100', '/v1/admin/catalog/items'],
      ['http://localhost:43100', '/v1/admin/catalog/items'],
    ]
  );
  // The body is the decider's own, so the slot holds what the walk made.
  assert.deepEqual(rehearsal.writes[0].body.name, { es: 'Leche', en: 'Milk' });

  // What the decider reads now: the new slot, and the refs on its ids.
  const { state, records, header } = loadSuggestionsRun(dir);
  assert.equal(state.rehearsalUrl, 'http://localhost:43100');
  assert.deepEqual(state.createdRefs, { 'ref-e1': 'new-1', 'ref-e4': 'new-2' });
  assert.equal(header.runId, 'r1');
  // Everything `--apply` reads is exactly as it was.
  assert.deepEqual(
    records.map((record) => [
      record.entryId,
      record.decision,
      record.ref ?? record.itemRef ?? null,
    ]),
    [
      ['e1', 'CREATE', 'ref-e1'],
      ['e2', 'LINK', 'ref-e1'],
      ['e3', 'REVIEW', null],
      ['e4', 'CREATE', 'ref-e4'],
    ]
  );
  assert.equal(records[0].rehearsalItemId, 'new-1');
  rmSync(dir, { recursive: true, force: true });
});

test('a groups resume writes its groups and repoints them', async () => {
  const dir = runDir([
    {
      itemId: 'i1',
      decision: 'CREATE_GROUP',
      ref: 'ref-i1',
      rehearsalGroupId: 'old',
      group: {
        nameEs: 'Arroz',
        nameEn: 'Rice',
        slug: 'arroz',
        referenceUnit: 'KG',
      },
    },
    { itemId: 'i2', decision: 'ASSIGN', groupRef: 'ref-i1' },
  ]);
  const rehearsal = fakeRehearsal();
  await replayCreations({
    implementation: 'groups',
    runDir: dir,
    rehearsalUrl: 'http://localhost:43200',
    makeSession: rehearsal.makeSession,
  });
  assert.equal(rehearsal.writes[0].path, '/v1/admin/catalog/product-groups');
  assert.equal(rehearsal.writes[0].body.slug, 'arroz');
  assert.deepEqual(loadGroupsRun(dir).state.createdRefs, { 'ref-i1': 'new-1' });
  rmSync(dir, { recursive: true, force: true });
});

test('a creation the new slot refuses stops the resume and names the ref', async () => {
  const dir = runDir([
    {
      entryId: 'e1',
      decision: 'CREATE',
      ref: 'ref-e1',
      rehearsalItemId: 'old-1',
      item: { nameEs: 'Leche' },
    },
  ]);
  const before = readFileSync(join(dir, 'decisions.jsonl'), 'utf8');
  await assert.rejects(
    () =>
      replayCreations({
        implementation: 'suggestions',
        runDir: dir,
        rehearsalUrl: 'http://s',
        makeSession: fakeRehearsal({ refuse: 'Leche' }).makeSession,
      }),
    /refused ref-e1.*slug taken/
  );
  // Nothing was rewritten on the way to the refusal.
  assert.equal(readFileSync(join(dir, 'decisions.jsonl'), 'utf8'), before);
  rmSync(dir, { recursive: true, force: true });
});

test('the run file round trips, and is found beside a decisions file', () => {
  const dir = runDir();
  assert.equal(readRunFile(dir), null);
  writeRunFile(dir, { implementation: 'groups', opened: { runId: 'r1' } });
  assert.equal(readRunFile(dir).implementation, 'groups');
  assert.equal(runFileBeside(join(dir, 'decisions.jsonl')).opened.runId, 'r1');
  rmSync(dir, { recursive: true, force: true });
});

test('a decisions file names its decider by the shape of its records', () => {
  assert.equal(sniffImplementation([{ entryId: 'e1' }]), 'suggestions');
  assert.equal(sniffImplementation([{ itemId: 'i1' }]), 'groups');
  assert.equal(sniffImplementation([]), null);
});
