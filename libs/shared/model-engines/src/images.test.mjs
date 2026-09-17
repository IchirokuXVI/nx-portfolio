/**
 * A page the model can see (plan 0004, a page the model can see).
 *
 * No network and no `claude` installed, as the rest of the library runs. The
 * claude half writes real files, because what it is asserting is that a file
 * arrives on disk with the right name and the right bytes, and a fake `fs`
 * would assert that this test knows how to call one.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MINIMAL_ARGS,
  imagePromptLine,
  imageToolArgs,
  makeClaudeEngine,
} from './claude-cli.mjs';
import {
  IMAGE_ERROR_NAME,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  checkImages,
} from './images.mjs';
import { makeApiEngine } from './messages-api.mjs';
import { makeOllamaEngine } from './ollama.mjs';

/** Two pictures, in the shape a caller hands them over. */
const PAGE_ONE = {
  mediaType: 'image/png',
  data: Buffer.from('the first page').toString('base64'),
};
const PAGE_TWO = {
  mediaType: 'image/webp',
  data: Buffer.from('the second page').toString('base64'),
};

/** What `/api/show` answers for the measured model, trimmed to what is read. */
const SHOWN = {
  capabilities: ['completion', 'vision', 'thinking'],
  model_info: { 'gemma3.context_length': 262144 },
};

/** An Ollama server that keeps the chat bodies and echoes the prompt back. */
function ollamaServer() {
  const chats = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/api/show')) {
      return { ok: true, status: 200, json: async () => SHOWN };
    }
    chats.push(body);
    const asked = body.messages[body.messages.length - 1].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: { role: 'assistant', content: `answered ${asked}` },
        prompt_eval_count: 2000,
        prompt_eval_cached_count: 0,
        eval_count: 10,
      }),
    };
  };
  return { chats, fetchImpl };
}

/** A Messages API server that keeps the bodies it was sent. */
function apiServer() {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'read' }],
        usage: {},
      }),
    };
  };
  return { bodies, fetchImpl };
}

/** The envelope a `claude -p --output-format json` call answers with. */
const ENVELOPE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'read',
  usage: {},
});

