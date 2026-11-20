import {
  UnitOfMeasure,
  type ItemView,
  type UpdateItemInput,
} from '@portfolio/luna-shopper/contracts';
import { EventEmitter } from 'events';
import {
  chainOf,
  confirmsCorrection,
  countLines,
  describe as describeFailure,
  describeWarning,
  guardOutput,
  listsToSave,
  mergeList,
  NOTES_SHAPE,
  notesList,
  notesPathOf,
  parseWashSizesArgs,
  planWashSizes,
  readNoteFormat,
  readRecorded,
  readWashFormat,
  reconcileReview,
  REVIEW_HEADER,
  REVIEW_SHAPE,
  reviewList,
  runWashSizes,
  SELECT_STATED_ROWS_SQL,
  SELECT_WASH_ROWS_SQL,
  statedSizeOf,
  WASH_PREFILTER,
  WashSizesRefusal,
  type CatalogPort,
  type HarvesterDb,
  type ListShape,
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
    entryId: `e-${itemId}`,
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
      'pack-of-units 0',
      'short-wash-word 0',
      'sum 0',
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

  it.each([
    ['a count of 1', 1],
    ['no stated count', null],
  ])('notes no Mercadona row priced per wash with %s', (_label, unitSize) => {
    const r = row('m', {
      chain: 'mercadona',
      adapterKey: 'mercadona-api',
      sizeFormat: 'ud',
      unitSize,
      sizeUnit: 'UNIT',
      label: 'lv',
    });
    expect(plan([r], [item('m', { unitSize: 1 })]).notes).toEqual([]);
  });

  it('asks the note only for Mercadona counts above 1', () => {
    expect(SELECT_STATED_ROWS_SQL).toContain(
      `e."sizeUnit" = 'UNIT'\n              AND e."unitSize" > 1`
    );
    expect(SELECT_STATED_ROWS_SQL).toContain(
      `r.label = 'lv'\n        AND r."unitSize" > 1`
    );
  });
});

