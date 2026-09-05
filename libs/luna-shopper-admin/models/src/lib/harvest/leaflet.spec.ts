import {
  leafletConflict,
  leafletFailures,
  parseLeaflet,
  sortOffersByPage,
  type LeafletOfferRow,
} from './leaflet';

/**
 * Reading a leaflet in the browser (admin plan 0010, sections 2 and 2.1).
 *
 * The fixture is shaped after `tmp/leaflet/eljamon.vision.json`, which is what
 * the extractor really produces, and it is written out here rather than read
 * from that directory. `tmp` is git ignored: a spec that read it would pass on
 * the one machine that has the file and fail in CI.
 *
 * Four offers, and each is a different answer from the import's rules. A plain
 * price drop is written. A per kilogram offer writes a unit price and no till
 * price, and is still previewed as an ordinary row. A second unit tile with no
 * single unit price is queued, and one gated behind a loyalty card is dropped.
 */
const DOCUMENT = {
  schema_version: '1.0',
  source: {
    file: 'eljamon_del_27_de_agosto_al_23_de_septiembre_de_2026.pdf',
    sha256: 'f62fa7ac367008e1dd00871292e9b6be1b5d1c8cca840c40a6541cec3a58f2ea',
    page_count: 40,
    extraction: { method: 'vision', extracted_at: '2026-09-04T11:03:22Z' },
  },
  retailer: {
    name: 'El Jamon',
    chain_id: 'el-jamon',
    country: 'ES',
    currency: 'EUR',
    language: 'es',
  },
  validity: {
    starts_on: '2026-08-27',
    ends_on: '2026-09-23',
    raw_text: 'del 27 de agosto al 23 de septiembre de 2026',
  },
  offers: [
    {
      id: 'p05-o07',
      page: 5,
      product: {
        name: 'Cerveza Radler Cruzcampo',
        brand: 'Cruzcampo',
        format: { raw: 'lata 33 cl.' },
      },
      pricing: { price: { amount: 0.39, currency: 'EUR' }, basis: 'unit' },
      // No `single_unit_price`, which is what sends it to the queue.
      promotion: { type: 'second_unit_discount', raw_text: '-50% 2a Unidad' },
      loyalty: { required: false, program: null },
      source: 'vision',
    },
    {
      id: 'p01-o01',
      page: 1,
      product: {
        name: 'Aceite de Oliva Virgen Serie Oro Coosur',
        brand: 'Coosur',
        format: { raw: 'Garrafa 5 litros' },
      },
      pricing: { price: { amount: 19.95, currency: 'EUR' }, basis: 'unit' },
      promotion: { type: 'price_drop', raw_text: 'ANTES 21,95' },
      loyalty: { required: false, program: null },
      source: 'vision',
    },
    {
      id: 'p36-o01',
      page: 36,
      product: { name: 'Champu Elvive', brand: 'Elvive', format: {} },
      pricing: { price: { amount: 2.34, currency: 'EUR' }, basis: 'unit' },
      promotion: {
        type: 'second_unit_discount',
        raw_text: '-50% 2a Unidad',
        single_unit_price: { amount: 4.69, currency: 'EUR' },
      },
      loyalty: { required: true, program: 'descuentos ifamilia' },
      source: 'vision',
    },
    {
      id: 'p02-o03',
      page: 2,
      product: { name: 'Solomillo de cerdo', brand: null, format: {} },
      pricing: { price: { amount: 6.95, currency: 'EUR' }, basis: 'kg' },
      promotion: null,
      source: 'vision',
    },
  ],
  warnings: [{ page: 0, message: 'Only six pages were read by the model.' }],
};

const read = (over: Partial<typeof DOCUMENT> = {}) => {
  const parsed = parseLeaflet(JSON.stringify({ ...DOCUMENT, ...over }));
  if (!parsed.ok) {
    throw new Error(`expected a document, got ${parsed.reason}`);
  }
  return parsed.leaflet;
};

