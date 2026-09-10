import assert from 'node:assert/strict';
import test from 'node:test';
import { API_CONFIRMATION, confirmApiBilling } from './messages-api.mjs';
import {
  DEFAULT_ENGINE,
  ENGINES,
  ENGINE_NAMES,
  engineEntry,
} from './registry.mjs';
import { emptyUsage } from './usage.mjs';

/** A writable that keeps what was written. */
function sink() {
  const written = [];
  return { written, write: (text) => written.push(text) };
}

const ENVELOPE = JSON.stringify({
  type: 'result',
  is_error: false,
  result: '{"decision":"REVIEW"}',
  usage: { input_tokens: 2, output_tokens: 9 },
});

test('every name there is resolves to an entry', () => {
  assert.deepEqual(ENGINE_NAMES, ['claude', 'api', 'ollama']);
  for (const name of ENGINE_NAMES) {
    assert.equal(engineEntry(name).name, name);
  }
  assert.equal(engineEntry(DEFAULT_ENGINE).name, 'claude');
});

test('an unknown name is refused by a message that lists the names there are', () => {
  assert.throws(
    () => engineEntry('sdk'),
    /Unknown engine sdk\. It is claude, api or ollama\./
  );
});

test('every entry carries the whole of what a provider is', () => {
  for (const entry of ENGINES) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.defaultModel, 'string');
    assert.ok(Array.isArray(entry.effortLevels));
    assert.equal(typeof entry.create, 'function');
    // An entry that takes effort has a default that is one of its own levels.
    if (entry.effortLevels.length > 0) {
      assert.ok(entry.effortLevels.includes(entry.defaultEffort));
    } else {
      assert.equal(entry.defaultEffort, null);
    }
  }
});

test('the defaults an entry names are the ones the engine is built with', () => {
  const entry = engineEntry('claude');
  const engine = entry.create({
    spawn: async () => ({ code: 0, stdout: ENVELOPE, stderr: '' }),
    env: {},
    model: entry.defaultModel,
    effort: entry.defaultEffort,
    stderr: sink(),
  });

  assert.equal(engine.name, 'claude');
  assert.equal(engine.model, 'claude-sonnet-5');
  assert.equal(engine.effort, 'medium');
});

test('the claude entry is asked to confirm nothing', () => {
  assert.equal(engineEntry('claude').gate, null);
});

test('the ollama entry fights none of the four things plan 0001 named', async () => {
  const entry = engineEntry('ollama');
  // A default model that is not a Claude model, no effort level it does not
  // have, and no billing to confirm for a model on the operator's own machine.
  assert.equal(entry.defaultModel, 'gemma4:12b');
  assert.deepEqual(entry.effortLevels, []);
  assert.equal(entry.defaultEffort, null);
  assert.equal(entry.gate, null);

  const usage = emptyUsage();
  const seen = [];
  const engine = entry.create({
    fetchImpl: async (url, options) => {
      seen.push(url);
      if (url.endsWith('/api/show')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ capabilities: ['completion'], model_info: {} }),
        };
      }
      assert.equal(JSON.parse(options.body).model, 'gemma4:12b');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: 'ok' },
          prompt_eval_count: 12,
          prompt_eval_cached_count: 4,
          eval_count: 3,
        }),
      };
    },
    env: { OLLAMA_HOST: 'box:11434' },
    model: entry.defaultModel,
    effort: entry.defaultEffort,
    usage,
  });

  assert.equal(engine.name, 'ollama');
  assert.equal(engine.effort, null);
  assert.equal((await engine.ask('x')).text, 'ok');
  // The fourth: the usage block is mapped into the five counters this library
  // owns, and no sixth is invented.
  assert.equal(usage.inputTokens, 8);
  assert.equal(usage.cacheReadInputTokens, 4);
  assert.deepEqual(seen, [
    'http://box:11434/api/show',
    'http://box:11434/api/chat',
  ]);
});

test('every entry builds an engine that answers both methods and says how wide it is', async () => {
  const built = [
    engineEntry('claude').create({
      spawn: async () => ({ code: 0, stdout: ENVELOPE, stderr: '' }),
      env: {},
      model: 'claude-sonnet-5',
      effort: 'medium',
      stderr: sink(),
    }),
    engineEntry('api').create({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
      model: 'claude-sonnet-5',
      effort: 'medium',
      gated: 'sk-ant-x',
    }),
    engineEntry('ollama').create({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
      env: {},
      model: 'gemma4:12b',
      effort: null,
      stderr: sink(),
    }),
  ];

  for (const engine of built) {
    assert.equal(typeof engine.ask, 'function');
    // Batching turns off where it is not supported, and that is the library's
    // job rather than each adapter's, so there is no entry whose engine cannot
    // answer a list of prompts.
    assert.equal(typeof engine.askMany, 'function');
    assert.ok(Number.isInteger(engine.batchSize) && engine.batchSize > 0);
  }
  assert.deepEqual(
    built.map((engine) => engine.batchSize),
    [1, 1, 4]
  );
});

test('OLLAMA_BATCH reaches the ollama entry, and its notice reaches the injected stderr', async () => {
  const stderr = sink();
  const engine = engineEntry('ollama').create({
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith('/api/show')
          ? { capabilities: [], model_info: {} }
          : { message: { content: 'ok' } },
    }),
    env: { OLLAMA_BATCH: '12' },
    model: 'gemma4:12b',
    effort: null,
    stderr,
  });

  assert.equal(engine.batchSize, 12);
  const answers = await engine.askMany(['one', 'two']);
  assert.deepEqual(answers, [{ text: 'ok' }, { text: 'ok' }]);
  assert.equal(stderr.written.length, 1);
  assert.match(stderr.written[0], /OLLAMA_NUM_PARALLEL/);
});

test('the api entry names the billing gate, and its answer builds the engine', async () => {
  const entry = engineEntry('api');
  assert.equal(entry.gate, confirmApiBilling);

  const key = await entry.gate({
    env: { ANTHROPIC_API_KEY: 'sk-ant-x' },
    isTty: true,
    askLine: async () => API_CONFIRMATION,
    stdout: sink(),
  });

  const seen = [];
  const usage = emptyUsage();
  const engine = entry.create({
    fetchImpl: async (url, options) => {
      seen.push(options.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      };
    },
    model: entry.defaultModel,
    effort: entry.defaultEffort,
    usage,
    gated: key,
  });

  assert.equal((await engine.ask('x')).text, 'ok');
  // Whatever the gate answered is what the request is made with, so an entry
  // with no gate never reaches for a key of its own.
  assert.equal(seen[0]['x-api-key'], 'sk-ant-x');
  assert.equal(usage.calls, 1);
});

test('a run builds its engine from injected everything', async () => {
  const controller = new AbortController();
  const seen = [];
  const usage = emptyUsage();
  const engine = engineEntry('claude').create({
    spawn: async (command, args, options) => {
      seen.push({ command, options });
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    model: 'claude-haiku-4-5',
    effort: 'low',
    usage,
    stderr: sink(),
    signal: controller.signal,
  });

  await engine.ask('x');

  assert.equal(engine.model, 'claude-haiku-4-5');
  assert.equal(engine.effort, 'low');
  assert.equal(seen[0].command, 'claude');
  assert.equal(seen[0].options.timeoutMs, 120000);
  assert.equal(seen[0].options.signal, controller.signal);
  assert.equal(usage.calls, 1);
});
