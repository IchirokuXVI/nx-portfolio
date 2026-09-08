// The verification section of luna plan 0099.
//
// Everything here runs against injected fakes. No test reaches the network, the
// gateway or the model, and no test waits: the backoff sleep is a spy that
// records the delay it was asked for and returns at once.
//
//   node --test tools/catalog/assign-groups.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  BACKOFF_MS,
  buildDirectoryBlock,
  buildItemPacket,
  buildRequestBody,
  canonicalSlug,
  checkDecisionSchema,
  deriveUnitFamilies,
  fileTimestamp,
  firstTextBlock,
  isValidSlug,
  MESSAGES_URL,
  normalizeName,
  parseArgs,
  parseDecisionText,
  processItem,
  readUnitVocabulary,
  resolveToken,
  runAssign,
  stripFence,
  validateDecision,
  writeRunFiles,
} from './assign-groups.mjs';

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
}

const DIRECTORY_PAGE = fixture('groups-directory-page-1.json');
const ITEMS_PAGE_1 = fixture('groups-items-page-1.json');
const ITEMS_PAGE_2 = fixture('groups-items-page-2.json');
const REPLIES = fixture('groups-model-replies.json');

const MILK_GROUP = DIRECTORY_PAGE.items[0];
const MILK_ITEM = ITEMS_PAGE_1.items[0];
const RICE_ITEM = ITEMS_PAGE_1.items[1];
const OAT_ITEM = ITEMS_PAGE_1.items[2];
const OIL_ITEM = ITEMS_PAGE_2.items[0];
const CHEESE_ITEM = ITEMS_PAGE_2.items[1];

const BASE_URL = 'http://localhost:3000';
const UNITS = deriveUnitFamilies(readUnitVocabulary());
const RULES = 'the rules';

const CREATED_RICE_GROUP = {
  id: '33333333-3333-4333-8333-333333333301',
  name: { es: 'Arroz redondo', en: 'Round rice' },
  slug: 'arroz-redondo',
  referenceUnit: 'KILOGRAM',
  synonyms: { es: ['arroz'], en: ['rice'] },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status, body = 'nope') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

/** The item packet the request carried, whatever note was appended to it. */
function packetOf(init) {
  const content = JSON.parse(init.body).messages[0].content;
  return JSON.parse(content.split('\n\n')[0]);
}

/** The directory the request showed the model. */
function directoryOf(init) {
  const text = JSON.parse(init.body).system[1].text;
  return JSON.parse(text.slice(text.indexOf('\n') + 1));
}

/**
 * A gateway and a model in one function, recording every call.
 *
 * `model` is handed the item packet and the whole request, so a test can answer
 * differently per product or read the directory the run has built so far.
 */
function fakeFetch({ model, createdGroup = CREATED_RICE_GROUP, calls }) {
  return async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });

    if (url === MESSAGES_URL) {
      return model(packetOf(init), init);
    }
    if (method === 'POST' && url.includes('/v1/admin/catalog/product-groups')) {
      return jsonResponse(createdGroup, 201);
    }
    if (method === 'PATCH' && url.includes('/v1/admin/catalog/items/')) {
      return jsonResponse({ id: url.split('/').pop() });
    }
    if (url.includes('/v1/admin/catalog/product-groups?')) {
      return jsonResponse(DIRECTORY_PAGE);
    }
    if (url.includes('/v1/admin/catalog/items?')) {
      const page = url.includes('cursor=cursor-items-page-2')
        ? ITEMS_PAGE_2
        : ITEMS_PAGE_1;
      const asked = Number(new URL(url).searchParams.get('limit'));
      return jsonResponse({ ...page, items: page.items.slice(0, asked) });
    }
    throw new Error(`the fake was asked for ${method} ${url}`);
  };
}

/** The gateway calls only, so the model's own POST is not counted as a write. */
function gatewayCalls(calls, method) {
  return calls.filter(
    (call) => call.url !== MESSAGES_URL && call.method === method
  );
}

