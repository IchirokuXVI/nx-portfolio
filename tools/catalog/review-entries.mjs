#!/usr/bin/env node
// A model works the harvest entry queue (plan 0098).
//
// A harvest run leaves rows in `source_catalog_entries` that no rung of the
// matching ladder could settle. A person works that queue in the back office,
// one row at a time. This tool is that person's delegate: it reads the queue,
// asks Claude about each row, checks the answer against rules the tool holds
// itself, and then writes through the same three admin routes the back office
// uses, under the operator's own admin session.
//
// It never rejects a row. Junk is a human call, and a wrong reject hides a row
// from the queue. It never writes a price either; `accept` does that server
// side, which is the point of going through the routes.
//
// Zero dependencies, on purpose. Adding a package means running `npm install`
// on Windows, which prunes other platforms' bindings from `package-lock.json`
// and fails CI at `npm ci`.
//
// Manual smoke run against a dev slot. Not part of CI.
//
//   # 1. See which backend slots are up, and pick a gateway port.
//   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
//
//   # 2. Credentials. The admin row `luna-slot.sh` creates is dev-admin.
//   export ANTHROPIC_API_KEY=sk-ant-...
//   export LUNA_ADMIN_EMAIL=dev-admin
//   export LUNA_ADMIN_PASSWORD=dev-admin-password
//
//   # 3. A dry run over five rows of slot 0. Nothing is written.
//   node tools/catalog/review-entries.mjs --limit 5
//
//   # 4. The same against slot 1, one chain, reading the decisions with jq.
//   node tools/catalog/review-entries.mjs --base-url http://localhost:43000 \
//     --chain 0f5f1f2e-... --limit 20 | jq -r '[.decision, .entryName] | @tsv'
//
//   # 5. Once the dry run reads right, let it write.
//   node tools/catalog/review-entries.mjs --chain 0f5f1f2e-... --limit 20 --apply
//
// stdout is one JSON line per entry and nothing else, so it pipes into jq.
// Progress goes to stderr. Both are also written to tools/catalog/out/.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3000';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8000;
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Below this a decision is a REVIEW, whatever the model wrote (section 3). */
const CONFIDENCE_THRESHOLD = 0.9;

/** The gateway's own cap. Asking for more is a 400. */
const PAGE_SIZE = 100;

/** How many catalog products the pre-pass offers the model. */
const CANDIDATE_LIMIT = 8;

/** Backoff between attempts on a 429 or a 5xx, in milliseconds. */
const RETRY_DELAYS = [2000, 8000, 30000];

/** A safety net on the queue walk, not a limit anybody should reach. */
const MAX_QUEUE_PAGES = 200;

/** An `extra` bag can hold a leaflet's whole page text; the model needs a taste. */
const MAX_EXTRA_CHARS = 2000;

const OPENAPI_URL = new URL(
  '../../apps/luna-shopper-backend/gateway/docs/openapi.json',
  import.meta.url
);
const PROMPT_URL = new URL('./review-entries-prompt.md', import.meta.url);
const PRIVATE_LABELS_URL = new URL('./private-labels.json', import.meta.url);
const DEFAULT_OUT_URL = new URL('./out/', import.meta.url);

const USAGE = `Usage: node tools/catalog/review-entries.mjs [options]

  --apply             Write the decisions that pass validation. Default is a dry run.
  --limit <n>         Stop after n entries.
  --chain <id>        Only this supermarket id. Default is every registered chain.
  --base-url <url>    The gateway. Default ${DEFAULT_BASE_URL}.
  --out-dir <dir>     Where the log and the report go. Default tools/catalog/out.
  --help              This.

Environment:

  ANTHROPIC_API_KEY   Required. The tool refuses to start without it.
  LUNA_ADMIN_TOKEN    An admin access token. Skips the login.
  LUNA_ADMIN_EMAIL    The admin username, when there is no token.
  LUNA_ADMIN_PASSWORD The admin password, when there is no token.
`;

// ---------------------------------------------------------------------------
// Normalizing, verbatim from the harvester's matching.ts
// ---------------------------------------------------------------------------

