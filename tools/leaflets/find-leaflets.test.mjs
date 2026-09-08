// Tests for the pure half of the finder and of the LIDL module.
//
// Plain `node --test`, not jest: nothing here is an Nx project and the tool has
// no dependencies. The fixtures are trimmed from what the endpoints answered on
// 2026-09-06, and no test touches the network.
//
//   node --test tools/leaflets/find-leaflets.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NATIONAL_REGION,
  classify,
  collectEditions,
  findLeaflets,
  overviewUrl,
  regionsFromStores,
} from './chains/lidl.mjs';
import {
  applyToState,
  diffAgainstState,
  emptyState,
  hashKey,
  mergeEditions,
  parseArgs,
  parseRegionsArg,
  render,
  run,
} from './find-leaflets.mjs';

// --- Fixtures ---------------------------------------------------------------

const flyer = (id, name, extra = {}) => ({
  id,
  name,
  title: '7/9/26-13/9/26',
  pdfUrl: `https://assets.leaflets.schwarz/leaflets/pdfs/${id}/x.pdf`,
  fileSize: 100,
  startDate: '2026-08-31',
  endDate: '2026-09-13',
  offerStartDate: '2026-09-07',
  offerEndDate: '2026-09-13',
  flyerUrlAbsolute: `https://www.lidl.es/l/folletos/${id}/ar/0`,
  regions: [{ type: 'national', code: '0' }],
  ...extra,
});

const overview = (grocery, bazar = [], other = []) => ({
  success: true,
  isRegionalized: true,
  categories: [
    {
      name: 'Folletos',
      subcategories: [
        { name: 'Folletos de Alimentación', flyers: grocery },
        { name: 'Folletos de Bazar', flyers: bazar },
        { name: 'Nuestros folletos semanales', flyers: other },
      ],
    },
  ],
});

const REGIONS = [
  { code: '1', name: 'A Coruña', zone: 'Peninsula' },
  { code: '2', name: 'Pontevedra', zone: 'Peninsula' },
  { code: '28', name: 'Madrid', zone: 'Peninsula' },
];

const stores = [
  {
    marketingData: {
      offerRegion: 28,
      offerRegionName: 'Madrid',
      zoneName: 'Peninsula',
    },
  },
  {
    marketingData: {
      offerRegion: 1,
      offerRegionName: 'A Coruña',
      zoneName: 'Peninsula',
    },
  },
  {
    marketingData: {
      offerRegion: 28,
      offerRegionName: 'Madrid',
      zoneName: 'Peninsula',
    },
  },
  { marketingData: {} },
];

// --- LIDL module ------------------------------------------------------------

describe('lidl classify', () => {
  it('reads the subcategory before the name', () => {
    assert.equal(
      classify('Folletos de Alimentación', 'FOLLETO ALIMENTACIÓN 7/9'),
      'grocery'
    );
    assert.equal(classify('Folletos de Bazar', 'FOLLETO BAZAR 7/9'), 'bazar');
    // The Canary editions carry the same name in both subcategories.
    assert.equal(
      classify('Folletos de Alimentación', 'Islas canarias desde el 7/9'),
      'grocery'
    );
    assert.equal(
      classify('Folletos de Bazar', 'Islas canarias desde el 7/9'),
      'bazar'
    );
    assert.equal(
      classify('Nuestros folletos semanales', 'FOLLETO FACTORI 9/9'),
      'other'
    );
  });

  it('falls back to the name when the subcategory says nothing', () => {
    assert.equal(classify('', 'FOLLETO BAZAR 7/9'), 'bazar');
    assert.equal(classify(undefined, 'FOLLETO ALIMENTACIÓN 7/9'), 'grocery');
    assert.equal(classify('', ''), 'other');
  });
});