const offer = (id: string): LeafletOfferRow => {
  const row = read().offers.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`no offer ${id}`);
  }
  return row;
};

describe('parseLeaflet', () => {
  it('refuses a file that is not JSON', () => {
    expect(parseLeaflet('%PDF-1.7\n')).toEqual({
      ok: false,
      reason: 'not-json',
    });
  });

  /**
   * A different refusal from the one above, because the next step is different:
   * telling somebody who dropped a valid JSON file to check their JSON sends
   * them looking for a syntax error that is not there.
   */
  it('refuses JSON that is not a leaflet', () => {
    expect(parseLeaflet('{"hello":"world"}')).toEqual({
      ok: false,
      reason: 'not-a-document',
    });
  });

  it('reads what is in the file before anything is chosen', () => {
    expect(read().summary).toEqual({
      retailerName: 'El Jamon',
      chainId: 'el-jamon',
      file: 'eljamon_del_27_de_agosto_al_23_de_septiembre_de_2026.pdf',
      sha256:
        'f62fa7ac367008e1dd00871292e9b6be1b5d1c8cca840c40a6541cec3a58f2ea',
      pageCount: 40,
      offerCount: 4,
      warningCount: 1,
      startsOn: '2026-08-27',
      endsOn: '2026-09-23',
    });
  });

  /** A null date leaves the input empty, and the input is required. */
  it('reads a missing date as no date at all', () => {
    const summary = read({
      validity: { starts_on: null, ends_on: null },
    } as unknown as Partial<typeof DOCUMENT>).summary;

    expect(summary.startsOn).toBe('');
    expect(summary.endsOn).toBe('');
  });

  it('sends the document back byte for byte', () => {
    expect(read().document).toEqual(DOCUMENT);
  });

  it('draws a loyalty gated offer muted, with the rule that drops it', () => {
    const row = offer('p36-o01');

    expect(row.loyalty).toBe(true);
    expect(row.muted).toBe(true);
    expect(row.noteKey).toBe('harvest.leaflets.note.loyalty');
  });

  /**
   * The Radler tile. Its headline price is the second unit's, and the tile
   * states no single unit price, so the import writes nothing and queues it.
   */
  it('draws a conditional promotion with no single unit price muted', () => {
    const row = offer('p05-o07');

    expect(row.muted).toBe(true);
    expect(row.noteKey).toBe('harvest.leaflets.note.conditional');
  });

  /**
   * The same promotion type **with** a single unit price is written, so the
   * muting is about the missing number and not about the promotion.
   */
  it('does not mute a conditional promotion that states its single unit price', () => {
    const row = read({
      offers: [
        {
          ...DOCUMENT.offers[0],
          promotion: {
            type: 'second_unit_discount',
            raw_text: '-50%',
            single_unit_price: { amount: 0.79, currency: 'EUR' },
          },
        },
      ],
    } as unknown as Partial<typeof DOCUMENT>).offers[0];

    expect(row.muted).toBe(false);
    expect(row.noteKey).toBeNull();
  });

  it('leaves an ordinary price drop alone', () => {
    const row = offer('p01-o01');

    expect(row.muted).toBe(false);
    expect(row.promotionType).toBe('price_drop');
    expect(row.basis).toBe('unit');
  });

  /**
   * The currency is the offer's own, so a symbol here is a fact and not a
   * guess. The locale is the reader's, which is why it is stated: without one
   * this asserts on whatever locale the machine running it happens to have.
   */
  it('formats a price in the currency the offer states', () => {
    const parsed = parseLeaflet(JSON.stringify(DOCUMENT), 'es-ES');
    const price = parsed.ok
      ? (parsed.leaflet.offers.find((row) => row.id === 'p01-o01')?.price ?? '')
      : '';

    expect(price).toContain('19,95');
    expect(price).toContain('€');
  });

  it('reads a row with no brand as having none rather than as broken', () => {
    const row = offer('p02-o03');

    expect(row.brand).toBe('');
    expect(row.basis).toBe('kg');
  });

  /**
   * A row with no id of its own is still a row. The gateway's JSON path names
   * it by index anyway, so that is what it is called here.
   */
  it('numbers an offer that carries no id', () => {
    const rows = read({
      offers: [{ page: 3, product: { name: 'x' }, pricing: {} }],
    } as unknown as Partial<typeof DOCUMENT>).offers;

    expect(rows[0].id).toBe('offers[0]');
  });
});

