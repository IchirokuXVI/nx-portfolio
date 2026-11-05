import {
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  createdFromEntryOf,
  parseKiloPiecesArgs,
  planKiloPieces,
  runKiloPieces,
  type CatalogPort,
  type HarvesterDb,
  type RowRead,
} from './kilo-pieces';

function item(id: string, over: Partial<ItemView> = {}): ItemView {
  return {
    id,
    name: { es: `Producto ${id}` },
    brand: 'Hacendado',
    imageUrl: null,
    imageSource: null,
    imageSupermarketId: null,
    ownImageUrl: null,
    images: [],
    sku: null,
    ean: null,
    eans: [],
    unitSize: 1560,
    approxWeight: null,
    approxWeightSetBy: null,
    packCount: null,
    categories: [
      { id: 'leaf-1', parentId: 'root', slug: 'queso', name: { es: 'Queso' } },
    ],
    defaultUnit: UnitOfMeasure.GRAM,
    productGroupId: null,
    ...over,
  } as ItemView;
}

function row(id: string, itemId: string, over: Partial<RowRead> = {}): RowRead {
  return {
    id: `row-${id}`,
    externalId: id,
    itemId,
    supermarketId: 'mercadona',
    adapterKey: 'mercadona-api',
    soldByWeight: true,
    ean: null,
    imageUrl: null,
    lastRunId: null,
    sizeFormat: 'kg',
    unitSize: null,
    label: 'kg',
    lowestPrice: 9,
    rowsOnItem: 1,
    ...over,
  };
}

/** The raw shape SELECT_ROWS_SQL answers, as pg returns it. */
function raw(r: RowRead): Record<string, unknown> {
  return {
    ...r,
    lowestPrice: r.lowestPrice === null ? null : String(r.lowestPrice),
    unitSize: r.unitSize === null ? null : `${r.unitSize}.0000`,
  };
}

class FakeHarvester implements HarvesterDb {
  readonly writes: { sql: string; params: unknown[] }[] = [];
  hasWeightColumn = true;
  constructor(public rows: RowRead[]) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('WITH active AS')) {
      return this.rows.map(raw) as T[];
    }
    if (sql.includes('information_schema.columns')) {
      return (this.hasWeightColumn ? [{ present: 1 }] : []) as T[];
    }
    this.writes.push({ sql, params });
    return [{ changed: 1 }] as T[];
  }
}

function fakeCatalog(items: ItemView[]) {
  const calls: { kind: string; arg: unknown }[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  let created = 0;
  const catalog: CatalogPort & {
    createdFrom: Map<string, ItemView>;
    storedSetBy: 'SOURCE' | 'ADMIN';
  } = {
    createdFrom: new Map(),
    storedSetBy: 'SOURCE',
    getMany: async (ids) =>
      ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as ItemView] : [])),
    update: async (input) => {
      calls.push({ kind: 'update', arg: input });
      return {
        ...(byId.get(input.itemId) as ItemView),
        defaultUnit: input.defaultUnit as UnitOfMeasure,
        unitSize: null,
        approxWeight: input.approxWeight ?? null,
        approxWeightSetBy: catalog.storedSetBy,
      };
    },
    findCreatedFromEntry: async (entry) => {
      calls.push({ kind: 'find', arg: entry });
      return catalog.createdFrom.get(entry) ?? null;
    },
    create: async (input) => {
      calls.push({ kind: 'create', arg: input });
      created += 1;
      return item(`new-${created}`, {
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
      });
    },
    findItemByEan: async () => null,
    linkImages: async (links) => {
      calls.push({ kind: 'link', arg: links });
      return { linked: 1, moved: 0, unchanged: 0, rejected: [] };
    },
  };
  return { catalog, calls };
}

const kiloPiece = () => item('p-kilo');
const loose = () =>
  item('p-loose', { defaultUnit: UnitOfMeasure.KILOGRAM, unitSize: null });

describe('parseKiloPiecesArgs', () => {
  it('reads the count and the three ceilings', () => {
    expect(parseKiloPiecesArgs(['--count'])).toEqual({ mode: 'count' });
    expect(
      parseKiloPiecesArgs([
        '--max-split',
        '10',
        '--max-kilo',
        '200',
        '--max-piece',
        '20',
      ])
    ).toEqual({ mode: 'write', maxKilo: 200, maxPiece: 20, maxSplit: 10 });
  });

  it('refuses a missing ceiling, a word for a number, and no argument', () => {
    expect(() => parseKiloPiecesArgs([])).toThrow('usage');
    expect(() =>
      parseKiloPiecesArgs(['--max-kilo', '200', '--max-piece', '20'])
    ).toThrow('usage');
    expect(() =>
      parseKiloPiecesArgs([
        '--max-kilo',
        'many',
        '--max-piece',
        '20',
        '--max-split',
        '1',
      ])
    ).toThrow('usage');
  });
});

