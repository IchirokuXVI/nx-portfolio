#!/usr/bin/env node
/**
 * Reads one receipt photo with several Gemini models and writes one JSON per
 * model, plus the measured token usage that `cost.mjs` turns into money.
 *
 *   node run-gemini.mjs <image> <outDir> [model ...]
 *   node run-gemini.mjs --list-models
 *
 * The key comes from GEMINI_API_KEY, or from the file named by GEMINI_ENV_FILE,
 * or from the assistant service's own .env. It is never printed.
 *
 * Models run one at a time rather than in parallel: the free tier answers 429
 * under concurrency, and a serialized run is the difference between a latency
 * number that means something and one that measures the queue.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE =
  process.env.GEMINI_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function findKey() {
  if ((process.env.GEMINI_API_KEY ?? '').trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  const candidates = [
    process.env.GEMINI_ENV_FILE,
    join(HERE, '../../../assistant/.env'),
  ].filter(Boolean);

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*GEMINI_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }
  return null;
}

const key = findKey();
if (!key) {
  console.error(
    'No GEMINI_API_KEY found (env, GEMINI_ENV_FILE, or assistant/.env).'
  );
  process.exit(2);
}

const args = process.argv.slice(2);

if (args.includes('--list-models')) {
  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': key },
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  for (const model of body.models ?? []) {
    if ((model.supportedGenerationMethods ?? []).includes('generateContent')) {
      console.log(model.name.replace('models/', ''));
    }
  }
  process.exit(0);
}

const [image, outDir, ...named] = args;
if (!image || !outDir) {
  console.error('usage: node run-gemini.mjs <image> <outDir> [model ...]');
  process.exit(2);
}

const models = named.length > 0 ? named : DEFAULT_MODELS;
const mime = MIME[extname(image).toLowerCase()];
if (!mime) {
  console.error(`unsupported image extension: ${extname(image)}`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

const body = {
  contents: [
    {
      role: 'user',
      parts: [
        {
          inline_data: {
            mime_type: mime,
            data: readFileSync(image).toString('base64'),
          },
        },
        { text: readFileSync(join(HERE, 'prompt.txt'), 'utf8') },
      ],
    },
  ],
  generationConfig: {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: JSON.parse(readFileSync(join(HERE, 'schema.json'), 'utf8')),
  },
};

const usagePath = join(outDir, 'usage.json');
const usage = existsSync(usagePath)
  ? JSON.parse(readFileSync(usagePath, 'utf8'))
  : {};

/**
 * Every request gets a deadline. Without one a hung socket blocks the whole run
 * forever and looks identical to a slow model, which is exactly what happened on
 * the first ticket-02 run.
 */
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 240000);

for (const model of models) {
  const started = Date.now();
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(
      `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      }
    );
  } catch (error) {
    const ms = Date.now() - started;
    const why =
      error.name === 'AbortError' ? `timed out after ${ms}ms` : error.message;
    console.error(`${model.padEnd(24)} ${why}`);
    usage[model] = { error: 'timeout', detail: why, ms };
    writeFileSync(usagePath, `${JSON.stringify(usage, null, 2)}\n`);
    continue;
  } finally {
    clearTimeout(deadline);
  }

  const payload = await res.json();
  const ms = Date.now() - started;

  if (!res.ok) {
    const detail =
      payload?.error?.message ?? JSON.stringify(payload).slice(0, 200);
    console.error(
      `${model.padEnd(24)} HTTP ${res.status} after ${ms}ms: ${detail}`
    );
    usage[model] = { error: res.status, detail, ms };
    continue;
  }

  const text =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .join('') ?? '';
  const meta = payload.usageMetadata ?? {};

  writeFileSync(join(outDir, `${model}.json`), text);
  usage[model] = {
    ms,
    inputTokens: meta.promptTokenCount ?? null,
    outputTokens: meta.candidatesTokenCount ?? null,
    thoughtsTokens: meta.thoughtsTokenCount ?? null,
  };
  console.error(
    `${model.padEnd(24)} ${String(ms).padStart(7)}ms  in=${meta.promptTokenCount ?? '?'} out=${meta.candidatesTokenCount ?? '?'}`
  );
  writeFileSync(usagePath, `${JSON.stringify(usage, null, 2)}\n`);
}

writeFileSync(usagePath, `${JSON.stringify(usage, null, 2)}\n`);
console.error(`\nwrote ${usagePath}`);
