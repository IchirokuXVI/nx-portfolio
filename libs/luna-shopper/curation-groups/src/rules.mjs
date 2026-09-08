/**
 * The grouping rules, the unit vocabulary and the prompt (plan 0001).
 *
 * Carried over from the single file tool of backend plan 0099. The loop, the
 * flags and the in-prompt group directory did not survive the split; this half
 * did, because it is what the validators enforce and what the prompt states,
 * and the two have to keep agreeing.
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
 * "Aceite de Oliva Virgen Extra" and "aceite de oliva virgen extra" are the
 * same group, and so is one written with an accent the other leaves off. The
 * same function the suggestions decider uses, and the harvester's
 * `normalizeName` before that.
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
 * The slug rule, kept the same as `product-group.service.ts#validateSlug`.
 *
 * Catalog trims and lower cases before testing, so this does too: a slug the
 * service would accept after trimming is not a reason to send a product to a
 * person, and one it would refuse must never reach a decisions file.
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
 * A slug as words, which is the only way to look one up.
 *
 * The group listing searches the group's own name and its synonyms and does not
 * search the slug, so `leche-semidesnatada` is asked for as `leche
 * semidesnatada`. That finds the group whose slug was made from its name, which
 * is every group this toolchain creates.
 */
export function slugWords(slug) {
  return canonicalSlug(slug).split('-').filter(Boolean).join(' ');
}

/** Every word an existing group answers to, normalized. */
export function groupWords(group) {
  const words = [group?.name?.es, group?.name?.en];
  for (const list of [group?.synonyms?.es, group?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

/** Every word a proposed group would answer to, normalized. */
export function proposedWords(proposal) {
  const words = [proposal?.nameEs, proposal?.nameEn];
  for (const list of [proposal?.synonyms?.es, proposal?.synonyms?.en]) {
    if (Array.isArray(list)) {
      words.push(...list);
    }
  }
  return new Set(words.map(normalizeName).filter(Boolean));
}

/** The name a packet and a report call a product by. */
export function itemName(item) {
  return item?.name?.es ?? item?.name?.en ?? null;
}

// ---------------------------------------------------------------------------
// What the library reads at startup
// ---------------------------------------------------------------------------

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * The unit vocabulary, read from the committed OpenAPI document.
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
export function deriveUnitFamilies(units) {
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

/** The units and their families, which is everything the validators need. */
export function loadVocabularies(docUrl = OPENAPI_URL) {
  const units = loadUnits(docUrl);
  return { units, unitFamilies: deriveUnitFamilies(units) };
}

/** The rules prompt template, the markdown file beside this source. */
export function loadPromptTemplate(url = PROMPT_URL) {
  return readFileSync(url, 'utf8');
}

/**
 * The system prompt: the file, then the unit vocabulary appended, so the model
 * is told the same list the validators enforce.
 *
 * `start` answers this text and the orchestrator hands it to the model. The
 * library owns it because the library is what checks the answer against it.
 *
 * **No group directory is appended, and that is the change from plan 0099.**
 * There may be thousands of groups and a directory in the prompt does not
 * survive that, so the groups a product might join arrive per row, in the
 * packet, found by the same search production answers.
 */
export function buildSystemPrompt({
  template = loadPromptTemplate(),
  units,
  unitFamilies = deriveUnitFamilies(units),
}) {
  const lines = units.map((unit) => {
    const family = unitFamilies.get(unit);
    return family ? `- \`${unit}\` (${family})` : `- \`${unit}\``;
  });
  return [
    template.trimEnd(),
    '',
    '## Unit vocabulary',
    '',
    'One of these, exactly as written. The family in brackets is what has to',
    'match the product’s own `defaultUnit`; a unit with no family named is one',
    'this tool cannot place, and choosing it sends the product to a person.',
    '',
    lines.join('\n'),
    '',
  ].join('\n');
}
