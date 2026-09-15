import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyUsage,
  handleAbandoned,
  stripFence,
} from '../../../../../shared/model-engines/src/index.mjs';
import {
  decideRow,
  fetchBatch,
  parseDecision,
  roundWidth,
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

// ---------------------------------------------------------------------------
// The walk that asks four at a time (plan 0002)
// ---------------------------------------------------------------------------

/** A row of a batch: the packet, with no count of the run on it. */
function batchRow(id, name) {
  return { entry: { id, name }, candidates: [], eanMatch: null };
}

/**
 * A decider that hands out whole batches, as `next --count` does.
 *
 * `decide` answers whatever the test's `answers` map holds for the entry it is
 * called about, taking one answer per call, and an accepted decision otherwise.
 */
function fakeBatchDecider({
  batches = [],
  total = 0,
  answers = {},
  width = 20,
} = {}) {
  const calls = [];
  const queue = batches.map((rows) => [...rows]);
  const pending = new Map(
    Object.entries(answers).map(([id, list]) => [id, [...list]])
  );
  let left = total;
  return {
    calls,
    start: async (options) => {
      calls.push({ command: 'start', options });
      return {
        runId: 'r1',
        remaining: total,
        prompt: 'THE RULES',
        ...(width ? { batches: width } : {}),
      };
    },
    next: async (count) => {
      calls.push({ command: 'next', count: count ?? null });
      const rows = queue.shift() ?? [];
      const remaining = left;
      left -= rows.length;
      if (count) {
        return { rows, remaining };
      }
      // Asked without a count it answers one row, which is the shape the
      // subcommand has always answered and the shape `curation-groups` still
      // answers whatever the flag says.
      return rows.length === 0
        ? { done: true, remaining: 0 }
        : { ...rows[0], remaining };
    },
    decide: async (entryId, decision, options) => {
      calls.push({
        command: 'decide',
        entryId,
        decision,
        final: options?.final ?? false,
      });
      const answer = pending.get(entryId)?.shift();
      return answer ?? { accepted: true, retryable: false, entryId };
    },
    end: async (usage) => {
      calls.push({ command: 'end', usage });
      return { report: '/runs/x/report.json', counts: {}, decided: 0 };
    },
  };
}

/**
 * An engine that holds `batchSize` questions at a time.
 *
 * A queued reply is a string, or an entry of its own for the case `askEach`
 * exists to express: one prompt the engine gave up on while the rest answered.
 *
 * `batches` is one entry per call, which is how a test says whether the re-asks
 * of a round were sent together or one at a time. `roundSize` is passed only by
 * a test about the width, because most of them want the width to be the number
 * they already named.
 */
function fakeBatchEngine(replies, batchSize = 4, { roundSize = null } = {}) {
  const prompts = [];
  const batches = [];
  const options = [];
  const entryOf = (reply) => {
    if (reply === undefined) {
      throw new Error('the test queued no more replies');
    }
    return typeof reply === 'string' ? { text: reply } : reply;
  };
  const engine = {
    batchSize,
    ...(roundSize === null ? {} : { roundSize }),
    prompts,
    batches,
    options,
    ask: async (prompt, opts = {}) => {
      prompts.push(prompt);
      options.push(opts);
      const entry = entryOf(replies.shift());
      if (entry.error) {
        throw entry.error;
      }
      return entry;
    },
    askEach: (bodies, opts = {}) => {
      batches.push(bodies);
      return bodies.map((body) => {
        prompts.push(body);
        options.push(opts);
        return Promise.resolve(entryOf(replies.shift()));
      });
    },
    askMany: async (bodies, opts = {}) =>
      Promise.all(engine.askEach(bodies, opts)),
  };
  return engine;
}

const LINKED = '{"decision":"LINK","itemId":"i1","confidence":0.95}';

test('a width of one asks the decider for the row it always asked for', async () => {
  const seen = [];
  const decider = {
    next: async (count) => {
      seen.push(count);
      return ROW;
    },
  };
  assert.deepEqual(await fetchBatch(decider, 1), {
    rows: [ROW],
    remaining: 2,
  });
  // No count reaches the decider, so the subcommand is the one it has always
  // been rather than `next --count 1`.
  assert.deepEqual(seen, [undefined]);

  assert.deepEqual(
    await fetchBatch({ next: async () => ({ done: true, remaining: 0 }) }, 1),
    { rows: [], remaining: 0 }
  );
});

test('a batch of four with no collisions asks four times and records four in order', async () => {
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 4,
  });
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED]);
  const stdout = sink();
  const stderr = sink();

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout,
    stderr,
  });

  // One call for the four rows, and four questions inside it.
  assert.equal(engine.batches.length, 1);
  assert.equal(engine.batches[0].length, 4);
  assert.equal(engine.prompts.length, 4);
  assert.deepEqual(
    decider.calls
      .filter((call) => call.command === 'decide')
      .map((call) => call.entryId),
    ['e1', 'e2', 'e3', 'e4']
  );
  // The width reaches the decider, which is the only thing that decides it.
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [4, 4]
  );
  assert.equal(stdout.text().trim().split('\n').length, 4);
  assert.match(stderr.text(), /1\/4 - Producto e1/);
  assert.match(stderr.text(), /4\/4 - Producto e4/);
});

