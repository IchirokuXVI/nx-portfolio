import type { HarvestRun } from './harvest-run';
import { runWarningRows } from './run-warnings';

type Warning = HarvestRun['warnings'][number];

const withWarnings = (warnings: Warning[]): HarvestRun =>
  ({ warnings }) as unknown as HarvestRun;

const warning = (
  code: Warning['code'],
  name: string | null,
  message: string
): Warning => ({ code, offerId: null, page: null, name, message });

describe('runWarningRows', () => {
  it('hides the name of a part that was not read, whether or not the runner set it', () => {
    const rows = runWarningRows(
      withWarnings([
        // DEZA sets the name and says it in the sentence.
        warning(
          'LISTING_UNREAD',
          'Mascotas',
          'Section 07 Mascotas failed: Error: socket hang up'
        ),
        // A Carrefour row that came with no name.
        warning(
          'LISTING_UNREAD',
          null,
          'Category cat21449123 Congelados was refused twice and was not read.'
        ),
        // A row whose name the sentence does not quote as it came.
        warning(
          'LISTING_UNREAD',
          'Congelados y helados',
          'Category cat21449123 Congelados was refused twice and was not read.'
        ),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual(['', '', '']);
  });

  it('hides the name of a part that read short, whether or not the runner set it', () => {
    const rows = runWarningRows(
      withWarnings([
        warning(
          'LISTING_SHORT',
          'DESPENSA',
          'Category 01 DESPENSA: 1188 of 1200 row(s) read.'
        ),
        warning(
          'LISTING_SHORT',
          null,
          'Category 06 BEBIDAS: 20 row(s) read, no count printed.'
        ),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual(['', '']);
  });

  it('hides the name of a part past the paging ceiling, whose sentence names it (owner decision 124b)', () => {
    const rows = runWarningRows(
      withWarnings([
        warning(
          'LISTING_TRUNCATED',
          'Bebidas',
          'Category cat20003 Bebidas: Carrefour states 1,100 products in ' +
            'Bebidas and serves only the first 1,008. The rest were not read.'
        ),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual(['']);
  });

  it('keeps the bold name of an import warning whose sentence quotes it', () => {
    const rows = runWarningRows(
      withWarnings([
        warning(
          'NO_MATCH',
          'Yogur natural',
          '"Yogur natural" matched nothing, so it is queued for a person.'
        ),
        warning(
          'CANDIDATE_MATCH',
          'Leche entera Hacendado',
          '"Leche entera Hacendado" looks like something the catalog knows, so ' +
            'it is queued for a person: a fuzzy match never writes a price.'
        ),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual([
      'Yogur natural',
      'Leche entera Hacendado',
    ]);
  });

  it('keeps the name of a duplicate key warning', () => {
    const [row] = runWarningRows(
      withWarnings([
        {
          code: 'DUPLICATE_KEY',
          offerId: 'p12-o03',
          page: 12,
          name: 'Leche entera Hacendado brik 1 l.',
          message:
            'Two products in this document have the same name and size, so ' +
            'neither wrote a price.',
        },
      ])
    );

    expect(row).toEqual({
      key: '0',
      code: 'DUPLICATE_KEY',
      offerId: 'p12-o03',
      page: '12',
      name: 'Leche entera Hacendado brik 1 l.',
      message:
        'Two products in this document have the same name and size, so ' +
        'neither wrote a price.',
    });
  });

  it('gives an empty name for a null or blank one', () => {
    const rows = runWarningRows(
      withWarnings([
        warning('EXTRACTOR', null, 'tile has no readable price'),
        warning('NO_MATCH', '   ', '"" matched nothing, so it is queued.'),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual(['', '']);
  });
});
