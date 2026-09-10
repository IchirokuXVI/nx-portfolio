/**
 * The naming rules, the vocabularies and the prompt (plan 0001).
 *
 * Carried over unchanged from the single file tool of backend plan 0098. The
 * loop and the CLI layer around it were replaced; this half was not, because
 * it is what the validators enforce and what the prompt states, and the two
 * have to keep agreeing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OPENAPI_URL = new URL(
  '../../../../apps/luna-shopper-backend/gateway/docs/openapi.json',
  import.meta.url
);
const PROMPT_URL = new URL('./prompt.md', import.meta.url);
const PRIVATE_LABELS_URL = new URL('./private-labels.json', import.meta.url);

// ---------------------------------------------------------------------------
// Normalizing, verbatim from the harvester's matching.ts
// ---------------------------------------------------------------------------

/**
 * Case, accent and punctuation insensitive.
 *
 * A copy of `normalizeName` in
 * `apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts`. The two
 * have to agree, because this library searches the catalog with the same key
 * the ladder matched on.
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
  /(?:^|[\s([/x×-])\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l|lt|ltr|litro|litros|mg|gr|g|kg|kgs|cc|ud|uds|u|unid|unidad|unidades|pack|packs)(?![a-z0-9])/i;

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

/** The chain's own name, as the packet and the private label check read it. */
export function chainName(supermarket) {
  return supermarket?.name?.es ?? supermarket?.name?.en ?? null;
}

// ---------------------------------------------------------------------------
// What the library reads at startup
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

/** The rules prompt template, the markdown file beside this source. */
export function loadPromptTemplate(url = PROMPT_URL) {
  return readFileSync(url, 'utf8');
}

/**
 * The system prompt: the file, then the two vocabularies and the private label
 * map appended, so the model is told the same lists the validators enforce.
 *
 * `start` answers this text, and the orchestrator hands it to the model. The
 * library owns it because the library is what checks the answer against it.
 */
export function buildSystemPrompt({
  template = loadPromptTemplate(),
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

/**
 * The shape of one decision, as JSON Schema, from the same two vocabularies.
 *
 * `start` answers this beside the prompt and the orchestrator hands it to the
 * engine, which passes it as `--json-schema` or as `output_config.format`. It
 * is built here and from the live vocabularies for the same reason the prompt
 * is: a category the catalog does not have must be unable to reach `decide`,
 * rather than be described in prose and caught afterwards.
 *
 * It governs the **shape** only, and the validators keep owning the semantics.
 * The conditional rules cannot be written here: `itemId` belongs on a `LINK`
 * and nowhere else, exactly one of `itemId` and `itemRef` is allowed, and the
 * id has to be one of the candidates this row was actually given. So every
 * field except `decision` stays optional, and a schema valid answer is still an
 * answer the decider can refuse.
 */
export function buildDecisionSchema({ categories, units }) {
  const nullableString = { type: ['string', 'null'] };
  return {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['LINK', 'CREATE', 'REVIEW'] },
      itemId: nullableString,
      itemRef: nullableString,
      item: {
        type: ['object', 'null'],
        properties: {
          nameEs: nullableString,
          nameEn: nullableString,
          brand: nullableString,
          unitSize: { type: ['number', 'null'] },
          defaultUnit: { type: ['string', 'null'], enum: [...units, null] },
          category: { type: ['string', 'null'], enum: [...categories, null] },
          ean: nullableString,
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