test('a batch whose third row goes stale records four, and asks once more', async () => {
  const refreshed = {
    entry: { id: 'e3', name: 'Producto e3' },
    candidates: [{ ref: 'ref-e2', origin: 'run' }],
    eanMatch: null,
    remaining: 2,
  };
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 4,
    answers: {
      e3: [
        { accepted: false, retryable: false, stale: true, packet: refreshed },
        { accepted: true, retryable: false, entryId: 'e3' },
      ],
    },
  });
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED, LINKED]);

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  // Four in the round and one more for the row that was asked the wrong
  // question, which is what a collision costs. The re-ask is its own pass over
  // the round rather than a request in the middle of the decide loop.
  assert.deepEqual(
    engine.batches.map((bodies) => bodies.length),
    [4, 1]
  );
  assert.equal(engine.prompts.length, 5);
  assert.match(engine.prompts[4], /ref-e2/);
  // The re-ask is the packet alone, not a retry: it carries no reproach.
  assert.ok(!engine.prompts[4].includes('could not be used'));

  const decides = decider.calls.filter((call) => call.command === 'decide');
  // The stale row waits for the rest of its round and is re-asked at the end of
  // it (plan 0004), so it is recorded last rather than in its own place. The
  // round is composed so that no two of its rows can be about the same product,
  // which is what makes the order of one round's rows free.
  assert.deepEqual(
    decides.map((call) => call.entryId),
    ['e1', 'e2', 'e3', 'e4', 'e3']
  );
  // Every one of them a first attempt: staleness spends nothing.
  assert.deepEqual(
    decides.map((call) => call.final),
    [false, false, false, false, false]
  );
});

test('a stale packet does not consume the schema retry', async () => {
  const refreshed = {
    entry: { id: 'e1', name: 'Leche entera 1 L' },
    candidates: [{ ref: 'ref-e0', origin: 'run' }],
    eanMatch: null,
  };
  const seen = [];
  const answers = [
    { accepted: false, retryable: false, stale: true, packet: refreshed },
    {
      accepted: false,
      retryable: true,
      issues: [
        { code: 'MODEL_OUTPUT_INVALID', detail: 'confidence is missing' },
      ],
    },
    { accepted: true, retryable: false },
  ];
  const decider = {
    decide: async (entryId, decision, options) => {
      seen.push({ final: options.final });
      return answers.shift();
    },
  };
  const engine = fakeEngine([LINKED, LINKED, LINKED]);

  const answer = await decideRow({
    row: ROW,
    prompt: 'RULES',
    engine,
    decider,
    stripFence,
  });

  assert.equal(answer.accepted, true);
  // Asked three times: once on the stale packet, once on the refreshed one,
  // and once more because that answer broke the schema. The row still got both
  // of the attempts `--final` counts.
  assert.equal(engine.prompts.length, 3);
  assert.match(engine.prompts[1], /ref-e0/);
  assert.ok(!engine.prompts[1].includes('could not be used'));
  assert.match(engine.prompts[2], /confidence is missing/);
  assert.deepEqual(
    seen.map((call) => call.final),
    [false, false, true]
  );
});