describe('lidl regionsFromStores', () => {
  it('lists each region once, counted and sorted by code', () => {
    const regions = regionsFromStores(stores);
    assert.deepEqual(regions, [
      { code: '1', name: 'A Coruña', zone: 'Peninsula', stores: 1 },
      { code: '28', name: 'Madrid', zone: 'Peninsula', stores: 2 },
    ]);
  });
});

describe('lidl overviewUrl', () => {
  it('asks for the region with the page locale and no store', () => {
    assert.equal(
      overviewUrl('26'),
      'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fes-ES&region_id=26&store_id=0'
    );
  });
});

describe('lidl collectEditions', () => {
  it('folds regions that answer the same flyer id into one edition', () => {
    const shared = flyer('aaa', 'FOLLETO ALIMENTACIÓN 7/9');
    const overviews = new Map([
      ['1', overview([shared], [flyer('bbb', 'FOLLETO BAZAR 7/9')])],
      ['2', overview([shared])],
      [
        '28',
        overview(
          [flyer('ccc', 'FOLLETO ALIMENTACIÓN 7/9')],
          [],
          [flyer('ddd', 'FOLLETO FACTORI 9/9')]
        ),
      ],
    ]);
    const editions = collectEditions(overviews, REGIONS);
    assert.deepEqual(
      editions.map((e) => [e.sourceId, e.kind, e.regions.map((r) => r.name)]),
      [
        ['aaa', 'grocery', ['A Coruña', 'Pontevedra']],
        ['bbb', 'bazar', ['A Coruña']],
        ['ccc', 'grocery', ['Madrid']],
        ['ddd', 'other', ['Madrid']],
      ]
    );
    assert.equal(
      editions[0].pdfUrl,
      'https://assets.leaflets.schwarz/leaflets/pdfs/aaa/x.pdf'
    );
    assert.equal(editions[0].offerEndDate, '2026-09-13');
  });

  it('names a region it was not told about by its code', () => {
    const overviews = new Map([['99', overview([flyer('aaa', 'X')])]]);
    const [edition] = collectEditions(overviews, REGIONS);
    assert.deepEqual(edition.regions, [{ code: '99', name: '99', zone: null }]);
  });
});

describe('lidl findLeaflets', () => {
  const fakeHttp = (answers) => {
    const calls = [];
    return {
      calls,
      requests: 0,
      async json(url) {
        calls.push(['json', url]);
        return answers.json(url);
      },
      async head(url) {
        calls.push(['head', url]);
        return answers.head(url);
      },
    };
  };
  const storesAnswer = { items: stores, meta: { total: stores.length } };

  it('sweeps region 0 and every store region, then HEADs each distinct PDF once', async () => {
    const shared = flyer('aaa', 'FOLLETO ALIMENTACIÓN 7/9');
    const http = fakeHttp({
      json: (url) => {
        if (url.includes('stores-api')) return storesAnswer;
        const region = new URL(url).searchParams.get('region_id');
        return region === '28'
          ? overview([flyer('ccc', 'FOLLETO ALIMENTACIÓN 7/9')])
          : overview([shared]);
      },
      head: () => ({ status: 200, etag: '"abc"', lastModified: 'x' }),
    });
    const editions = await findLeaflets(http);
    const swept = http.calls
      .filter(([kind, url]) => kind === 'json' && url.includes('overview'))
      .map(([, url]) => new URL(url).searchParams.get('region_id'));
    assert.deepEqual(swept, ['0', '1', '28']);
    assert.equal(http.calls.filter(([kind]) => kind === 'head').length, 2);
    assert.deepEqual(
      editions.map((e) => [
        e.sourceId,
        e.contentHash,
        e.regions.map((r) => r.code),
      ]),
      [
        ['aaa', { algorithm: 'etag', value: 'abc' }, ['0', '1']],
        ['ccc', { algorithm: 'etag', value: 'abc' }, ['28']],
      ]
    );
  });

  it('sweeps only the given regions and keeps their names', async () => {
    const http = fakeHttp({
      json: (url) =>
        url.includes('stores-api')
          ? storesAnswer
          : overview([flyer('aaa', 'X')]),
      head: () => ({ status: 200, etag: null }),
    });
    const editions = await findLeaflets(http, { regions: ['28'] });
    assert.deepEqual(editions[0].regions, [
      { code: '28', name: 'Madrid', zone: 'Peninsula' },
    ]);
    // No ETag: the flyer id stands in, so the edition is still identified.
    assert.deepEqual(editions[0].contentHash, {
      algorithm: 'source-id',
      value: 'aaa',
    });
  });

  it('refuses to guess the region list when the store API fails', async () => {
    const http = fakeHttp({
      json: (url) => {
        if (url.includes('stores-api')) throw new Error('401');
        return overview([]);
      },
      head: () => ({}),
    });
    await assert.rejects(
      () => findLeaflets(http),
      /store API refused.*--regions/
    );
    const editions = await findLeaflets(http, { regions: ['0', '5'] });
    assert.deepEqual(editions, []);
  });

  it('fails on an overview that did not succeed', async () => {
    const http = fakeHttp({
      json: (url) =>
        url.includes('stores-api')
          ? storesAnswer
          : { success: false, message: 'nope' },
      head: () => ({}),
    });
    await assert.rejects(() => findLeaflets(http), /region 0 answered nope/);
  });

  it('starts with the national region', () => {
    assert.equal(NATIONAL_REGION.code, '0');
  });
});

