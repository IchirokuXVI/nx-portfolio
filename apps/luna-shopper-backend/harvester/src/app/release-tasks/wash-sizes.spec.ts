import {
  UnitOfMeasure,
  type ItemView,
  type UpdateItemInput,
} from '@portfolio/luna-shopper/contracts';
import {
  chainOf,
  countLines,
  notePathOf,
  parseWashSizesArgs,
  planWashSizes,
  readWashFormat,
  reviewList,
  runWashSizes,
  SELECT_STATED_ROWS_SQL,
  SELECT_WASH_ROWS_SQL,
  type CatalogPort,
  type HarvesterDb,
  type StatedRow,
} from './wash-sizes';

function item(id: string, over: Partial<ItemView> = {}): ItemView {
  return {
    id,
    name: { es: `Detergente ${id}` },
    brand: 'Marca',
    imageUrl: null,
    imageSource: null,
    imageSupermarketId: null,
    ownImageUrl: null,
    images: [],
    sku: null,
    ean: null,
    eans: [],
    unitSize: 40,
    approxWeight: null,
    approxWeightSetBy: null,
    packCount: null,
    categories: [],
    defaultUnit: UnitOfMeasure.UNIT,
    productGroupId: null,
    ...over,
  } as ItemView;
}

function row(itemId: string, over: Partial<StatedRow> = {}): StatedRow {
  return {
    itemId,
    chain: 'deza',
    adapterKey: 'deza-web',
    sizeFormat: '40 lavados',
    unitSize: 40,
    sizeUnit: 'UNIT',
    packCount: null,
    label: null,
    ...over,
  };
}

function plan(rows: StatedRow[], items: ItemView[]) {
  return planWashSizes(rows, new Map(items.map((i) => [i.id, i])));
}

describe('wash sizes: the printed wash count', () => {
  it.each([
    ['40 lavados', { count: 40, pack: null }],
    ['2x40 lavados', { count: 80, pack: 2 }],
    ['2 X 40 lavados', { count: 80, pack: 2 }],
    ['44 Lavados.', { count: 44, pack: null }],
    ['1 lavado', { count: 1, pack: null }],
    [' 30lavados ', { count: 30, pack: null }],
  ])('reads %s', (text, expected) => {
    expect(readWashFormat(text)).toEqual(expected);
  });

  it.each(['23+12 lavados', 'ud', '40 lavados gel', '1,5 lavados', '', null])(
    'reads nothing in %s',
    (text) => {
      expect(readWashFormat(text)).toBeNull();
    }
  );

  it('names a chain by its adapter key, and by its id without one', () => {
    expect(chainOf('deza-web', 's1')).toBe('deza');
    expect(chainOf('eljamon-web', 's1')).toBe('eljamon');
    expect(chainOf(null, 's1')).toBe('s1');
  });
});

