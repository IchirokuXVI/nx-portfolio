import { readRunReport, reportHasContent } from './run-report';

/**
 * The report fields of admin plan 0071, each read from a valid bag, from a bag
 * with the wrong shapes, and from an empty one. The report is a free form bag,
 * so a shape this build does not expect reads as absent.
 */

const CARREFOUR = {
  unreadableCategories: ['/supermercado/frescos/cat20002/c', 7],
  askedAgain: [
    { id: 'cat1', name: 'Lácteos', read: true },
    { id: 'cat2', name: 'Congelados', read: false },
    { id: 'cat3', name: 'No outcome' },
  ],
  blockedAfter: 'HTTP 403 on 4 categories in a row',
};

// The shapes `deza-catalog.runner.ts` writes: a section the budget stopped
// names its word in `incompleteSections`, a section that threw names null
// there and carries its error in that entry's `openQueries`.
const DEZA = {
  incompleteSections: [
    {
      code: 'S2',
      name: 'Bebidas',
      queries: 25,
      stoppedBy: 'BUDGET',
      openQueries: [],
      narrowing: 'agua',
      termsTried: 3,
    },
    {
      code: 'S3',
      name: 'Threw',
      queries: null,
      stoppedBy: null,
      openQueries: ['Error: socket hang up'],
      narrowing: null,
      termsTried: null,
    },
  ],
  sections: [
    {
      code: 'S1',
      name: 'Droguería',
      products: 412,
      firstSeen: 400,
      queries: 14,
      stoppedBy: 'GROWTH',
      coverageOnce: 30,
      growthAtStop: 2,
      openQueries: ['champú', 'gel'],
    },
    {
      code: 'S2',
      name: 'Bebidas',
      products: 900,
      firstSeen: 880,
      queries: 25,
      stoppedBy: 'BUDGET',
      coverageOnce: 51,
      growthAtStop: 40,
      openQueries: [],
    },
    {
      code: 'S3',
      name: 'Threw',
      products: 0,
      firstSeen: 0,
      queries: null,
      stoppedBy: null,
      coverageOnce: null,
      growthAtStop: null,
      openQueries: [],
    },
    { code: 'S4', name: 'No count', stoppedBy: 'COMPLETE' },
  ],
};

const ELJAMON = {
  categories: [
    {
      code: '01',
      name: 'DESPENSA',
      printedCount: 1200,
      rowsRead: 1188,
      rowsRepeated: 12,
    },
    {
      code: '02',
      name: 'BEBIDAS',
      printedCount: 300,
      rowsRead: 300,
      rowsRepeated: 0,
    },
    {
      code: '03',
      name: 'NO COUNT',
      printedCount: null,
      rowsRead: 40,
      rowsRepeated: 0,
    },
  ],
  detail: { pages: 800, failed: 3, timeouts: 2, silentAttempts: 1 },
};

const SIZES = {
  sizesDisproved: 2,
  probablePackCounts: 1,
  sizesDisprovedExamples: [
    {
      entryId: 'entry-1',
      externalId: '10293',
      name: 'Yogur natural',
      stated: 125,
      implied: 500,
      unit: 'GRAM',
      ratio: 4,
      label: '1,20 €/kg',
      probablePackCount: 4,
    },
    { name: 'Missing sizes', unit: 'GRAM' },
  ],
};

describe('readRunReport, the Carrefour fields', () => {
  it('reads the unread addresses, the second asks and the stop', () => {
    const report = readRunReport(CARREFOUR);

    expect(report.unreadable).toEqual(['/supermercado/frescos/cat20002/c']);
    expect(report.askedAgain).toEqual([
      { id: 'cat1', name: 'Lácteos', read: true },
      { id: 'cat2', name: 'Congelados', read: false },
    ]);
    expect(report.blockedAfter).toBe('HTTP 403 on 4 categories in a row');
    expect(reportHasContent(report)).toBe(true);
  });

  it('reads the wrong shapes as absent', () => {
    const report = readRunReport({
      unreadableCategories: 'all of them',
      askedAgain: { id: 'cat1' },
      blockedAfter: null,
    });

    expect(report.unreadable).toEqual([]);
    expect(report.askedAgain).toEqual([]);
    expect(report.blockedAfter).toBe('');
    expect(reportHasContent(report)).toBe(false);
  });
});