describe('wash sizes: the review list', () => {
  it('lists the old size and every size the rows state, grouped by chain', () => {
    const rows = [
      row('b'),
      row('a'),
      // Mercadona's real shape: the bare unit as the text, the number apart.
      row('a', {
        chain: 'mercadona',
        adapterKey: 'mercadona-api',
        sizeFormat: 'l',
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
        'old_pack_count\twash_size_format\tstated_sizes\toutcome'
    );
    expect(lines.slice(1)).toEqual([
      'carrefour\tb\tAlfa gel\t40\tUNIT\t2\t2x20 lavados\t' +
        'carrefour: 2x20 lavados; deza: 40 lavados\tplanned',
      'deza\tb\tAlfa gel\t40\tUNIT\t2\t40 lavados\t' +
        'carrefour: 2x20 lavados; deza: 40 lavados\tplanned',
      'deza\ta\tZeta\t40\tUNIT\t\t40 lavados\t' +
        'deza: 40 lavados; mercadona: 2 l\tplanned',
    ]);
  });

  it.each([
    [
      'a bare unit after its stored number',
      { sizeFormat: 'l', unitSize: 2 },
      '2 l',
    ],
    [
      'a bare unit with no stored number',
      { sizeFormat: 'ud', unitSize: null },
      'ud',
    ],
    [
      'a text that prints its number',
      { sizeFormat: '40 lavados', unitSize: 40 },
      '40 lavados',
    ],
    ['a decimal number', { sizeFormat: 'kg', unitSize: 1.5 }, '1.5 kg'],
  ])('states %s', (_label, over, expected) => {
    expect(statedSizeOf(row('a', over))).toBe(expected);
  });

  it('puts the notes beside the list', () => {
    expect(notesPathOf('/tmp/review.tsv')).toBe('/tmp/review.notes.tsv');
  });
});

describe('wash sizes: the arguments', () => {
  it('reads the three modes', () => {
    expect(parseWashSizesArgs(['--count'])).toEqual({ mode: 'count' });
    expect(parseWashSizesArgs(['--review', 'r.tsv'])).toEqual({
      mode: 'review',
      file: 'r.tsv',
      recorded: null,
    });
    expect(parseWashSizesArgs(['--max', '50', '--review', 'r.tsv'])).toEqual({
      mode: 'write',
      max: 50,
      file: 'r.tsv',
      recorded: null,
    });
    expect(
      parseWashSizesArgs(['--max', '5', '--review', 'r.tsv', '--recorded', '-'])
    ).toEqual({ mode: 'write', max: 5, file: 'r.tsv', recorded: '-' });
  });

  it.each([
    [[]],
    [['--max', '50']],
    [['--recorded', '-']],
    [['--count', '--recorded', '-']],
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
  /** What `~*` of the SQL keeps. The same text, case insensitive. */
  prefilter = new RegExp(WASH_PREFILTER, 'i');
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
        id: r.entryId,
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
  /**
   * Off, the catalog applies any update, so only the command's own re-read
   * of section 1.4 can skip a product that changed.
   */
  checkExpectations = true;
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
      this.checkExpectations &&
      ((expect.unitSize !== undefined &&
        expect.unitSize !== current.unitSize) ||
        (expect.packCount !== undefined &&
          expect.packCount !== current.packCount))
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
        read: async (path: string) => {
          const text = files.get(path);
          if (text === undefined) {
            throw new Error(`no file ${path}`);
          }
          return text;
        },
      },
      log: (line: string) => log.push(line),
    },
  };
}

/** The ConfigMap post.sh would save from the lists of `file`, as JSON. */
function configMap(files: Map<string, string>, file: string): string {
  return JSON.stringify({
    data: {
      'review.tsv': files.get(file),
      'notes.tsv': files.get(notesPathOf(file)),
    },
  });
}

/** The outcome of each product's line in a review list, by item id. */
function outcomes(text: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (text ?? '')
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t'))
      .map((cells) => [cells[1], cells[cells.length - 1]])
  );
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
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r.tsv',
      recorded: null,
    });
    expect(s.catalog.updates).toEqual([]);
    expect(s.harvester.other).toEqual([]);
    expect(s.files.get('r.tsv')?.trimEnd().split('\n')).toHaveLength(3);
    expect(s.files.get('r.tsv')).not.toContain('corrected');
    expect(s.files.has('r.notes.tsv')).toBe(true);
  });

  it('corrects, lists the old values, and a second count prints products 0', async () => {
    const s = stack(rows(), items());
    const failures = await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
      recorded: null,
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
    expect(list).not.toContain('planned');
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
      runWashSizes(s.ports, {
        mode: 'write',
        max: 1,
        file: 'r.tsv',
        recorded: null,
      })
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
      runWashSizes(s.ports, {
        mode: 'write',
        max: 9,
        file: 'r.tsv',
        recorded: null,
      })
    ).rejects.toThrow(/not a whole number above 0/);
    expect(s.catalog.updates).toEqual([]);
  });

  it('skips a product edited between the count and its update, and lists it planned', async () => {
    const s = stack(rows(), items());
    s.catalog.beforeRead = (ids) => {
      // The read of the write run, one product at a time.
      if (ids.length === 1 && ids[0] === 'a') {
        s.catalog.items.set('a', item('a', { unitSize: 750 }));
      }
    };
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
      recorded: null,
    });
    expect(s.catalog.updates.map((u) => u.itemId)).toEqual(['b']);
    expect(s.catalog.items.get('a')?.unitSize).toBe(750);
    // It was counted, so it is listed, and its update never went through.
    const lines = (s.files.get('r.tsv') ?? '').split('\n');
    expect(lines.find((l) => l.includes('\ta\t'))).toMatch(
      /\ta\tNombre secreto\t40\t.*\tplanned$/
    );
    expect(lines.find((l) => l.includes('\tb\t'))).toMatch(/\tcorrected$/);
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
      recorded: null,
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

  it('skips a product that changed by its own re-read, with a catalog that checks nothing', async () => {
    // Only the re-read of section 1.4 can skip here: this catalog applies any
    // update, whatever the expect says.
    const s = stack(rows(), items());
    s.catalog.checkExpectations = false;
    s.catalog.beforeRead = (ids) => {
      if (ids.length === 1 && ids[0] === 'a') {
        s.catalog.items.set('a', item('a', { unitSize: 750 }));
      }
    };
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
      recorded: null,
    });
    expect(s.catalog.updates.map((u) => u.itemId)).toEqual(['b']);
    expect(s.catalog.items.get('a')?.unitSize).toBe(750);
    expect(s.log).toEqual(expect.arrayContaining(['corrected 1', 'skipped 1']));
  });

  it('writes past a product catalog lacks or merged, counts it held, and lists it not', async () => {
    const s = stack(
      [...rows(), row('gone'), row('merged')],
      [...items(), item('merged', { mergedInto: 'a' })]
    );
    const failures = await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
      recorded: null,
    });
    expect(failures).toBe(0);
    expect(s.catalog.updates.map((u) => u.itemId)).toEqual(['a', 'b']);
    expect(s.log).toEqual(
      expect.arrayContaining(['held 2', 'products 2', 'corrected 2'])
    );
    expect(s.files.get('r.tsv')).not.toMatch(/\tgone\t|\tmerged\t/);
  });

  it('keeps every product an earlier run corrected when a later run finishes the rest', async () => {
    const s = stack(rows(), items());
    const update = s.catalog.update.bind(s.catalog);
    // Run 1 corrects a, then b fails.
    s.catalog.update = async (input) => {
      if (input.itemId === 'b') {
        throw { code: 'timeout' };
      }
      return update(input);
    };
    expect(
      await runWashSizes(s.ports, {
        mode: 'write',
        max: 2,
        file: 'r.tsv',
        recorded: null,
      })
    ).toBe(1);
    s.files.set('cm1.json', configMap(s.files, 'r.tsv'));
    expect(outcomes(s.files.get('r.tsv'))).toEqual({
      a: 'corrected',
      b: 'planned',
    });

    // Run 2: a stays corrected with its old size, b becomes corrected.
    s.catalog.update = update;
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'before.tsv',
      recorded: 'cm1.json',
    });
    expect(s.files.get('before.tsv')).toContain(
      '\ta\tNombre secreto\t40\tUNIT\t'
    );
    expect(outcomes(s.files.get('before.tsv'))).toEqual({
      a: 'corrected',
      b: 'planned',
    });
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r2.tsv',
      recorded: 'cm1.json',
    });
    const second = (s.files.get('r2.tsv') ?? '').trimEnd().split('\n');
    expect(second).toHaveLength(3);
    expect(second.filter((l) => l.startsWith('chain\t'))).toHaveLength(1);
    expect(second.join('\n')).toContain('\ta\tNombre secreto\t40\tUNIT\t');
    expect(second.join('\n')).toContain('\tb\tDetergente b\t80\tUNIT\t2\t');
    expect(outcomes(s.files.get('r2.tsv'))).toEqual({
      a: 'corrected',
      b: 'corrected',
    });

    // Run 3 has nothing to do and changes nothing.
    s.files.set('cm2.json', configMap(s.files, 'r2.tsv'));
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r3.tsv',
      recorded: 'cm2.json',
    });
    expect(s.files.get('r3.tsv')).toBe(s.files.get('r2.tsv'));
    expect(s.files.get(notesPathOf('r3.tsv'))).toBe(
      s.files.get(notesPathOf('r2.tsv'))
    );
  });

  it('moves a line from planned to corrected across three runs, then leaves it', async () => {
    const s = stack([row('a')], [item('a')]);
    // Run 1: the list saved before the write, as post.sh does.
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r1.tsv',
      recorded: null,
    });
    expect(outcomes(s.files.get('r1.tsv'))).toEqual({ a: 'planned' });
    s.files.set('cm1.json', configMap(s.files, 'r1.tsv'));

    // Run 2: the update goes through.
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 1,
      file: 'r2.tsv',
      recorded: 'cm1.json',
    });
    expect(outcomes(s.files.get('r2.tsv'))).toEqual({ a: 'corrected' });
    expect(s.files.get('r2.tsv')).toContain('\ta\tDetergente a\t40\tUNIT\t');
    s.files.set('cm2.json', configMap(s.files, 'r2.tsv'));

    // Run 3: nothing qualifies, and the corrected line stays as it was.
    for (const mode of ['review', 'write'] as const) {
      await runWashSizes(
        s.ports,
        mode === 'review'
          ? { mode, file: 'r3.tsv', recorded: 'cm2.json' }
          : { mode, max: 1, file: 'r3.tsv', recorded: 'cm2.json' }
      );
      expect(s.files.get('r3.tsv')).toBe(s.files.get('r2.tsv'));
    }
  });

  it('leaves a planned line planned when its product stopped qualifying', async () => {
    const s = stack([row('a')], [item('a')]);
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r1.tsv',
      recorded: null,
    });
    s.files.set('cm1.json', configMap(s.files, 'r1.tsv'));
    // A person sized it between the runs.
    s.catalog.items.set('a', item('a', { unitSize: 750 }));
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 1,
      file: 'r2.tsv',
      recorded: 'cm1.json',
    });
    expect(s.catalog.updates).toEqual([]);
    expect(s.files.get('r2.tsv')).toBe(s.files.get('r1.tsv'));
    expect(outcomes(s.files.get('r2.tsv'))).toEqual({ a: 'planned' });
  });

  it('leaves a planned line planned when its update fails', async () => {
    const s = stack([row('a')], [item('a')]);
    s.catalog.update = async () => {
      throw { code: 'timeout' };
    };
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 1,
      file: 'r.tsv',
      recorded: null,
    });
    expect(outcomes(s.files.get('r.tsv'))).toEqual({ a: 'planned' });
  });

  it('refuses a recorded list of an earlier shape, naming the ConfigMap and the remedy', async () => {
    const s = stack(rows(), items());
    // The header of the review list before the outcome column.
    const old =
      'chain\titem_id\titem_name\told_unit_size\told_default_unit\t' +
      'old_pack_count\twash_size_format\tstated_sizes\n' +
      'deza\ta\tNombre secreto\t40\tUNIT\t\t40 lavados\tdeza: 40 lavados\n';
    s.files.set('cm.json', JSON.stringify({ data: { 'review.tsv': old } }));
    const error = await runWashSizes(s.ports, {
      mode: 'write',
      max: 2,
      file: 'r.tsv',
      recorded: 'cm.json',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WashSizesRefusal);
    const message = (error as Error).message;
    expect(message).toContain('configmap/release-task-0007-review');
    expect(message).toContain('review.tsv');
    expect(message).toMatch(
      /Delete configmap\/release-task-0007-review, or restore/
    );
    expect(message).not.toMatch(/Nombre/);
    expect(s.catalog.updates).toEqual([]);
    expect(s.files.has('r.tsv')).toBe(false);
  });

  it('refuses a recorded ConfigMap that holds the old Mercadona key', async () => {
    const s = stack(rows(), items());
    s.files.set(
      'cm.json',
      JSON.stringify({ data: { 'mercadona-per-wash.tsv': 'x' } })
    );
    await expect(
      runWashSizes(s.ports, {
        mode: 'review',
        file: 'r.tsv',
        recorded: 'cm.json',
      })
    ).rejects.toThrow(/configmap\/release-task-0007-review holds the key/);
    expect(s.files.has('r.tsv')).toBe(false);
  });

  it('refuses a recorded ConfigMap it cannot read before any write, quoting none of it', async () => {
    const s = stack(rows(), items());
    s.files.set('cm.json', '{"data": "Nombre secreto');
    await expect(
      runWashSizes(s.ports, {
        mode: 'write',
        max: 2,
        file: 'r.tsv',
        recorded: 'cm.json',
      })
    ).rejects.toThrow(/cannot be read/);
    expect(s.catalog.updates).toEqual([]);
    expect(s.files.has('r.tsv')).toBe(false);
  });
});

