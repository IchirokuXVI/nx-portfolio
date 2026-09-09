import {
  exportFileName,
  harvestFailures,
  hintNotice,
  importConflict,
  parseHarvestDocument,
  PREVIEW_PAGE,
  previewMatches,
  previewWindow,
  type HarvestProductRow,
  type HintResult,
} from './harvest-document';

/**
 * Reading a file nobody in this repository produced (admin plan 0014, section 2).
 *
 * Everything here is read off `unknown`, so the tests that matter are the ones
 * with a field missing, a field of the wrong type, or a whole block absent. A
 * well formed document proves the happy path once; the rest of the file is about
 * what a document from another version, another producer or a text editor does
 * to this screen.
 */

const document = {
  schema_version: 1,
  sha256: '9f2cdead',
  producer: {
    name: 'leaflet-extractor',
    version: '0.4.0',
    produced_at: '2026-09-04T18:02:11Z',
  },
  hints: {
    chain_id: 'chain-1',
    price_scope_id: 'scope-1',
    source_kind: 'OFFICIAL_LEAFLET',
  },
  validity: { from: '2026-09-10', until: '2026-09-23' },
  products: [
    {
      id: 'p-0001',
      external_id: '4241',
      name: 'Leche semidesnatada Hacendado',
      brand: 'Hacendado',
      ean: '8480000123456',
      size: { label: '1 L', quantity: 1, unit: 'l' },
      price: { amount: 0.89, currency: 'EUR' },
      unit_price: { amount: 0.89, currency: 'EUR', label: 'l' },
      validity: { from: '2026-09-12', until: '2026-09-14' },
      category_path: ['Lacteos', 'Leche'],
      extra: { page: 3 },
    },
  ],
  warnings: [{ message: 'Tile on page 7 had no readable price' }],
};

const read = (over: object = {}) => {
  const parsed = parseHarvestDocument(
    JSON.stringify({ ...document, ...over }),
    'en'
  );
  if (!parsed.ok) {
    throw new Error(`expected a document, got ${parsed.reason}`);
  }
  return parsed.read;
};