// --- Finder -----------------------------------------------------------------

const edition = (sourceId, hash, regionCodes, extra = {}) => ({
  chain: 'lidl',
  sourceId,
  name: 'FOLLETO ALIMENTACIÓN 7/9',
  title: '7/9/26-13/9/26',
  kind: 'grocery',
  pdfUrl: `https://x/${sourceId}.pdf`,
  fileSize: 100,
  offerStartDate: '2026-09-07',
  offerEndDate: '2026-09-13',
  regions: regionCodes.map((code) => ({ code, name: `R${code}`, zone: null })),
  contentHash: { algorithm: 'etag', value: hash },
  ...extra,
});

describe('mergeEditions', () => {
  it('folds editions with the same content into one, listing every region once', () => {
    const merged = mergeEditions([
      edition('a', 'same', ['0']),
      edition('b', 'same', ['28', '33']),
      edition('c', 'other', ['26']),
    ]);
    assert.deepEqual(
      merged.map((e) => [e.sourceIds, e.regions.map((r) => r.code)]),
      [
        [
          ['a', 'b'],
          ['0', '28', '33'],
        ],
        [['c'], ['26']],
      ]
    );
  });

  it('orders the newest offers first, then by name, then by region', () => {
    const merged = mergeEditions([
      edition('old', 'h1', ['26'], { offerStartDate: '2026-08-31', name: 'B' }),
      edition('new-b', 'h2', ['26'], { name: 'B' }),
      edition('new-a', 'h3', ['28'], { name: 'A' }),
      edition('new-a0', 'h4', ['0'], { name: 'A' }),
    ]);
    assert.deepEqual(
      merged.map((e) => e.sourceId),
      ['new-a0', 'new-a', 'new-b', 'old']
    );
  });
});

