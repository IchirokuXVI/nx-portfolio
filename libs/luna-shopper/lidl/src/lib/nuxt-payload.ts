import { isRecord, type Json } from './json';

/**
 * The product page's state, out of the HTML it is served in.
 *
 * **The product page is not an API and there is no JSON endpoint behind it**
 * (plan 0089, section 1.1). `lidl.es` renders with Nuxt and ships the whole page
 * state inside a `<script id="__NUXT_DATA__">` tag, so `eans` and `regionsV2`,
 * which the index does not carry, are read out of the page a browser would read
 * them from and cost no extra request.
 *
 * The tag holds devalue's flat format, which is an array where index 0 is the
 * root and every number is an index into that same array. That is what lets the
 * graph hold cycles and shared references, and it is why this cannot be
 * `JSON.parse` alone.
 *
 * Not exported from the library: callers ask {@link LidlClient} for a product.
 */

const HOLE = -1;
const UNDEFINED = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

/**
 * Wrappers Nuxt adds around reactive state. The value is the single payload
 * after the tag, so they are unwrapped rather than represented.
 */
const TRANSPARENT_TAGS: ReadonlySet<string> = new Set([
  'Reactive',
  'ShallowReactive',
  'Ref',
  'ShallowRef',
  'EmptyRef',
  'EmptyShallowRef',
  'Object',
  'null',
]);

const NUXT_DATA_TAG =
  /<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/** Rebuild the object graph a flat devalue array describes. */
export function parseFlat(flat: readonly Json[]): Json {
  const hydrated = new Array<Json>(flat.length);
  const seen = new Array<boolean>(flat.length).fill(false);

  function at(index: Json): Json {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      return undefined;
    }
    if (index === HOLE || index === UNDEFINED) {
      return undefined;
    }
    if (index === NAN) {
      return NaN;
    }
    if (index === POSITIVE_INFINITY) {
      return Infinity;
    }
    if (index === NEGATIVE_INFINITY) {
      return -Infinity;
    }
    if (index === NEGATIVE_ZERO) {
      return -0;
    }
    if (index < 0 || index >= flat.length) {
      return undefined;
    }
    if (seen[index]) {
      return hydrated[index];
    }
    seen[index] = true;

    const value = flat[index];
    if (value === null || typeof value !== 'object') {
      hydrated[index] = value;
      return value;
    }

    if (Array.isArray(value)) {
      const tag = value[0];
      // A plain array holds indices, which are numbers, so a leading string is
      // unambiguously a type tag.
      if (typeof tag === 'string') {
        hydrated[index] = fromTag(tag, value, at);
        return hydrated[index];
      }
      const out: Json[] = [];
      hydrated[index] = out;
      for (const entry of value) {
        out.push(at(entry));
      }
      return out;
    }

    const out: Record<string, Json> = {};
    hydrated[index] = out;
    for (const [key, entry] of Object.entries(value)) {
      out[key] = at(entry);
    }
    return out;
  }

  return at(0);
}

function fromTag(
  tag: string,
  value: readonly Json[],
  at: (index: Json) => Json
): Json {
  if (TRANSPARENT_TAGS.has(tag)) {
    return at(value[1]);
  }
  if (tag === 'Date') {
    const raw = at(value[1]);
    return typeof raw === 'string' || typeof raw === 'number'
      ? new Date(raw)
      : null;
  }
  if (tag === 'Set') {
    return new Set(value.slice(1).map(at));
  }
  if (tag === 'Map') {
    const out = new Map<Json, Json>();
    for (let i = 1; i + 1 < value.length; i += 2) {
      out.set(at(value[i]), at(value[i + 1]));
    }
    return out;
  }
  if (tag === 'BigInt') {
    const raw = at(value[1]);
    return typeof raw === 'string' ? BigInt(raw) : null;
  }
  if (tag === 'RegExp') {
    const source = at(value[1]);
    const flags = at(value[2]);
    return typeof source === 'string'
      ? new RegExp(source, typeof flags === 'string' ? flags : undefined)
      : null;
  }
  // An unknown wrapper is treated as one, which is what every tag Nuxt has
  // added so far has been. Guessing wrong costs one field, and throwing here
  // would cost the whole page.
  return value.length === 2 ? at(value[1]) : undefined;
}

/**
 * The flat array the page carries, as served, or null when it carries none.
 *
 * This is what a fixture holds. A capture that stored the hydrated graph would
 * store what this file understood rather than what the source sent, which is
 * the one thing a fixture must not do.
 */
export function extractNuxtFlat(html: string): Json[] | null {
  const match = NUXT_DATA_TAG.exec(html);
  if (!match) {
    return null;
  }
  let flat: Json;
  try {
    flat = JSON.parse(match[1]) as Json;
  } catch {
    return null;
  }
  return Array.isArray(flat) ? flat : null;
}

/** The hydrated page state, or null when the page carries no payload tag. */
export function extractNuxtData(html: string): Json {
  const flat = extractNuxtFlat(html);
  return flat === null ? null : parseFlat(flat);
}

/**
 * The product the page is about, out of the hydrated state.
 *
 * The storefront keeps its products in a Pinia store keyed by product id, so
 * the id the index gave is what reads it back. A page that renders a different
 * product than the one asked for reads as absent, which is the honest answer.
 */
export function readProductState(root: Json, externalId: string): Json {
  const byId = pathOf(root, ['pinia', 'products', 'byId']);
  if (!isRecord(byId)) {
    return null;
  }
  return byId[externalId] ?? null;
}

function pathOf(root: Json, path: readonly string[]): Json {
  let node = root;
  for (const key of path) {
    if (!isRecord(node)) {
      return null;
    }
    node = node[key];
  }
  return node;
}