describe('wash sizes: lists across runs', () => {
  const header = ['chain', 'item_id', 'item_name', 'old_unit_size'];
  const shape: ListShape = {
    header,
    key: 'review.tsv',
    keyOf: (cells) => `${cells[0]}\t${cells[1]}`,
    groupOf: (cells) => cells[0],
    nameOf: (cells) => cells[2] ?? '',
  };
  const list = (...lines: string[]) =>
    [header.join('\t'), ...lines].join('\n') + '\n';

  it('keeps a recorded line as it stands and adds only new products', () => {
    const merged = mergeList(
      shape,
      list('deza\ta\tZeta\t40'),
      list('deza\ta\tZeta\t', 'carrefour\tb\tAlfa\t80', 'deza\tc\tBeta\t30')
    );
    expect(merged).toBe(
      list('carrefour\tb\tAlfa\t80', 'deza\tc\tBeta\t30', 'deza\ta\tZeta\t40')
    );
  });

  it('changes nothing when merged twice, and keeps one header', () => {
    const once = mergeList(shape, '', list('deza\ta\tZeta\t40'));
    expect(mergeList(shape, once, once)).toBe(once);
    expect(mergeList(shape, once, list())).toBe(once);
  });

  it('keys on chain and product, so one product under two chains is two lines', () => {
    const merged = mergeList(
      shape,
      list('deza\ta\tZeta\t40'),
      list('dia\ta\tZeta\t40')
    );
    expect(merged.trimEnd().split('\n')).toHaveLength(3);
  });

  it('refuses a list with another header, quoting none of it', () => {
    expect(() =>
      mergeList(shape, 'other\theader\nNombre secreto\n', list())
    ).toThrow(WashSizesRefusal);
    expect(() =>
      mergeList(shape, 'other\theader\nNombre secreto\n', list())
    ).not.toThrow(/Nombre/);
    expect(() =>
      mergeList(shape, 'other\theader\nNombre secreto\n', list())
    ).toThrow(
      'the key review.tsv of configmap/release-task-0007-review does not ' +
        'start with the header of this task. Delete ' +
        'configmap/release-task-0007-review, or restore the header'
    );
  });

  it('reads no ConfigMap as nothing recorded, and a missing key as empty', () => {
    expect(readRecorded('')).toEqual({ review: '', notes: '' });
    expect(readRecorded('{"data": {"review.tsv": "x"}}')).toEqual({
      review: 'x',
      notes: '',
    });
    expect(readRecorded('{"kind": "ConfigMap"}')).toEqual({
      review: '',
      notes: '',
    });
  });
});