describe('wash sizes: the selection', () => {
  it('selects 40 lavados on a product of 40 UNIT', () => {
    const p = plan([row('a')], [item('a')]);
    expect(p.corrections.map((c) => c.item.id)).toEqual(['a']);
    expect(p.corrections[0].clearPack).toBe(false);
  });

  it('selects 2x40 lavados on 80 UNIT and clears a pack of 2', () => {
    const p = plan(
      [row('a', { sizeFormat: '2x40 lavados', unitSize: 80 })],
      [item('a', { unitSize: 80, packCount: 2 })]
    );
    expect(p.corrections).toHaveLength(1);
    expect(p.corrections[0].clearPack).toBe(true);
  });

  it('selects 2x40 lavados on 80 UNIT and keeps a pack of 4', () => {
    const p = plan(
      [row('a', { sizeFormat: '2x40 lavados' })],
      [item('a', { unitSize: 80, packCount: 4 })]
    );
    expect(p.corrections).toHaveLength(1);
    expect(p.corrections[0].clearPack).toBe(false);
  });

  it.each([
    ['a product of 42 UNIT', row('a'), item('a', { unitSize: 42 })],
    [
      'a product of 40 MILLILITER',
      row('a'),
      item('a', { defaultUnit: UnitOfMeasure.MILLILITER }),
    ],
    [
      'a sum of washes',
      row('a', { sizeFormat: '23+12 lavados' }),
      item('a', { unitSize: 35 }),
    ],
    ['a row that prints ud', row('a', { sizeFormat: 'ud' }), item('a')],
    ['a product with no size', row('a'), item('a', { unitSize: null })],
    ['a merged product', row('a'), item('a', { mergedInto: 'b' })],
  ])('selects nothing for %s', (_label, r, i) => {
    expect(plan([r], [i]).corrections).toEqual([]);
  });

  it('reads only ACTIVE bound rows, so a CANDIDATE row is never asked', () => {
    for (const sql of [SELECT_WASH_ROWS_SQL, SELECT_STATED_ROWS_SQL]) {
      expect(sql).toContain(`e.status = 'ACTIVE' AND e."itemId" IS NOT NULL`);
    }
  });

  it('asks no audit trail: a product a person sized is selected the same', () => {
    // The product carries nothing that says who set its size, and the
    // command reads nothing else (D4).
    const p = plan([row('a')], [item('a', { brand: 'Edited by hand' })]);
    expect(p.corrections).toHaveLength(1);
  });

  it('counts a product under each chain that qualifies it', () => {
    const rows = [
      row('a'),
      row('a', { chain: 'carrefour', adapterKey: 'carrefour-web' }),
      row('b', { chain: 'carrefour', adapterKey: 'carrefour-web' }),
      row('c', { chain: 'dia', adapterKey: 'dia-api' }),
      row('d', {
        chain: 'mercadona',
        adapterKey: 'mercadona-api',
        sizeFormat: 'l',
        unitSize: 2,
        sizeUnit: 'LITER',
      }),
    ];
    const p = plan(rows, [
      item('a'),
      item('b'),
      item('c', { unitSize: 41 }),
      item('d', { unitSize: 2, defaultUnit: UnitOfMeasure.LITER }),
    ]);
    expect(countLines(p)).toEqual([
      'chain carrefour 2',
      'chain deza 1',
      'chain dia 0',
      'products 2',
      'pack 0',
      'content 0',
      'unread 0',
      'held 0',
      'mercadona-per-wash 0',
    ]);
  });

  it('counts content when another row states a weight or a volume', () => {
    const p = plan(
      [
        row('a'),
        row('a', {
          chain: 'mercadona',
          adapterKey: 'mercadona-api',
          sizeFormat: 'l',
          unitSize: 2,
          sizeUnit: 'LITER',
        }),
      ],
      [item('a')]
    );
    expect(countLines(p)).toContain('content 1');
  });

  it('counts a wash count of 0 as unread, and a product catalog lacks as held', () => {
    const p = plan(
      [row('a', { sizeFormat: '0 lavados' }), row('b')],
      [item('a', { unitSize: 0 })]
    );
    expect(p.unread).toBe(1);
    expect(p.held).toBe(1);
    expect(p.corrections).toEqual([]);
  });

  it('notes a Mercadona pack priced per wash and sized as a count, and corrects it not', () => {
    const per = row('m', {
      chain: 'mercadona',
      adapterKey: 'mercadona-api',
      sizeFormat: 'ud',
      unitSize: 30,
      sizeUnit: 'UNIT',
      label: 'lv',
    });
    const perLitre = row('n', {
      chain: 'mercadona',
      adapterKey: 'mercadona-api',
      sizeFormat: 'ud',
      unitSize: 30,
      sizeUnit: 'UNIT',
      label: 'ud',
    });
    const p = plan([per, perLitre], [item('m', { unitSize: 30 }), item('n')]);
    expect(p.corrections).toEqual([]);
    expect(p.notes.map((n) => n.item.id)).toEqual(['m']);
    expect(countLines(p)).toContain('mercadona-per-wash 1');
  });
});

describe('wash sizes: the review list', () => {
  it('lists the old size and every size the rows state, grouped by chain', () => {
    const rows = [
      row('b'),
      row('a'),
      row('a', {
        chain: 'mercadona',
        adapterKey: 'mercadona-api',
        sizeFormat: '2 l',
        unitSize: 2,
        sizeUnit: 'LITER',
      }),
      row('b', {
        chain: 'carrefour',
        adapterKey: 'carrefour-web',
        sizeFormat: '2x20 lavados',
        unitSize: 40,
      }),
    ];
    const p = plan(rows, [
      item('a', { name: { es: 'Zeta' } }),
      item('b', { name: { es: 'Alfa\tgel' }, packCount: 2 }),
    ]);
    const lines = reviewList(p.corrections).trimEnd().split('\n');
    expect(lines[0]).toBe(
      'chain\titem_id\titem_name\told_unit_size\told_default_unit\t' +
        'old_pack_count\twash_size_format\tstated_sizes'
    );
    expect(lines.slice(1)).toEqual([
      'carrefour\tb\tAlfa gel\t40\tUNIT\t2\t2x20 lavados\t' +
        'carrefour: 2x20 lavados; deza: 40 lavados',
      'deza\tb\tAlfa gel\t40\tUNIT\t2\t40 lavados\t' +
        'carrefour: 2x20 lavados; deza: 40 lavados',
      'deza\ta\tZeta\t40\tUNIT\t\t40 lavados\tdeza: 40 lavados; mercadona: 2 l',
    ]);
  });

  it('puts the Mercadona note beside the list', () => {
    expect(notePathOf('/tmp/review.tsv')).toBe(
      '/tmp/review.mercadona-per-wash.tsv'
    );
  });
});

