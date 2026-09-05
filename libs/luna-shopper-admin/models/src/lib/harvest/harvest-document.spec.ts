import {
  exportFileName,
  harvestFailures,
  hintNotice,
  importConflict,
  parseHarvestDocument,
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

  it('reads the three hints', () => {
    expect(read().hints).toEqual({
      chainId: 'chain-1',
      priceScopeId: 'scope-1',
      sourceKind: 'OFFICIAL_LEAFLET',
    });
  });

  /** A hand written file carries none, and that is an ordinary file. */
  it('reads no hints from a document that has none', () => {
    expect(read({ hints: undefined }).hints).toEqual({
      chainId: '',
      priceScopeId: '',
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