/** Texts a note reads, with the kind and the count. */
const NOTE_ACCEPTS: [string, string, number][] = [
  ['pack de 2 unidades de 50 lavados.', 'pack-of-units', 100],
  ['pack 2 de 50 lavados', 'pack-of-units', 100],
  ['pack de 3 de 20 lavados', 'pack-of-units', 60],
  ['2 cajas de 40 lavados', 'pack-of-units', 80],
  ['pack 2 bolsas 30 lavados.', 'pack-of-units', 60],
  ['PACK DE 2 UNIDADES DE 50 LAVADOS', 'pack-of-units', 100],
  ['40lav', 'short-wash-word', 40],
  ['40 lv.', 'short-wash-word', 40],
  ['40LV', 'short-wash-word', 40],
  ['23+12 lavados', 'sum', 35],
  ['23+12  lavados', 'sum', 35],
  ['23 + 12lav', 'sum', 35],
  ['23+12 lv', 'sum', 35],
  ['23+12lv.', 'sum', 35],
];

/** Texts no note reads, among them the spacings the prefilter rejects. */
const NOTE_REJECTS: (string | null)[] = [
  '40 lavados',
  '2x40 lavados',
  'pk 40lav',
  '40lava',
  '40 l',
  '40  lav',
  '40\tlv',
  '40lav gel',
  'caja de 50 lavados',
  'pack de 2 unidades de 2x50 lavados',
  'pack de 2 unidades de 28+16 lavados',
  '23+12 l',
  '23+12  lav',
  '23+12\tlv',
  '23+12 lv',
  'ud',
  '',
  null,
];

