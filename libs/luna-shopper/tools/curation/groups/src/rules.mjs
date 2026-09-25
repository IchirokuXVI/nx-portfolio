/**
 * The grouping rules, the unit vocabulary and the prompt (plan 0001).
 *
 * Carried over from the single file tool of backend plan 0099. The loop and the
 * CLI layer around it were replaced; this half was not, because it is what the
 * validators enforce and what the prompt states, and the two have to keep
 * agreeing.
 *
 * The one thing that did not carry over is the group directory. The tool put
 * every group into the prompt, which does not survive a catalog with thousands
 * of them, so candidates are searched for instead (see `commands.mjs`).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OPENAPI_URL = new URL(
  '../../../../../../apps/luna-shopper-backend/gateway/docs/openapi.json',
  import.meta.url
);
const PROMPT_URL = new URL('./prompt.md', import.meta.url);

// ---------------------------------------------------------------------------
// Names and slugs
// ---------------------------------------------------------------------------

/**
 * A name reduced to what a collision is about: case, accents and spacing gone.
 *
 * The same function the sibling decider uses, and the same one the harvester
 * matches names with. "Aceite de Oliva Virgen Extra" and "aceite de oliva
 * virgen extra" are the same group, and so is one written with an accent the
 * other leaves off.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

/** What catalog would store, which is what a collision has to be compared to. */
export function canonicalSlug(slug) {
  return String(slug ?? '')
    .trim()
    .toLowerCase();
}

/**
 * A slug read as words, so a search over names can be asked about it.
 *
 * The group search runs over `search_es`, `search_en` and the two names, and
 * over no slug at all. A slug is almost always the group's own name with the
 * accents dropped and the spaces turned into dashes, so turning it back into
 * words is what lets one search answer whether somebody already holds it.
 */
export function slugWords(slug) {
  return canonicalSlug(slug).replace(/-+/g, ' ').trim();
}