test('a prompt the engine gave up on is a reply that cannot be used', async () => {
  const decider = fakeBatchDecider({
    batches: [[batchRow('e1', 'Leche'), batchRow('e2', 'Pan')]],
    total: 2,
  });
  const engine = fakeBatchEngine(
    [{ error: new Error('the ollama engine gave up') }, LINKED, LINKED],
    2
  );

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  // The failed entry costs its own row one retry and costs the row beside it
  // nothing, which is why a round reports a failure per prompt.
  assert.equal(engine.prompts.length, 3);
  assert.match(
    engine.prompts[2],
    /could not be used: the ollama engine gave up/
  );
  const decides = decider.calls.filter((call) => call.command === 'decide');
  // e1 records nothing on the round's own pass, because there was no reply to
  // record, so e2 is recorded first and e1 is recorded from the re-ask pass
  // with the attempt `--final` counts.
  assert.deepEqual(
    decides.map((call) => [call.entryId, call.final]),
    [
      ['e2', false],
      ['e1', true],
    ]
  );
});

test('a stop inside a round records what was recorded and applies nothing in flight', async () => {
  const controller = new AbortController();
  const decider = fakeBatchDecider({
    batches: [
      [batchRow('e1', 'Leche'), batchRow('e2', 'Pan')],
      [batchRow('e3', 'Arroz'), batchRow('e4', 'Aceite')],
    ],
    total: 4,
  });
  const slots = fakeSlots({ taken: [1] });
  const stderr = sink();

  let round = 0;
  const engine = {
    batchSize: 2,
    ask: async () => assert.fail('a batched walk asks through askEach'),
    askEach: (bodies) => {
      round += 1;
      if (round === 1) {
        return bodies.map(() => Promise.resolve({ text: LINKED }));
      }
      // The keystroke lands while the second round is in flight, and every
      // reply that had not arrived rejects with the signal's own reason. Every
      // one of them is handled here, as the contract says an engine handles
      // them, because the walk is entitled to abandon a round it stopped
      // reading.
      controller.abort(new Error('the run was stopped with Ctrl+C'));
      return handleAbandoned(
        bodies.map(() => Promise.reject(controller.signal.reason))
      );
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
  // The first batch stands, and nothing of the second was applied.
  assert.deepEqual(
    decider.calls
      .filter((call) => call.command === 'decide')
      .map((call) => call.entryId),
    ['e1', 'e2']
  );
  // A stop is not a failure, so the rehearsal catalog is not dumped.
  assert.ok(!slots.verbs.some((verb) => verb.startsWith('dump:')));
  assert.match(stderr.text(), /stopped: the report covers/);
});

test('a stop part way through applying a batch leaves the rest of it unapplied', async () => {
  const controller = new AbortController();
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 4,
  });
  const inner = decider.decide;
  decider.decide = async (entryId, decision, options) => {
    if (entryId === 'e2') {
      controller.abort(new Error('the run was stopped with Ctrl+C'));
    }
    return inner(entryId, decision, options);
  };
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED]);

  const outcome = await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
    signal: controller.signal,
  });

  assert.equal(outcome.stopped, true);
  // A batch is not a transaction: the rows recorded before the stop stay
  // recorded and the rows behind them are simply never asked about.
  assert.deepEqual(
    decider.calls
      .filter((call) => call.command === 'decide')
      .map((call) => call.entryId),
    ['e1', 'e2']
  );
});

test('an engine that holds one request in flight never calls askMany', async () => {
  const decider = fakeDecider({ rows: [ROW] });
  const engine = fakeEngine([LINKED]);
  engine.batchSize = 1;
  engine.askMany = async () => assert.fail('a width of one asks one at a time');
  engine.askEach = () => assert.fail('a width of one asks one at a time');

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(engine.prompts.length, 1);
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next'),
    [{ command: 'next' }, { command: 'next' }]
  );
});

