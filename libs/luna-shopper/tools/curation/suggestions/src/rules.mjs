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
  '../../../../../../apps/luna-shopper-backend/gateway/docs/openapi.json',
  import.meta.url
);
const PROMPT_URL = new URL('./prompt.md', import.meta.url);

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
 * A brand's key, character for character the contracts function (plan 0115).
 *
 * A copy of `brandKey` in
 * `libs/luna-shopper/contracts/src/lib/brands/brand-key.ts`. This library is
 * plain `.mjs` with no build step, so it cannot import the TypeScript, and the
 * two are held together by `brand-key.cases.json`: every pair in that file is
 * asserted against this function in `rules.test.mjs`.
 *
 * It is not `normalizeName`. That one keeps a space between words, so `El Pozo`
 * and `ElPozo` are two keys under it and one key here, which is the whole
 * reason the registry needed a key of its own.
 */
export function brandKey(text) {
  if (text === null || text === undefined) {
    return null;
  }
  const key = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return key === '' ? null : key;
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

/**
 * A digit wedged inside a real word.
 *
 * A local model measured over forty Mercadona rows produced one of these about
 * once per forty rows: `fres1a`, `may1onesa`, `Beb1ida`. It is a generation
 * glitch and never a product name, and it is worth a validator of its own
 * because the row it lands on is otherwise a perfectly good decision, so
 * nothing else catches it and the catalog keeps the misspelling forever.
 *
 * **Two letters before the digit, and at least one after.** That is what tells
 * a glitch from a shade code, and a shade code has to survive: `n4N` on a
 * Guerlain corrector is the only thing telling two shades of one line apart,
 * and refusing it would refuse every cosmetics row. A code is a short prefix
 * and then digits (`n4N`, `n30`, `spf25`, `H2O`, `B12`, `Omega 3`), so one
 * letter before the digit is never enough to accuse anything. A glitch lands in
 * the middle of a word that was already several letters long.
 */
const GLITCH_PATTERN = /[a-záéíóúüñ]{2}\d+[a-záéíóúüñ]/i;

/**
 * The words a digit belongs inside, whatever the shape rule says.
 *
 * The shape rule above already excuses all three, and the list is kept as the
 * second lock rather than the first: a formula is a fact about the language and
 * the shape rule is a reading of one model's failures.
 */
const GLITCH_ALLOWED = new Set(['h2o', 'co2', 'o2']);

/** True when a name carries a glitch the allowlist does not excuse. */
export function carriesGlitch(name) {
  return String(name ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .some(
      (word) =>
        !GLITCH_ALLOWED.has(word.toLowerCase()) && GLITCH_PATTERN.test(word)
    );
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
 * The brand registry, keyed the way catalog keys it.
 *
 * The rows are whatever `GET /v1/admin/catalog/brands` answered, read once per
 * run and kept in the run directory. A row whose label has no key is dropped:
 * catalog cannot hold one either, so it can never be the answer to a lookup.
 *
 * The map carries a second lookup, `byId`, beside its own keys (plan 0005). A
 * link names the brand it points at by id, and resolving one is a lookup on
 * every CREATE that writes a brand, so the map is built once here rather than
 * scanned once per row. A row with no `canonicalBrandId` is an unlinked brand,
 * which is also every row a gateway that predates plan `0124` answers.
 */
export function indexBrands(raw) {
  const byKey = new Map();
  const byId = new Map();
  for (const row of raw ?? []) {
    const key = row?.key ?? brandKey(row?.label);
    if (!key) {
      continue;
    }
    const brand = {
      id: row.id ?? null,
      key,
      label: row.label ?? null,
      privateLabelSupermarketId: row.privateLabelSupermarketId ?? null,
      canonicalBrandId: row.canonicalBrandId ?? null,
    };
    byKey.set(key, brand);
    if (brand.id) {
      byId.set(brand.id, brand);
    }
  }
  byKey.byId = byId;
  return byKey;
}

/** The registered brand a spelling names, or null. */
export function findBrand(brands, text) {
  const key = brandKey(text);
  if (!key) {
    return null;
  }
  return brands?.get(key) ?? null;
}

/**
 * The brand a registered brand is really a spelling of, or the brand itself.
 *
 * One hop, and never a second one. The backend enforces one level under row
 * locks (plan `0124` section 3), so a link cannot point at a linked brand and
 * there is no chain here to walk.
 *
 * An id the registry does not hold answers the brand itself rather than null.
 * That is a snapshot read while somebody was writing, and the brand in hand is
 * still a registered brand: treating it as unlinked costs a row the retry it
 * would have had, where answering null would lose the brand altogether.
 */
export function canonicalBrand(brands, brand) {
  if (!brand) {
    return null;
  }
  const canonicalId = brand.canonicalBrandId;
  if (!canonicalId || canonicalId === brand.id) {
    return brand;
  }
  return brands?.byId?.get(canonicalId) ?? brand;
}

/** The canonical brand a spelling names, through a link if there is one. */
export function findCanonicalBrand(brands, text) {
  return canonicalBrand(brands, findBrand(brands, text));
}

/** The chains by id, so a private label can name the chain that owns it. */
export function chainNamesById(supermarkets) {
  const names = new Map();
  for (const supermarket of supermarkets ?? []) {
    if (supermarket?.id) {
      names.set(supermarket.id, chainName(supermarket));
    }
  }
  return names;
}

/**
 * How many private label lines the system prompt carries before `start` says
 * so.
 *
 * A chain has a handful of house labels, so the list is short by nature. It is
 * also billed on every row of the run, which is what makes a long one worth a
 * warning rather than a truncation: the list still has to be complete, because
 * rule 6 is enforced against exactly these brands.
 */
export const PRIVATE_LABEL_WARN_LINES = 40;

/**
 * The registry's private label brands, each with the chain that owns it.
 *
 * Canonical brands only. A linked brand owns no chain (plan `0124` section 2),
 * and its canonical brand is already a line of this list, so listing the
 * spelling beside it would bill every row of the run for a second name of one
 * house label.
 */
export function privateLabelLines(brands, supermarkets) {
  const names = chainNamesById(supermarkets);
  return [...(brands?.values() ?? [])]
    .filter(
      (brand) => brand.privateLabelSupermarketId && !brand.canonicalBrandId
    )
    .map((brand) => ({
      label: brand.label,
      chain:
        names.get(brand.privateLabelSupermarketId) ??
        brand.privateLabelSupermarketId,
    }));
}

/** The rules prompt template, the markdown file beside this source. */
export function loadPromptTemplate(url = PROMPT_URL) {
  return readFileSync(url, 'utf8');
}

/**
 * The system prompt: the file, then the two vocabularies and the private label
 * brands appended, so the model is told the same lists the validators enforce.
 *
 * The registry itself is never in here. It is hundreds of brands, every one of
 * them billed on every row of the run, and the model does not need it: the
 * library looks a brand up for itself and the packet carries the one brand the
 * row resolves to.
 *
 * `start` answers this text, and the orchestrator hands it to the model. The
 * library owns it because the library is what checks the answer against it.
 */
export function buildSystemPrompt({
  template = loadPromptTemplate(),
  categories,
  units,
  brands = new Map(),
  supermarkets = [],
}) {
  const labels = privateLabelLines(brands, supermarkets)
    .map((entry) => `- \`${entry.label}\` belongs to ${entry.chain}.`)
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
 * The id a `LINK` names still has to be one of the candidates this row was
 * given, and nothing expressible here can say so, which is why a schema valid
 * answer is still an answer the decider can refuse.
 *
 * **What the shape does say is which fields go with which decision** (plan
 * 0003). Measured over 111 requests of a live run, 28 of them were re-asks of
 * `a CREATE needs an "item" object` or `a LINK needs an "itemId" or an
 * "itemRef"`, and six rows ended as REVIEW on that alone. The schema had every
 * field optional and nullable, so `{"decision":"CREATE","item":null}` was a
 * legal token stream and the model was free to produce it. So the root now
 * carries an `anyOf` of the four shapes a decision can take, discriminated on
 * `decision` as a `const`: a shape defect becomes ungrammatical rather than
 * refused a second later, and a quarter of the model time goes back into the
 * run.
 */
/**
 * The longest `reasoning` the schema accepts, in characters.
 *
 * Output tokens are three quarters of a row's model time, and `reasoning` plus
 * the `issues[].detail` strings are about a third of the output tokens. Nothing
 * reads either as prose: they go into `decisions.jsonl` and, for a REVIEW, into
 * the report an operator scans. One clause names the rule that fired, which is
 * all that scan needs, and a paragraph costs every row of the run.
 *
 * The cap is stated here and again in the prompt, because a schema `maxLength`
 * is enforced by some providers and treated as advice by others. Neither is
 * load bearing: a long answer is still a valid answer and is recorded as one.
 */
export const REASONING_MAX = 160;

/** The same, for one issue's `detail`. See {@link REASONING_MAX}. */
export const ISSUE_DETAIL_MAX = 120;

export function buildDecisionSchema({ categories, units }) {
  const nullableString = { type: ['string', 'null'] };
  const confidence = { type: 'number', minimum: 0, maximum: 1 };
  const issues = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        detail: { type: 'string', maxLength: ISSUE_DETAIL_MAX },
      },
      required: ['code', 'detail'],
    },
  };
  const reasoning = { type: 'string', maxLength: REASONING_MAX };

  /**
   * The item as the root describes it: still nullable, and no longer half
   * filled.
   *
   * `item` stays `["object", "null"]` here, because the root has to describe a
   * LINK and a REVIEW too and neither carries one. What it does now say is that
   * **an item which is present is a complete one**: the three fields
   * `checkDecisionShape` refuses a CREATE without are `required`, which a
   * validator only applies to an object and so leaves `null` alone.
   *
   * That one line is what the claude engine gets, because the Messages API
   * refuses an alternation at the top level of a tool schema and the adapter
   * strips it (`claude-cli.mjs`, `toolInputSchema`). It is the failure sonnet
   * actually had: 26 of 80 SuperCash rows were re-asked for `a CREATE needs
   * "item.defaultUnit"`, which is the same defect class as the missing `item`
   * and is closed here without the alternation.
   *
   * **Required and nullable is not required.** Those three fields are also
   * non null here, and that is the other half of the same fix rather than a
   * tidy up: a `required` field whose type admits `null` is satisfied by
   * `null`, and `checkDecisionShape` refuses all three of them null. Measured
   * on sonnet low over 80 SuperCash rows, 15 were re-asked for `a CREATE needs
   * "item.defaultUnit"`, every one of them a product with no printed size,
   * answered `unitSize: null, defaultUnit: null`. `unitSize` stays nullable,
   * because a product with no size is a real thing and `null` is the right
   * answer for it. A unit is not: a sizeless product is sold by the piece.
   *
   * The two halves agree by construction. Every `anyOf` alternative that
   * carries an item requires the same three fields and types them the same
   * way, so an answer the grammar lets Ollama produce is an answer this root
   * also accepts.
   */
  const looseItem = {
    type: ['object', 'null'],
    properties: {
      nameEs: { type: 'string' },
      nameEn: nullableString,
      brand: nullableString,
      unitSize: { type: ['number', 'null'] },
      defaultUnit: { type: 'string', enum: [...units] },
      category: { type: 'string', enum: [...categories] },
      ean: nullableString,
    },
    required: ['nameEs', 'category', 'defaultUnit'],
  };

  /**
   * The item a CREATE has to carry: the same item, minus the `null`.
   *
   * Built from `looseItem` rather than written out beside it, so the two cannot
   * disagree about a field. The only difference a CREATE makes is that the item
   * is there at all, which is the `type`, and the alternative it sits in is
   * what makes it `required`.
   */
  const createItem = { ...looseItem, type: 'object' };

  const shared = { confidence, issues, reasoning };
  const sharedRequired = ['confidence', 'issues', 'reasoning'];

  return {
    // The root is the object it has always been, and every field of it is
    // still described here. An engine that does not read `anyOf` is therefore
    // exactly as well off as it was before this was added.
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['LINK', 'CREATE', 'REVIEW'] },
      itemId: nullableString,
      itemRef: nullableString,
      item: looseItem,
      ...shared,
    },
    required: ['decision', ...sharedRequired],
    // The four shapes a decision can actually take, discriminated on
    // `decision` as a `const`. This is the half that is enforced at the
    // grammar level: llama.cpp, which is what Ollama converts a schema with,
    // reads `anyOf` before it reads `properties`, so the token stream itself
    // cannot produce a CREATE with no item. `anyOf` rather than `oneOf`
    // because Anthropic's structured outputs take `anyOf` and the two are the
    // same alternation to llama.cpp. `if`/`then` would say this more directly
    // and llama.cpp does not support it.
    anyOf: [
      {
        type: 'object',
        properties: {
          decision: { const: 'CREATE' },
          item: createItem,
          ...shared,
        },
        required: ['decision', 'item', ...sharedRequired],
      },
      // A LINK names exactly one target, so the two ways of naming one are two
      // alternatives rather than two optional fields.
      {
        type: 'object',
        properties: {
          decision: { const: 'LINK' },
          itemId: { type: 'string' },
          ...shared,
        },
        required: ['decision', 'itemId', ...sharedRequired],
      },
      {
        type: 'object',
        properties: {
          decision: { const: 'LINK' },
          itemRef: { type: 'string' },
          ...shared,
        },
        required: ['decision', 'itemRef', ...sharedRequired],
      },
      {
        type: 'object',
        properties: { decision: { const: 'REVIEW' }, ...shared },
        required: ['decision', ...sharedRequired],
      },
    ],
  };
}
