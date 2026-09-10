import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyUsage, stripFence } from '../../model-engines/src/index.mjs';
import {
  decideRow,
  parseDecision,
  rowIdentity,
  runCuration,
  toPacket,
} from './orchestrator.mjs';

function sink() {
  const written = [];
  return {
    written,
    write: (text) => written.push(text),
    text: () => written.join(''),
  };
}

/** A slot driver that records the verbs it was asked for. */
function fakeSlots({ taken = [1], dumpFails = false } = {}) {
  const verbs = [];
  return {
    verbs,
    list: async () => {
      verbs.push('list');
      return taken;
    },
    up: async (slot, services) => {
      verbs.push(`up:${slot}:${services.join(',')}`);
    },
    down: async (slot) => {
      verbs.push(`down:${slot}`);
    },
    dumpCatalog: async (slot, path) => {
      verbs.push(`dump:${slot}`);
      if (dumpFails) {
        throw new Error('no container');
      }
      return path;
    },
  };
}

/** A decider whose rows and answers a test states outright. */
function fakeDecider({
  rows = [],
  startAnswer = null,
  startError = null,
} = {}) {
  const calls = [];
  const queue = [...rows];
  return {
    calls,
    start: async (options) => {
      calls.push({ command: 'start', options });
      if (startError) {
        throw startError;
      }
      return (
        startAnswer ?? {
          runId: 'r1',
          remaining: rows.length,
          prompt: 'THE RULES',
        }
      );
    },
    next: async () => {
      calls.push({ command: 'next' });
      return queue.shift() ?? { done: true, remaining: 0 };
    },
    decide: async (entryId, decision, options) => {
      calls.push({
        command: 'decide',
        entryId,
        decision,
        final: options?.final ?? false,
      });
      return { accepted: true, retryable: false, decision: 'LINK', entryId };
    },
    end: async (usage) => {
      calls.push({ command: 'end', usage });
      return {
        report: '/runs/x/report.json',
        counts: {},
        decided: rows.length,
      };
    },
  };
}

/** A model that answers whatever the test queued, in order. */
function fakeEngine(replies) {
  const prompts = [];
  const options = [];
  return {
    prompts,
    options,
    ask: async (prompt, opts = {}) => {
      prompts.push(prompt);
      options.push(opts);
      const reply = replies.shift();
      if (reply === undefined) {
        throw new Error('the test queued no more replies');
      }
      return { text: reply };
    },
  };
}

const ROW = {
  entry: { id: 'e1', name: 'Leche entera 1 L' },
  candidates: [{ itemId: 'i1', origin: 'catalog' }],
  eanMatch: null,
  remaining: 2,
};

test('the packet the model sees carries no count of the run', () => {
  const packet = toPacket(ROW);
  assert.ok(!('remaining' in packet));
  assert.deepEqual(Object.keys(packet), ['entry', 'candidates', 'eanMatch']);
});

test('a row is identified whichever decider answered it', () => {
  assert.deepEqual(rowIdentity(ROW), { id: 'e1', name: 'Leche entera 1 L' });
  assert.deepEqual(
    rowIdentity({ item: { id: 'i9', name: { es: 'Arroz', en: 'Rice' } } }),
    { id: 'i9', name: 'Arroz' }
  );
  assert.deepEqual(rowIdentity({ item: { id: 'i9' } }), {
    id: 'i9',
    name: 'i9',
  });
  assert.deepEqual(rowIdentity({}), { id: null, name: '(unnamed)' });
});

test('parseDecision takes an object and refuses everything else', () => {
  assert.deepEqual(parseDecision('```json\n{"a":1}\n```', { stripFence }), {
    a: 1,
  });
  assert.equal(parseDecision('I think it is a link.', { stripFence }), null);
  assert.equal(parseDecision('[1,2]', { stripFence }), null);
  assert.equal(parseDecision('"a string"', { stripFence }), null);
});