/** The canned reply for this product, from the fixtures. */
const cannedModel = (packet) => jsonResponse(REPLIES[packet.id]);

function textReply(decision, usage) {
  return jsonResponse({
    content: [{ type: 'text', text: JSON.stringify(decision) }],
    usage: usage ?? { input_tokens: 10, output_tokens: 5 },
  });
}

function noSleep(record = []) {
  return async (ms) => {
    record.push(ms);
  };
}

function baseDeps(overrides = {}) {
  return {
    baseUrl: BASE_URL,
    token: 'token',
    apiKey: 'key',
    apply: false,
    rulesPrompt: RULES,
    unitFamilies: UNITS,
    sleep: noSleep(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The unit vocabulary
// ---------------------------------------------------------------------------

describe('unit families', () => {
  it('reads the vocabulary out of the committed OpenAPI document', () => {
    const units = readUnitVocabulary();
    assert.deepEqual(units, [
      'UNIT',
      'GRAM',
      'KILOGRAM',
      'MILLILITER',
      'LITER',
      'PACK',
    ]);
  });

  it('sorts every known unit into weight, volume or count', () => {
    assert.equal(UNITS.get('GRAM'), 'weight');
    assert.equal(UNITS.get('KILOGRAM'), 'weight');
    assert.equal(UNITS.get('MILLILITER'), 'volume');
    assert.equal(UNITS.get('LITER'), 'volume');
    assert.equal(UNITS.get('UNIT'), 'count');
    assert.equal(UNITS.get('PACK'), 'count');
  });

  it('leaves a unit it cannot place out, rather than guessing', () => {
    const families = deriveUnitFamilies(['LITER', 'FURLONG']);
    assert.equal(families.get('LITER'), 'volume');
    assert.equal(families.has('FURLONG'), false);
  });
});

// ---------------------------------------------------------------------------
// Slugs and names
// ---------------------------------------------------------------------------

describe('isValidSlug', () => {
  // The cases product-group.service.ts#validateSlug accepts and refuses.
  const accepted = ['leche', 'leche-semidesnatada', 'aceite-2', '123', 'a-b-c'];
  const refused = [
    '',
    '-leche',
    'leche-',
    'leche--semi',
    'Leche Semidesnatada',
    'leche_semi',
    'café',
    'leche/semi',
  ];

  for (const slug of accepted) {
    it(`accepts ${JSON.stringify(slug)}`, () => {
      assert.equal(isValidSlug(slug), true);
    });
  }
  for (const slug of refused) {
    it(`refuses ${JSON.stringify(slug)}`, () => {
      assert.equal(isValidSlug(slug), false);
    });
  }

  it('trims and lower cases first, exactly as the service does', () => {
    assert.equal(isValidSlug('  Leche-Semi  '), true);
    assert.equal(canonicalSlug('  Leche-Semi  '), 'leche-semi');
  });
});

describe('normalizeName', () => {
  it('takes case, accents and punctuation out of a collision', () => {
    assert.equal(normalizeName('Papel Higiénico'), 'papel higienico');
    assert.equal(
      normalizeName('Aceite de Oliva  Virgen-Extra'),
      'aceite de oliva virgen extra'
    );
  });
});

// ---------------------------------------------------------------------------
// Reading the model's answer
// ---------------------------------------------------------------------------

describe('reading the answer', () => {
  it('skips thinking blocks and takes the first text block', () => {
    const message = {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'the answer' },
        { type: 'text', text: 'not this one' },
      ],
    };
    assert.equal(firstTextBlock(message), 'the answer');
  });

  it('forgives a stray code fence', () => {
    assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(stripFence('  {"a":1}  '), '{"a":1}');
  });

  it('refuses an answer that is not JSON', () => {
    const parsed = parseDecisionText('I think it is milk.');
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /not valid JSON/);
  });

  it('refuses an ASSIGN with no groupId and a confidence out of range', () => {
    const schema = checkDecisionSchema({ decision: 'ASSIGN', confidence: 4 });
    assert.equal(schema.ok, false);
    assert.equal(schema.errors.length, 2);
  });

  it('fills the optional parts in, so nothing downstream reads undefined', () => {
    const parsed = parseDecisionText('{"decision":"REVIEW","confidence":0.4}');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.decision.issues, []);
    assert.equal(parsed.decision.reasoning, '');
  });
});

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

