/**
 * The store finder's XML (plan 0223, section 2): one `<markers>` root and one
 * self closing `<marker>` per point of sale in Spain and Andorra.
 *
 * Read with a regular expression over `<marker .../>` and its attributes, on
 * purpose: the document is flat, every value is an attribute, and an XML
 * dependency for one flat list is a dependency this library does not need.
 *
 * **Every record is a shop or a dropped record with its reason**, as in the El
 * Jamón parser, so a count that moves between runs is explained by the report
 * rather than by a guess.
 */

export type CarrefourFormat =
  | 'HIPERMERCADO'
  | 'MARKET'
  | 'EXPRESS'
  | 'EXPRESS_CEPSA'
  | 'BIO';

/** Every format, in the order a refusal names them. */
export const CARREFOUR_FORMATS: readonly CarrefourFormat[] = [
  'HIPERMERCADO',
  'MARKET',
  'EXPRESS',
  'EXPRESS_CEPSA',
  'BIO',
];

export interface CarrefourStore {
  /** The `tcm` attribute, e.g. `tcm:5-3850`. The one key that is unique. */
  externalRef: string;
  format: CarrefourFormat;
  /** The `category` attribute, verbatim. */
  category: string;
  name: string;
  latitude: number;
  longitude: number;
  street: string;
  city: string | null;
  province: string | null;
  postalCode: string;
  phone: string | null;
  web: string | null;
  /**
   * `hours1`, `hours2`, `hours3`, verbatim, each under its own name and null
   * when blank. A blank `hours1` beside a present `hours2` stays `hours2`.
   */
  hours: CarrefourStoreHours;
  features: string[];
  codsa: string | null;
  codat: string | null;
}

/** The three opening hours attributes of a marker, by name. */
export interface CarrefourStoreHours {
  hours1: string | null;
  hours2: string | null;
  hours3: string | null;
}

export interface CarrefourDroppedRecord {
  name: string;
  category: string;
  reason:
    | 'NOT_GROCERY'
    | 'OUTSIDE_SPAIN'
    | 'NO_REFERENCE'
    | 'BAD_COORDINATES'
    | 'BAD_POSTAL_CODE';
}

export interface CarrefourStoreList {
  recordsRead: number;
  stores: CarrefourStore[];
  dropped: CarrefourDroppedRecord[];
}

/**
 * The grocery formats, by the `category` the chain writes. Every other
 * category is `NOT_GROCERY`: travel agencies, petrol stations and outlets
 * today, and any category the chain adds later.
 */
const FORMAT_BY_CATEGORY: Readonly<Record<string, CarrefourFormat>> = {
  Hipermercado: 'HIPERMERCADO',
  'Supermercado Carrefour Market': 'MARKET',
  'Supermercado Carrefour Express': 'EXPRESS',
  'Supermercado Carrefour Express CEPSA': 'EXPRESS_CEPSA',
  'Supermercado Carrefour BIO': 'BIO',
};

/** One `<marker>`, its attributes allowed to hold a `>` inside their quotes. */
const MARKER = /<marker\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** One attribute, in either quote. */
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** The five XML entities and numeric references, decoded. */
export function decodeXmlAttribute(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (whole: string, decimal?: string, hex?: string, name?: string) => {
      if (decimal !== undefined) {
        return codePoint(Number(decimal), whole);
      }
      if (hex !== undefined) {
        return codePoint(Number.parseInt(hex, 16), whole);
      }
      return XML_ENTITIES[name ?? ''] ?? whole;
    }
  );
}

/**
 * The character a numeric entity names, or the entity's raw text when the
 * number is past the last code point, where `String.fromCodePoint` throws.
 */
function codePoint(value: number, whole: string): string {
  return value <= 0x10ffff ? String.fromCodePoint(value) : whole;
}

/** The attributes of one marker, decoded, by name. */
function attributesOf(body: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of body.matchAll(ATTRIBUTE)) {
    attributes.set(match[1], decodeXmlAttribute(match[2] ?? match[3] ?? ''));
  }
  return attributes;
}

/** A value as it was written, or null when it holds only spaces. */
function verbatim(value: string | undefined): string | null {
  return present(value) === null ? null : (value ?? null);
}

/** A value with its spaces trimmed, or null when nothing is left. */
function present(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function coordinate(value: string | undefined, limit: number): number | null {
  const text = present(value);
  if (text === null) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** Parse the whole store finder document. */
export function parseStoreLocator(xml: string): CarrefourStoreList {
  const stores: CarrefourStore[] = [];
  const dropped: CarrefourDroppedRecord[] = [];
  let recordsRead = 0;

  for (const match of xml.matchAll(MARKER)) {
    recordsRead += 1;
    const attributes = attributesOf(match[1]);
    const category = attributes.get('category') ?? '';
    const name = present(attributes.get('name')) ?? '';
    const drop = (reason: CarrefourDroppedRecord['reason']): void => {
      dropped.push({ name, category, reason });
    };

    const format = FORMAT_BY_CATEGORY[category.trim()];
    if (!format) {
      drop('NOT_GROCERY');
      continue;
    }
    // 21 codes carry a trailing space. The 11 Andorran shops say
    // `country="es"`, so the country attribute is never read: the code is.
    const postalCode = (attributes.get('postal') ?? '').trim();
    if (!/^\d{5}$/.test(postalCode)) {
      drop(/^AD/i.test(postalCode) ? 'OUTSIDE_SPAIN' : 'BAD_POSTAL_CODE');
      continue;
    }
    const externalRef = present(attributes.get('tcm'));
    if (externalRef === null) {
      drop('NO_REFERENCE');
      continue;
    }
    const latitude = coordinate(attributes.get('lat'), 90);
    const longitude = coordinate(attributes.get('lng'), 180);
    if (
      latitude === null ||
      longitude === null ||
      (latitude === 0 && longitude === 0)
    ) {
      drop('BAD_COORDINATES');
      continue;
    }

    const address = present(attributes.get('address'));
    const address2 = present(attributes.get('address2'));
    stores.push({
      externalRef,
      format,
      category,
      name,
      latitude,
      longitude,
      street: [address, address2].filter((part) => part !== null).join(' '),
      city: present(attributes.get('city')),
      province: present(attributes.get('state')),
      postalCode,
      phone: present(attributes.get('phone')),
      web: present(attributes.get('web')),
      hours: {
        hours1: verbatim(attributes.get('hours1')),
        hours2: verbatim(attributes.get('hours2')),
        hours3: verbatim(attributes.get('hours3')),
      },
      features: (attributes.get('features') ?? '')
        .split(',')
        .map((feature) => feature.trim())
        .filter((feature) => feature !== ''),
      codsa: present(attributes.get('codsa')),
      codat: present(attributes.get('codat')),
    });
  }

  return { recordsRead, stores, dropped };
}