describe('wash sizes: the notes', () => {
  it.each(NOTE_ACCEPTS)('reads %s as %s of %d', (text, kind, count) => {
    expect(readNoteFormat(text)).toEqual({ kind, count });
    expect(readWashFormat(text)).toBeNull();
  });

  it.each(NOTE_REJECTS)('reads no note in %s', (text) => {
    expect(readNoteFormat(text)).toBeNull();
  });

  const eljamon = { chain: 'eljamon', adapterKey: 'eljamon-web' };

  it('corrects 40 lavados and notes it not', () => {
    const p = plan([row('a')], [item('a')]);
    expect(p.corrections).toHaveLength(1);
    expect(p.notes).toEqual([]);
  });

  it('notes 40lav on a product of 40 UNIT and corrects it not', () => {
    const p = plan(
      [row('a', { ...eljamon, sizeFormat: '40lav' })],
      [item('a')]
    );
    expect(p.corrections).toEqual([]);
    expect(p.notes.map((n) => [n.kind, n.item.id])).toEqual([
      ['short-wash-word', 'a'],
    ]);
    expect(countLines(p)).toContain('short-wash-word 1');
  });

  it.each(['pk 40lav', '40lava', '40 l'])(
    'neither corrects nor notes %s',
    (sizeFormat) => {
      const p = plan([row('a', { ...eljamon, sizeFormat })], [item('a')]);
      expect(p.corrections).toEqual([]);
      expect(p.notes).toEqual([]);
    }
  );

  it.each([
    [
      'a pack of units',
      'pack de 2 unidades de 50 lavados.',
      100,
      'pack-of-units',
    ],
    ['a short wash word', '40lv', 40, 'short-wash-word'],
    ['a sum', '23+12 lavados', 35, 'sum'],
  ])(
    'notes %s only on a product that holds its count as UNIT',
    (_l, sizeFormat, count, kind) => {
      const r = row('a', { sizeFormat });
      expect(plan([r], [item('a', { unitSize: count })]).notes[0]?.kind).toBe(
        kind
      );
      expect(plan([r], [item('a', { unitSize: count + 1 })]).notes).toEqual([]);
      expect(
        plan(
          [r],
          [item('a', { unitSize: count, defaultUnit: UnitOfMeasure.GRAM })]
        ).notes
      ).toEqual([]);
    }
  );

  it('never notes a product it corrects', () => {
    const p = plan(
      [row('a'), row('a', { ...eljamon, entryId: 'e2', sizeFormat: '40lav' })],
      [item('a')]
    );
    expect(p.corrections.map((c) => c.item.id)).toEqual(['a']);
    expect(p.notes).toEqual([]);
  });

  it('gives two noted rows of one product two lines, also across runs', () => {
    const rows = [
      row('a', { ...eljamon, entryId: 'e1', sizeFormat: '40lav' }),
      row('a', { ...eljamon, entryId: 'e2', sizeFormat: '40 lv' }),
    ];
    const text = notesList(plan(rows, [item('a')]).notes);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe(
      'kind\tchain\titem_id\titem_name\tunit_size\tdefault_unit\tpack_count\t' +
        'row_size_format\tstated_sizes\tentry_id'
    );
    expect(lines.slice(1)).toEqual([
      'short-wash-word\teljamon\ta\tDetergente a\t40\tUNIT\t\t40 lv\t' +
        'eljamon: 40 lv; eljamon: 40lav\te2',
      'short-wash-word\teljamon\ta\tDetergente a\t40\tUNIT\t\t40lav\t' +
        'eljamon: 40 lv; eljamon: 40lav\te1',
    ]);
    // Merged with itself, and with an earlier run's copy, still two lines.
    expect(mergeList(NOTES_SHAPE, text, text)).toBe(text);
    expect(mergeList(NOTES_SHAPE, '', text).trimEnd().split('\n')).toHaveLength(
      3
    );
  });

  it('moves the Mercadona per wash note into the notes as its kind', () => {
    const r = row('m', {
      chain: 'mercadona',
      adapterKey: 'mercadona-api',
      sizeFormat: 'ud',
      unitSize: 30,
      sizeUnit: 'UNIT',
      label: 'lv',
    });
    const text = notesList(plan([r], [item('m', { unitSize: 30 })]).notes);
    expect(text.split('\n')[1]).toBe(
      'mercadona-per-wash\tmercadona\tm\tDetergente m\t30\tUNIT\t\tud\t' +
        'mercadona: 30 ud\te-m'
    );
  });

  it('writes no noted product and prints no id or name in the counts', async () => {
    const s = stack(
      [
        row('a', { ...eljamon, sizeFormat: '40lav' }),
        row('b', { sizeFormat: '23+12 lavados' }),
        row('c', {
          chain: 'carrefour',
          adapterKey: 'carrefour-web',
          sizeFormat: 'pack de 2 unidades de 50 lavados.',
        }),
      ],
      [
        item('a', { name: { es: 'Nombre secreto' } }),
        item('b', { unitSize: 35 }),
        item('c', { unitSize: 100 }),
      ]
    );
    await runWashSizes(s.ports, { mode: 'count' });
    expect(s.log).toEqual(
      expect.arrayContaining([
        'products 0',
        'pack-of-units 1',
        'short-wash-word 1',
        'sum 1',
        'mercadona-per-wash 0',
      ])
    );
    for (const line of s.log) {
      expect(line).toMatch(/^[a-z-]+ (?:[a-z0-9-]+ )?\d+$/);
    }
    expect(s.log.join('\n')).not.toMatch(/Nombre|Detergente|\ba\b|\bb\b|\bc\b/);

    s.log.length = 0;
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 5,
      file: 'r.tsv',
      recorded: null,
    });
    expect(s.catalog.updates).toEqual([]);
    expect(s.harvester.other).toEqual([]);
    expect(
      (s.files.get('r.notes.tsv') ?? '').trimEnd().split('\n')
    ).toHaveLength(4);
    expect(s.log.join('\n')).not.toMatch(/Nombre|Detergente/);
  });
});