describe('the request', () => {
  it('caches both system blocks and puts the directory second', () => {
    const body = buildRequestBody({
      rulesPrompt: RULES,
      directory: DIRECTORY_PAGE.items,
      item: MILK_ITEM,
    });
    assert.equal(body.model, 'claude-sonnet-5');
    assert.equal(body.max_tokens, 8000);
    assert.deepEqual(body.thinking, { type: 'adaptive' });
    assert.deepEqual(body.output_config, { effort: 'medium' });
    assert.equal(body.system.length, 2);
    assert.equal(body.system[0].text, RULES);
    for (const block of body.system) {
      assert.deepEqual(block.cache_control, { type: 'ephemeral' });
    }
    assert.match(body.system[1].text, /leche-semidesnatada/);
    assert.deepEqual(JSON.parse(body.messages[0].content), {
      id: MILK_ITEM.id,
      nameEs: MILK_ITEM.name.es,
      nameEn: MILK_ITEM.name.en,
      brand: 'Hacendado',
      unitSize: 1,
      defaultUnit: 'LITER',
      category: 'DAIRY',
      ean: MILK_ITEM.ean,
    });
  });

  it('names every group in the directory block', () => {
    const block = buildDirectoryBlock(DIRECTORY_PAGE.items);
    const rows = JSON.parse(block.slice(block.indexOf('\n') + 1));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      id: MILK_GROUP.id,
      nameEs: MILK_GROUP.name.es,
      nameEn: MILK_GROUP.name.en,
      slug: MILK_GROUP.slug,
      referenceUnit: 'LITER',
      synonyms: MILK_GROUP.synonyms,
    });
  });

  it('leaves a missing field null rather than absent', () => {
    const packet = buildItemPacket({ id: 'x', name: { en: 'Salt' } });
    assert.deepEqual(packet, {
      id: 'x',
      nameEs: null,
      nameEn: 'Salt',
      brand: null,
      unitSize: null,
      defaultUnit: null,
      category: null,
      ean: null,
    });
  });
});

// ---------------------------------------------------------------------------
// The validators
// ---------------------------------------------------------------------------

const codes = (issues) => issues.map((issue) => issue.code);

function validate(decision, item, directory = DIRECTORY_PAGE.items) {
  return validateDecision({
    decision,
    item,
    directory,
    unitFamilies: UNITS,
  });
}

function assignTo(groupId, confidence = 0.95) {
  return { decision: 'ASSIGN', groupId, confidence, issues: [], reasoning: '' };
}

function createGroupDecision(group, confidence = 0.95) {
  return {
    decision: 'CREATE_GROUP',
    group: {
      nameEs: 'Arroz redondo',
      nameEn: 'Round rice',
      slug: 'arroz-redondo',
      referenceUnit: 'KILOGRAM',
      synonyms: { es: [], en: [] },
      ...group,
    },
    confidence,
    issues: [],
    reasoning: '',
  };
}

