import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildOperations as buildGroupOperations } from '../../groups/src/commands.mjs';
import {
  applyDecisions,
  loadDeciderOperations,
  partPath,
  splitDecisions,
} from './apply.mjs';
import { readDecisions, writeRunFile } from './run-files.mjs';

function sink() {
  const written = [];
  return {
    written,
    write: (text) => written.push(text),
    text: () => written.join(''),
  };
}

const HEADER = { header: true, runId: 'r1', mainUrl: 'http://main:3000' };

/** A decisions file in a directory of its own. */
function decisionsFile(records, header = HEADER) {
  const dir = mkdtempSync(join(tmpdir(), 'curation-apply-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(
    file,
    [header, ...records].map((line) => `${JSON.stringify(line)}\n`).join('')
  );
  return { dir, file };
}

const link = (id) => ({
  entryId: id,
  decision: 'LINK',
  itemId: `i-${id}`,
  expect: {},
});
const create = (id) => ({
  entryId: id,
  decision: 'CREATE',
  ref: `ref-${id}`,
  item: { nameEs: id },
  expect: {},
});
const linkByRef = (id, ref) => ({
  entryId: id,
  decision: 'LINK',
  itemRef: ref,
  expect: {},
});

/** One operation per non REVIEW record, which is what the suggestions decider builds. */
const countOperations = (records) =>
  records.filter((record) => record.decision !== 'REVIEW').map(() => ({}));

/** A decider per request, answering from a list and recording what it was asked. */
function fakeDeciders(answers) {
  const asked = [];
  return {
    asked,
    makeDeciderFor: (implementation) => ({
      apply: async (options) => {
        asked.push({ implementation, ...options });
        const answer = answers.shift() ?? { applied: true };
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      },
    }),
  };
}

test('a split keeps a creation with every row that names its ref', () => {
  const records = [
    create('a'),
    link('b'),
    create('c'),
    linkByRef('d', 'ref-a'),
    linkByRef('e', 'ref-c'),
    link('f'),
  ];
  const parts = splitDecisions({
    records,
    buildOperations: countOperations,
    max: 3,
  });
  const ids = parts.map((part) => part.map((record) => record.entryId));
  assert.deepEqual(ids, [
    ['a', 'b', 'd'],
    ['c', 'e', 'f'],
  ]);
  for (const part of parts) {
    assert.ok(countOperations(part).length <= 3);
  }
});

test('a split of groups decisions counts two operations for a new group', () => {
  const group = (id) => ({
    itemId: id,
    decision: 'CREATE_GROUP',
    ref: `ref-${id}`,
    group: { nameEs: id, nameEn: id, slug: id, referenceUnit: 'KG' },
    expect: {},
  });
  const assign = (id, ref) => ({
    itemId: id,
    decision: 'ASSIGN',
    groupRef: ref,
    expect: {},
  });
  const parts = splitDecisions({
    records: [group('a'), assign('b', 'ref-a'), group('c')],
    buildOperations: buildGroupOperations,
    max: 3,
  });
  assert.deepEqual(
    parts.map((part) => part.map((record) => record.itemId)),
    [['a', 'b'], ['c']]
  );
});

test('a ref whose rows alone are over the cap cannot be split', () => {
  assert.throws(
    () =>
      splitDecisions({
        records: [
          create('a'),
          linkByRef('b', 'ref-a'),
          linkByRef('c', 'ref-a'),
        ],
        buildOperations: countOperations,
        max: 2,
      }),
    /ref-a and the rows that name it are 3 operations, over the cap of 2/
  );
});

test('a file under the cap is sent whole, to the url its header names', async () => {
  const { dir, file } = decisionsFile([
    link('a'),
    { entryId: 'b', decision: 'REVIEW' },
  ]);
  const deciders = fakeDeciders([{ applied: true, operations: 1 }]);
  const stdout = sink();
  const stderr = sink();

  await applyDecisions({
    file,
    makeDeciderFor: deciders.makeDeciderFor,
    stdout,
    stderr,
  });

  // No --implementation, no --main-url: the records say suggestions and the
  // header says where the run was decided against.
  assert.deepEqual(deciders.asked, [
    {
      implementation: 'suggestions',
      mainUrl: 'http://main:3000',
      file,
      mainUser: null,
    },
  ]);
  assert.match(stdout.text(), /"operations":1/);
  assert.match(stderr.text(), /applied 1 operations to http:\/\/main:3000/);
  rmSync(dir, { recursive: true, force: true });
});

test('the implementation the run recorded is the one that applies it', async () => {
  const { dir, file } = decisionsFile([
    { itemId: 'i1', decision: 'ASSIGN', groupId: 'g1', expect: {} },
  ]);
  writeRunFile(dir, { implementation: 'groups' });
  const deciders = fakeDeciders([{ applied: true }]);
  await applyDecisions({
    file,
    makeDeciderFor: deciders.makeDeciderFor,
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(deciders.asked[0].implementation, 'groups');
  rmSync(dir, { recursive: true, force: true });
});

test('a run of reviews only has nothing to apply and asks no decider', async () => {
  const { dir, file } = decisionsFile([
    { itemId: 'i1', decision: 'REVIEW', issues: [] },
    { itemId: 'i2', decision: 'REVIEW', issues: [] },
  ]);
  const deciders = fakeDeciders([]);
  const stderr = sink();
  const answer = await applyDecisions({
    file,
    makeDeciderFor: deciders.makeDeciderFor,
    stdout: sink(),
    stderr,
  });
  assert.deepEqual(answer, { operations: 0, parts: 0 });
  assert.deepEqual(deciders.asked, []);
  assert.match(
    stderr.text(),
    /nothing to apply: every one of the 2 decided rows is a REVIEW/
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a file over the cap goes as parts, each an ordinary decisions file', async () => {
  const { dir, file } = decisionsFile([
    link('a'),
    link('b'),
    link('c'),
    link('d'),
    link('e'),
  ]);
  const deciders = fakeDeciders([]);
  const stderr = sink();

  const answer = await applyDecisions({
    file,
    makeDeciderFor: deciders.makeDeciderFor,
    stdout: sink(),
    stderr,
    loadOperations: async () => ({
      buildOperations: countOperations,
      maxOperations: 2,
    }),
  });

  assert.deepEqual(answer, { operations: 5, parts: 3 });
  assert.deepEqual(
    deciders.asked.map((call) => call.file),
    [partPath(file, 0, 3), partPath(file, 1, 3), partPath(file, 2, 3)]
  );
  assert.match(partPath(file, 1, 3), /decisions\.part-2-of-3\.jsonl$/);
  // Each part carries the original header, so the decider checks it the same way.
  const second = readDecisions(partPath(file, 1, 3));
  assert.deepEqual(second.header, HEADER);
  assert.deepEqual(
    second.records.map((record) => record.entryId),
    ['c', 'd']
  );
  assert.match(stderr.text(), /in 3 requests/);
  rmSync(dir, { recursive: true, force: true });
});

test('a refused part stops the rest and names what to send next', async () => {
  const { dir, file } = decisionsFile([link('a'), link('b'), link('c')]);
  const deciders = fakeDeciders([
    { applied: true },
    new Error('apply failed: {"applied":false}'),
  ]);
  const stderr = sink();

  await assert.rejects(
    () =>
      applyDecisions({
        file,
        mainUser: 'curator',
        passwordGiven: true,
        makeDeciderFor: deciders.makeDeciderFor,
        stdout: sink(),
        stderr,
        loadOperations: async () => ({
          buildOperations: countOperations,
          maxOperations: 1,
        }),
      }),
    /apply failed/
  );

  assert.equal(deciders.asked.length, 2);
  const text = stderr.text();
  assert.match(text, /part 2 of 3 was refused\. Parts 1 to 1 landed/);
  assert.ok(text.includes('--apply'));
  assert.ok(
    text.includes(
      'decisions.part-2-of-3.jsonl --main-user curator --main-password <password>'
    )
  );
  assert.ok(text.includes('decisions.part-3-of-3.jsonl'));
  rmSync(dir, { recursive: true, force: true });
});

test('a file that is not there, or has no header, is refused before anything is sent', async () => {
  const deciders = fakeDeciders([]);
  await assert.rejects(
    () =>
      applyDecisions({
        file: join(tmpdir(), 'no-such-dir', 'decisions.jsonl'),
        makeDeciderFor: deciders.makeDeciderFor,
        stdout: sink(),
        stderr: sink(),
      }),
    /does not exist/
  );
  const dir = mkdtempSync(join(tmpdir(), 'curation-apply-'));
  const file = join(dir, 'decisions.jsonl');
  writeFileSync(file, `${JSON.stringify(link('a'))}\n`);
  await assert.rejects(
    () =>
      applyDecisions({
        file,
        makeDeciderFor: deciders.makeDeciderFor,
        stdout: sink(),
        stderr: sink(),
      }),
    /has no header line/
  );
  assert.deepEqual(deciders.asked, []);
  assert.ok(existsSync(file));
  rmSync(dir, { recursive: true, force: true });
});

test('the operation builders are each decider own, with the cap it enforces', async () => {
  for (const implementation of ['suggestions', 'groups']) {
    const { buildOperations, maxOperations } =
      await loadDeciderOperations(implementation);
    assert.equal(typeof buildOperations, 'function');
    assert.equal(maxOperations, 1000);
  }
});