describe('parseHarvestDocument', () => {
  it('refuses a file that is not JSON at all', () => {
    expect(parseHarvestDocument('%PDF-1.7')).toEqual({
      ok: false,
      reason: 'not-json',
    });
  });

  /**
   * A different refusal from the one above, because the next step is different.
   * Telling somebody who dropped a JSON file from the wrong tool to check their
   * JSON sends them looking for a syntax error that is not there.
   */
  it('refuses JSON that carries no products', () => {
    expect(parseHarvestDocument('{"schema_version":1}')).toEqual({
      ok: false,
      reason: 'not-a-document',
    });
  });

  it('reads what the file says about itself', () => {
    expect(read().summary).toEqual({
      schemaVersion: '1',
      sha256: '9f2cdead',
      producerName: 'leaflet-extractor',
      producerVersion: '0.4.0',
      producedAt: '2026-09-04T18:02:11Z',
      productCount: 1,
      warningCount: 1,
    });
  });

  it('keeps the document byte for byte, because the digest is the dedupe key', () => {
    expect(read().document).toEqual(document);
  });

  it('reads the hints', () => {
    expect(read().hints).toEqual({
      chainId: 'chain-1',
      priceScopeId: 'scope-1',
      adapterKey: '',
      sourceKind: 'OFFICIAL_LEAFLET',
    });
  });

  /** A hand written file carries none, and that is an ordinary file. */
  it('reads no hints from a document that has none', () => {
    expect(read({ hints: undefined }).hints).toEqual({
      chainId: '',
      priceScopeId: '',
      adapterKey: '',
      sourceKind: null,
    });
  });

  /**
   * `null` rather than a fallback: the kind decides which price policy ranks the
   * row, so a badge claiming the wrong one is worse than no badge.
   */
  it('reads a source kind this app does not know as none', () => {
    expect(
      read({ hints: { source_kind: 'OFFICIAL_CARRIER_PIGEON' } }).hints
        .sourceKind
    ).toBeNull();
  });

  it('reads the document window', () => {
    expect(read().validity).toEqual({
      from: '2026-09-10',
      until: '2026-09-23',
    });
  });

  it('reads no window at all from a document that states none', () => {
    expect(read({ validity: undefined }).validity).toBeNull();
  });

  /**
   * Both bounds or neither. Half a window is a window nothing can use, and
   * offering one filled date input would ask the operator to guess the other.
   */
  it('reads half a window as none', () => {
    expect(read({ validity: { from: '2026-09-10' } }).validity).toBeNull();
  });

  it('reads a product row with its numbers already formatted', () => {
    const [product] = read().products;

    expect(product).toEqual({
      id: 'p-0001',
      externalId: '4241',
      name: 'Leche semidesnatada Hacendado',
      brand: 'Hacendado',
      ean: '8480000123456',
      size: '1 L',
      price: expect.stringContaining('0.89'),
      unitPrice: expect.stringContaining('/ l'),
      prices: 1,
      validFrom: '2026-09-12',
      validUntil: '2026-09-14',
      categoryPath: 'Lacteos / Leche',
    });
  });

  /** The bare minimum a product may be: a name and nothing else. */
  it('reads a product with nothing but a name', () => {
    const [product] = read({ products: [{ name: 'Pan' }] }).products;

    expect(product).toEqual({
      id: 'products[0]',
      externalId: '',
      name: 'Pan',
      brand: '',
      ean: '',
      size: '',
      price: '',
      unitPrice: '',
      validFrom: '',
      prices: 0,
      validUntil: '',
      categoryPath: '',
    });
  });

  /** `unit` stands in for a missing `label`, which is what the schema says. */
  it('falls back to the size unit when there is no label', () => {
    const [product] = read({
      products: [{ name: 'Pan', size: { unit: 'kg' } }],
    }).products;

    expect(product.size).toBe('kg');
  });
});

/**
 * What a version 2 document holds, which is what the upload form asks from
 * (admin plan 0025, section 3).
 *
 * **Read from the products and never from `hints.adapter_key`.** The hint is
 * what a producer claims and the products are what the file holds, so a
 * mislabelled file is asked for what it actually needs.
 */