test('one row is one model call when the reply can be used', async () => {
  const decider = fakeDecider();
  const engine = fakeEngine([
    '{"decision":"LINK","itemId":"i1","confidence":0.95}',
  ]);
  const answer = await decideRow({
    row: ROW,
    prompt: 'THE RULES',
    schema: { type: 'object' },
    engine,
    decider,
    stripFence,
  });

  assert.equal(answer.accepted, true);
  assert.equal(engine.prompts.length, 1);
  // The packet alone in the user half, the rules in the system half, and the
  // rules never in both: sending them twice is what the split exists to stop.
  assert.match(engine.prompts[0], /^\{/);
  assert.ok(!engine.prompts[0].includes('THE RULES'));
  assert.equal(engine.options[0].system, 'THE RULES');
  assert.deepEqual(engine.options[0].schema, { type: 'object' });
  // The rules and the row, and nothing about the run.
  assert.ok(!engine.prompts[0].includes('remaining'));
  assert.deepEqual(decider.calls, [
    {
      command: 'decide',
      entryId: 'e1',
      decision: { decision: 'LINK', itemId: 'i1', confidence: 0.95 },
      final: false,
    },
  ]);
});

test('a reply that is not JSON is asked once more, then recorded as final', async () => {
  const decider = fakeDecider();
  const engine = fakeEngine([
    'I would link it.',
    '{"decision":"LINK","itemId":"i1","confidence":0.9}',
  ]);
  await decideRow({
    row: ROW,
    prompt: 'THE RULES',
    engine,
    decider,
    stripFence,
  });

  assert.equal(engine.prompts.length, 2);
  assert.match(
    engine.prompts[1],
    /could not be used: the reply is not one JSON object/
  );
  // Nothing was written on the first attempt, because it never reached `decide`.
  assert.equal(decider.calls.length, 1);
  assert.equal(decider.calls[0].final, true);
});

test('a decision the decider calls retryable is asked once more with its reason', async () => {
  const seen = [];
  const decider = {
    decide: async (entryId, decision, options) => {
      seen.push({ decision, final: options.final });
      return seen.length === 1
        ? {
            accepted: false,
            retryable: true,
            issues: [
              { code: 'MODEL_OUTPUT_INVALID', detail: 'confidence is missing' },
            ],
          }
        : { accepted: true, retryable: false };
    },
  };
  const engine = fakeEngine([
    '{"decision":"LINK","itemId":"i1"}',
    '{"decision":"LINK","itemId":"i1","confidence":0.95}',
  ]);
  const answer = await decideRow({
    row: ROW,
    prompt: 'RULES',
    engine,
    decider,
    stripFence,
  });

  assert.equal(answer.accepted, true);
  assert.match(engine.prompts[1], /confidence is missing/);
  assert.equal(seen[0].final, false);
  assert.equal(seen[1].final, true);
});

test('a second unusable reply is still a decided row', async () => {
  const seen = [];
  const decider = {
    decide: async (entryId, decision, options) => {
      seen.push({ decision, final: options.final });
      return { accepted: false, retryable: false, decision: 'REVIEW' };
    },
  };
  const engine = fakeEngine(['prose', 'more prose']);
  const answer = await decideRow({
    row: ROW,
    prompt: 'RULES',
    engine,
    decider,
    stripFence,
  });

  assert.equal(answer.decision, 'REVIEW');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].final, true);
  assert.equal(seen[0].decision.modelReply, 'more prose');
});

test('the run picks a free slot, brings up three services, walks and tears down', async () => {
  const slots = fakeSlots({ taken: [0, 1, 2] });
  const decider = fakeDecider({
    rows: [
      ROW,
      { entry: { id: 'e2', name: 'Pan' }, candidates: [], remaining: 1 },
    ],
  });
  const stdout = sink();
  const stderr = sink();
  const waited = [];
  const usage = emptyUsage();

  const result = await runCuration({
    slots,
    makeDeciderFor: () => decider,
    engine: fakeEngine([
      '{"decision":"LINK","itemId":"i1","confidence":0.95}',
      '{"decision":"CREATE","confidence":0.95}',
    ]),
    runDir: '/runs/x',
    mainUrl: 'http://localhost:3000',
    mainUser: 'dev-admin',
    model: 'claude-sonnet-5',
    waitForGateway: async ({ url }) => waited.push(url),
    stripFence,
    stdout,
    stderr,
    dumpPath: '/runs/x/dump.sql',
    usage,
  });

  assert.equal(result.slot, 3);
  assert.deepEqual(slots.verbs, [
    'list',
    'up:3:gateway,auth,catalog',
    'down:3',
  ]);
  assert.deepEqual(waited, ['http://localhost:43200']);
  assert.equal(decider.calls[0].options.rehearsalUrl, 'http://localhost:43200');

  // stdout carries one JSON line per decided row and nothing else.
  const lines = stdout.text().trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]).entryId, 'e1');
  assert.deepEqual(JSON.parse(lines[1]).entryId, 'e2');

  // Progress is stderr, as `n/total - name`.
  assert.match(stderr.text(), /1\/2 - Leche entera 1 L/);
  assert.match(stderr.text(), /2\/2 - Pan/);

  // The usage the run accumulated reaches `end`.
  assert.equal(decider.calls.at(-1).command, 'end');
  assert.equal(decider.calls.at(-1).usage, usage);
});