test('a decider that composes no batches is walked one row at a time', async () => {
  // `curation-groups` answers no width, because nobody has measured how often
  // two of its rows collide. A batching engine changes nothing for it.
  const decider = fakeBatchDecider({
    batches: [[batchRow('e1', 'Arroz')]],
    total: 1,
    width: 0,
  });
  const engine = fakeBatchEngine([LINKED], 4);
  engine.askMany = async () => assert.fail('the decider hands out no batches');
  engine.askEach = () => assert.fail('the decider hands out no batches');

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [null, null]
  );
  assert.equal(engine.prompts.length, 1);
});

// ---------------------------------------------------------------------------
// The walk that decides as replies arrive (plan 0004)
// ---------------------------------------------------------------------------

/** A round of `ids`, and the decider that hands it out in one go. */
function roundOf(ids, answers = {}) {
  return fakeBatchDecider({
    batches: [ids.map((id) => batchRow(id, `Producto ${id}`))],
    total: ids.length,
    answers,
  });
}

/** A run over one round, with everything a test does not care about faked. */
function walk(decider, engine, extra = {}) {
  return runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
    ...extra,
  });
}

/** The decisions a run recorded, as `[entryId, final]` in the order it made them. */
function decidesOf(decider) {
  return decider.calls
    .filter((call) => call.command === 'decide')
    .map((call) => [call.entryId, call.final]);
}

test('a row is decided as its own reply arrives, not once the round is back', async () => {
  const decider = roundOf(['e1', 'e2']);
  // The second reply is only written once the first row has been recorded, so
  // a walk that waited for the whole round before deciding anything would never
  // finish this test rather than merely asserting slower.
  let release = null;
  const second = new Promise((resolve) => {
    release = resolve;
  });
  const inner = decider.decide;
  decider.decide = async (entryId, decision, options) => {
    if (entryId === 'e1') {
      release({ text: LINKED });
    }
    return inner(entryId, decision, options);
  };

  await walk(decider, {
    batchSize: 2,
    ask: async () => assert.fail('a round asks through askEach'),
    askEach: () => [Promise.resolve({ text: LINKED }), second],
  });

  assert.deepEqual(decidesOf(decider), [
    ['e1', false],
    ['e2', false],
  ]);
});

test('a later prompt that answers first is still decided in its own place', async () => {
  const decider = roundOf(['e1', 'e2', 'e3']);

  await walk(decider, {
    batchSize: 3,
    ask: async () => assert.fail('a round asks through askEach'),
    // The server answers this round backwards, which is what a pool does when
    // the earlier rows are the slower ones.
    askEach: (bodies) =>
      bodies.map(
        (unused, index) =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ text: LINKED }),
              (bodies.length - index) * 5
            );
          })
      ),
  });

  assert.deepEqual(decidesOf(decider), [
    ['e1', false],
    ['e2', false],
    ['e3', false],
  ]);
});

test('the re-asks of a round are asked together, as one more pass', async () => {
  const refreshed = {
    entry: { id: 'e3', name: 'Producto e3' },
    candidates: [{ ref: 'ref-e2', origin: 'run' }],
    eanMatch: null,
  };
  const decider = roundOf(['e1', 'e2', 'e3', 'e4'], {
    e1: [
      {
        accepted: false,
        retryable: true,
        issues: [
          { code: 'MODEL_OUTPUT_INVALID', detail: 'confidence is missing' },
        ],
      },
      { accepted: true, retryable: false, entryId: 'e1' },
    ],
    e3: [
      { accepted: false, retryable: false, stale: true, packet: refreshed },
      { accepted: true, retryable: false, entryId: 'e3' },
    ],
  });
  const engine = fakeBatchEngine(new Array(6).fill(LINKED));

  await walk(decider, engine);

  // Two calls, not five: the round, and then the two rows it set aside asked
  // together rather than one at a time in the middle of the decide loop.
  assert.deepEqual(
    engine.batches.map((bodies) => bodies.length),
    [4, 2]
  );
  // A retry carries the reason it was refused; a stale row carries the
  // refreshed packet and no reproach at all.
  assert.match(
    engine.batches[1][0],
    /could not be used: confidence is missing/
  );
  assert.match(engine.batches[1][1], /ref-e2/);
  assert.ok(!engine.batches[1][1].includes('could not be used'));
  // Every row of the round is offered to the decider on the round's own pass,
  // which is what answers `retryable` and `stale` in the first place, and the
  // two that were refused are recorded again from the re-ask pass.
  assert.deepEqual(decidesOf(decider), [
    ['e1', false],
    ['e2', false],
    ['e3', false],
    ['e4', false],
    ['e1', true],
    ['e3', false],
  ]);
});