describe('parseHarvestDocument, a document that prices by scope', () => {
  const v2 = (over: object = {}) => {
    const parsed = parseHarvestDocument(
      JSON.stringify({
        schema_version: 2,
        sha256: 'a'.repeat(64),
        scopes: [
          { key: '58', kind: 'REGION', name: 'Sevilla' },
          { key: '12', kind: 'REGION' },
        ],
        products: [
          {
            name: 'Uva blanca',
            prices: [
              { scope: '58', amount: 1.29, currency: 'EUR' },
              { scope: '12', amount: 1.39, currency: 'EUR' },
            ],
          },
        ],
        ...over,
      }),
      'en'
    );
    if (!parsed.ok) {
      throw new Error(`expected a document, got ${parsed.reason}`);
    }
    return parsed.read;
  };

  it('reads the scopes it declares, naming one that named itself nothing', () => {
    expect(v2().scopes).toEqual([
      { key: '58', kind: 'REGION', name: 'Sevilla' },
      // A scope the source did not name reads as its own key, so the preview
      // lists something rather than a blank row.
      { key: '12', kind: 'REGION', name: '12' },
    ]);
  });

  it('says a file whose every price names a scope needs no default', () => {
    expect(v2().pricing).toEqual({
      any: true,
      unscoped: false,
      mostPerProduct: 2,
    });
  });

  it('says a file with one unscoped price does need a default', () => {
    // One is enough: that price has nowhere to go, and the rest of the file
    // being scoped does not help it.
    const pricing = v2({
      products: [
        {
          name: 'Uva',
          prices: [
            { scope: '58', amount: 1.29, currency: 'EUR' },
            { amount: 1.19, currency: 'EUR' },
          ],
        },
      ],
    }).pricing;

    expect(pricing).toMatchObject({ any: true, unscoped: true });
  });

  it('says a file with no price at all needs no default', () => {
    // A DEZA export, which states no price anywhere. Asking for a scope would
    // be asking for a field nothing in the file uses.
    const pricing = v2({
      scopes: null,
      products: [{ name: 'Uva', prices: [] }],
    }).pricing;

    expect(pricing).toEqual({ any: false, unscoped: false, mostPerProduct: 0 });
  });

  it('reads a version 1 product as one price naming no scope', () => {
    // Every leaflet. The form asks for a default exactly as it always has.
    const parsed = parseHarvestDocument(
      JSON.stringify({
        schema_version: 1,
        sha256: 'b'.repeat(64),
        products: [{ name: 'Uva', price: { amount: 1.29, currency: 'EUR' } }],
      }),
      'en'
    );
    if (!parsed.ok) {
      throw new Error('expected a document');
    }

    expect(parsed.read.scopes).toEqual([]);
    expect(parsed.read.pricing).toEqual({
      any: true,
      unscoped: true,
      mostPerProduct: 1,
    });
  });

  it('shows the first price on the row and counts the rest', () => {
    // A product priced for 59 regions is one line and a count, not 59 rows of
    // the same product.
    const [product] = v2().products;

    expect(product.price).toEqual(expect.stringContaining('1.29'));
    expect(product.prices).toBe(2);
  });

  it('reads the adapter the file claims, which decides nothing', () => {
    expect(v2({ hints: { adapter_key: 'lidl-api' } }).hints.adapterKey).toBe(
      'lidl-api'
    );
  });
});

describe('harvestFailures', () => {
  it('gathers every complaint about one product into one row', () => {
    expect(
      harvestFailures(
        {
          '/products/0/name': ['must be a string (product p-0001)'],
          '/products/0/price/amount': ['must be a number (product p-0001)'],
        },
        ['p-0001']
      )
    ).toEqual([
      {
        productId: 'p-0001',
        section: '',
        messages: [
          'must be a string (product p-0001)',
          'must be a number (product p-0001)',
        ],
      },
    ]);
  });

  /**
   * The one failure whose message cannot carry the id it is about: the product
   * has no id. The path's index names it instead, through the document's own
   * ids.
   */
  it('names a product by its position when the message cannot', () => {
    expect(
      harvestFailures({ '/products/1/id': ['is required'] }, ['a', 'b'])
    ).toEqual([{ productId: 'b', section: '', messages: ['is required'] }]);
  });

  it('names the position itself when the document has no id there either', () => {
    expect(harvestFailures({ '/products/2/id': ['is required'] }, [])).toEqual([
      { productId: 'products[2]', section: '', messages: ['is required'] },
    ]);
  });

  it('names the section for a failure outside the products', () => {
    expect(
      harvestFailures({ '/schema_version': ['unknown version 4'] }, [])
    ).toEqual([
      {
        productId: '',
        section: 'schema_version',
        messages: ['unknown version 4'],
      },
    ]);
  });
});