describe('sortOffersByPage', () => {
  it('orders by page in both directions', () => {
    const rows = read().offers;

    expect(sortOffersByPage(rows, 'asc').map((row) => row.page)).toEqual([
      1, 2, 5, 36,
    ]);
    expect(sortOffersByPage(rows, 'desc').map((row) => row.page)).toEqual([
      36, 5, 2, 1,
    ]);
  });

  /** Two offers on one page keep the order the extractor printed them in. */
  it('is stable within a page', () => {
    const rows = read({
      offers: [
        { ...DOCUMENT.offers[0], id: 'a', page: 4 },
        { ...DOCUMENT.offers[1], id: 'b', page: 4 },
      ],
    } as unknown as Partial<typeof DOCUMENT>).offers;

    expect(sortOffersByPage(rows, 'asc').map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('leafletFailures', () => {
  /**
   * An offer with three failures is **one** row with three lines, so it reads
   * as "this tile is wrong in three ways" rather than as three unrelated
   * complaints (section 2.1).
   */
  it('gathers every failure about one offer into one row', () => {
    const rows = leafletFailures(
      {
        '/offers/0/pricing/price': [
          '/offers/0/pricing/price must be an object (offer p05-o07)',
        ],
        '/offers/0/product/name': [
          '/offers/0/product/name must not be empty (offer p05-o07)',
        ],
      },
      ['p05-o07']
    );

    expect(rows).toEqual([
      {
        offerId: 'p05-o07',
        section: '',
        messages: [
          '/offers/0/pricing/price must be an object (offer p05-o07)',
          '/offers/0/product/name must not be empty (offer p05-o07)',
        ],
      },
    ]);
  });

  /**
   * The one failure whose message cannot carry the offer id is the one that is
   * *about* the missing id, so the path's index names the tile instead.
   */
  it('names an offer from its index when the message cannot', () => {
    const rows = leafletFailures(
      { '/offers/1/id': ['/offers/1/id must not be empty'] },
      ['p05-o07', 'p01-o01']
    );

    expect(rows[0].offerId).toBe('p01-o01');
  });

  it('names the section for a failure outside the offers', () => {
    const rows = leafletFailures(
      { '/source/sha256': ['/source/sha256 is required'] },
      []
    );

    expect(rows).toEqual([
      {
        offerId: '',
        section: 'source',
        messages: ['/source/sha256 is required'],
      },
    ]);
  });
});

describe('leafletConflict', () => {
  it('tells a document already imported from a run already going', () => {
    const imported = leafletConflict({
      status: 409,
      detail:
        'That document has already been imported for this chain by run ' +
        '11111111-1111-4111-8111-111111111111. Revert that run to import it again.',
    });
    const running = leafletConflict({
      status: 409,
      detail:
        'A run is already in progress: 22222222-2222-4222-8222-222222222222',
    });

    expect(imported).toEqual({
      kind: 'already-imported',
      runId: '11111111-1111-4111-8111-111111111111',
    });
    expect(running).toEqual({
      kind: 'run-in-progress',
      runId: '22222222-2222-4222-8222-222222222222',
    });
  });

  /** A refusal that named no run still says which of the two it was. */
  it('answers with no run when the server named none', () => {
    expect(
      leafletConflict({
        status: 409,
        detail: 'That document has already been imported for this chain',
      })
    ).toEqual({ kind: 'already-imported', runId: '' });
  });

  it('is nothing at all for a failure that is not a conflict', () => {
    expect(leafletConflict({ status: 400, detail: 'nope' })).toBeNull();
  });
});
