/**
 * Research script. Not production code.
 *
 * lidl.es renders its storefront with Nuxt and serves the whole page state
 * inside a <script id="__NUXT_DATA__"> tag, encoded in the flat "devalue"
 * format. This module extracts that tag and rebuilds the object graph, so a
 * probe can read products straight out of the HTML with no extra request.
 *
 * The flat format is an array. Index 0 is the root. Every number is an index
 * into the array, so the graph can hold cycles and shared references.
 */
const HOLE = -1;
const UNDEFINED = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

/** Wrapper tags Nuxt adds; the real value is the single payload after the tag. */
const TRANSPARENT_TAGS = new Set([
  'Reactive',
  'ShallowReactive',
  'Ref',
  'ShallowRef',
  'EmptyRef',
  'EmptyShallowRef',
]);

export function parseFlat(flat) {
  const hydrated = new Array(flat.length);
  const seen = new Array(flat.length).fill(false);

  function at(index) {
    if (index === HOLE) return undefined;
    if (index === UNDEFINED) return undefined;
    if (index === NAN) return NaN;
    if (index === POSITIVE_INFINITY) return Infinity;
    if (index === NEGATIVE_INFINITY) return -Infinity;
    if (index === NEGATIVE_ZERO) return -0;
    if (seen[index]) return hydrated[index];
    seen[index] = true;

    const value = flat[index];
    if (value === null || typeof value !== 'object') {
      hydrated[index] = value;
      return value;
    }

    if (Array.isArray(value)) {
      const tag = value[0];
      if (typeof tag === 'string' && value.length === 2) {
        if (TRANSPARENT_TAGS.has(tag)) {
          const inner = at(value[1]);
          hydrated[index] = inner;
          return inner;
        }
        if (tag === 'Date') {
          hydrated[index] = new Date(at(value[1]));
          return hydrated[index];
        }
        if (tag === 'Set') {
          const out = new Set();
          hydrated[index] = out;
          for (const i of at(value[1]) ?? []) out.add(i);
          return out;
        }
        if (tag === 'Map') {
          const out = new Map();
          hydrated[index] = out;
          return out;
        }
        if (tag === 'BigInt') {
          hydrated[index] = BigInt(at(value[1]));
          return hydrated[index];
        }
        if (tag === 'Object' || tag === 'null') {
          hydrated[index] = at(value[1]);
          return hydrated[index];
        }
      }
      const out = [];
      hydrated[index] = out;
      for (const i of value) out.push(at(i));
      return out;
    }

    const out = {};
    hydrated[index] = out;
    for (const [key, i] of Object.entries(value)) out[key] = at(i);
    return out;
  }

  return at(0);
}

export function extractNuxtData(html) {
  const match = html.match(
    /<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  return parseFlat(JSON.parse(match[1]));
}

/**
 * Walks the hydrated graph and returns every object that looks like a product,
 * so a probe does not have to know the exact route the storefront used.
 */
export function findProducts(root) {
  const found = [];
  const seen = new Set();
  (function walk(node) {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const keys = Object.keys(node);
    const looksLikeProduct =
      (keys.includes('price') ||
        keys.includes('prices') ||
        keys.includes('priceInfo')) &&
      (keys.includes('title') ||
        keys.includes('fullTitle') ||
        keys.includes('name') ||
        keys.includes('label'));
    if (looksLikeProduct) found.push(node);
    for (const key of keys) walk(node[key]);
  })(root);
  return found;
}