describe('hintNotice', () => {
  const hint = (over: Partial<HintResult>): HintResult => ({
    field: 'chain',
    outcome: 'set',
    fileValue: 'Deza',
    keptValue: '',
    ...over,
  });

  /** A hand written file. Nothing to say, so nothing is said. */
  it('says nothing about a file with no hints', () => {
    expect(hintNotice([])).toMatchObject({ kind: 'none', shown: false });
  });

  it('says the file set the inputs when it set all of them', () => {
    const notice = hintNotice([
      hint({ field: 'chain' }),
      hint({ field: 'scope' }),
      hint({ field: 'sourceKind' }),
    ]);

    expect(notice.kind).toBe('set');
    expect(notice.set).toHaveLength(3);
    expect(notice.shown).toBe(true);
  });

  it('says the choices were kept when the operator had chosen first', () => {
    const notice = hintNotice([
      hint({ outcome: 'kept', keptValue: 'Mercadona' }),
    ]);

    expect(notice.kind).toBe('kept');
    expect(notice.kept[0]).toMatchObject({
      fileValue: 'Deza',
      keptValue: 'Mercadona',
    });
  });

  it('lists both when some were set and some were kept', () => {
    const notice = hintNotice([
      hint({ field: 'chain', outcome: 'kept', keptValue: 'Mercadona' }),
      hint({ field: 'sourceKind', outcome: 'set' }),
    ]);

    expect(notice.kind).toBe('mixed');
    expect(notice.set).toHaveLength(1);
    expect(notice.kept).toHaveLength(1);
  });

  /**
   * An id does not survive an environment change, so this is the ordinary state
   * of a file carried from a machine that walks to a cluster that imports.
   */
  it('shows a notice for a hint this deployment cannot resolve', () => {
    const notice = hintNotice([
      hint({ outcome: 'unknown', fileValue: 'chain-9' }),
    ]);

    expect(notice.kind).toBe('none');
    expect(notice.shown).toBe(true);
    expect(notice.unknown[0].fileValue).toBe('chain-9');
  });
});

describe('exportFileName', () => {
  it('names the file after the chain, the scope and the day', () => {
    expect(
      exportFileName({
        chain: 'Deza',
        scope: 'NATIONAL',
        day: '2026-09-05',
      })
    ).toBe('harvest-deza-national-2026-09-05.json');
  });

  /** An accent has to survive as a letter, or the name is unrecognisable. */
  it('keeps an accented name readable', () => {
    expect(
      exportFileName({ chain: 'Córdoba Centro', scope: '', day: '2026-09-05' })
    ).toBe('harvest-cordoba-centro-2026-09-05.json');
  });

  it('leaves out a part nothing could name', () => {
    expect(exportFileName({ chain: '', scope: '', day: '' })).toBe(
      'harvest-export.json'
    );
  });
});

describe('importConflict', () => {
  it('tells a repeated document from a chain already running', () => {
    expect(
      importConflict({
        status: 409,
        detail:
          'That document has already been imported for this chain by run ' +
          '00000000-0000-4000-8000-000000000001.',
      })
    ).toEqual({
      kind: 'already-imported',
      runId: '00000000-0000-4000-8000-000000000001',
    });

    expect(
      importConflict({ status: 409, detail: 'A run is already in progress.' })
    ).toEqual({ kind: 'run-in-progress', runId: '' });
  });

  it('is nothing at all for any other refusal', () => {
    expect(importConflict({ status: 400, detail: 'imported' })).toBeNull();
  });
});

/**
 * The preview cap and the search over it (admin plan 0019).
 *
 * Two pure functions and a table of inputs, which is why they live in this file
 * rather than in the component: the decision they make is about a document, and
 * a mounted component would test Angular's `@for` on the way to testing it.
 */
const row = (over: Partial<HarvestProductRow> = {}): HarvestProductRow => ({
  id: 'p-1',
  externalId: '',
  name: '',
  brand: '',
  ean: '',
  size: '',
  price: '',
  unitPrice: '',
  validFrom: '',
  validUntil: '',
  categoryPath: '',
  ...over,
});

/** A file of `count` products, numbered so any one of them can be named. */
const many = (count: number): readonly HarvestProductRow[] =>
  Array.from({ length: count }, (_, index) =>
    row({ id: `p-${index}`, name: `Product ${index}` })
  );