describe('readRunReport, the DEZA sections', () => {
  it('reads every section, the unfinished first', () => {
    const report = readRunReport(DEZA);

    expect(report.sections.map((section) => section.code)).toEqual([
      'S2',
      'S3',
      'S1',
    ]);
    expect(report.sections[0]).toEqual({
      code: 'S2',
      name: 'Bebidas',
      products: 900,
      queries: 25,
      stoppedBy: 'BUDGET',
      openQueries: [],
      unfinished: true,
      failed: false,
    });
    expect(report.sections[2]).toMatchObject({
      openQueries: ['champú', 'gel'],
      unfinished: false,
      failed: false,
    });
  });

  it('reads a section that threw as failed', () => {
    expect(readRunReport(DEZA).sections[1]).toEqual({
      code: 'S3',
      name: 'Threw',
      products: 0,
      queries: null,
      stoppedBy: null,
      openQueries: [],
      unfinished: true,
      failed: true,
    });
  });

  it('reads only an explicit null stop as a failure', () => {
    const report = readRunReport({
      incompleteSections: [
        { code: 'S1', name: 'A', queries: 4 },
        { code: 'S2', name: 'B', queries: 4, stoppedBy: 'LATER' },
      ],
      sections: [
        { code: 'S1', name: 'A', products: 1, queries: 4, stoppedBy: null },
        { code: 'S2', name: 'B', products: 1, queries: 4, stoppedBy: 'LATER' },
      ],
    });

    expect(report.sections.map((section) => section.failed)).toEqual([
      false,
      false,
    ]);
    expect(report.sections.map((section) => section.unfinished)).toEqual([
      true,
      true,
    ]);
  });

  it('reads a stop word this build does not know as none', () => {
    const report = readRunReport({
      sections: [{ code: 'S1', name: 'A', products: 1, stoppedBy: 'LATER' }],
    });

    expect(report.sections[0].stoppedBy).toBeNull();
  });

  it('reads the wrong shapes as absent', () => {
    expect(
      readRunReport({ sections: 'S1', incompleteSections: 3 }).sections
    ).toEqual([]);
  });
});

describe('readRunReport, the El Jamón fields', () => {
  it('keeps the categories that read differently from their print', () => {
    const report = readRunReport(ELJAMON);

    expect(report.categories).toEqual([
      {
        code: '01',
        name: 'DESPENSA',
        printedCount: 1200,
        rowsRead: 1188,
        rowsRepeated: 12,
      },
    ]);
    expect(report.detailStage).toEqual({ pages: 800, failed: 3, timeouts: 2 });
  });

  it('reads the wrong shapes as absent', () => {
    const report = readRunReport({
      categories: [{ code: '01', name: 'A', printedCount: '3', rowsRead: 2 }],
      detail: { pages: 10, failed: 'none' },
    });

    expect(report.categories).toEqual([]);
    expect(report.detailStage).toBeNull();
  });
});

describe('readRunReport, the size doubts', () => {
  it('reads the counts and the examples it can draw', () => {
    expect(readRunReport(SIZES).sizes).toEqual({
      disproved: 2,
      probablePackCounts: 1,
      examples: [
        {
          entryId: 'entry-1',
          name: 'Yogur natural',
          stated: 125,
          implied: 500,
          unit: 'GRAM',
          label: '1,20 €/kg',
        },
      ],
    });
  });

  it('draws nothing for a walk that found no doubt', () => {
    expect(readRunReport({ ...SIZES, sizesDisproved: 0 }).sizes).toBeNull();
  });

  it('reads the wrong shapes as absent', () => {
    const report = readRunReport({
      sizesDisproved: 3,
      probablePackCounts: 'two',
      sizesDisprovedExamples: { name: 'x' },
    });

    expect(report.sizes).toEqual({
      disproved: 3,
      probablePackCounts: 0,
      examples: [],
    });
    expect(readRunReport({ sizesDisproved: '3' }).sizes).toBeNull();
  });
});

describe('readRunReport, an empty bag', () => {
  it.each([{}, null, undefined, 'report', []])('reads %p as nothing', (bag) => {
    const report = readRunReport(bag);

    expect(report).toEqual({
      copies: [],
      details: null,
      writes: '',
      detailFetch: '',
      unreadable: [],
      askedAgain: [],
      blockedAfter: '',
      sections: [],
      categories: [],
      detailStage: null,
      sizes: null,
    });
    expect(reportHasContent(report)).toBe(false);
  });
});