describe('planKiloPieces', () => {
  it('puts each product in its group of section 7', () => {
    const items = new Map(
      [
        kiloPiece(),
        item('p-ud', { unitSize: 580 }),
        item('p-lidl', { unitSize: 350 }),
        item('p-lidl-shared', { unitSize: 350 }),
        loose(),
        item('p-merged', {
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
        }),
      ].map((i) => [i.id, i])
    );
    const plan = planKiloPieces(
      [
        row('50985', 'p-kilo'),
        row('60226', 'p-ud', { label: 'ud' }),
        row('lidl-1', 'p-lidl', {
          adapterKey: 'lidl-api',
          soldByWeight: false,
          sizeFormat: 'Aprox. 350 g',
          label: null,
        }),
        // Not its only ACTIVE row, so the product is not a piece.
        row('lidl-2', 'p-lidl-shared', {
          adapterKey: 'lidl-api',
          soldByWeight: false,
          sizeFormat: 'Aprox. 350 g',
          rowsOnItem: 2,
        }),
        row('70000', 'p-loose'),
        row('50943', 'p-merged', { lowestPrice: 9.7 }),
        row('50946', 'p-merged', { lowestPrice: 9.41 }),
      ],
      items
    );
    expect(plan.kilo.map((c) => [c.item.id, c.approxWeight])).toEqual([
      ['p-kilo', 1560],
    ]);
    expect(
      plan.piece.map((c) => [c.group, c.item.id, c.approxWeight, c.rowWeight])
    ).toEqual([
      ['piece-mercadona', 'p-ud', 580, null],
      ['piece-lidl', 'p-lidl', 350, 350],
    ]);
    expect(plan.split).toHaveLength(1);
    expect(plan.split[0].keep.externalId).toBe('50946');
    expect(plan.split[0].move.map((r) => r.externalId)).toEqual(['50943']);
    expect(plan.unweighed).toBe(2);
  });

  it('breaks a tie of price by the lower external id, as numbers', () => {
    const items = new Map([
      ['p', item('p', { defaultUnit: UnitOfMeasure.KILOGRAM, unitSize: null })],
    ]);
    const plan = planKiloPieces(
      [
        row('58260', 'p', { lowestPrice: 47.5 }),
        row('9999', 'p', { lowestPrice: 47.5 }),
      ],
      items
    );
    expect(plan.split[0].keep.externalId).toBe('9999');
  });

  it('leaves a sized product with two pieces to a person', () => {
    const items = new Map([['p', item('p')]]);
    const plan = planKiloPieces([row('1', 'p'), row('2', 'p')], items);
    expect(plan.split).toHaveLength(0);
    expect(plan.kilo).toHaveLength(0);
    expect(plan.held).toHaveLength(1);
  });

  it('finds a piece whose product is converted and whose row is not, for each chain', () => {
    const converted = (id: string) =>
      item(id, {
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: null,
        approxWeight: 580,
        approxWeightSetBy: 'SOURCE',
      });
    const items = new Map(
      [converted('p-ud'), converted('p-lidl'), converted('p-lidl-done')].map(
        (i) => [i.id, i]
      )
    );
    const lidl = {
      adapterKey: 'lidl-api',
      soldByWeight: false,
      sizeFormat: 'Aprox. 350 g',
      label: null,
    };
    const plan = planKiloPieces(
      [
        row('60226', 'p-ud', { label: 'ud' }),
        row('lidl-1', 'p-lidl', { ...lidl, unitSize: 350 }),
        // Its row already holds no size: nothing is left to write.
        row('lidl-2', 'p-lidl-done', { ...lidl, unitSize: null }),
      ],
      items
    );
    expect(plan.resume.map((r) => [r.group, r.row.externalId])).toEqual([
      ['piece-mercadona', '60226'],
      ['piece-lidl', 'lidl-1'],
    ]);
    expect([plan.kilo, plan.piece, plan.split]).toEqual([[], [], []]);
  });

  it('matches nothing once a product is converted', () => {
    const items = new Map([
      [
        'p-kilo',
        item('p-kilo', {
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
          approxWeight: 1560,
          approxWeightSetBy: 'SOURCE',
        }),
      ],
    ]);
    const plan = planKiloPieces([row('50985', 'p-kilo')], items);
    expect([plan.kilo, plan.piece, plan.split, plan.resume]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect(plan.unweighed).toBe(0);
  });
});

describe('runKiloPieces', () => {
  const write = {
    mode: 'write',
    maxKilo: 200,
    maxPiece: 20,
    maxSplit: 10,
  } as const;

  it('counts and writes nothing in count mode', async () => {
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    const { catalog, calls } = fakeCatalog([kiloPiece()]);
    const lines: string[] = [];
    await runKiloPieces(
      { harvester, catalog, log: (l) => lines.push(l) },
      { mode: 'count' }
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        'kilo 1',
        'piece 0',
        'split 0',
        'rows 0',
        'unweighed 0',
      ])
    );
    expect(calls).toEqual([]);
    expect(harvester.writes).toEqual([]);
  });

  it('converts a kilo piece in one update that states the weight as SOURCE', async () => {
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    const { catalog, calls } = fakeCatalog([kiloPiece()]);
    const failures = await runKiloPieces(
      { harvester, catalog, log: () => undefined },
      write
    );
    expect(failures).toBe(0);
    expect(calls).toEqual([
      {
        kind: 'update',
        arg: {
          itemId: 'p-kilo',
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
          approxWeight: 1560,
          approxWeightSetBy: 'SOURCE',
          expect: {
            defaultUnit: UnitOfMeasure.GRAM,
            unitSize: 1560,
            approxWeight: null,
          },
        },
      },
    ]);
    // A kilo piece's row already agrees: nothing is written in the harvester.
    expect(harvester.writes).toEqual([]);
  });

  it('counts a failure when catalog stores the weight as a person´s', async () => {
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    const { catalog } = fakeCatalog([kiloPiece()]);
    catalog.storedSetBy = 'ADMIN';
    const lines: string[] = [];
    const failures = await runKiloPieces(
      { harvester, catalog, log: (l) => lines.push(l) },
      write
    );
    expect(failures).toBe(1);
    expect(lines.some((l) => l.includes('not SOURCE'))).toBe(true);
  });

  it('turns a Mercadona piece priced as one into UNIT and the row off weight', async () => {
    const harvester = new FakeHarvester([
      row('60226', 'p-ud', { label: 'ud' }),
    ]);
    const { catalog, calls } = fakeCatalog([item('p-ud', { unitSize: 580 })]);
    await runKiloPieces({ harvester, catalog, log: () => undefined }, write);
    expect(calls.map((c) => c.kind)).toEqual(['update']);
    expect(calls[0].arg).toMatchObject({
      defaultUnit: UnitOfMeasure.UNIT,
      unitSize: null,
      approxWeight: 580,
      approxWeightSetBy: 'SOURCE',
    });
    expect(harvester.writes).toHaveLength(1);
    expect(harvester.writes[0].sql).toContain('"soldByWeight" = false');
  });

  it('gives a LIDL piece its weight and no size on the row', async () => {
    const harvester = new FakeHarvester([
      row('lidl-1', 'p-lidl', {
        adapterKey: 'lidl-api',
        soldByWeight: false,
        sizeFormat: 'Aprox. 350 g',
        label: null,
        unitSize: 350,
      }),
    ]);
    const { catalog, calls } = fakeCatalog([item('p-lidl', { unitSize: 350 })]);
    await runKiloPieces({ harvester, catalog, log: () => undefined }, write);
    expect(calls.map((c) => c.kind)).toEqual(['update']);
    expect(harvester.writes[0].sql).toContain('"approxWeight" = $2');
    expect(harvester.writes[0].params).toEqual(['row-lidl-1', 350]);
  });

  it('refuses above a ceiling before anything is written', async () => {
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    const { catalog, calls } = fakeCatalog([kiloPiece()]);
    await expect(
      runKiloPieces(
        { harvester, catalog, log: () => undefined },
        { ...write, maxKilo: 0 }
      )
    ).rejects.toThrow('nothing was changed');
    expect(calls).toEqual([]);
    expect(harvester.writes).toEqual([]);
  });

  it('refuses where the harvester migration has not run', async () => {
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    harvester.hasWeightColumn = false;
    const { catalog } = fakeCatalog([kiloPiece()]);
    await expect(
      runKiloPieces({ harvester, catalog, log: () => undefined }, write)
    ).rejects.toThrow('"approxWeight" column');
    expect(harvester.writes).toEqual([]);
  });

  it('refuses a catalog that answers no approxWeight', async () => {
    const old = kiloPiece() as Partial<ItemView>;
    delete old.approxWeight;
    const harvester = new FakeHarvester([row('50985', 'p-kilo')]);
    const { catalog } = fakeCatalog([old as ItemView]);
    await expect(
      runKiloPieces({ harvester, catalog, log: () => undefined }, write)
    ).rejects.toThrow('older than plan 0244');
  });

  it('writes only the row of a piece whose product an earlier run converted', async () => {
    const harvester = new FakeHarvester([
      row('60226', 'p-ud', { label: 'ud' }),
    ]);
    const { catalog, calls } = fakeCatalog([
      item('p-ud', {
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: null,
        approxWeight: 580,
        approxWeightSetBy: 'SOURCE',
      }),
    ]);
    const lines: string[] = [];
    await runKiloPieces(
      { harvester, catalog, log: (l) => lines.push(l) },
      write
    );
    expect(lines).toContain('rows 1');
    expect(calls).toEqual([]);
    expect(harvester.writes).toHaveLength(1);
    expect(harvester.writes[0].sql).toContain('"soldByWeight" = false');
    expect(
      lines.some((l) => l.startsWith('resumed piece-mercadona 60226'))
    ).toBe(true);
  });

  it('splits a merged product: one create, one rebind, the photo moved', async () => {
    const merged = item('p-merged', {
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
      ownImageUrl: 'https://example.test/own.jpg',
      packCount: 1,
    });
    const harvester = new FakeHarvester([
      row('50943', 'p-merged', {
        lowestPrice: 9.7,
        imageUrl: 'https://prod.mercadona.test/50943.jpg',
      }),
      row('50946', 'p-merged', { lowestPrice: 9.41 }),
    ]);
    const { catalog, calls } = fakeCatalog([merged]);
    const lines: string[] = [];
    await runKiloPieces(
      { harvester, catalog, log: (l) => lines.push(l) },
      write
    );
    expect(calls.map((c) => c.kind)).toEqual(['find', 'create', 'link']);
    expect(calls[0].arg).toBe('mercadona:50943');
    expect(calls[1].arg).toEqual({
      name: merged.name,
      brand: 'Hacendado',
      imageUrl: 'https://example.test/own.jpg',
      packCount: 1,
      categoryIds: ['leaf-1'],
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
      ean: null,
      createdFromEntry: 'mercadona:50943',
    });
    // The bind is the one harvester write, and nothing marks the row first.
    expect(harvester.writes).toHaveLength(1);
    expect(harvester.writes[0].params).toEqual([
      'row-50943',
      'new-1',
      'p-merged',
    ]);
    expect(harvester.writes[0].sql).not.toContain('extra');
    expect(lines.some((l) => l.startsWith('created 50943 new-1'))).toBe(true);
  });

  it('binds the row to the product an interrupted run created for it', async () => {
    const merged = item('p-merged', {
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
    });
    const moving = row('50943', 'p-merged', { lowestPrice: 9.7 });
    const harvester = new FakeHarvester([
      moving,
      row('50946', 'p-merged', { lowestPrice: 9.41 }),
    ]);
    const { catalog, calls } = fakeCatalog([merged]);
    catalog.createdFrom.set(
      createdFromEntryOf(moving),
      item('p-earlier', { defaultUnit: UnitOfMeasure.KILOGRAM, unitSize: null })
    );
    const lines: string[] = [];
    await runKiloPieces(
      { harvester, catalog, log: (l) => lines.push(l) },
      write
    );
    expect(calls.map((c) => c.kind)).toEqual(['find']);
    expect(harvester.writes[0].params).toEqual([
      'row-50943',
      'p-earlier',
      'p-merged',
    ]);
    expect(lines.some((l) => l.startsWith('adopted 50943 p-earlier'))).toBe(
      true
    );
  });

  it('refuses a row whose earlier product was merged since, and binds nothing', async () => {
    const merged = item('p-merged', {
      defaultUnit: UnitOfMeasure.KILOGRAM,
      unitSize: null,
    });
    const moving = row('50943', 'p-merged', { lowestPrice: 9.7 });
    const harvester = new FakeHarvester([
      moving,
      row('50946', 'p-merged', { lowestPrice: 9.41 }),
    ]);
    const { catalog } = fakeCatalog([merged]);
    catalog.createdFrom.set(
      createdFromEntryOf(moving),
      item('p-earlier', { mergedInto: 'p-merged' })
    );
    const failures = await runKiloPieces(
      { harvester, catalog, log: () => undefined },
      write
    );
    expect(failures).toBe(1);
    expect(harvester.writes).toEqual([]);
  });
});
