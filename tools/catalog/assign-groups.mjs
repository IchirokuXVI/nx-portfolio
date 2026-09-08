#!/usr/bin/env node
// Sorts ungrouped catalog products into product groups, with a model in the
// judgment seat (luna plan 0099).
//
// `items.productGroupId` says which items are the same purchase. Nothing in the
// backend assigns it: it is owner curation, so the catalog fills up with
// products in no group and no read can compare them. This tool walks those
// products, asks the model one question per product against the group directory
// it already has, checks the answer with validators that do not guess, and
// writes through the ordinary admin gateway routes under an operator session.
//
// It never deletes or renames a group, and it never touches an item that
// already has one.
//
// Dry run by default. Every decision is printed as one JSON line on stdout and
// saved under tools/catalog/out/, so a run can be read before it is repeated
// with --apply.
//
//   # a dry run over the first 20 ungrouped products of a dev slot
//   ANTHROPIC_API_KEY=sk-... LUNA_ADMIN_USERNAME=admin LUNA_ADMIN_PASSWORD=... \
//     node tools/catalog/assign-groups.mjs --limit 20
//
//   # the same run against slot 1's gateway, writing the assignments
//   ANTHROPIC_API_KEY=sk-... LUNA_ADMIN_TOKEN=eyJ... \
//     node tools/catalog/assign-groups.mjs --apply --base-url http://localhost:43000
//
//   # the whole ungrouped catalog, dry run, decisions only
//   node tools/catalog/assign-groups.mjs > /tmp/groups.jsonl
//
// Zero npm dependencies on purpose: Node built-ins and global fetch only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODEL = 'claude-sonnet-5';
export const MAX_TOKENS = 8000;
export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/** Below this the decision is a REVIEW, whatever the model called it. */
export const CONFIDENCE_FLOOR = 0.9;

/** The gateway clamps a page to this, so asking for more is asking for 100. */
export const PAGE_SIZE = 100;

/** Waits between retries of a call the API refused for a reason that passes. */
export const BACKOFF_MS = [2000, 8000, 30000];

const DEFAULT_BASE_URL = 'http://localhost:3000';

const USAGE = `Usage: node tools/catalog/assign-groups.mjs [options]

  --apply           Write the assignments. Without it the run only reports.
  --limit <n>       Stop after n products. Default: every ungrouped product.
  --base-url <url>  The gateway. Default: ${DEFAULT_BASE_URL}
  --help            This.

Environment:
  ANTHROPIC_API_KEY   Required. The run refuses to start without it.
  LUNA_ADMIN_TOKEN    An admin access token. Skips the login below.
  LUNA_ADMIN_EMAIL    The admin username (LUNA_ADMIN_USERNAME is the same thing).
  LUNA_ADMIN_PASSWORD The admin password.
`;

// ---------------------------------------------------------------------------
// The unit vocabulary, read from the committed OpenAPI document
// ---------------------------------------------------------------------------

/** Where the gateway's own document sits, relative to this file. */
export const OPENAPI_PATH = new URL(
  '../../apps/luna-shopper-backend/gateway/docs/openapi.json',
  import.meta.url
);

/**
 * The units the catalog knows, taken from the document rather than retyped.
 *
 * A unit added to the enum reaches this tool by regenerating the document,
 * which the workspace already requires for every contract change.
 */
export function readUnitVocabulary(path = OPENAPI_PATH) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  const schema = document?.components?.schemas?.['enums.UnitOfMeasure'];
  const values = schema?.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      'enums.UnitOfMeasure carries no values in the OpenAPI document. ' +
        'Regenerate it with `npx nx run luna-shopper-backend-gateway:openapi`.'
    );
  }
  return values;
}

/**
 * Which family each unit belongs to: weight, volume or count.
 *
 * Derived from the vocabulary by the word the unit ends in, so a new unit that
 * follows the same naming lands in the right family on its own. A unit that
 * matches nothing is left out, and the validator reads a missing family as a
 * reason to hand the product to a person rather than as a crash.
 */