/**
 * Case, accent and punctuation insensitive.
 *
 * A copy of `normalizeName` in
 * `apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts`. The two
 * have to agree, because this tool searches the catalog with the same key the
 * ladder matched on. The test asserts the cases the harvester's own spec does.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A size the name is carrying, rule 3.
 *
 * A number followed by a unit, with the separator optional, which is how every
 * chain prints one: `1L`, `1 l`, `500 ml`, `0,4 kg`, `12 uds`.
 */
const SIZE_PATTERN =
  /(?:^|[\s(\[/x×-])\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l|lt|ltr|litro|litros|mg|gr|g|kg|kgs|cc|ud|uds|u|unid|unidad|unidades|pack|packs)(?![a-z0-9])/i;

/** True when the name states a size, which rule 3 forbids. */
export function carriesSize(name) {
  return SIZE_PATTERN.test(String(name ?? ''));
}

/** True when the normalized brand appears as a run of tokens inside the name. */
export function carriesBrand(name, brand) {
  const brandKey = normalizeName(brand);
  if (!brandKey) {
    return false;
  }
  const nameTokens = normalizeName(name).split(' ').filter(Boolean);
  const brandTokens = brandKey.split(' ').filter(Boolean);
  if (brandTokens.length === 0 || nameTokens.length < brandTokens.length) {
    return false;
  }
  for (
    let start = 0;
    start + brandTokens.length <= nameTokens.length;
    start++
  ) {
    if (brandTokens.every((token, i) => nameTokens[start + i] === token)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// What the tool reads at startup
// ---------------------------------------------------------------------------

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * The category and unit vocabularies, read from the committed OpenAPI document.
 *
 * Never hand copied. The document is generated from the contracts and a stale
 * copy of it fails the gateway's own suite, so reading it here is the one way
 * these two lists cannot drift from the enums the routes accept.
 */
export function loadVocabularies(docUrl = OPENAPI_URL) {
  const doc = readJson(docUrl);
  const schemas = doc?.components?.schemas ?? {};
  const categories = schemas['enums.ItemCategory']?.enum;
  const units = schemas['enums.UnitOfMeasure']?.enum;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error(
      `enums.ItemCategory is missing from ${fileURLToPath(docUrl)}. Regenerate it with ` +
        '`npx nx run luna-shopper-backend-gateway:openapi`.'
    );
  }
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error(
      `enums.UnitOfMeasure is missing from ${fileURLToPath(docUrl)}. Regenerate it with ` +
        '`npx nx run luna-shopper-backend-gateway:openapi`.'
    );
  }
  return { categories: [...categories], units: [...units] };
}

/**
 * The private label map, normalized on both sides so a validator can compare it
 * with a catalog supermarket's own name.
 */
export function loadPrivateLabels(url = PRIVATE_LABELS_URL) {
  return indexPrivateLabels(readJson(url));
}

export function indexPrivateLabels(raw) {
  const byBrand = new Map();
  for (const [brand, chain] of Object.entries(raw ?? {})) {
    const key = normalizeName(brand);
    if (!key) {
      continue;
    }
    byBrand.set(key, { brand, chain, chainKey: normalizeName(chain) });
  }
  return byBrand;
}

/**
 * The system prompt: the file, then the two vocabularies and the private label
 * map appended, so the model is told the same lists the validators enforce.
 */
export function buildSystemPrompt({
  template,
  categories,
  units,
  privateLabels,
}) {
  const labels = [...privateLabels.values()]
    .map((entry) => `- \`${entry.brand}\` belongs to ${entry.chain}.`)
    .join('\n');
  return [
    template.trimEnd(),
    '',
    '## Category vocabulary',
    '',
    'One of these, exactly as written:',
    '',
    categories.map((value) => `- \`${value}\``).join('\n'),
    '',
    '## Unit vocabulary',
    '',
    'One of these, exactly as written:',
    '',
    units.map((value) => `- \`${value}\``).join('\n'),
    '',
    '## Known private labels',
    '',
    'Rule 6 applies to these brands. The list is not complete, so a brand that is',
    'plainly a chain’s own house label follows the same rule.',
    '',
    labels || '- (none)',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The packet the model is given
// ---------------------------------------------------------------------------

function trimExtra(extra) {
  if (extra === null || extra === undefined) {
    return null;
  }
  const text = JSON.stringify(extra);
  if (text.length <= MAX_EXTRA_CHARS) {
    return extra;
  }
  return { truncated: true, preview: text.slice(0, MAX_EXTRA_CHARS) };
}

function toCandidate(item, proposedByLadder = false) {
  return {
    itemId: item.id,
    nameEs: item.name?.es ?? null,
    nameEn: item.name?.en ?? null,
    brand: item.brand ?? null,
    unitSize: item.unitSize ?? null,
    defaultUnit: item.defaultUnit ?? null,
    ean: item.ean ?? null,
    category: item.category ?? null,
    ...(proposedByLadder ? { proposedByLadder: true } : {}),
  };
}

/** What the model is asked about: the entry as observed, plus the pre-pass. */
export function buildEntryPacket({ entry, supermarket, candidates, eanMatch }) {
  return {
    entry: {
      id: entry.id,
      name: entry.name,
      brand: entry.brand ?? null,
      ean: entry.ean ?? null,
      unitSize: entry.unitSize ?? null,
      sizeFormat: entry.sizeFormat ?? null,
      categoryPath: entry.categoryPath ?? [],
      url: entry.url ?? null,
      sourceKind: entry.sourceKind ?? null,
      status: entry.status ?? null,
      chainName: supermarket ? chainName(supermarket) : null,
      chainRegistered: Boolean(supermarket),
      proposedItemId: entry.itemId ?? null,
      extra: trimExtra(entry.extra ?? null),
    },
    candidates,
    eanMatch: eanMatch ? toCandidate(eanMatch) : null,
  };
}

export function chainName(supermarket) {
  return supermarket?.name?.es ?? supermarket?.name?.en ?? null;
}

// ---------------------------------------------------------------------------
// The shape of a decision, checked locally before anything reads it
// ---------------------------------------------------------------------------

const DECISIONS = new Set(['LINK', 'CREATE', 'REVIEW']);

function isString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeIssues(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((issue) => {
      if (isString(issue)) {
        return { code: 'MODEL_NOTE', detail: issue };
      }
      if (issue && typeof issue === 'object') {
        return {
          code: isString(issue.code) ? issue.code : 'MODEL_NOTE',
          detail: isString(issue.detail) ? issue.detail : '',
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * The local schema check.
 *
 * Types only. A category outside the vocabulary is a validator's business, not
 * a parse failure, because the difference matters: a malformed reply is retried
 * and a wrong value is reported.
 */
export function checkDecisionShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'the reply is not a JSON object' };
  }
  if (!DECISIONS.has(value.decision)) {
    return {
      ok: false,
      error: `"decision" must be one of LINK, CREATE, REVIEW, got ${JSON.stringify(value.decision)}`,
    };
  }
  if (typeof value.confidence !== 'number' || Number.isNaN(value.confidence)) {
    return { ok: false, error: '"confidence" must be a number' };
  }
  if (value.confidence < 0 || value.confidence > 1) {
    return { ok: false, error: '"confidence" must be between 0 and 1' };
  }

  const decision = {
    decision: value.decision,
    itemId: null,
    item: null,
    confidence: value.confidence,
    issues: normalizeIssues(value.issues),
    reasoning: isString(value.reasoning) ? value.reasoning.trim() : '',
  };

  if (value.decision === 'LINK') {
    if (!isString(value.itemId)) {
      return { ok: false, error: 'a LINK needs an "itemId"' };
    }
    decision.itemId = value.itemId.trim();
  }

  if (value.decision === 'CREATE') {
    const item = value.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'a CREATE needs an "item" object' };
    }
    if (!isString(item.nameEs)) {
      return { ok: false, error: 'a CREATE needs "item.nameEs"' };
    }
    if (!isString(item.category)) {
      return { ok: false, error: 'a CREATE needs "item.category"' };
    }
    if (!isString(item.defaultUnit)) {
      return { ok: false, error: 'a CREATE needs "item.defaultUnit"' };
    }
    if (
      item.unitSize !== null &&
      item.unitSize !== undefined &&
      typeof item.unitSize !== 'number'
    ) {
      return { ok: false, error: '"item.unitSize" must be a number or null' };
    }
    decision.item = {
      nameEs: item.nameEs.trim(),
      nameEn: isString(item.nameEn) ? item.nameEn.trim() : null,
      brand: isString(item.brand) ? item.brand.trim() : null,
      unitSize:
        item.unitSize === null || item.unitSize === undefined
          ? null
          : item.unitSize,
      defaultUnit: item.defaultUnit.trim(),
      category: item.category.trim(),
      ean: isString(item.ean) ? item.ean.trim() : null,
    };
  }

  return { ok: true, decision };
}

// ---------------------------------------------------------------------------
// The validators, deterministic, before any write
// ---------------------------------------------------------------------------

function issue(code, detail) {
  return { code, detail };
}

function sameNumber(a, b) {
  return Number(a) === Number(b);
}

function supermarketKeys(supermarket) {
  return [supermarket?.name?.es, supermarket?.name?.en]
    .filter(isString)
    .map(normalizeName);
}

/**
 * Every check the tool makes for itself, whatever the model's confidence was.
 *
 * A decision that fails any of them is demoted to REVIEW with the named issue,
 * so the row stays in the queue where the back office already shows it.
 */
export function validateDecision({
  decision,
  entry,
  supermarket,
  linkTarget = null,
  eanOwner = null,
  privateLabels = new Map(),
  categories = [],
  units = [],
}) {
  const issues = [];
  const item = decision.item;

  // Must not happen, which is exactly why it is checked.
  if (!supermarket) {
    issues.push(
      issue(
        'CHAIN_NOT_REGISTERED',
        `No catalog supermarket answers to ${entry.supermarketId}.`
      )
    );
  }

  if (decision.decision === 'CREATE' && item) {
    for (const [field, name] of [
      ['nameEs', item.nameEs],
      ['nameEn', item.nameEn],
    ]) {
      if (!name) {
        continue;
      }
      if (item.brand && carriesBrand(name, item.brand)) {
        issues.push(
          issue(
            'NAME_CARRIES_BRAND',
            `${field} "${name}" carries the brand "${item.brand}" (rule 2).`
          )
        );
      }
      if (carriesSize(name)) {
        issues.push(
          issue(
            'NAME_CARRIES_SIZE',
            `${field} "${name}" states a size, which belongs in unitSize and defaultUnit (rule 3).`
          )
        );
      }
    }

    if (!categories.includes(item.category)) {
      issues.push(
        issue(
          'UNKNOWN_CATEGORY',
          `"${item.category}" is not one of ${categories.join(', ')}.`
        )
      );
    }
    if (!units.includes(item.defaultUnit)) {
      issues.push(
        issue(
          'UNKNOWN_UNIT',
          `"${item.defaultUnit}" is not one of ${units.join(', ')}.`
        )
      );
    }

    if (item.ean && eanOwner) {
      issues.push(
        issue(
          'EAN_CONFLICT',
          `EAN ${item.ean} already belongs to catalog item ${eanOwner.id}. Link onto it instead.`
        )
      );
    }
  }

  if (decision.decision === 'LINK') {
    if (!linkTarget) {
      issues.push(
        issue(
          'LINK_TARGET_MISSING',
          `Item ${decision.itemId} is not among the candidates and catalog does not hold it.`
        )
      );
    } else {
      if (entry.ean && linkTarget.ean && entry.ean !== linkTarget.ean) {
        issues.push(
          issue(
            'EAN_CONFLICT',
            `The entry states EAN ${entry.ean} and item ${linkTarget.id} carries ${linkTarget.ean}.`
          )
        );
      }
      if (
        entry.unitSize !== null &&
        entry.unitSize !== undefined &&
        linkTarget.unitSize !== null &&
        linkTarget.unitSize !== undefined &&
        !sameNumber(entry.unitSize, linkTarget.unitSize)
      ) {
        issues.push(
          issue(
            'FORMAT_MISMATCH',
            `The entry is ${entry.unitSize} and item ${linkTarget.id} is ${linkTarget.unitSize}. Same brand plus same format merges, and nothing else does (rule 1).`
          )
        );
      }
    }
  }

  const brand =
    decision.decision === 'LINK'
      ? (linkTarget?.brand ?? null)
      : (item?.brand ?? null);
  const label = brand ? privateLabels.get(normalizeName(brand)) : undefined;
  if (label && supermarket) {
    const keys = supermarketKeys(supermarket);
    if (!keys.includes(label.chainKey)) {
      issues.push(
        issue(
          'PRIVATE_LABEL_CROSSES_CHAIN',
          `"${label.brand}" is ${label.chain}'s own label and this entry belongs to ${chainName(supermarket)} (rule 6).`
        )
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The text block of a reply, skipping any thinking block before it. */
export function textOf(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const block = blocks.find((entry) => entry?.type === 'text');
  return typeof block?.text === 'string' ? block.text : null;
}

/** A model that wrapped its object in a fence is still answering; unwrap it. */
function stripFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

function addUsage(total, usage) {
  total.calls += 1;
  total.inputTokens += usage?.input_tokens ?? 0;
  total.outputTokens += usage?.output_tokens ?? 0;
  total.cacheReadInputTokens += usage?.cache_read_input_tokens ?? 0;
  total.cacheCreationInputTokens += usage?.cache_creation_input_tokens ?? 0;
  return total;
}

export function emptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

/**
 * One request to the Messages API, retried on a 429 or a 5xx.
 *
 * The system prompt is one stable block with `cache_control` on it, so a 349
 * entry run pays for it once and reads it back 348 times.
 */
export async function callModel({
  fetchImpl,
  apiKey,
  system,
  messages,
  sleep = defaultSleep,
  usage = null,
}) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });

  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS[attempt - 1]);
    }
    let response;
    try {
      response = await fetchImpl(MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
      });
    } catch (error) {
      lastError = new Error(`the request failed: ${String(error)}`);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      const detail = await safeText(response);
      lastError = new Error(`HTTP ${response.status}: ${detail}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await safeText(response)}`);
    }

    const payload = await response.json();
    if (usage) {
      addUsage(usage, payload?.usage);
    }
    return payload;
  }
  throw lastError ?? new Error('the request failed');
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * The judgment: one call, and one retry when the reply will not parse.
 *
 * The retry carries the parse error as a second user message, which is the
 * cheapest way to get a well formed answer out of a model that wrote prose. A
 * second failure is a REVIEW, and the report says why.
 */
export async function askModel({
  fetchImpl,
  apiKey,
  system,
  packet,
  sleep = defaultSleep,
  usage = null,
}) {
  const first = JSON.stringify(packet, null, 2);
  const messages = [{ role: 'user', content: first }];
  let lastError = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = await callModel({
      fetchImpl,
      apiKey,
      system,
      messages,
      sleep,
      usage,
    });
    const text = textOf(payload);
    if (text === null) {
      lastError = 'the reply carried no text block';
    } else {
      try {
        const parsed = JSON.parse(stripFence(text));
        const checked = checkDecisionShape(parsed);
        if (checked.ok) {
          return { ok: true, decision: checked.decision };
        }
        lastError = checked.error;
      } catch (error) {
        lastError = `the reply is not valid JSON: ${String(error.message ?? error)}`;
      }
    }
    // The turns stay alternating, so the retry is a normal second exchange
    // rather than two user messages in a row.
    messages.push({ role: 'assistant', content: text ?? '(no text block)' });
    messages.push({
      role: 'user',
      content:
        `That reply could not be used: ${lastError}. ` +
        'Answer again with exactly one JSON object of the shape the system prompt names. ' +
        'No code fence, no prose.',
    });
  }

  return { ok: false, error: lastError };
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

/**
 * The admin routes this tool uses, and no others.
 *
 * Every one of them is a route the back office already calls, taken from
 * `apps/luna-shopper-backend/gateway/docs/openapi.json`.
 */
export function makeGatewayClient({ fetchImpl, baseUrl, token = null }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  let accessToken = token;

  async function request(method, path, { query, body } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const url = `${base}${path}${search.size ? `?${search}` : ''}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(
        `${method} ${url} answered ${response.status}: ${await safeText(response)}`
      );
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async function pageThrough(path, query, cap = MAX_QUEUE_PAGES) {
    const items = [];
    let cursor = undefined;
    for (let page = 0; page < cap; page++) {
      const answer = await request('GET', path, {
        query: { ...query, limit: PAGE_SIZE, cursor },
      });
      items.push(...(answer?.items ?? []));
      cursor = answer?.nextCursor ?? null;
      if (!cursor) {
        return items;
      }
    }
    return items;
  }

  return {
    get token() {
      return accessToken;
    },

    /** POST /v1/admin/auth/login. The DTO names the field `username`. */
    async login(username, password) {
      const tokens = await request('POST', '/v1/admin/auth/login', {
        body: { username, password },
      });
      accessToken = tokens?.accessToken ?? null;
      if (!accessToken) {
        throw new Error('the login answered no access token');
      }
      return tokens;
    },

    /** GET /v1/admin/catalog/supermarkets, every page. */
    listSupermarkets() {
      return pageThrough('/v1/admin/catalog/supermarkets', { order: 'name' });
    },

    /**
     * GET /v1/admin/harvest/entries, every page of one chain's queue.
     *
     * Absent `status` is the queue itself: CANDIDATE and UNRESOLVED, the two
     * statuses waiting for a person. The route orders newest first and offers
     * no other order, so the caller reverses what comes back.
     */
    listQueue(supermarketId) {
      return pageThrough('/v1/admin/harvest/entries', { supermarketId });
    },

    /** GET /v1/admin/catalog/items, ranked. */
    async searchItems(query, limit = CANDIDATE_LIMIT) {
      const answer = await request('GET', '/v1/admin/catalog/items', {
        query: { query, order: 'relevance', limit },
      });
      return answer?.items ?? [];
    },

    /** GET /v1/admin/catalog/items/{id}, or null when catalog holds no such id. */
    async getItem(id) {
      try {
        return await request(
          'GET',
          `/v1/admin/catalog/items/${encodeURIComponent(id)}`
        );
      } catch {
        return null;
      }
    },

    /**
     * The EAN lookup, through the search route.
     *
     * No admin route exposes catalog's own `findItemByEan`; the search route is
     * what the back office uses, and it matches a whole barcode exactly and
     * ranks that row first. The answer is filtered on equality here, so a text
     * hit that merely scored well is not mistaken for the barcode's owner.
     */
    async findByEan(ean) {
      if (!ean) {
        return null;
      }
      const items = await this.searchItems(ean, 5);
      return items.find((item) => item.ean === ean) ?? null;
    },

    /** POST /v1/admin/harvest/entries/{id}/accept. */
    accept(entryId, itemId) {
      return request(
        'POST',
        `/v1/admin/harvest/entries/${encodeURIComponent(entryId)}/accept`,
        { body: { itemId } }
      );
    },

    /** POST /v1/admin/harvest/entries/{id}/item. */
    createItem(entryId, body) {
      return request(
        'POST',
        `/v1/admin/harvest/entries/${encodeURIComponent(entryId)}/item`,
        { body }
      );
    },
  };
}

/** The body the create route's DTO actually names (CreateItemFromEntryDto). */
export function toCreateItemBody(item) {
  return {
    name: item.nameEn
      ? { es: item.nameEs, en: item.nameEn }
      : { es: item.nameEs },
    brand: item.brand,
    ean: item.ean,
    unitSize: item.unitSize,
    category: item.category,
    defaultUnit: item.defaultUnit,
  };
}

// ---------------------------------------------------------------------------
// One entry, end to end
// ---------------------------------------------------------------------------

/** The deterministic pre-pass: no model, and the same key the ladder used. */
export async function prePass({ gateway, entry }) {
  const eanMatch = await gateway.findByEan(entry.ean);
  const key = normalizeName(entry.name);
  const found = key ? await gateway.searchItems(key) : [];
  const candidates = found.map((item) => toCandidate(item));

  const itemsById = new Map(found.map((item) => [item.id, item]));
  if (eanMatch) {
    itemsById.set(eanMatch.id, eanMatch);
  }

  // The item the ladder itself proposed, when it proposed one and the search
  // did not surface it. It is the answer the queue is most often waiting on.
  if (entry.itemId && !itemsById.has(entry.itemId)) {
    const proposed = await gateway.getItem(entry.itemId);
    if (proposed) {
      itemsById.set(proposed.id, proposed);
      candidates.unshift(toCandidate(proposed, true));
    }
  }

  return { candidates, eanMatch, itemsById };
}

/**
 * The whole judgment for one row: pre-pass, one model call, the threshold, the
 * validators, and then the write when `apply` is set.
 *
 * The record it answers is what one stdout line holds.
 */
export async function reviewEntry({
  entry,
  gateway,
  supermarket,
  system,
  apiKey,
  fetchImpl,
  sleep = defaultSleep,
  usage = null,
  privateLabels,
  categories,
  units,
  apply = false,
}) {
  const base = {
    entryId: entry.id,
    entryName: entry.name,
    supermarketId: entry.supermarketId,
  };

  const { candidates, eanMatch, itemsById } = await prePass({ gateway, entry });
  const packet = buildEntryPacket({ entry, supermarket, candidates, eanMatch });

  let answer;
  try {
    answer = await askModel({
      fetchImpl,
      apiKey,
      system,
      packet,
      sleep,
      usage,
    });
  } catch (error) {
    return {
      ...base,
      decision: 'REVIEW',
      proposedDecision: null,
      itemId: null,
      item: null,
      confidence: 0,
      issues: [issue('MODEL_CALL_FAILED', String(error.message ?? error))],
      reasoning: '',
      applied: false,
    };
  }

  if (!answer.ok) {
    return {
      ...base,
      decision: 'REVIEW',
      proposedDecision: null,
      itemId: null,
      item: null,
      confidence: 0,
      issues: [issue('MODEL_OUTPUT_INVALID', answer.error)],
      reasoning: '',
      applied: false,
    };
  }

  const decision = answer.decision;
  // The model's own notes are reported and never decide anything. Only what
  // the tool found for itself demotes a decision.
  const found = [];

  if (decision.confidence < CONFIDENCE_THRESHOLD) {
    found.push(
      issue(
        'LOW_CONFIDENCE',
        `Confidence ${decision.confidence} is below the ${CONFIDENCE_THRESHOLD} threshold.`
      )
    );
  }

  let linkTarget = null;
  if (decision.decision === 'LINK' && decision.itemId) {
    linkTarget =
      itemsById.get(decision.itemId) ??
      (await gateway.getItem(decision.itemId));
  }

  let eanOwner = null;
  if (decision.decision === 'CREATE' && decision.item?.ean) {
    eanOwner =
      decision.item.ean === entry.ean
        ? eanMatch
        : await gateway.findByEan(decision.item.ean);
  }

  found.push(
    ...validateDecision({
      decision,
      entry,
      supermarket,
      linkTarget,
      eanOwner,
      privateLabels,
      categories,
      units,
    })
  );

  const final = found.length > 0 ? 'REVIEW' : decision.decision;

  const record = {
    ...base,
    decision: final,
    proposedDecision: final === decision.decision ? null : decision.decision,
    itemId: decision.itemId,
    item: decision.item,
    confidence: decision.confidence,
    issues: [...decision.issues, ...found],
    reasoning: decision.reasoning,
    applied: false,
  };

  if (!apply || final === 'REVIEW') {
    return record;
  }

  try {
    if (final === 'LINK') {
      await gateway.accept(entry.id, decision.itemId);
    } else {
      await gateway.createItem(entry.id, toCreateItemBody(decision.item));
    }
    record.applied = true;
  } catch (error) {
    record.issues = [
      ...record.issues,
      issue('APPLY_FAILED', String(error.message ?? error)),
    ];
  }

  return record;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    apply: false,
    limit: null,
    chain: null,
    baseUrl: DEFAULT_BASE_URL,
    outDir: null,
    help: false,
  };

  const rest = [];
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      rest.push(arg.slice(0, eq), arg.slice(eq + 1));
    } else {
      rest.push(arg);
    }
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = () => {
      const value = rest[++i];
      if (value === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return value;
    };
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--limit': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error('--limit needs a positive whole number');
        }
        options.limit = value;
        break;
      }
      case '--chain':
        options.chain = next();
        break;
      case '--base-url':
        options.baseUrl = next();
        break;
      case '--out-dir':
        options.outDir = next();
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function countsOf(records) {
  const counts = { LINK: 0, CREATE: 0, REVIEW: 0, applied: 0, failed: 0 };
  for (const record of records) {
    counts[record.decision] += 1;
    if (record.applied) {
      counts.applied += 1;
    }
    if (
      record.issues.some((entryIssue) => entryIssue.code === 'APPLY_FAILED')
    ) {
      counts.failed += 1;
    }
  }
  return counts;
}

/**
 * The loop.
 *
 * Every chain the run covers, oldest row first, so a rerun continues where the
 * last one stopped. Deciding a row takes it out of the queue, so the next run
 * of the same chain reads a shorter list.
 */
export async function run({
  argv = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  now = () => new Date(),
  outDir = DEFAULT_OUT_URL,
  openapiUrl = OPENAPI_URL,
  promptUrl = PROMPT_URL,
  privateLabelsUrl = PRIVATE_LABELS_URL,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    stderr(USAGE);
    return { exitCode: 0, records: [], report: null };
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The tool refuses to start rather than failing 52 entries in.'
    );
  }

  const { categories, units } = loadVocabularies(openapiUrl);
  const privateLabels = loadPrivateLabels(privateLabelsUrl);
  const system = buildSystemPrompt({
    template: readFileSync(promptUrl, 'utf8'),
    categories,
    units,
    privateLabels,
  });

  const gateway = makeGatewayClient({
    fetchImpl,
    baseUrl: options.baseUrl,
    token: env.LUNA_ADMIN_TOKEN ?? null,
  });
  if (!gateway.token) {
    const username = env.LUNA_ADMIN_EMAIL ?? env.LUNA_ADMIN_USERNAME;
    const password = env.LUNA_ADMIN_PASSWORD;
    if (!username || !password) {
      throw new Error(
        'No admin session. Set LUNA_ADMIN_TOKEN, or LUNA_ADMIN_EMAIL and LUNA_ADMIN_PASSWORD.'
      );
    }
    await gateway.login(username, password);
  }

  const startedAt = now();
  const supermarkets = await gateway.listSupermarkets();
  const byId = new Map(supermarkets.map((market) => [market.id, market]));
  const chains = options.chain
    ? [options.chain]
    : supermarkets.map((m) => m.id);
  if (options.chain && !byId.has(options.chain)) {
    stderr(
      `warning: no catalog supermarket answers to ${options.chain}; every row of it will be a REVIEW.`
    );
  }

  const queued = [];
  for (const supermarketId of chains) {
    // The route orders newest first and offers no other order, so the page is
    // reversed here to get the oldest row of each chain first.
    const page = await gateway.listQueue(supermarketId);
    queued.push(...page.reverse());
    if (options.limit && queued.length >= options.limit) {
      break;
    }
  }
  const entries = options.limit ? queued.slice(0, options.limit) : queued;

  const usage = emptyUsage();
  const records = [];
  const lines = [];
  for (const [index, entry] of entries.entries()) {
    stderr(`${index + 1}/${entries.length} - ${entry.name}`);
    const record = await reviewEntry({
      entry,
      gateway,
      supermarket: byId.get(entry.supermarketId) ?? null,
      system,
      apiKey,
      fetchImpl,
      sleep,
      usage,
      privateLabels,
      categories,
      units,
      apply: options.apply,
    });
    records.push(record);
    const line = JSON.stringify(record);
    lines.push(line);
    stdout(line);
  }

  const finishedAt = now();
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    baseUrl: options.baseUrl,
    apply: options.apply,
    limit: options.limit,
    chain: options.chain,
    entries: records.length,
    counts: countsOf(records),
    reviews: records
      .filter((record) => record.decision === 'REVIEW')
      .map((record) => ({
        entryId: record.entryId,
        entryName: record.entryName,
        proposedDecision: record.proposedDecision,
        confidence: record.confidence,
        issues: record.issues,
      })),
    usage,
  };

  const dir = new URL(
    options.outDir ? toDirUrl(options.outDir) : outDir,
    pathToFileURL(`${process.cwd()}/`)
  );
  mkdirSync(dir, { recursive: true });
  const suffix = stamp(startedAt);
  const logUrl = new URL(`review-${suffix}.jsonl`, dir);
  const reportUrl = new URL(`review-${suffix}-report.json`, dir);
  writeFileSync(logUrl, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  writeFileSync(reportUrl, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  stderr(`log:    ${fileURLToPath(logUrl)}`);
  stderr(`report: ${fileURLToPath(reportUrl)}`);

  return { exitCode: 0, records, report, logUrl, reportUrl };
}

function toDirUrl(dir) {
  const path = String(dir).replace(/[\\/]*$/, '/');
  return pathToFileURL(path).href;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run({ argv: process.argv.slice(2) })
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${String(error.message ?? error)}\n`);
      process.exitCode = 1;
    });
}