describe('wash sizes: the wider prefilter', () => {
  /** The rows a prefilter keeps, then the plan of them. */
  function planThrough(
    prefilter: RegExp,
    rows: StatedRow[],
    items: ItemView[]
  ) {
    const kept = new Set(
      rows
        .filter((r) => prefilter.test(r.sizeFormat ?? ''))
        .map((r) => r.itemId)
    );
    return plan(
      rows.filter((r) => kept.has(r.itemId)),
      items
    );
  }

  const corpus = [
    '40 lavados',
    '2x40 lavados',
    '44 Lavados.',
    '40lav',
    '40 lv',
    'pk 40lav',
    '40lava',
    '40 l',
    '23+12 lavados',
    '23+12lav',
    'pack de 2 unidades de 50 lavados.',
    'ud',
    '1 l',
  ];

  it('corrects exactly what the old prefilter corrected', () => {
    const rows = corpus.map((sizeFormat, i) =>
      row(`p${i}`, { sizeFormat, entryId: `e${i}` })
    );
    for (const unitSize of [35, 40, 44, 80, 100]) {
      const sized = corpus.map((_t, i) => item(`p${i}`, { unitSize }));
      const before = planThrough(/lavado/i, rows, sized);
      const after = planThrough(new RegExp(WASH_PREFILTER, 'i'), rows, sized);
      expect(after.corrections.map((c) => c.item.id)).toEqual(
        before.corrections.map((c) => c.item.id)
      );
      expect(countLines(after).slice(0, 6)).toEqual(
        countLines(before).slice(0, 6)
      );
    }
  });

  it('keeps every row a correction or a note reads', () => {
    const prefilter = new RegExp(WASH_PREFILTER, 'i');
    for (const text of corpus) {
      if (readWashFormat(text) !== null || readNoteFormat(text) !== null) {
        expect(prefilter.test(text)).toBe(true);
      }
    }
  });

  it('admits every text a note pattern accepts anywhere in this spec', () => {
    // A note pattern wider than the prefilter notes a row only when another
    // row of its product happens to pass, so the two must agree.
    const prefilter = new RegExp(WASH_PREFILTER, 'i');
    const texts = [
      ...NOTE_ACCEPTS.map(([text]) => text),
      ...NOTE_REJECTS,
      ...corpus,
    ];
    const accepted = texts.filter(
      (text): text is string => readNoteFormat(text) !== null
    );
    expect(accepted.length).toBeGreaterThanOrEqual(NOTE_ACCEPTS.length);
    expect(accepted.filter((text) => !prefilter.test(text))).toEqual([]);
  });

  it('is the text the SQL asks with', () => {
    expect(WASH_PREFILTER).not.toContain('\\');
    expect(SELECT_WASH_ROWS_SQL).toContain(
      `e."sizeFormat" ~* '${WASH_PREFILTER}'`
    );
  });
});

describe('wash sizes: what a failure prints', () => {
  it('prints a refusal the command worded', () => {
    expect(describeFailure(new WashSizesRefusal('Refused: 3 products'))).toBe(
      'Refused: 3 products'
    );
  });

  it.each([
    [
      'a failed query',
      Object.assign(
        new Error('invalid input syntax for type uuid: "Detergente a"'),
        { name: 'QueryFailedError', code: '22P02' }
      ),
      'the command failed: QueryFailedError 22P02',
    ],
    [
      'a rejected read',
      new Error('item Detergente a (0b1c) could not be read'),
      'the command failed: Error',
    ],
    [
      'a refusal object with a message',
      { code: 'validation_failed', message: 'Detergente a' },
      'the command failed: validation_failed',
    ],
    ['a bare string', 'Detergente a', 'the command failed'],
  ])('prints no product for %s', (_label, error, expected) => {
    const line = describeFailure(error);
    expect(line).toBe(expected);
    expect(line).not.toMatch(/Detergente|0b1c/);
  });

  it('puts nothing of a failed read on stdout or in the line for stderr', async () => {
    const s = stack(
      [row('a')],
      [item('a', { name: { es: 'Nombre secreto' } })]
    );
    s.catalog.getMany = async () => {
      throw new Error('could not read Nombre secreto');
    };
    const error = await runWashSizes(s.ports, { mode: 'count' }).catch(
      (e: unknown) => e
    );
    expect(describeFailure(error)).not.toMatch(/Nombre/);
    expect(s.log.join('\n')).not.toMatch(/Nombre/);
  });
});