/** Every whole string an existing group answers to, normalized. */
export function groupWords(group) {
  const words = [group?.name?.es, group?.name?.en];
  for (const list of [group?.synonyms?.es, group?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

/** Every whole string a proposed group would answer to, normalized. */
export function proposedWords(proposal) {
  const words = [proposal?.nameEs, proposal?.nameEn];
  for (const list of [proposal?.synonyms?.es, proposal?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

/** The name a person reads on a progress line and in the report. */
export function itemLabel(item) {
  return item?.name?.es ?? item?.name?.en ?? item?.id ?? '(unnamed)';
}

/**
 * The longest search text the gateway takes.
 *
 * Both routes this library searches refuse a longer `query` with a 400: the
 * admin item search (`catalog-admin.dto.ts`) and the product group search
 * (`catalog.dto.ts`). One long product name was enough to end a whole walk on
 * its first row (plan 0002), so every query is cut to this before it is sent.
 */
export const MAX_SEARCH_LENGTH = 120;

/**
 * A search text cut to the gateway's cap at a word boundary.
 *
 * A word cut in half matches nothing in a full text search, or worse matches a
 * shorter word it happens to start, so the cut falls on the last space that
 * fits. A single word longer than the cap has no space to fall back to and is
 * cut where the cap is, which is the only answer the gateway would take.
 */
export function capSearchText(text, max = MAX_SEARCH_LENGTH) {
  const value = String(text ?? '').trim();
  if (value.length <= max) {
    return value;
  }
  if (/\s/.test(value[max])) {
    return value.slice(0, max).trimEnd();
  }
  const head = value.slice(0, max);
  const lastSpace = head.search(/\s\S*$/);
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd();
}

/** What a product is searched for by: its Spanish name, else its English one. */
export function itemSearchKey(item) {
  return capSearchText(normalizeName(item?.name?.es ?? item?.name?.en ?? ''));
}

/**
 * The keys a product is searched for by, most specific first: the whole name,
 * then its first three, two and one words.
 *
 * The group search joins every word with AND, and its trigram fallback only
 * rescues a query about as short as a group name, so a product's whole name
 * finds no group whose name is shorter than it (`champu liss frizz control`
 * never reaches `Champú`). A shorter key does. The whole name still comes
 * first, so a group named after the product ranks ahead of a broad one.
 */
export function itemSearchKeys(item) {
  const whole = itemSearchKey(item);
  const words = whole.split(/\s+/).filter(Boolean);
  const keys = [whole];
  for (const count of [3, 2, 1]) {
    if (words.length > count) {
      keys.push(words.slice(0, count).join(' '));
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// The unit vocabulary
// ---------------------------------------------------------------------------

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * The units the catalog knows, read from the committed OpenAPI document.
 *
 * Never hand copied. The document is generated from the contracts and a stale
 * copy of it fails the gateway's own suite, so reading it here is the one way
 * this list cannot drift from the enum the routes accept.
 */
export function loadUnits(docUrl = OPENAPI_URL) {
  const doc = readJson(docUrl);
  const units = doc?.components?.schemas?.['enums.UnitOfMeasure']?.enum;
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error(
      `enums.UnitOfMeasure is missing from ${fileURLToPath(docUrl)}. Regenerate it with ` +
        '`npx nx run luna-shopper-backend-gateway:openapi`.'
    );
  }
  return [...units];
}

/**
 * Which family each unit belongs to: weight, volume or count.
 *
 * Derived from the vocabulary by the word the unit ends in, so a new unit that
 * follows the same naming lands in the right family on its own. A unit that
 * matches nothing is left out, and the validator reads a missing family as a
 * reason to hand the product to a person rather than as a crash.
 */
export function deriveUnitFamilies(units = loadUnits()) {
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
// The prompt
// ---------------------------------------------------------------------------

/** The rules prompt template, the markdown file beside this source. */
export function loadPromptTemplate(url = PROMPT_URL) {
  return readFileSync(url, 'utf8');
}

/**
 * The system prompt: the file, then the unit vocabulary appended, so the model
 * is told the same list the validators enforce.
 *
 * `start` answers this text, and the orchestrator hands it to the model. The
 * library owns it because the library is what checks the answer against it.
 */
export function buildSystemPrompt({
  template = loadPromptTemplate(),
  units = loadUnits(),
} = {}) {
  return [
    template.trimEnd(),
    '',
    '## Unit vocabulary',
    '',
    'One of these, exactly as written:',
    '',
    units.map((value) => `- \`${value}\``).join('\n'),
    '',
  ].join('\n');
}

/**
 * The shape of one decision, as JSON Schema, from the same unit vocabulary.
 *
 * `start` answers this beside the prompt; see the twin in
 * `curation-suggestions/src/rules.mjs` for why it is built from the live
 * vocabulary and why it governs the shape only. The conditional rules stay with
 * the validators here too: exactly one of `groupId` and `groupRef` belongs on
 * an `ASSIGN`, `group` belongs on a `CREATE_GROUP` and nowhere else, and
 * `referenceUnit` has to sit in the same family as the product's own unit,
 * which no enum can express.
 */
export function buildDecisionSchema({ units = loadUnits() } = {}) {
  const nullableString = { type: ['string', 'null'] };
  const synonymList = { type: 'array', items: { type: 'string' } };

  // A group that is present is a complete one: the four fields
  // `checkDecisionShape` refuses a CREATE_GROUP without are required and non
  // null. The root still admits `null` for the group, because an ASSIGN and a
  // REVIEW carry none. This line is all the claude engine gets, since the
  // Messages API refuses an alternation at the top of a tool schema.
  const looseGroup = {
    type: ['object', 'null'],
    properties: {
      nameEs: { type: 'string' },
      nameEn: { type: 'string' },
      slug: { type: 'string' },
      referenceUnit: { type: 'string', enum: [...units] },
      synonyms: {
        type: ['object', 'null'],
        properties: { es: synonymList, en: synonymList },
      },
    },
    required: ['nameEs', 'nameEn', 'slug', 'referenceUnit'],
  };
  const shared = {
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['code', 'detail'],
      },
    },
    reasoning: { type: 'string' },
  };
  const sharedRequired = ['confidence', 'issues', 'reasoning'];

  return {
    // Every field is still described at the root, so an engine that does not
    // read `anyOf` is as well off as it was before.
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['ASSIGN', 'CREATE_GROUP', 'REVIEW'],
      },
      groupId: nullableString,
      groupRef: nullableString,
      group: looseGroup,
      ...shared,
    },
    required: ['decision', ...sharedRequired],
    // The shapes a decision can take, discriminated on `decision`. Ollama
    // turns this into a grammar, so an ASSIGN that names no group cannot be
    // produced at all. The flat schema allowed it, and 77 of 328 rows of a
    // live gemma walk were re-asked for it and ended as REVIEW. The same fix
    // is in the suggestions decider (its plan 0003).
    anyOf: [
      {
        type: 'object',
        properties: {
          decision: { const: 'ASSIGN' },
          groupId: { type: 'string' },
          ...shared,
        },
        required: ['decision', 'groupId', ...sharedRequired],
      },
      {
        type: 'object',
        properties: {
          decision: { const: 'ASSIGN' },
          groupRef: { type: 'string' },
          ...shared,
        },
        required: ['decision', 'groupRef', ...sharedRequired],
      },
      {
        type: 'object',
        properties: {
          decision: { const: 'CREATE_GROUP' },
          group: { ...looseGroup, type: 'object' },
          ...shared,
        },
        required: ['decision', 'group', ...sharedRequired],
      },
      {
        type: 'object',
        properties: { decision: { const: 'REVIEW' }, ...shared },
        required: ['decision', ...sharedRequired],
      },
    ],
  };
}