describe('validators', () => {
  it('stays quiet on an ASSIGN that fits', () => {
    assert.deepEqual(validate(assignTo(MILK_GROUP.id), MILK_ITEM), []);
  });

  it('stays quiet on a CREATE_GROUP that fits', () => {
    assert.deepEqual(validate(createGroupDecision({}), RICE_ITEM), []);
  });

  it('GROUP_TARGET_MISSING when the id is not in the directory', () => {
    const issues = validate(assignTo('not-a-group'), MILK_ITEM);
    assert.deepEqual(codes(issues), ['GROUP_TARGET_MISSING']);
    assert.match(issues[0].detail, /not-a-group/);
  });

  it('SLUG_INVALID on a slug the catalog would refuse', () => {
    const issues = validate(
      createGroupDecision({ slug: 'Arroz_Redondo' }),
      RICE_ITEM
    );
    assert.deepEqual(codes(issues), ['SLUG_INVALID']);
  });

  it('SLUG_TAKEN when the directory already holds it', () => {
    const issues = validate(
      createGroupDecision({
        slug: MILK_GROUP.slug,
        nameEs: 'Arroz redondo',
        nameEn: 'Round rice',
        referenceUnit: 'KILOGRAM',
      }),
      RICE_ITEM
    );
    assert.deepEqual(codes(issues), ['SLUG_TAKEN']);
  });

  it('GROUP_DUPLICATE on a name that already names a group', () => {
    const issues = validate(
      createGroupDecision({
        nameEs: 'Aceite de Oliva Virgen Extra',
        nameEn: 'Extra virgin olive oil',
        slug: 'aceite-oliva-virgen-extra',
        referenceUnit: 'LITER',
      }),
      OIL_ITEM
    );
    assert.deepEqual(codes(issues), ['GROUP_DUPLICATE']);
    assert.match(issues[0].detail, /aceite-de-oliva-virgen-extra/);
  });

  it('GROUP_DUPLICATE on a synonym collision too', () => {
    const issues = validate(
      createGroupDecision({
        nameEs: 'Oro líquido',
        nameEn: 'Liquid gold',
        slug: 'oro-liquido',
        referenceUnit: 'LITER',
        synonyms: { es: ['AOVE'], en: [] },
      }),
      OIL_ITEM
    );
    assert.deepEqual(codes(issues), ['GROUP_DUPLICATE']);
  });

  it('UNIT_FAMILY_MISMATCH when weight meets volume', () => {
    const issues = validate(assignTo(MILK_GROUP.id), CHEESE_ITEM);
    assert.deepEqual(codes(issues), ['UNIT_FAMILY_MISMATCH']);
    assert.match(issues[0].detail, /weight/);
  });

  it('UNIT_FAMILY_MISMATCH on a unit the vocabulary does not carry', () => {
    const issues = validate(assignTo(MILK_GROUP.id), {
      ...MILK_ITEM,
      defaultUnit: 'FURLONG',
    });
    assert.deepEqual(codes(issues), ['UNIT_FAMILY_MISMATCH']);
    assert.match(issues[0].detail, /FURLONG/);
  });

  it('says nothing about a REVIEW, which writes nothing anyway', () => {
    assert.deepEqual(
      validate({ decision: 'REVIEW', confidence: 0.2, issues: [] }, MILK_ITEM),
      []
    );
  });
});

// ---------------------------------------------------------------------------
// One product at a time
// ---------------------------------------------------------------------------

