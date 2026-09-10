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
  '../../../../apps/luna-shopper-backend/gateway/docs/openapi.json',
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

/** What a product is searched for by: its Spanish name, else its English one. */
export function itemSearchKey(item) {
  return normalizeName(item?.name?.es ?? item?.name?.en ?? '');
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
  return {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['ASSIGN', 'CREATE_GROUP', 'REVIEW'],
      },
      groupId: nullableString,
      groupRef: nullableString,
      group: {
        type: ['object', 'null'],
        properties: {
          nameEs: nullableString,
          nameEn: nullableString,
          slug: nullableString,
          referenceUnit: { type: ['string', 'null'], enum: [...units, null] },
          synonyms: {
            type: ['object', 'null'],
            properties: { es: synonymList, en: synonymList },
          },
        },
      },
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
    },
    required: ['decision', 'confidence', 'issues', 'reasoning'],
  };
}