describe('diffAgainstState and applyToState', () => {
  it('reports everything new on an empty state and nothing on the next run', () => {
    const state = emptyState();
    const editions = mergeEditions([
      edition('a', 'h1', ['0']),
      edition('b', 'h2', ['26']),
    ]);
    const first = diffAgainstState(state, 'lidl', editions);
    assert.equal(first.fresh.length, 2);
    assert.equal(first.seen.length, 0);

    applyToState(state, 'lidl', first.fresh, '2026-09-06T00:00:00Z');
    const second = diffAgainstState(state, 'lidl', editions);
    assert.equal(second.fresh.length, 0);
    assert.equal(second.seen.length, 2);

    const stored = state.chains.lidl.leaflets[hashKey(editions[0].contentHash)];
    assert.deepEqual(stored.sourceIds, ['a']);
    assert.deepEqual(stored.regions, ['0']);
    assert.equal(stored.firstSeenAt, '2026-09-06T00:00:00Z');
    assert.equal(stored.sha256, null);
  });

  it('keeps chains apart', () => {
    const state = emptyState();
    applyToState(
      state,
      'lidl',
      [mergeEditions([edition('a', 'h1', ['0'])])[0]],
      'now'
    );
    const { fresh } = diffAgainstState(state, 'other', [
      edition('a', 'h1', ['0']),
    ]);
    assert.equal(fresh.length, 1);
  });

  it('moves latest to the most recent offer and never backwards', () => {
    const state = emptyState();
    applyToState(
      state,
      'lidl',
      mergeEditions([edition('a', 'h1', ['0'])]),
      't1'
    );
    assert.equal(state.chains.lidl.latest.hash, 'etag:h1');
    assert.equal(state.chains.lidl.latest.offerStartDate, '2026-09-07');

    applyToState(
      state,
      'lidl',
      mergeEditions([
        edition('old', 'h0', ['0'], { offerStartDate: '2026-08-31' }),
      ]),
      't2'
    );
    assert.equal(state.chains.lidl.latest.hash, 'etag:h1');

    applyToState(
      state,
      'lidl',
      mergeEditions([
        edition('next', 'h9', ['0'], { offerStartDate: '2026-09-14' }),
      ]),
      't3'
    );
    assert.equal(state.chains.lidl.latest.hash, 'etag:h9');
    assert.equal(state.chains.lidl.latest.seenAt, 't3');
    assert.equal(state.chains.lidl.lastRunAt, 't3');
  });

  it('records the sha256 and the file when a download filled them in', () => {
    const state = emptyState();
    const [fresh] = mergeEditions([edition('a', 'h1', ['0'])]);
    fresh.sha256 = 'deadbeef';
    fresh.file = 'tmp/leaflets/pdf/lidl/a.pdf';
    applyToState(state, 'lidl', [fresh], 'now');
    const stored = state.chains.lidl.leaflets['etag:h1'];
    assert.equal(stored.sha256, 'deadbeef');
    assert.equal(stored.file, 'tmp/leaflets/pdf/lidl/a.pdf');
  });
});

describe('parseRegionsArg', () => {
  it('reads lists, ranges and a mix, without repeats', () => {
    assert.deepEqual(parseRegionsArg('0,26,28'), ['0', '26', '28']);
    assert.deepEqual(parseRegionsArg('3-5'), ['3', '4', '5']);
    assert.deepEqual(parseRegionsArg('0, 1-2,2'), ['0', '1', '2']);
    assert.throws(() => parseRegionsArg('5-3'), /bad range/);
    assert.throws(() => parseRegionsArg('x'), /bad region code/);
  });
});

describe('parseArgs', () => {
  it('reads every option and defaults the rest', () => {
    const options = parseArgs([
      '--chain',
      'lidl',
      '--chain',
      'x',
      '--regions',
      '0-1',
      '--all',
      '--json',
      '--dry-run',
      '--pause',
      '10',
    ]);
    assert.deepEqual(options.chains, ['lidl', 'x']);
    assert.deepEqual(options.regions, ['0', '1']);
    assert.equal(options.all, true);
    assert.equal(options.json, true);
    assert.equal(options.dryRun, true);
    assert.equal(options.pauseMs, 10);
    assert.equal(options.download, null);
    assert.match(options.state, /tmp[\\/]leaflets[\\/]state\.json$/);
  });

  it('refuses an unknown option and a missing value', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
    assert.throws(() => parseArgs(['--chain']), /--chain needs a value/);
  });
});