/** A review list of whole lines, `[item_id, outcome]` each, chain `deza`. */
function review(...lines: [string, string][]): string {
  return (
    [
      REVIEW_HEADER.join('\t'),
      ...lines.map(([id, outcome]) =>
        [
          'deza',
          id,
          `Detergente ${id}`,
          '40',
          'UNIT',
          '',
          '40 lavados',
          'deza: 40 lavados',
          outcome,
        ].join('\t')
      ),
    ].join('\n') + '\n'
  );
}

describe('wash sizes: a corrected line never goes back', () => {
  it('keeps a recorded corrected line when the next run lists it planned', () => {
    const recorded = review(['a', 'corrected']);
    expect(mergeList(REVIEW_SHAPE, recorded, review(['a', 'planned']))).toBe(
      recorded
    );
  });

  it('turns a recorded planned line when the next run lists it corrected', () => {
    expect(
      mergeList(
        REVIEW_SHAPE,
        review(['a', 'planned']),
        review(['a', 'corrected'])
      )
    ).toBe(review(['a', 'corrected']));
  });
});

describe('wash sizes: the reconcile', () => {
  const recorded = () =>
    review(
      ['cleared', 'planned'],
      ['sized', 'planned'],
      ['gone', 'planned'],
      ['merged', 'planned'],
      ['grams', 'planned'],
      ['done', 'corrected']
    );
  const catalog = () =>
    new FakeCatalog(
      new Map(
        [
          item('cleared', { unitSize: null }),
          item('sized', { unitSize: 750 }),
          item('merged', { unitSize: null, mergedInto: 'sized' }),
          item('grams', { unitSize: null, defaultUnit: UnitOfMeasure.GRAM }),
          // A person sized it again after the task: the line stays as it was.
          item('done', { unitSize: 40 }),
        ].map((i) => [i.id, i])
      )
    );

  it('turns a planned line corrected only when its product holds no size as UNIT', async () => {
    const c = catalog();
    const { text, turned } = await reconcileReview(c, recorded());
    expect(turned).toBe(1);
    expect(outcomes(text)).toEqual({
      cleared: 'corrected',
      sized: 'planned',
      gone: 'planned',
      merged: 'planned',
      grams: 'planned',
      done: 'corrected',
    });
    // Every other cell of the turned line is the recorded one.
    expect(text).toContain(
      '\tcleared\tDetergente cleared\t40\tUNIT\t\t40 lavados\t' +
        'deza: 40 lavados\tcorrected'
    );
  });

  it('reads only, and never reads a corrected line', async () => {
    const c = catalog();
    const asked: string[] = [];
    c.beforeRead = (ids) => asked.push(...ids);
    await reconcileReview(c, recorded());
    expect(c.updates).toEqual([]);
    expect(asked).not.toContain('done');
    expect(asked.sort()).toEqual([
      'cleared',
      'gone',
      'grams',
      'merged',
      'sized',
    ]);
  });

  it('asks nothing for a list with no planned line', async () => {
    const c = catalog();
    const list = review(['done', 'corrected']);
    expect(await reconcileReview(c, list)).toEqual({ text: list, turned: 0 });
    expect(await reconcileReview(c, '')).toEqual({ text: '', turned: 0 });
    expect(c.reads).toBe(0);
  });

  it('reads a product as catalog answers it', () => {
    expect(confirmsCorrection(item('a', { unitSize: null }))).toBe(true);
    expect(confirmsCorrection(item('a', { unitSize: 40 }))).toBe(false);
    expect(confirmsCorrection(undefined)).toBe(false);
  });

  it.each(['review', 'write'] as const)(
    'confirms the planned lines a stopped run left, in --%s',
    async (mode) => {
      // The run saved its planned list, then corrected both and stopped
      // before it wrote its own: the products have no size and the
      // selection no longer finds them.
      const s = stack([row('a'), row('b')], [item('a'), item('b')]);
      await runWashSizes(s.ports, {
        mode: 'review',
        file: 'r1.tsv',
        recorded: null,
      });
      s.files.set('cm1.json', configMap(s.files, 'r1.tsv'));
      s.catalog.items.set('a', item('a', { unitSize: null }));
      s.catalog.items.set('b', item('b', { unitSize: null }));

      await runWashSizes(
        s.ports,
        mode === 'review'
          ? { mode, file: 'r2.tsv', recorded: 'cm1.json' }
          : { mode, max: 2, file: 'r2.tsv', recorded: 'cm1.json' }
      );
      expect(s.catalog.updates).toEqual([]);
      expect(outcomes(s.files.get('r2.tsv'))).toEqual({
        a: 'corrected',
        b: 'corrected',
      });
      // The old size the first run recorded stays on the line.
      expect(s.files.get('r2.tsv')).toContain('\ta\tDetergente a\t40\tUNIT\t');
    }
  );

  it('confirms a line whose update timed out after catalog applied it', async () => {
    const s = stack([row('a')], [item('a')]);
    const update = s.catalog.update.bind(s.catalog);
    s.catalog.update = async (input) => {
      await update(input);
      throw new Error('Timeout has occurred');
    };
    await runWashSizes(s.ports, {
      mode: 'write',
      max: 1,
      file: 'r1.tsv',
      recorded: null,
    });
    expect(outcomes(s.files.get('r1.tsv'))).toEqual({ a: 'planned' });
    s.files.set('cm1.json', configMap(s.files, 'r1.tsv'));
    s.catalog.update = update;

    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r2.tsv',
      recorded: 'cm1.json',
    });
    expect(outcomes(s.files.get('r2.tsv'))).toEqual({ a: 'corrected' });
    expect(s.log).toContain('save 1');
  });
});