/** A scratch directory of this test's own, removed when the test is over. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'model-engines-images-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// What the library refuses, before any request
// ---------------------------------------------------------------------------

test('absent and empty images are the same answer', () => {
  assert.deepEqual(checkImages(undefined), []);
  assert.deepEqual(checkImages(null), []);
  assert.deepEqual(checkImages([]), []);
});

test('an unsupported media type is refused by name', () => {
  assert.throws(
    () => checkImages([{ mediaType: 'image/gif', data: 'AAAA' }]),
    (error) =>
      error.name === IMAGE_ERROR_NAME && /image\/gif/.test(error.message)
  );
  // The three the adapters carry are all accepted, and nothing is rewritten.
  for (const mediaType of SUPPORTED_IMAGE_MEDIA_TYPES) {
    assert.deepEqual(checkImages([{ mediaType, data: 'AAAA' }]), [
      { mediaType, data: 'AAAA' },
    ]);
  }
});

test('a non array and an entry with no data string are refused by name', () => {
  for (const bad of ['AAAA', { mediaType: 'image/png', data: 'AAAA' }, 42]) {
    assert.throws(
      () => checkImages(bad),
      (error) => error.name === IMAGE_ERROR_NAME
    );
  }
  for (const entry of [
    { mediaType: 'image/png' },
    { mediaType: 'image/png', data: '' },
    { mediaType: 'image/png', data: Buffer.from('x') },
    null,
  ]) {
    assert.throws(
      () => checkImages([entry]),
      (error) => error.name === IMAGE_ERROR_NAME
    );
  }
});

test('an unsupported media type stops every adapter before it asks', async (t) => {
  const bad = [{ mediaType: 'application/pdf', data: 'AAAA' }];
  const ollama = ollamaServer();
  const api = apiServer();
  const spawns = [];

  const engines = [
    makeOllamaEngine({ fetchImpl: ollama.fetchImpl }),
    makeApiEngine({ fetchImpl: api.fetchImpl, apiKey: 'sk-test' }),
    makeClaudeEngine({
      spawn: async (command, args) => {
        spawns.push(args);
        return { code: 0, stdout: ENVELOPE, stderr: '' };
      },
      env: { PATH: '/usr/bin' },
      scratchDir: scratch(t),
    }),
  ];

  for (const engine of engines) {
    await assert.rejects(
      () => engine.ask('the packet', { images: bad }),
      (error) => error.name === IMAGE_ERROR_NAME,
      engine.name
    );
  }

  // The refusal is the library's, so nothing left the process. `/api/show` is
  // not asked either, because the check runs before the model is described.
  assert.deepEqual(ollama.chats, []);
  assert.deepEqual(api.bodies, []);
  assert.deepEqual(spawns, []);
});

// ---------------------------------------------------------------------------
// A text ask is unchanged on the wire
// ---------------------------------------------------------------------------

test('the ollama message is what it was when there was no images option', async () => {
  const { chats, fetchImpl } = ollamaServer();
  const engine = makeOllamaEngine({ fetchImpl, model: 'gemma4:12b' });

  await engine.ask('the packet', { system: 'THE RULES' });

  assert.deepEqual(chats[0].messages, [
    { role: 'system', content: 'THE RULES' },
    { role: 'user', content: 'the packet' },
  ]);
  // The key is absent rather than empty: an empty array is a different request.
  assert.equal('images' in chats[0].messages[1], false);
});

test('the api content is the plain string when there is no image', async () => {
  const { bodies, fetchImpl } = apiServer();
  const engine = makeApiEngine({ fetchImpl, apiKey: 'sk-test' });

  await engine.ask('the packet', { system: 'THE RULES' });

  assert.deepEqual(bodies[0].messages, [
    { role: 'user', content: 'the packet' },
  ]);
});

test('the claude argument list and stdin are unchanged with no image', async (t) => {
  const seen = [];
  const dir = scratch(t);
  const engine = makeClaudeEngine({
    spawn: async (command, args, options) => {
      seen.push({ args, options });
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    model: 'claude-sonnet-5',
    effort: 'medium',
    scratchDir: dir,
  });

  await engine.ask('the packet', { system: 'THE RULES' });

  assert.deepEqual(seen[0].args, [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-sonnet-5',
    '--effort',
    'medium',
    '--system-prompt',
    'THE RULES',
    ...MINIMAL_ARGS,
  ]);
  // No line was put in front of the prompt, and no file was written.
  assert.equal(seen[0].options.input, 'the packet');
  assert.deepEqual(readdirSync(dir), []);
});

// ---------------------------------------------------------------------------
// What each adapter does with a picture
// ---------------------------------------------------------------------------

test('ollama puts the base64 data on the message, and sends the three options', async () => {
  const { chats, fetchImpl } = ollamaServer();
  const engine = makeOllamaEngine({ fetchImpl, model: 'gemma4:12b' });

  await engine.ask('read the page', {
    system: 'THE RULES',
    images: [PAGE_ONE, PAGE_TWO],
  });

  const user = chats[0].messages[1];
  assert.equal(user.content, 'read the page');
  // Base64 strings in the caller's order, with no media type: the server
  // sniffs the bytes.
  assert.deepEqual(user.images, [PAGE_ONE.data, PAGE_TWO.data]);

  // Thinking on never answered the two dense pages of the measured sample, and
  // a generation with no cap shifts the context rather than stopping.
  assert.equal(chats[0].think, false);
  assert.ok(chats[0].options.num_predict > 0);
  assert.equal(chats[0].options.temperature, 0);
});

test('the api content is the blocks, image first, with the media type it was handed', async () => {
  const { bodies, fetchImpl } = apiServer();
  const engine = makeApiEngine({ fetchImpl, apiKey: 'sk-test' });

  await engine.ask('read the page', { images: [PAGE_ONE, PAGE_TWO] });

  assert.deepEqual(bodies[0].messages[0].content, [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: PAGE_ONE.data,
      },
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/webp',
        data: PAGE_TWO.data,
      },
    },
    { type: 'text', text: 'read the page' },
  ]);
});

test('claude writes the files, names them, and puts the Read tool back', async (t) => {
  const seen = [];
  const dir = scratch(t);
  const engine = makeClaudeEngine({
    spawn: async (command, args, options) => {
      seen.push({ args, options });
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    model: 'claude-sonnet-5',
    effort: 'medium',
    scratchDir: dir,
  });

  await engine.ask('read the page', {
    images: [PAGE_ONE, PAGE_TWO, { ...PAGE_ONE, mediaType: 'image/jpeg' }],
  });

  // The extension comes from the media type, because the Read tool decides
  // what a file is from its name.
  const first = join(dir, 'image_1.png');
  const second = join(dir, 'image_2.webp');
  const third = join(dir, 'image_3.jpg');
  assert.deepEqual(readdirSync(dir).sort(), [
    'image_1.png',
    'image_2.webp',
    'image_3.jpg',
  ]);
  assert.equal(readFileSync(first, 'utf8'), 'the first page');
  assert.equal(readFileSync(second, 'utf8'), 'the second page');

  // One line in front of the prompt, naming the paths in the caller's order.
  assert.equal(
    seen[0].options.input,
    `${imagePromptLine([first, second, third])}\n\nread the page`
  );

  // Exactly one tool comes back, and only for this call.
  assert.deepEqual(seen[0].args.slice(-8), imageToolArgs(dir));
  const at = seen[0].args.indexOf('--tools');
  assert.equal(seen[0].args[at + 1], 'Read');
  assert.equal(seen[0].args.includes('--add-dir'), true);
  assert.equal(seen[0].args[seen[0].args.indexOf('--add-dir') + 1], dir);
});

test('imageToolArgs keeps the rest of MINIMAL_ARGS as it is', () => {
  // Only the value behind `--tools` moves. `--safe-mode` and the three flags
  // beside it are what keeps a call cheap, and they are not an image decision.
  assert.deepEqual(imageToolArgs('/tmp/scratch'), [
    '--tools',
    'Read',
    ...MINIMAL_ARGS.slice(2),
    '--add-dir',
    '/tmp/scratch',
  ]);
  assert.deepEqual(MINIMAL_ARGS.slice(0, 2), ['--tools', '']);
});

// ---------------------------------------------------------------------------
// The images belong to the call, not to one prompt
// ---------------------------------------------------------------------------

test('askMany hands the same images to every prompt, in input order', async () => {
  const { chats, fetchImpl } = ollamaServer();
  const engine = makeOllamaEngine({ fetchImpl, model: 'gemma4:12b' });

  const answers = await engine.askMany(['first', 'second', 'third'], {
    system: 'THE RULES',
    images: [PAGE_ONE],
  });

  assert.deepEqual(
    answers.map((entry) => entry.text),
    ['answered first', 'answered second', 'answered third']
  );
  assert.equal(chats.length, 3);
  for (const chat of chats) {
    assert.deepEqual(chat.messages[1].images, [PAGE_ONE.data]);
  }
});

test('askEach hands the same images to every prompt', async (t) => {
  const seen = [];
  const engine = makeClaudeEngine({
    spawn: async (command, args, options) => {
      seen.push(options.input);
      return { code: 0, stdout: ENVELOPE, stderr: '' };
    },
    env: { PATH: '/usr/bin' },
    scratchDir: scratch(t),
  });

  const answers = await Promise.all(
    engine.askEach(['first', 'second'], { images: [PAGE_ONE] })
  );

  assert.deepEqual(
    answers.map((entry) => entry.text),
    ['read', 'read']
  );
  // Both prompts were given the same one picture, and each kept its own text.
  assert.equal(seen.length, 2);
  assert.ok(seen[0].endsWith('\n\nfirst'));
  assert.ok(seen[1].endsWith('\n\nsecond'));
  assert.ok(seen[0].includes('image_1.png'));
  assert.ok(seen[1].includes('image_1.png'));
});