test('a login that fails ends the run before the first model call', async () => {
  const slots = fakeSlots();
  const engine = fakeEngine([]);
  const stderr = sink();

  await assert.rejects(
    () =>
      runCuration({
        slots,
        makeDeciderFor: () =>
          fakeDecider({
            startError: new Error('start failed: rehearsal login failed'),
          }),
        engine,
        runDir: '/runs/x',
        mainUrl: 'http://localhost:3000',
        waitForGateway: async () => undefined,
        stripFence,
        stdout: sink(),
        stderr,
        dumpPath: '/runs/x/dump.sql',
      }),
    /rehearsal login failed/
  );

  assert.equal(engine.prompts.length, 0);
  // The dump runs before the teardown, and the teardown runs anyway.
  assert.deepEqual(slots.verbs, [
    'list',
    'up:2:gateway,auth,catalog',
    'dump:2',
    'down:2',
  ]);
});

test('a mid run failure dumps the rehearsal catalog and still tears the slot down', async () => {
  const slots = fakeSlots();
  const decider = fakeDecider({ rows: [ROW] });
  decider.decide = async () => {
    throw new Error('the gateway answered 500');
  };
  const stderr = sink();

  await assert.rejects(
    () =>
      runCuration({
        slots,
        makeDeciderFor: () => decider,
        engine: fakeEngine([
          '{"decision":"LINK","itemId":"i1","confidence":0.95}',
        ]),
        runDir: '/runs/x',
        mainUrl: 'http://localhost:3000',
        waitForGateway: async () => undefined,
        stripFence,
        stdout: sink(),
        stderr,
        dumpPath: '/runs/x/dump.sql',
      }),
    /answered 500/
  );

  assert.deepEqual(slots.verbs, [
    'list',
    'up:2:gateway,auth,catalog',
    'dump:2',
    'down:2',
  ]);
  assert.match(stderr.text(), /dumped to \/runs\/x\/dump\.sql/);
});

test('a dump that fails does not stop the teardown', async () => {
  const slots = fakeSlots({ dumpFails: true });
  const stderr = sink();

  await assert.rejects(
    () =>
      runCuration({
        slots,
        makeDeciderFor: () => fakeDecider({ startError: new Error('nope') }),
        engine: fakeEngine([]),
        runDir: '/runs/x',
        mainUrl: 'http://a',
        waitForGateway: async () => undefined,
        stripFence,
        stdout: sink(),
        stderr,
        dumpPath: '/runs/x/dump.sql',
      }),
    /nope/
  );

  assert.ok(slots.verbs.includes('down:2'));
  assert.match(stderr.text(), /could not be dumped: no container/);
});

// The checkout is never configured for the rehearsal slot, so there is nothing
// to put back afterwards: the teardown is one verb, and it names the slot it
// took rather than whichever one this checkout claims.
test('the teardown names the slot it took and restores no claim', async () => {
  const slots = fakeSlots({ taken: [1] });
  await runCuration({
    slots,
    makeDeciderFor: () => fakeDecider({ rows: [] }),
    engine: fakeEngine([]),
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });
  assert.deepEqual(slots.verbs, [
    'list',
    'up:2:gateway,auth,catalog',
    'down:2',
  ]);
});