describe('wash sizes: what a run with nothing to correct saves', () => {
  const eljamon = { chain: 'eljamon', adapterKey: 'eljamon-web' };
  const notes = (...ids: string[]) =>
    notesList(
      plan(
        ids.map((id) => row(id, { ...eljamon, sizeFormat: '40lav' })),
        ids.map((id) => item(id))
      ).notes
    );

  it('saves for a recorded planned line, or a note not recorded yet', () => {
    expect(listsToSave(1, notes('a'), notes('a'))).toBe(true);
    expect(listsToSave(0, notes('a'), notes('a', 'b'))).toBe(true);
    expect(listsToSave(0, '', notes('a'))).toBe(true);
    expect(listsToSave(0, notes('a', 'b'), notes('a', 'b'))).toBe(false);
    expect(listsToSave(0, '', '')).toBe(false);
  });

  it('prints save 1 once for three new notes, then save 0', async () => {
    const s = stack(
      [
        row('a', { ...eljamon, sizeFormat: '40lav' }),
        row('b', { sizeFormat: '23+12 lavados' }),
        row('c', { sizeFormat: '23+12 lv' }),
      ],
      [item('a'), item('b', { unitSize: 35 }), item('c', { unitSize: 35 })]
    );
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r1.tsv',
      recorded: null,
    });
    expect(s.log).toEqual(expect.arrayContaining(['products 0', 'save 1']));
    expect(
      (s.files.get('r1.notes.tsv') ?? '').trimEnd().split('\n')
    ).toHaveLength(4);
    s.files.set('cm1.json', configMap(s.files, 'r1.tsv'));

    s.log.length = 0;
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r2.tsv',
      recorded: 'cm1.json',
    });
    expect(s.log).toContain('save 0');
    expect(s.catalog.updates).toEqual([]);
  });

  it('prints save 0 with no ConfigMap, no note and no product', async () => {
    const s = stack([row('a', { sizeFormat: '1 l' })], [item('a')]);
    await runWashSizes(s.ports, {
      mode: 'review',
      file: 'r.tsv',
      recorded: null,
    });
    expect(s.log).toContain('save 0');
  });
});

describe('wash sizes: what the entry file prints', () => {
  function guarded() {
    const target = new EventEmitter();
    const printed: string[] = [];
    const exits: number[] = [];
    target.on('warning', () => printed.push('the default printer ran'));
    const fail = guardOutput(
      target,
      (line) => printed.push(line),
      (code) => exits.push(code)
    );
    return { target, printed, exits, fail };
  }

  it('prints an uncaught error as its class and code, and exits 1', () => {
    const g = guarded();
    g.target.emit(
      'uncaughtException',
      Object.assign(new Error('could not update Detergente secreto (0b1c)'), {
        name: 'QueryFailedError',
        code: '22P02',
      })
    );
    g.target.emit(
      'unhandledRejection',
      new Error('item Detergente secreto timed out')
    );
    expect(g.printed).toEqual([
      'the command failed: QueryFailedError 22P02',
      'the command failed: Error',
    ]);
    expect(g.exits).toEqual([1, 1]);
  });

  it('prints a warning that names a product as its class and code only', () => {
    const g = guarded();
    g.target.emit(
      'warning',
      Object.assign(new Error('Detergente secreto is slow'), {
        name: 'DeprecationWarning',
        code: 'DEP0005',
      })
    );
    g.target.emit(
      'warning',
      Object.assign(new Error('x'), { name: 'Detergente secreto', code: 'a b' })
    );
    expect(g.printed).toEqual([
      'warning DeprecationWarning DEP0005',
      'warning Warning',
    ]);
    expect(describeWarning('Detergente secreto')).toBe('warning Warning');
    expect(g.exits).toEqual([]);
  });

  it('answers the failure handler the command uses for its own rejection', () => {
    const g = guarded();
    g.fail(new WashSizesRefusal('Refused: 3 products'));
    g.fail({ code: 'validation_failed', message: 'Detergente secreto' });
    expect(g.printed).toEqual([
      'Refused: 3 products',
      'the command failed: validation_failed',
    ]);
    expect(g.exits).toEqual([1, 1]);
  });
});