describe('previewWindow', () => {
  it('draws the first page of a large file and says how many are left', () => {
    const view = previewWindow(many(4232), PREVIEW_PAGE);

    expect(view.rows).toHaveLength(250);
    expect(view.rows[0].id).toBe('p-0');
    expect(view.matched).toBe(4232);
    expect(view.hasMore).toBe(true);
    expect(view.remaining).toBe(3982);
  });

  it('draws a second page once the operator has asked for one', () => {
    const view = previewWindow(many(4232), PREVIEW_PAGE * 2);

    expect(view.rows).toHaveLength(500);
    expect(view.remaining).toBe(3732);
  });

  /** A leaflet. Nobody sees a control at all, which is the point of the cap. */
  it('draws a small file whole and offers nothing', () => {
    const view = previewWindow(many(40), PREVIEW_PAGE);

    expect(view.rows).toHaveLength(40);
    expect(view.hasMore).toBe(false);
    expect(view.remaining).toBe(0);
  });

  it('reports nothing rather than failing over nothing', () => {
    expect(previewWindow([], PREVIEW_PAGE)).toEqual({
      rows: [],
      matched: 0,
      hasMore: false,
      remaining: 0,
    });
  });
});

describe('previewMatches', () => {
  const catalogue = [
    row({ id: 'p-1', name: 'Jamón Serrano', brand: 'Hacendado' }),
    row({ id: 'p-2', name: 'Leche entera', brand: 'Pascual', size: '1 L' }),
    row({ id: 'p-3', name: 'Nocilla', ean: '8480000123456' }),
  ];

  it('leaves everything alone when nothing is typed', () => {
    expect(previewMatches(catalogue, '', null)).toHaveLength(3);
    expect(previewMatches(catalogue, '   ', null)).toHaveLength(3);
  });

  it('matches on the name, the brand, the size and the barcode', () => {
    expect(previewMatches(catalogue, 'nocilla', null)).toEqual([catalogue[2]]);
    expect(previewMatches(catalogue, 'pascual', null)).toEqual([catalogue[1]]);
    expect(previewMatches(catalogue, '1 L', null)).toEqual([catalogue[1]]);
    expect(previewMatches(catalogue, '84800001', null)).toEqual([catalogue[2]]);
  });

  it('folds the case', () => {
    expect(previewMatches(catalogue, 'LECHE', null)).toEqual([catalogue[1]]);
  });

  /**
   * Both ways, and neither is optional in this catalogue. An operator typing
   * `jamon` who is not shown `Jamón Serrano` concludes the file does not have it.
   */
  it('folds the accents in both directions', () => {
    expect(previewMatches(catalogue, 'jamon', null)).toEqual([catalogue[0]]);
    expect(previewMatches(catalogue, 'Jamón', null)).toEqual([catalogue[0]]);
  });

  it('does not match across the gap between two fields', () => {
    expect(previewMatches(catalogue, 'entera pascual', null)).toEqual([]);
  });

  /**
   * The whole file first, then the window. Filtering the drawn rows instead
   * would leave this product unreachable until "show more" had been pressed
   * eleven times.
   */
  it('finds a product past the cap with the window still at its default', () => {
    const products = [...many(3000), row({ id: 'late', name: 'Nocilla' })];
    const matched = previewMatches(products, 'nocilla', null);

    expect(previewWindow(matched, PREVIEW_PAGE)).toEqual({
      rows: [products[3000]],
      matched: 1,
      hasMore: false,
      remaining: 0,
    });
  });

  it('narrows to the refused rows, and a term narrows further', () => {
    const refused = new Set(['p-1', 'p-2']);

    expect(previewMatches(catalogue, '', refused)).toEqual([
      catalogue[0],
      catalogue[1],
    ]);
    expect(previewMatches(catalogue, 'leche', refused)).toEqual([catalogue[1]]);
    expect(previewMatches(catalogue, 'nocilla', refused)).toEqual([]);
  });

  it('returns nothing for a term nothing matches', () => {
    expect(previewMatches(catalogue, 'chorizo', null)).toEqual([]);
  });
});