test('every slot taken stops the run before anything is started', async () => {
  const slots = fakeSlots({ taken: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  await assert.rejects(
    () =>
      runCuration({
        slots,
        makeDeciderFor: () => fakeDecider(),
        engine: fakeEngine([]),
        runDir: '/runs/x',
        mainUrl: 'http://a',
        waitForGateway: async () => undefined,
        stripFence,
        stdout: sink(),
        stderr: sink(),
      }),
    /Every slot from 1 to 9 is taken/
  );
  assert.deepEqual(slots.verbs, ['list']);
});

// ---------------------------------------------------------------------------
// A stopped run (Ctrl+C)
// ---------------------------------------------------------------------------

test('a stopped run writes the report over the rows it decided', async () => {
  const slots = fakeSlots({ taken: [1] });
  const controller = new AbortController();
  const decider = fakeDecider({
    rows: [
      { ...ROW, remaining: 3 },
      { ...ROW, remaining: 2 },
      { ...ROW, remaining: 1 },
    ],
  });
  const stderr = sink();

  // The keystroke lands while the model is answering the first row, which is
  // where a run spends nearly all of its time.
  const engine = {
    ask: async () => {
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      return { text: JSON.stringify({ decision: 'LINK' }) };
    },
  };

  const outcome = await runCuration({
    slots,
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr,
    dumpPath: '/runs/x/dump.sql',
    signal: controller.signal,
  });

  assert.equal(outcome.stopped, true);
  assert.equal(outcome.report.report, '/runs/x/report.json');
  assert.equal(
    decider.calls.filter((call) => call.command === 'end').length,
    1
  );
  // One row decided, then the walk stopped rather than asking for a second.
  assert.equal(
    decider.calls.filter((call) => call.command === 'next').length,
    1
  );
  assert.ok(slots.verbs.includes('down:2'));
  // A stop is not a failure, so the rehearsal catalog is not dumped.
  assert.ok(!slots.verbs.some((verb) => verb.startsWith('dump:')));
  assert.match(stderr.text(), /stopped: the report covers/);
});

// Ctrl+C reaches every process in the terminal, so the child that was in
// flight dies of the keystroke and reports it in its own words. Once the run
// is stopping, that error is the stop.
test('a step that fails while the run is stopping is the stop, not a failure', async () => {
  const slots = fakeSlots({ taken: [1] });
  const controller = new AbortController();
  const decider = fakeDecider({ rows: [ROW, ROW] });
  decider.next = async () => {
    controller.abort(new Error('the run was stopped with Ctrl+C'));
    throw new Error('next failed: exit 1');
  };

  const outcome = await runCuration({
    slots,
    makeDeciderFor: () => decider,
    engine: fakeEngine([]),
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
    signal: controller.signal,
  });

  assert.equal(outcome.stopped, true);
  assert.equal(outcome.report.report, '/runs/x/report.json');
  assert.ok(slots.verbs.includes('down:2'));
});

test('a stop before the run opens takes the slot down and reports nothing', async () => {
  const slots = fakeSlots({ taken: [1] });
  const controller = new AbortController();
  const stderr = sink();
  const decider = fakeDecider({ rows: [ROW] });

  const outcome = await runCuration({
    slots,
    makeDeciderFor: () => decider,
    engine: fakeEngine([]),
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async ({ signal }) => {
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      throw signal.reason;
    },
    stripFence,
    stdout: sink(),
    stderr,
    dumpPath: '/runs/x/dump.sql',
    signal: controller.signal,
  });

  assert.equal(outcome.stopped, true);
  assert.equal(outcome.report, null);
  assert.equal(outcome.runId, null);
  assert.deepEqual(decider.calls, []);
  assert.ok(slots.verbs.includes('down:2'));
  assert.ok(!slots.verbs.some((verb) => verb.startsWith('dump:')));
  assert.match(stderr.text(), /stopped before the run opened/);
});

test('the slot is named to the caller before it is brought up', async () => {
  const seen = [];
  await runCuration({
    slots: fakeSlots({ taken: [1, 2] }),
    makeDeciderFor: () => fakeDecider({ rows: [] }),
    engine: fakeEngine([]),
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
    onSlot: (slot) => seen.push(slot),
  });
  assert.deepEqual(seen, [3]);
});
