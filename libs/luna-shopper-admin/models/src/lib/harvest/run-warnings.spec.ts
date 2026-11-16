import type { HarvestRun } from './harvest-run';
import { runWarningRows } from './run-warnings';

type Warning = HarvestRun['warnings'][number];

const withWarnings = (warnings: Warning[]): HarvestRun =>
  ({ warnings }) as unknown as HarvestRun;

const part = (name: string | null, message: string): Warning => ({
  code: 'LISTING_UNREAD',
  offerId: null,
  page: null,
  name,
  message,
});

describe('runWarningRows', () => {
  it('draws a part that was not read the same way whether or not the runner set its name', () => {
    const rows = runWarningRows(
      withWarnings([
        // DEZA sets the name and says it in the sentence.
        part('Mascotas', 'Section 07 Mascotas failed: Error: socket hang up'),
        // A Carrefour row that came with no name.
        part(
          null,
          'Category cat21449123 Congelados was refused twice and was not read.'
        ),
        // A Carrefour row that came with one, in another case.
        part(
          'congelados',
          'Category cat21449123 Congelados was refused twice and was not read.'
        ),
      ])
    );

    expect(rows.map((row) => row.name)).toEqual(['', '', '']);
  });

  it('keeps the name of an import warning whose sentence does not say it', () => {
    const [row] = runWarningRows(
      withWarnings([
        {
          code: 'DUPLICATE_KEY',
          offerId: 'p12-o03',
          page: 12,
          name: 'Leche entera Hacendado brik 1 l.',
          message:
            'Two products in this document share one key. The second won.',
        },
      ])
    );

    expect(row).toEqual({
      key: '0',
      code: 'DUPLICATE_KEY',
      offerId: 'p12-o03',
      page: '12',
      name: 'Leche entera Hacendado brik 1 l.',
      message: 'Two products in this document share one key. The second won.',
    });
  });
});