describe('wash sizes: the arguments', () => {
  it('reads the three modes', () => {
    expect(parseWashSizesArgs(['--count'])).toEqual({ mode: 'count' });
    expect(parseWashSizesArgs(['--review', 'r.tsv'])).toEqual({
      mode: 'review',
      file: 'r.tsv',
    });
    expect(parseWashSizesArgs(['--max', '50', '--review', 'r.tsv'])).toEqual({
      mode: 'write',
      max: 50,
      file: 'r.tsv',
    });
  });

  it.each([
    [[]],
    [['--max', '50']],
    [['--max', 'ten', '--review', 'r.tsv']],
    [['--review', '--max']],
    [['--count', '--max', '5']],
    [['--review', 'a', '--review', 'b']],
  ])('refuses %j', (argv) => {
    expect(() => parseWashSizesArgs(argv)).toThrow(/usage/);
  });
});

/** A harvester that answers the two SELECTs and records anything else. */
class FakeHarvester implements HarvesterDb {
  readonly other: string[] = [];
  constructor(public rows: StatedRow[]) {}
  async query<T>(sql: string): Promise<T[]> {
    if (sql === SELECT_WASH_ROWS_SQL) {
      return this.rows
        .filter((r) => /lavado/i.test(r.sizeFormat ?? ''))
        .map((r) => ({ itemId: r.itemId })) as T[];
    }
    if (sql === SELECT_STATED_ROWS_SQL) {
      return this.rows.map((r) => ({
        ...r,
        supermarketId: `${r.chain}-id`,
        unitSize: r.unitSize === null ? null : `${r.unitSize}.0000`,
      })) as T[];
    }
    this.other.push(sql);
    return [];
  }
}

/** A catalog of products by id that applies an update as catalog would. */
class FakeCatalog implements CatalogPort {
  readonly updates: UpdateItemInput[] = [];
  /** Runs before the read of each product the write run makes. */
  beforeRead: (ids: string[]) => void = () => undefined;
  reads = 0;
  constructor(public items: Map<string, ItemView>) {}
  async getMany(ids: string[]): Promise<ItemView[]> {
    this.reads += 1;
    this.beforeRead(ids);
    return ids.flatMap((id) => {
      const found = this.items.get(id);
      return found ? [{ ...found }] : [];
    });
  }
  async update(input: UpdateItemInput): Promise<ItemView> {
    this.updates.push(input);
    const current = this.items.get(input.itemId);
    if (!current) {
      throw { code: 'item_not_found' };
    }
    const expect = input.expect ?? {};
    if (
      (expect.unitSize !== undefined && expect.unitSize !== current.unitSize) ||
      (expect.packCount !== undefined && expect.packCount !== current.packCount)
    ) {
      throw { code: 'item_expectation_failed', details: current.id };
    }
    const next = {
      ...current,
      ...('unitSize' in input ? { unitSize: input.unitSize ?? null } : {}),
      ...('packCount' in input ? { packCount: input.packCount ?? null } : {}),
    };
    this.items.set(current.id, next);
    return next;
  }
}

function stack(rows: StatedRow[], items: ItemView[]) {
  const harvester = new FakeHarvester(rows);
  const catalog = new FakeCatalog(new Map(items.map((i) => [i.id, i])));
  const files = new Map<string, string>();
  const log: string[] = [];
  return {
    harvester,
    catalog,
    files,
    log,
    ports: {
      harvester,
      catalog,
      files: {
        write: async (path: string, text: string) => {
          files.set(path, text);
        },
      },
      log: (line: string) => log.push(line),
    },
  };
}