export function deriveUnitFamilies(units = readUnitVocabulary()) {
  const families = new Map();
  for (const unit of units) {
    const name = String(unit).toUpperCase();
    if (name.endsWith('GRAM')) {
      families.set(unit, 'weight');
    } else if (name.endsWith('LITER') || name.endsWith('LITRE')) {
      families.set(unit, 'volume');
    } else if (name === 'UNIT' || name === 'PACK') {
      families.set(unit, 'count');
    }
  }
  return families;
}

// ---------------------------------------------------------------------------
// Slugs and names
// ---------------------------------------------------------------------------

/**
 * The slug rule, kept the same as `product-group.service.ts#validateSlug`.
 *
 * Catalog trims and lower cases before testing, so this does too: a slug the
 * service would accept after trimming is not a reason to send a product to a
 * person, and one it would refuse must never reach a POST.
 */
export function isValidSlug(slug) {
  if (typeof slug !== 'string') {
    return false;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim().toLowerCase());
}

/** What catalog would store, which is what a duplicate has to be compared to. */
export function canonicalSlug(slug) {
  return String(slug ?? '')
    .trim()
    .toLowerCase();
}

/**
 * A name reduced to what a collision is about: case, accents and spacing gone.
 *
 * "Aceite de Oliva Virgen Extra" and "aceite de oliva virgen extra" are the
 * same group, and so is one written with an accent the other leaves off.
 */
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every word an existing group answers to, normalized. */
function groupWords(group) {
  const words = [group?.name?.es, group?.name?.en];
  for (const list of [group?.synonyms?.es, group?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

/** Every word a proposed group would answer to, normalized. */
function proposedWords(proposal) {
  const words = [proposal?.nameEs, proposal?.nameEn];
  for (const list of [proposal?.synonyms?.es, proposal?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export const RULES_PROMPT_PATH = new URL(
  './assign-groups-prompt.md',
  import.meta.url
);

export function readRulesPrompt(path = RULES_PROMPT_PATH) {
  return readFileSync(path, 'utf8');
}

/** The group directory as the model reads it. */
export function buildDirectoryBlock(directory) {
  const rows = directory.map((group) => ({
    id: group.id,
    nameEs: group.name?.es ?? null,
    nameEn: group.name?.en ?? null,
    slug: group.slug,
    referenceUnit: group.referenceUnit,
    synonyms: {
      es: group.synonyms?.es ?? [],
      en: group.synonyms?.en ?? [],
    },
  }));
  return `The product groups that exist right now:\n${JSON.stringify(
    rows,
    null,
    2
  )}`;
}

/** The one product the call is about. */
export function buildItemPacket(item) {
  return {
    id: item.id,
    nameEs: item.name?.es ?? null,
    nameEn: item.name?.en ?? null,
    brand: item.brand ?? null,
    unitSize: item.unitSize ?? null,
    defaultUnit: item.defaultUnit ?? null,
    category: item.category ?? null,
    ean: item.ean ?? null,
  };
}

/**
 * The request body, with both system blocks cached.
 *
 * The rules block never changes, so it stays in the cache for the whole run.
 * The directory block is rewritten whenever the run creates a group, which
 * costs one cache write and leaves the rules block read from cache.
 */
export function buildRequestBody({ rulesPrompt, directory, item, note }) {
  const packet = JSON.stringify(buildItemPacket(item), null, 2);
  const content = note ? `${packet}\n\n${note}` : packet;
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      {
        type: 'text',
        text: rulesPrompt,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: buildDirectoryBlock(directory),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content }],
  };
}

/** What a second attempt tells the model about the first one. */
export function retryNote(error) {
  return [
    'Your previous answer could not be read.',
    `The error was: ${error}`,
    'Answer again with exactly one JSON object and nothing else.',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

/** The first text block. Thinking blocks come first and are not the answer. */
export function firstTextBlock(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const block = blocks.find(
    (candidate) =>
      candidate?.type === 'text' && typeof candidate.text === 'string'
  );
  return block ? block.text : null;
}

/** A fence is not supposed to be there, and is cheap to forgive. */
export function stripFence(text) {
  const trimmed = String(text ?? '').trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * The decision the model is allowed to send, checked shape first.
 *
 * Only the shape is checked here. Whether the group it names exists, whether
 * the slug is legal and whether the units agree are questions for the
 * validators, because those answers are demotions rather than bad output.
 */
export function checkDecisionSchema(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['the answer is not a JSON object'] };
  }
  const decisions = ['ASSIGN', 'CREATE_GROUP', 'REVIEW'];
  if (!decisions.includes(value.decision)) {
    errors.push(`"decision" must be one of ${decisions.join(', ')}`);
  }
  if (
    typeof value.confidence !== 'number' ||
    Number.isNaN(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    errors.push('"confidence" must be a number between 0 and 1');
  }
  if (value.issues !== undefined) {
    if (!Array.isArray(value.issues)) {
      errors.push('"issues" must be an array');
    } else {
      for (const issue of value.issues) {
        if (!issue || typeof issue.code !== 'string') {
          errors.push('every issue needs a string "code"');
          break;
        }
      }
    }
  }
  if (value.decision === 'ASSIGN' && typeof value.groupId !== 'string') {
    errors.push('an ASSIGN needs "groupId"');
  }
  if (value.decision === 'CREATE_GROUP') {
    const group = value.group;
    if (!group || typeof group !== 'object') {
      errors.push('a CREATE_GROUP needs "group"');
    } else {
      for (const field of ['nameEs', 'nameEn', 'slug', 'referenceUnit']) {
        if (typeof group[field] !== 'string' || group[field].trim() === '') {
          errors.push(`"group.${field}" must be a non empty string`);
        }
      }
      if (group.synonyms !== undefined) {
        const lists = [group.synonyms?.es, group.synonyms?.en];
        const bad = lists.some(
          (list) => list !== undefined && !Array.isArray(list)
        );
        if (bad) {
          errors.push('"group.synonyms.es" and ".en" must be arrays');
        }
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Text to decision, with the schema check applied. */
export function parseDecisionText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'the answer carried no text block' };
  }
  let value;
  try {
    value = JSON.parse(stripFence(text));
  } catch (error) {
    return {
      ok: false,
      error: `the answer is not valid JSON (${error.message})`,
    };
  }
  const schema = checkDecisionSchema(value);
  if (!schema.ok) {
    return { ok: false, error: schema.errors.join('; ') };
  }
  return { ok: true, decision: normalizeDecision(value) };
}

/** The decision with its optional parts filled in, so nothing reads undefined. */
function normalizeDecision(value) {
  const decision = {
    decision: value.decision,
    confidence: value.confidence,
    issues: Array.isArray(value.issues)
      ? value.issues.map((issue) => ({
          code: String(issue.code),
          detail: typeof issue.detail === 'string' ? issue.detail : '',
        }))
      : [],
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : '',
  };
  if (value.decision === 'ASSIGN') {
    decision.groupId = value.groupId;
  }
  if (value.decision === 'CREATE_GROUP') {
    decision.group = {
      nameEs: value.group.nameEs,
      nameEn: value.group.nameEn,
      slug: value.group.slug,
      referenceUnit: value.group.referenceUnit,
      synonyms: {
        es: Array.isArray(value.group.synonyms?.es)
          ? value.group.synonyms.es.map(String)
          : [],
        en: Array.isArray(value.group.synonyms?.en)
          ? value.group.synonyms.en.map(String)
          : [],
      },
    };
  }
  return decision;
}

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

/**
 * Every reason this decision must not be written, named.
 *
 * An empty list is the only thing that lets a write happen. The checks run
 * against the directory as it stands at this moment, which includes the groups
 * earlier products in the same run created.
 */
export function validateDecision({ decision, item, directory, unitFamilies }) {
  const issues = [];
  if (decision.decision === 'ASSIGN') {
    const target = directory.find((group) => group.id === decision.groupId);
    if (!target) {
      issues.push({
        code: 'GROUP_TARGET_MISSING',
        detail: `no group in the directory has the id ${decision.groupId}`,
      });
    } else {
      issues.push(
        ...unitIssues(target.referenceUnit, item.defaultUnit, unitFamilies)
      );
    }
    return issues;
  }

  if (decision.decision !== 'CREATE_GROUP') {
    return issues;
  }

  const proposal = decision.group;
  const slug = canonicalSlug(proposal.slug);
  if (!isValidSlug(proposal.slug)) {
    issues.push({
      code: 'SLUG_INVALID',
      detail: `"${proposal.slug}" is not lower case words separated by single dashes`,
    });
  } else if (directory.some((group) => canonicalSlug(group.slug) === slug)) {
    issues.push({
      code: 'SLUG_TAKEN',
      detail: `the slug "${slug}" already belongs to a group`,
    });
  }

  const words = proposedWords(proposal);
  for (const group of directory) {
    const existing = groupWords(group);
    const shared = [...words].filter((word) => existing.has(word));
    if (shared.length) {
      issues.push({
        code: 'GROUP_DUPLICATE',
        detail: `"${shared[0]}" already names the group ${group.slug}`,
      });
      break;
    }
  }

  issues.push(
    ...unitIssues(proposal.referenceUnit, item.defaultUnit, unitFamilies)
  );
  return issues;
}

/** The reference unit and the product's own unit have to be the same kind. */
function unitIssues(referenceUnit, defaultUnit, unitFamilies) {
  const families = unitFamilies ?? new Map();
  const reference = families.get(referenceUnit);
  const item = families.get(defaultUnit);
  if (!reference || !item) {
    const unknown = !reference ? referenceUnit : defaultUnit;
    return [
      {
        code: 'UNIT_FAMILY_MISMATCH',
        detail: `"${unknown}" is not a unit this tool can place in a family`,
      },
    ];
  }
  if (reference !== item) {
    return [
      {
        code: 'UNIT_FAMILY_MISMATCH',
        detail: `the group compares in ${referenceUnit} (${reference}) and the product is sold in ${defaultUnit} (${item})`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} answered ${status}: ${body}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

async function readBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** One call to the gateway, with the operator's session on it. */
async function gateway(deps, method, path, body) {
  const url = `${deps.baseUrl}${path}`;
  const headers = { authorization: `Bearer ${deps.token}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await deps.fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HttpError(method, url, response.status, await readBody(response));
  }
  return response.status === 204 ? null : await response.json();
}

/** Walks a cursor paginated list to the end. */
async function readAll(deps, path, { max } = {}) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const remaining = max === undefined ? PAGE_SIZE : max - rows.length;
    if (remaining <= 0) {
      break;
    }
    const query = new URLSearchParams(deps.query ?? {});
    query.set('limit', String(Math.min(PAGE_SIZE, remaining)));
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page = await gateway(deps, 'GET', `${path}?${query}`);
    rows.push(...(page?.items ?? []));
    cursor = page?.nextCursor ?? null;
    if (!cursor) {
      break;
    }
  }
  return rows;
}

/** Every product group there is, which is the directory the model reads. */
export function fetchDirectory(deps) {
  return readAll(
    { ...deps, query: { order: 'name' } },
    '/v1/admin/catalog/product-groups'
  );
}

/**
 * The products in no group.
 *
 * `productGroupId=none` is the filter, not a boolean: the gateway spells "the
 * rows pointing at nothing" with that literal on the reference parameter
 * itself (admin plan 0012, section 2). It used to be `withoutProductGroup`,
 * which no longer exists on the route.
 *
 * The plan asks for the oldest products first and the gateway does not offer
 * that: `order=created` is creation order, newest first, and it is the only
 * creation order there is. It is taken anyway, because what the walk needs is
 * an order that does not shift under it, and keyset paging over `created`
 * gives that whichever way it points.
 */
export function fetchUngroupedItems(deps, limit) {
  return readAll(
    { ...deps, query: { productGroupId: 'none', order: 'created' } },
    '/v1/admin/catalog/items',
    { max: limit }
  );
}

/** The one write that joins a product to a group. */
export function assignItem(deps, itemId, productGroupId) {
  return gateway(deps, 'PATCH', `/v1/admin/catalog/items/${itemId}`, {
    productGroupId,
  });
}

/** Creates the group a product needed and nobody had made. */
export function createGroup(deps, proposal) {
  return gateway(deps, 'POST', '/v1/admin/catalog/product-groups', {
    name: { es: proposal.nameEs, en: proposal.nameEn },
    slug: canonicalSlug(proposal.slug),
    referenceUnit: proposal.referenceUnit,
    synonyms: {
      es: proposal.synonyms?.es ?? [],
      en: proposal.synonyms?.en ?? [],
    },
  });
}

/** The operator session, from a token that was handed over or from a login. */
export async function resolveToken({ baseUrl, fetchImpl, env }) {
  const token = env.LUNA_ADMIN_TOKEN;
  if (token) {
    return token;
  }
  const username = env.LUNA_ADMIN_EMAIL ?? env.LUNA_ADMIN_USERNAME;
  const password = env.LUNA_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'No admin session. Set LUNA_ADMIN_TOKEN, or LUNA_ADMIN_EMAIL ' +
        '(or LUNA_ADMIN_USERNAME) together with LUNA_ADMIN_PASSWORD.'
    );
  }
  const url = `${baseUrl}/v1/admin/auth/login`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new HttpError('POST', url, response.status, await readBody(response));
  }
  const tokens = await response.json();
  if (!tokens?.accessToken) {
    throw new Error('The login answered without an accessToken.');
  }
  return tokens.accessToken;
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

function isRetryable(status) {
  return status === 429 || status >= 500;
}

/**
 * One call, retried while the API says the reason passes.
 *
 * A 429 or a 5xx is waited out three times. Anything else is the caller's
 * problem the first time it is said, because repeating a refused request does
 * not change the answer.
 */
export async function callModel(deps, body) {
  let last = null;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    if (attempt > 0) {
      await deps.sleep(BACKOFF_MS[attempt - 1]);
    }
    let response;
    try {
      response = await deps.fetchImpl(MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': deps.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      last = error;
      continue;
    }
    if (response.ok) {
      return await response.json();
    }
    const text = await readBody(response);
    last = new HttpError('POST', MESSAGES_URL, response.status, text);
    if (!isRetryable(response.status)) {
      throw last;
    }
  }
  throw last ?? new Error('The model call failed.');
}

/**
 * The model's decision about one product, or the reason there is none.
 *
 * An answer that cannot be read is asked again once, with the parse error
 * attached. A second unreadable answer is the model's, not a network problem,
 * so it stops there.
 */
export async function askForDecision(deps, { item, directory }) {
  const usages = [];
  let note;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = buildRequestBody({
      rulesPrompt: deps.rulesPrompt,
      directory,
      item,
      note,
    });
    let message;
    try {
      message = await callModel(deps, body);
    } catch (error) {
      return {
        ok: false,
        usages,
        issue: {
          code: 'MODEL_CALL_FAILED',
          detail: String(error?.message ?? error),
        },
      };
    }
    if (message?.usage) {
      usages.push(message.usage);
    }
    const parsed = parseDecisionText(firstTextBlock(message));
    if (parsed.ok) {
      return { ok: true, usages, decision: parsed.decision };
    }
    note = retryNote(parsed.error);
    if (attempt === 1) {
      return {
        ok: false,
        usages,
        issue: { code: 'MODEL_OUTPUT_INVALID', detail: parsed.error },
      };
    }
  }
  return {
    ok: false,
    usages,
    issue: { code: 'MODEL_OUTPUT_INVALID', detail: 'no answer' },
  };
}

// ---------------------------------------------------------------------------
// One product, end to end
// ---------------------------------------------------------------------------

/** The name a person reads on the progress line and in the report. */
export function itemLabel(item) {
  return item?.name?.es ?? item?.name?.en ?? item?.id ?? '(unnamed)';
}

/**
 * The whole decision for one product: ask, threshold, validate, write.
 *
 * `directory` is mutated when a group is created, which is what lets the
 * hundredth product join the group the fortieth one made. In a dry run the
 * group is appended with a `dry-run:` id instead of a real one, so the rest of
 * the run previews the same shape it would take with --apply.
 */
export async function processItem(deps, { item, directory }) {
  const record = {
    itemId: item.id,
    itemName: itemLabel(item),
    decision: 'REVIEW',
    modelDecision: null,
    groupId: null,
    group: null,
    confidence: null,
    issues: [],
    reasoning: '',
    applied: false,
  };

  const answer = await askForDecision(deps, { item, directory });
  for (const usage of answer.usages) {
    deps.onUsage?.(usage);
  }
  if (!answer.ok) {
    record.issues = [answer.issue];
    return record;
  }

  const decision = answer.decision;
  record.modelDecision = decision.decision;
  record.confidence = decision.confidence;
  record.reasoning = decision.reasoning;
  record.issues = [...decision.issues];
  if (decision.decision === 'ASSIGN') {
    record.groupId = decision.groupId;
  }
  if (decision.decision === 'CREATE_GROUP') {
    record.group = decision.group;
  }

  if (decision.decision === 'REVIEW') {
    return record;
  }

  if (decision.confidence < CONFIDENCE_FLOOR) {
    record.issues.push({
      code: 'LOW_CONFIDENCE',
      detail: `confidence ${decision.confidence} is below ${CONFIDENCE_FLOOR}`,
    });
    return record;
  }

  const problems = validateDecision({
    decision,
    item,
    directory,
    unitFamilies: deps.unitFamilies,
  });
  if (problems.length) {
    record.issues.push(...problems);
    return record;
  }

  record.decision = decision.decision;
  if (!deps.apply) {
    if (decision.decision === 'CREATE_GROUP') {
      const preview = {
        id: `dry-run:${canonicalSlug(decision.group.slug)}`,
        name: { es: decision.group.nameEs, en: decision.group.nameEn },
        slug: canonicalSlug(decision.group.slug),
        referenceUnit: decision.group.referenceUnit,
        synonyms: decision.group.synonyms,
      };
      directory.push(preview);
      record.groupId = preview.id;
    }
    return record;
  }

  let groupId = record.groupId;
  if (decision.decision === 'CREATE_GROUP') {
    let created;
    try {
      created = await createGroup(deps, decision.group);
    } catch (error) {
      record.decision = 'REVIEW';
      record.issues.push({
        code: 'APPLY_FAILED',
        detail: `the group was not created: ${error?.message ?? error}`,
      });
      return record;
    }
    directory.push(created);
    record.groupCreated = created;
    groupId = created.id;
    record.groupId = groupId;
  }

  try {
    await assignItem(deps, item.id, groupId);
    record.applied = true;
  } catch (error) {
    record.decision = 'REVIEW';
    record.issues.push({
      code: 'APPLY_FAILED',
      detail: `the product was not assigned: ${error?.message ?? error}`,
    });
  }
  return record;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function emptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function addUsage(total, usage) {
  total.calls += 1;
  total.inputTokens += usage.input_tokens ?? 0;
  total.outputTokens += usage.output_tokens ?? 0;
  total.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  total.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * The whole run: the directory once, then one model call per product.
 *
 * `fetchImpl` and `sleep` are arguments so the tests can drive the whole loop
 * without a network and without waiting.
 */
export async function runAssign(options) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    token,
    apiKey,
    apply = false,
    limit,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => delay(ms),
    unitFamilies = deriveUnitFamilies(),
    rulesPrompt = readRulesPrompt(),
    stdout = (line) => process.stdout.write(`${line}\n`),
    stderr = (line) => process.stderr.write(`${line}\n`),
    startedAt = new Date().toISOString(),
  } = options;

  const usage = emptyUsage();
  const deps = {
    baseUrl,
    token,
    apiKey,
    apply,
    fetchImpl,
    sleep,
    unitFamilies,
    rulesPrompt,
    onUsage: (one) => addUsage(usage, one),
  };

  const directory = await fetchDirectory(deps);
  const groupsAtStart = directory.length;
  const items = await fetchUngroupedItems(deps, limit);
  stderr(
    `${items.length} ungrouped products, ${groupsAtStart} groups, ` +
      `${apply ? 'applying' : 'dry run'}`
  );

  const records = [];
  for (const [index, item] of items.entries()) {
    stderr(`${index + 1}/${items.length} - ${itemLabel(item)}`);
    const record = await processItem(deps, { item, directory });
    records.push(record);
    stdout(JSON.stringify(record));
  }

  const report = buildReport({
    records,
    baseUrl,
    apply,
    startedAt,
    finishedAt: new Date().toISOString(),
    groupsAtStart,
    usage,
  });
  return { report, records };
}

/** What the run did, in the shape a person reads afterwards. */
export function buildReport({
  records,
  baseUrl,
  apply,
  startedAt,
  finishedAt,
  groupsAtStart,
  usage,
}) {
  const counts = { ASSIGN: 0, CREATE_GROUP: 0, REVIEW: 0 };
  const reviews = [];
  const groupsCreated = [];
  for (const record of records) {
    counts[record.decision] = (counts[record.decision] ?? 0) + 1;
    if (record.decision === 'REVIEW') {
      reviews.push({
        itemId: record.itemId,
        itemName: record.itemName,
        modelDecision: record.modelDecision,
        confidence: record.confidence,
        issues: record.issues,
      });
    }
    if (record.groupCreated) {
      groupsCreated.push({
        id: record.groupCreated.id,
        slug: record.groupCreated.slug,
        name: record.groupCreated.name,
        referenceUnit: record.groupCreated.referenceUnit,
        forItemId: record.itemId,
      });
    }
  }
  return {
    startedAt,
    finishedAt,
    baseUrl,
    mode: apply ? 'apply' : 'dry-run',
    items: records.length,
    groupsAtStart,
    counts,
    applied: records.filter((record) => record.applied).length,
    reviews,
    groupsCreated,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Output files
// ---------------------------------------------------------------------------

export const OUT_DIR = new URL('./out/', import.meta.url);

/** A file name a shell never needs quoting for. */
export function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function writeRunFiles({ records, report, outDir = OUT_DIR, stamp }) {
  mkdirSync(outDir, { recursive: true });
  const lines = new URL(`groups-${stamp}.jsonl`, outDir);
  const summary = new URL(`groups-${stamp}-report.json`, outDir);
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  writeFileSync(lines, body ? `${body}\n` : '', 'utf8');
  writeFileSync(summary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { lines, summary };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { apply: false, baseUrl: DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--limit': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(
            '--limit takes a whole number of products, 1 or more.'
          );
        }
        options.limit = value;
        break;
      }
      case '--base-url':
        options.baseUrl = String(next()).replace(/\/+$/, '');
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option \`${arg}\`.\n\n${USAGE}`);
    }
  }
  return options;
}

async function main(argv, env) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'ANTHROPIC_API_KEY is not set. This tool asks the model about every ' +
        'product, so there is nothing it can do without one.\n'
    );
    return 1;
  }
  const token = await resolveToken({
    baseUrl: options.baseUrl,
    fetchImpl: globalThis.fetch,
    env,
  });

  const { report, records } = await runAssign({ ...options, apiKey, token });

  const stamp = fileTimestamp();
  const files = writeRunFiles({ records, report, stamp });
  const counts = report.counts;
  process.stderr.write(
    `\n${report.mode}: ${counts.ASSIGN} assigned, ` +
      `${counts.CREATE_GROUP} new groups, ${counts.REVIEW} for review\n` +
      `${files.lines.pathname}\n${files.summary.pathname}\n`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exitCode = 1;
    });
}