describe('processItem', () => {
  it('demotes a decision below the confidence floor', async () => {
    const deps = baseDeps({
      fetchImpl: async () => textReply(assignTo(MILK_GROUP.id, 0.89)),
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(record.decision, 'REVIEW');
    assert.equal(record.modelDecision, 'ASSIGN');
    assert.deepEqual(codes(record.issues), ['LOW_CONFIDENCE']);
    assert.equal(record.applied, false);
  });

  it('keeps a decision exactly on the floor', async () => {
    const deps = baseDeps({
      fetchImpl: async () => textReply(assignTo(MILK_GROUP.id, 0.9)),
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(record.decision, 'ASSIGN');
    assert.deepEqual(record.issues, []);
  });

  it('asks again with the parse error, then takes the second answer', async () => {
    const bodies = [];
    let call = 0;
    const deps = baseDeps({
      fetchImpl: async (url, init) => {
        bodies.push(JSON.parse(init.body));
        call += 1;
        return call === 1
          ? jsonResponse({ content: [{ type: 'text', text: 'sorry, prose' }] })
          : textReply(assignTo(MILK_GROUP.id));
      },
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(call, 2);
    assert.equal(record.decision, 'ASSIGN');
    assert.match(bodies[1].messages[0].content, /could not be read/);
    assert.match(bodies[1].messages[0].content, /not valid JSON/);
  });

  it('records MODEL_OUTPUT_INVALID when the second answer is bad too', async () => {
    let call = 0;
    const deps = baseDeps({
      fetchImpl: async () => {
        call += 1;
        return jsonResponse({
          content: [{ type: 'text', text: 'still prose' }],
        });
      },
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(call, 2);
    assert.equal(record.decision, 'REVIEW');
    assert.deepEqual(codes(record.issues), ['MODEL_OUTPUT_INVALID']);
  });

  it('backs off over 429 and gives up as MODEL_CALL_FAILED', async () => {
    const waits = [];
    let call = 0;
    const deps = baseDeps({
      sleep: noSleep(waits),
      fetchImpl: async () => {
        call += 1;
        return errorResponse(429, 'slow down');
      },
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(call, BACKOFF_MS.length + 1);
    assert.deepEqual(waits, BACKOFF_MS);
    assert.equal(record.decision, 'REVIEW');
    assert.deepEqual(codes(record.issues), ['MODEL_CALL_FAILED']);
  });

  it('does not retry a refusal that repeating cannot change', async () => {
    let call = 0;
    const deps = baseDeps({
      fetchImpl: async () => {
        call += 1;
        return errorResponse(400, 'bad request');
      },
    });
    const record = await processItem(deps, {
      item: MILK_ITEM,
      directory: [...DIRECTORY_PAGE.items],
    });
    assert.equal(call, 1);
    assert.deepEqual(codes(record.issues), ['MODEL_CALL_FAILED']);
  });

  it('records APPLY_FAILED when the group posts but the item does not move', async () => {
    const deps = baseDeps({
      apply: true,
      fetchImpl: async (url, init = {}) => {
        const method = init.method ?? 'GET';
        if (url === MESSAGES_URL) {
          return textReply(createGroupDecision({}));
        }
        if (method === 'POST') {
          return jsonResponse(CREATED_RICE_GROUP, 201);
        }
        return errorResponse(500, 'the patch fell over');
      },
    });
    const directory = [...DIRECTORY_PAGE.items];
    const record = await processItem(deps, { item: RICE_ITEM, directory });
    assert.equal(record.decision, 'REVIEW');
    assert.deepEqual(codes(record.issues), ['APPLY_FAILED']);
    assert.equal(record.applied, false);
    // The group is valid on its own, so it stays and is reported.
    assert.equal(record.groupCreated.id, CREATED_RICE_GROUP.id);
    assert.equal(directory.at(-1).slug, 'arroz-redondo');
  });
});

// ---------------------------------------------------------------------------
// The directory grows during the run
// ---------------------------------------------------------------------------

describe('the directory grows mid run', () => {
  const COFFEE_A = {
    id: '44444444-4444-4444-8444-444444444401',
    name: { es: 'Café molido Marcilla 250 g', en: 'Marcilla ground coffee' },
    brand: 'Marcilla',
    unitSize: 250,
    category: 'PANTRY',
    defaultUnit: 'GRAM',
    ean: null,
    productGroupId: null,
  };
  const COFFEE_B = {
    ...COFFEE_A,
    id: '44444444-4444-4444-8444-444444444402',
    name: { es: 'Café molido Hacendado 250 g', en: 'Hacendado ground coffee' },
    brand: 'Hacendado',
  };
  const COFFEE_GROUP = {
    id: '55555555-5555-4555-8555-555555555501',
    name: { es: 'Café molido', en: 'Ground coffee' },
    slug: 'cafe-molido',
    referenceUnit: 'KILOGRAM',
    synonyms: { es: [], en: [] },
  };

  /** The second product is answered from the directory the run has built. */
  const model = (packet, init) => {
    if (packet.id === COFFEE_A.id) {
      return textReply(
        createGroupDecision({
          nameEs: 'Café molido',
          nameEn: 'Ground coffee',
          slug: 'cafe-molido',
          referenceUnit: 'KILOGRAM',
        })
      );
    }
    const seen = directoryOf(init).find((row) => row.slug === 'cafe-molido');
    assert.ok(seen, 'the new group has to be in the directory block');
    return textReply(assignTo(seen.id));
  };

  it('lets a later product join the group an earlier one created', async () => {
    const calls = [];
    const fetchImpl = fakeFetch({
      model,
      createdGroup: COFFEE_GROUP,
      calls,
    });
    const directory = [...DIRECTORY_PAGE.items];
    const deps = baseDeps({ apply: true, fetchImpl });

    const first = await processItem(deps, { item: COFFEE_A, directory });
    const second = await processItem(deps, { item: COFFEE_B, directory });

    assert.equal(first.decision, 'CREATE_GROUP');
    assert.equal(first.groupId, COFFEE_GROUP.id);
    assert.equal(second.decision, 'ASSIGN');
    assert.equal(second.groupId, COFFEE_GROUP.id);
    assert.equal(second.applied, true);
    assert.equal(directory.length, DIRECTORY_PAGE.items.length + 1);
    assert.equal(gatewayCalls(calls, 'POST').length, 1);
  });

  it('previews the same growth in a dry run, with a dry-run id', async () => {
    const directory = [...DIRECTORY_PAGE.items];
    const calls = [];
    const deps = baseDeps({
      fetchImpl: fakeFetch({ model, createdGroup: COFFEE_GROUP, calls }),
    });

    const first = await processItem(deps, { item: COFFEE_A, directory });
    const second = await processItem(deps, { item: COFFEE_B, directory });

    assert.equal(first.groupId, 'dry-run:cafe-molido');
    assert.equal(second.decision, 'ASSIGN');
    assert.equal(second.groupId, 'dry-run:cafe-molido');
    assert.equal(second.applied, false);
    assert.equal(
      calls.every((call) => call.url === MESSAGES_URL),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// A whole run
// ---------------------------------------------------------------------------

async function fixtureRun(options = {}) {
  const calls = [];
  const out = [];
  const progress = [];
  const { report, records } = await runAssign({
    baseUrl: BASE_URL,
    token: 'token',
    apiKey: 'key',
    rulesPrompt: RULES,
    unitFamilies: UNITS,
    sleep: noSleep(),
    fetchImpl: fakeFetch({ model: cannedModel, calls }),
    stdout: (line) => out.push(line),
    stderr: (line) => progress.push(line),
    startedAt: '2026-09-08T00:00:00.000Z',
    ...options,
  });
  return { report, records, calls, out, progress };
}

describe('a dry run over the fixtures', () => {
  it('writes one JSON line per product and nothing else to stdout', async () => {
    const { out } = await fixtureRun();
    assert.equal(out.length, 5);
    const decisions = out.map((line) => JSON.parse(line));
    assert.deepEqual(
      decisions.map((record) => record.decision),
      ['ASSIGN', 'CREATE_GROUP', 'REVIEW', 'REVIEW', 'REVIEW']
    );
    assert.deepEqual(
      decisions.map((record) => record.itemId),
      [MILK_ITEM.id, RICE_ITEM.id, OAT_ITEM.id, OIL_ITEM.id, CHEESE_ITEM.id]
    );
    assert.equal(decisions[0].groupId, MILK_GROUP.id);
    assert.equal(decisions[1].groupId, 'dry-run:arroz-redondo');
    assert.equal(
      decisions.every((record) => record.applied === false),
      true
    );
  });

  it('names each product on stderr as it goes', async () => {
    const { progress } = await fixtureRun();
    assert.match(progress[0], /5 ungrouped products, 3 groups, dry run/);
    assert.deepEqual(progress.slice(1), [
      `1/5 - ${MILK_ITEM.name.es}`,
      `2/5 - ${RICE_ITEM.name.es}`,
      `3/5 - ${OAT_ITEM.name.es}`,
      `4/5 - ${OIL_ITEM.name.es}`,
      `5/5 - ${CHEESE_ITEM.name.es}`,
    ]);
  });

  it('asks the gateway for the products in no group, oldest page first', async () => {
    const { calls } = await fixtureRun();
    const gets = calls.filter((call) => call.method === 'GET');
    assert.match(gets[0].url, /\/v1\/admin\/catalog\/product-groups\?/);
    assert.match(gets[1].url, /\/v1\/admin\/catalog\/items\?/);
    assert.match(gets[1].url, /productGroupId=none/);
    assert.match(gets[1].url, /order=created/);
    assert.match(gets[1].url, /limit=100/);
    assert.match(gets[2].url, /cursor=cursor-items-page-2/);
    assert.equal(gets.length, 3);
  });

  it('writes nothing at all without --apply', async () => {
    const { calls } = await fixtureRun();
    assert.deepEqual(gatewayCalls(calls, 'POST'), []);
    assert.deepEqual(gatewayCalls(calls, 'PATCH'), []);
    assert.equal(calls.filter((call) => call.url === MESSAGES_URL).length, 5);
  });

  it('reports the counts, the reviews and the tokens', async () => {
    const { report } = await fixtureRun();
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.items, 5);
    assert.equal(report.groupsAtStart, 3);
    assert.equal(report.applied, 0);
    assert.deepEqual(report.counts, {
      ASSIGN: 1,
      CREATE_GROUP: 1,
      REVIEW: 3,
    });
    assert.deepEqual(report.groupsCreated, []);
    assert.deepEqual(
      report.reviews.map((review) => [review.itemId, codes(review.issues)]),
      [
        [OAT_ITEM.id, ['NOT_DAIRY_MILK', 'LOW_CONFIDENCE']],
        [OIL_ITEM.id, ['GROUP_DUPLICATE']],
        [CHEESE_ITEM.id, ['UNIT_FAMILY_MISMATCH']],
      ]
    );
    assert.deepEqual(report.usage, {
      calls: 5,
      inputTokens: 650,
      outputTokens: 360,
      cacheReadInputTokens: 7600,
      cacheCreationInputTokens: 2000,
    });
  });

  it('stops at --limit and asks for no more than that', async () => {
    const { report, calls, out } = await fixtureRun({ limit: 2 });
    assert.equal(out.length, 2);
    assert.equal(report.items, 2);
    const items = calls.find(
      (call) => call.method === 'GET' && call.url.includes('/items?')
    );
    assert.match(items.url, /limit=2/);
  });
});

describe('a run with --apply', () => {
  it('patches the item it assigns and posts the group it creates', async () => {
    const { report, calls } = await fixtureRun({ apply: true });

    const posts = gatewayCalls(calls, 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, `${BASE_URL}/v1/admin/catalog/product-groups`);
    assert.deepEqual(posts[0].body, {
      name: { es: 'Arroz redondo', en: 'Round rice' },
      slug: 'arroz-redondo',
      referenceUnit: 'KILOGRAM',
      synonyms: { es: ['arroz'], en: ['rice'] },
    });

    const patches = gatewayCalls(calls, 'PATCH');
    assert.deepEqual(
      patches.map((call) => call.url),
      [
        `${BASE_URL}/v1/admin/catalog/items/${MILK_ITEM.id}`,
        `${BASE_URL}/v1/admin/catalog/items/${RICE_ITEM.id}`,
      ]
    );
    assert.deepEqual(patches[0].body, { productGroupId: MILK_GROUP.id });
    assert.deepEqual(patches[1].body, {
      productGroupId: CREATED_RICE_GROUP.id,
    });

    assert.equal(report.mode, 'apply');
    assert.equal(report.applied, 2);
    assert.deepEqual(report.groupsCreated, [
      {
        id: CREATED_RICE_GROUP.id,
        slug: 'arroz-redondo',
        name: CREATED_RICE_GROUP.name,
        referenceUnit: 'KILOGRAM',
        forItemId: RICE_ITEM.id,
      },
    ]);
  });

  it('never touches a product it sent to review', async () => {
    const { calls } = await fixtureRun({ apply: true });
    const touched = gatewayCalls(calls, 'PATCH').map((call) =>
      call.url.split('/').pop()
    );
    for (const id of [OAT_ITEM.id, OIL_ITEM.id, CHEESE_ITEM.id]) {
      assert.equal(touched.includes(id), false);
    }
  });
});

// ---------------------------------------------------------------------------
// The session, the files and the command line
// ---------------------------------------------------------------------------

describe('the session', () => {
  it('takes LUNA_ADMIN_TOKEN as it stands', async () => {
    const token = await resolveToken({
      baseUrl: BASE_URL,
      fetchImpl: async () => {
        throw new Error('no login should happen');
      },
      env: { LUNA_ADMIN_TOKEN: 'already-signed-in' },
    });
    assert.equal(token, 'already-signed-in');
  });

  it('logs in with the username and password otherwise', async () => {
    const seen = [];
    const token = await resolveToken({
      baseUrl: BASE_URL,
      fetchImpl: async (url, init) => {
        seen.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({ accessToken: 'fresh' }, 201);
      },
      env: { LUNA_ADMIN_EMAIL: 'admin', LUNA_ADMIN_PASSWORD: 'secret' },
    });
    assert.equal(token, 'fresh');
    assert.equal(seen[0].url, `${BASE_URL}/v1/admin/auth/login`);
    assert.deepEqual(seen[0].body, { username: 'admin', password: 'secret' });
  });

  it('accepts LUNA_ADMIN_USERNAME as the same thing', async () => {
    const token = await resolveToken({
      baseUrl: BASE_URL,
      fetchImpl: async () => jsonResponse({ accessToken: 'fresh' }, 201),
      env: { LUNA_ADMIN_USERNAME: 'admin', LUNA_ADMIN_PASSWORD: 'secret' },
    });
    assert.equal(token, 'fresh');
  });

  it('says so when there is no way to sign in', async () => {
    await assert.rejects(
      resolveToken({ baseUrl: BASE_URL, fetchImpl: async () => {}, env: {} }),
      /LUNA_ADMIN_TOKEN/
    );
  });
});

describe('the output files', () => {
  it('writes the decisions and the report side by side', async () => {
    const { report, records } = await fixtureRun();
    const outDir = pathToFileURL(`${mkdtempSync(join(tmpdir(), 'groups-'))}/`);
    const files = writeRunFiles({
      records,
      report,
      outDir,
      stamp: '2026-09-08T00-00-00-000Z',
    });
    const lines = readFileSync(files.lines, 'utf8').trim().split('\n');
    assert.equal(lines.length, 5);
    assert.equal(JSON.parse(lines[0]).itemId, MILK_ITEM.id);
    assert.equal(
      JSON.parse(readFileSync(files.summary, 'utf8')).counts.REVIEW,
      3
    );
    assert.match(
      files.lines.pathname,
      /groups-2026-09-08T00-00-00-000Z\.jsonl$/
    );
    assert.match(
      files.summary.pathname,
      /groups-2026-09-08T00-00-00-000Z-report\.json$/
    );
  });

  it('names a file a shell never has to quote', () => {
    const stamp = fileTimestamp(new Date('2026-09-08T10:20:30.400Z'));
    assert.equal(stamp, '2026-09-08T10-20-30-400Z');
  });
});

describe('the command line', () => {
  it('is a dry run against localhost by default', () => {
    assert.deepEqual(parseArgs([]), {
      apply: false,
      baseUrl: 'http://localhost:3000',
    });
  });

  it('reads --apply, --limit and --base-url', () => {
    const options = parseArgs([
      '--apply',
      '--limit',
      '25',
      '--base-url',
      'http://localhost:43000/',
    ]);
    assert.equal(options.apply, true);
    assert.equal(options.limit, 25);
    assert.equal(options.baseUrl, 'http://localhost:43000');
  });

  it('refuses a limit that is not a count', () => {
    assert.throws(() => parseArgs(['--limit', 'lots']), /whole number/);
  });

  it('refuses an option it does not know', () => {
    assert.throws(() => parseArgs(['--force']), /Unknown option/);
  });
});