test('a re-ask that goes stale again is another pass, and spends nothing', async () => {
  const refreshed = (ref) => ({
    entry: { id: 'e2', name: 'Producto e2' },
    candidates: [{ ref, origin: 'run' }],
    eanMatch: null,
  });
  const decider = roundOf(['e1', 'e2'], {
    e2: [
      {
        accepted: false,
        retryable: false,
        stale: true,
        packet: refreshed('ref-one'),
      },
      {
        accepted: false,
        retryable: false,
        stale: true,
        packet: refreshed('ref-two'),
      },
      { accepted: true, retryable: false, entryId: 'e2' },
    ],
  });
  const engine = fakeBatchEngine(new Array(4).fill(LINKED));

  await walk(decider, engine);

  // The round, and then one pass for each time the packet moved under it. The
  // passes are bounded by the retry budget and by nothing else, which is why a
  // row can be asked a third time without a counter saying it may.
  assert.deepEqual(
    engine.batches.map((bodies) => bodies.length),
    [2, 1, 1]
  );
  assert.match(engine.batches[1][0], /ref-one/);
  assert.match(engine.batches[2][0], /ref-two/);
  // Not one of them final: a question that was never asked costs no attempt.
  assert.deepEqual(decidesOf(decider), [
    ['e1', false],
    ['e2', false],
    ['e2', false],
    ['e2', false],
  ]);
});

test('a re-ask that breaks the schema twice is recorded, final, in its pass', async () => {
  const decider = roundOf(['e1', 'e2'], {
    e1: [
      {
        accepted: false,
        retryable: true,
        issues: [{ code: 'MODEL_OUTPUT_INVALID', detail: 'no itemId' }],
      },
      { accepted: true, retryable: false, decision: 'REVIEW', entryId: 'e1' },
    ],
  });
  const engine = fakeBatchEngine([LINKED, LINKED, 'still not JSON']);

  await walk(decider, engine);

  assert.deepEqual(decidesOf(decider), [
    ['e1', false],
    ['e2', false],
    ['e1', true],
  ]);
  // The second answer is recorded whatever it says, which is what `--final`
  // means, so an unusable one reaches the decider as the reply it was.
  const last = decider.calls.filter((call) => call.command === 'decide').pop();
  assert.deepEqual(last.decision, { modelReply: 'still not JSON' });
});

test('the round is what the engine advises, capped by what the decider composes', () => {
  assert.equal(roundWidth({ batchSize: 4, roundSize: 12 }, 20), 12);
  // The decider's queue page is the cap: a round never crosses one.
  assert.equal(roundWidth({ batchSize: 4, roundSize: 12 }, 8), 8);
  // An engine that advises no round falls back to what it holds in flight,
  // which is what the width was before plan 0004.
  assert.equal(roundWidth({ batchSize: 4 }, 20), 4);
  assert.equal(roundWidth({ roundSize: 1, batchSize: 1 }, 20), 1);
  // An engine that reports neither, and a decider that composes no batches,
  // are both one row at a time.
  assert.equal(roundWidth({}, 20), 1);
  assert.equal(roundWidth({ batchSize: 4, roundSize: 12 }, 0), 1);
});