describe('run', () => {
  const fakeChain = (leaflets) => ({
    key: 'fake',
    name: 'Fake',
    async findLeaflets() {
      return leaflets;
    },
  });
  const options = (extra = {}) => ({
    chains: [],
    state: 'this-file-does-not-exist.json',
    download: null,
    regions: null,
    all: false,
    json: false,
    dryRun: true,
    ...extra,
  });
  const http = { requests: 3 };

  it('keeps grocery, skips the rest by kind, and folds identical content', async () => {
    const chain = fakeChain([
      edition('a', 'same', ['0']),
      edition('b', 'same', ['28']),
      edition('c', 'other', ['26']),
      edition('d', 'bz', ['0'], { kind: 'bazar' }),
      edition('e', 'ot', ['28'], { kind: 'other' }),
    ]);
    const { report, failed } = await run(options(), { http, chains: [chain] });
    assert.equal(failed, false);
    const [result] = report.chains;
    assert.equal(result.found, 5);
    assert.equal(result.regionsSwept, 3);
    assert.deepEqual(result.skipped, { bazar: 1, other: 1 });
    assert.deepEqual(
      result.fresh.map((e) => e.sourceIds),
      [['a', 'b'], ['c']]
    );
    assert.equal(result.latest.hash, 'etag:same');
    assert.equal(report.requests, 3);
  });

  it('keeps every kind with --all', async () => {
    const chain = fakeChain([edition('d', 'bz', ['0'], { kind: 'bazar' })]);
    const { report } = await run(options({ all: true }), {
      http,
      chains: [chain],
    });
    assert.equal(report.chains[0].fresh.length, 1);
    assert.deepEqual(report.chains[0].skipped, {});
  });

  it('names an unknown chain', async () => {
    await assert.rejects(
      () =>
        run(options({ chains: ['nope'] }), { http, chains: [fakeChain([])] }),
      /no chain nope; known: fake/
    );
  });

  it('reports a chain that failed and keeps going', async () => {
    const broken = {
      key: 'broken',
      name: 'Broken',
      async findLeaflets() {
        throw new Error('boom');
      },
    };
    const { report, failed } = await run(options(), {
      http,
      chains: [broken, fakeChain([edition('a', 'h', ['0'])])],
    });
    assert.equal(failed, true);
    assert.equal(report.chains[0].error, 'boom');
    assert.equal(report.chains[1].fresh.length, 1);
    assert.match(render(report), /Broken: FAILED, boom/);
  });
});

describe('render', () => {
  it('writes one block per chain and the state line', () => {
    const [fresh] = mergeEditions([edition('a', 'h1', ['0', '28'])]);
    fresh.sha256 = 'abc';
    const text = render({
      statePath: '/x/state.json',
      dryRun: false,
      chains: [
        {
          name: 'LIDL',
          found: 4,
          regionsSwept: 60,
          skipped: { bazar: 2 },
          fresh: [fresh],
          seen: [mergeEditions([edition('b', 'h2', ['26'])])[0]],
          latest: { name: 'X', offerStartDate: '2026-09-07', hash: 'etag:h1' },
        },
      ],
    });
    assert.match(
      text,
      /LIDL: 1 new, 1 already known \(4 flyer ids over 60 regions, skipped 2 bazar\)/
    );
    assert.match(
      text,
      /NEW {3}FOLLETO ALIMENTACIÓN 7\/9 {2}\(7\/9\/26-13\/9\/26\) {2}offers 2026-09-07 to 2026-09-13/
    );
    assert.match(text, /etag:h1 {2}0\.0 MB {2}sha256 abc/);
    assert.match(text, /regions: R0, R28/);
    assert.match(
      text,
      /known FOLLETO ALIMENTACIÓN 7\/9 .* etag:h2 {2}regions: R26/
    );
    assert.match(text, /latest: X from 2026-09-07, etag:h1/);
    assert.match(text, /state: \/x\/state\.json/);
  });
});