describe('wash sizes: the command', () => {
  const rows = () => [
    row('a'),
    row('b', { sizeFormat: '2x40 lavados', unitSize: 80 }),
  ];
  const items = () => [
    item('a', { name: { es: 'Nombre secreto' } }),
    item('b', { unitSize: 80, packCount: 2 }),
  ];

  it('--count writes nothing and prints no id and no name', async () => {
    const s = stack(rows(), items());
    await runWashSizes(s.ports, { mode: 'count' });
    expect(s.catalog.updates).toEqual([]);
    expect(s.harvester.other).toEqual([]);
    expect(s.files.size).toBe(0);
    expect(s.log).toContain('products 2');
    expect(s.log.join('\n')).not.toMatch(/Nombre|\ba\b|\bb\b/);
  });

  it('--review writes the list and no database row', async () => {
    const s = stack(rows(), items());
    await runWashSizes(s.ports, { mode: 'review', file: 'r.tsv' });
    expect(s.catalog.updates).toEqual([]);
    expect(s.harvester.other).toEqual([]);
    expect(s.files.get('r.tsv')?.trimEnd().split('\n')).toHaveLength(3);
    expect(s.files.has('r.mercadona-per-wash.tsv')).toBe(true);
  });

  it('corrects, lists the old values, and a second count prints products 0', async () => {
    const s = stack(rows(), items());
    const failures = await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
    });
    expect(failures).toBe(0);
    expect(s.catalog.updates).toEqual([
      {
        itemId: 'a',
        unitSize: null,
        expect: {
          defaultUnit: UnitOfMeasure.UNIT,
          unitSize: 40,
          packCount: null,
        },
      },
      {
        itemId: 'b',
        unitSize: null,
        packCount: null,
        expect: { defaultUnit: UnitOfMeasure.UNIT, unitSize: 80, packCount: 2 },
      },
    ]);
    const list = s.files.get('r.tsv') ?? '';
    expect(list).toContain('\tb\tDetergente b\t80\tUNIT\t2\t2x40 lavados\t');
    expect(s.log).toEqual(
      expect.arrayContaining(['corrected 2', 'skipped 0', 'failures 0'])
    );
    expect(s.log.join('\n')).not.toMatch(/Nombre|Detergente/);

    s.log.length = 0;
    await runWashSizes(s.ports, { mode: 'count' });
    expect(s.log).toContain('products 0');
  });

  it('refuses before any write when --max is below the count', async () => {
    const s = stack(rows(), items());
    await expect(
      runWashSizes(s.ports, { mode: 'write', max: 1, file: 'r.tsv' })
    ).rejects.toThrow(/2 products, above 1/);
    expect(s.catalog.updates).toEqual([]);
    expect(s.files.size).toBe(0);
  });

  it('refuses before any write when a wash count reads as 0', async () => {
    const s = stack(
      [...rows(), row('c', { sizeFormat: '0 lavados' })],
      items()
    );
    await expect(
      runWashSizes(s.ports, { mode: 'write', max: 9, file: 'r.tsv' })
    ).rejects.toThrow(/not a whole number above 0/);
    expect(s.catalog.updates).toEqual([]);
  });

  it('skips a product edited between the count and its update, and lists it not', async () => {
    const s = stack(rows(), items());
    s.catalog.beforeRead = (ids) => {
      // The read of the write run, one product at a time.
      if (ids.length === 1 && ids[0] === 'a') {
        s.catalog.items.set('a', item('a', { unitSize: 750 }));
      }
    };
    await runWashSizes(s.ports, { mode: 'write', max: 2, file: 'r.tsv' });
    expect(s.catalog.updates.map((u) => u.itemId)).toEqual(['b']);
    expect(s.catalog.items.get('a')?.unitSize).toBe(750);
    expect(s.files.get('r.tsv')).not.toContain('\ta\t');
    expect(s.log).toEqual(expect.arrayContaining(['corrected 1', 'skipped 1']));
  });

  it('skips a product whose expectation fails in catalog, and prints a code for a failure', async () => {
    const s = stack(rows(), items());
    const update = s.catalog.update.bind(s.catalog);
    s.catalog.update = async (input) => {
      if (input.itemId === 'a') {
        throw { code: 'item_expectation_failed', details: 'a' };
      }
      if (input.itemId === 'b') {
        throw { code: 'validation_failed', message: 'b is Detergente b' };
      }
      return update(input);
    };
    const failures = await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
    });
    expect(failures).toBe(1);
    expect(s.log).toEqual(
      expect.arrayContaining([
        'failed validation_failed',
        'corrected 0',
        'skipped 1',
        'failures 1',
      ])
    );
    expect(s.log.join('\n')).not.toMatch(/Detergente/);
  });
});