test('the round the engine advises is what the decider is asked for', async () => {
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) =>
        batchRow(id, `Producto ${id}`)
      ),
    ],
    total: 6,
    width: 20,
  });
  const engine = fakeBatchEngine(new Array(6).fill(LINKED), 2, {
    roundSize: 6,
  });

  await walk(decider, engine);

  // Six rows in one round, asked of an engine that holds two in flight: the
  // round and the in flight count are two numbers.
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [6, 6]
  );
  assert.deepEqual(
    engine.batches.map((bodies) => bodies.length),
    [6]
  );
});

test('--limit narrows a wide round to the exact remainder', async () => {
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) =>
        batchRow(id, `Producto ${id}`)
      ),
      ['e7', 'e8'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 20,
    width: 20,
  });
  const engine = fakeBatchEngine(new Array(8).fill(LINKED), 2, {
    roundSize: 6,
  });

  await walk(decider, engine, { limit: 8 });

  // Six, then the two the limit has left, asked for as two rather than as six
  // and trimmed: a fetched row carries a handout nothing would ever close.
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [6, 2]
  );
  assert.equal(engine.prompts.length, 8);
});

// ---------------------------------------------------------------------------
// --limit (plan 0003)
// ---------------------------------------------------------------------------

test('--limit ends the walk after that many rows, and ends it normally', async () => {
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
      ['e5', 'e6', 'e7', 'e8'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 8,
  });
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED]);
  const stderr = sink();

  const outcome = await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    limit: 4,
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr,
  });

  // One batch asked, four rows decided, and the second batch never fetched.
  assert.equal(engine.batches.length, 1);
  assert.equal(engine.prompts.length, 4);
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [4]
  );
  assert.equal(
    decider.calls.filter((call) => call.command === 'decide').length,
    4
  );

  // A limit is not a stop: the report is written, the slot comes down, and the
  // run ends the way a finished one does.
  assert.equal(outcome.stopped, false);
  assert.ok(decider.calls.some((call) => call.command === 'end'));
  assert.match(stderr.text(), /limit 4 reached: 4 rows handed out/);
});

test('--limit narrows the last batch rather than trimming one it fetched', async () => {
  // A fetched row carries a handout the decider is holding open, so a batch
  // asked for and then trimmed would leave one open for the life of the run.
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2', 'e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
      [batchRow('e5', 'Producto e5')],
    ],
    total: 8,
  });
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED, LINKED]);

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    limit: 5,
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  // Four, then the one row the limit has left, asked for as one row and not
  // as four.
  assert.deepEqual(
    decider.calls.filter((call) => call.command === 'next').map((c) => c.count),
    [4, null]
  );
  assert.equal(engine.prompts.length, 5);
});

test('a limit past the end of the queue is the whole queue', async () => {
  const decider = fakeBatchDecider({
    batches: [[batchRow('e1', 'Leche'), batchRow('e2', 'Pan')]],
    total: 2,
  });
  const engine = fakeBatchEngine([LINKED, LINKED]);

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    limit: 100,
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(engine.prompts.length, 2);
  assert.ok(decider.calls.some((call) => call.command === 'end'));
});

test('no limit walks the whole queue, which is what it has always done', async () => {
  const decider = fakeBatchDecider({
    batches: [
      ['e1', 'e2'].map((id) => batchRow(id, `Producto ${id}`)),
      ['e3', 'e4'].map((id) => batchRow(id, `Producto ${id}`)),
    ],
    total: 4,
  });
  const engine = fakeBatchEngine([LINKED, LINKED, LINKED, LINKED]);

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine,
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(engine.prompts.length, 4);
});

test('the run reports the re-ask rate the decider counted', async () => {
  const decider = fakeDecider({ rows: [] });
  decider.end = async () => ({
    report: '/runs/x/report.json',
    counts: {},
    decided: 40,
    reasks: { stale: 1, decided: 40, rate: 0.025 },
  });
  const stderr = sink();

  await runCuration({
    slots: fakeSlots({ taken: [1] }),
    makeDeciderFor: () => decider,
    engine: fakeEngine([]),
    runDir: '/runs/x',
    mainUrl: 'http://a',
    waitForGateway: async () => undefined,
    stripFence,
    stdout: sink(),
    stderr,
  });

  assert.match(stderr.text(), /re-asked 1 of 40 decided rows/);
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
