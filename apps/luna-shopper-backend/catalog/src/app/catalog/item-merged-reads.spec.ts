import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemStateSql } from './item.service';

/**
 * Every list and search of products leaves a merged product out (plan 0239,
 * section 2), through one shared condition.
 *
 * A fake repository cannot prove a `WHERE` clause, so this reads the service
 * itself: each query it writes over the `items` table, raw or through the
 * query builder, must carry {@link itemStateSql} a few lines below where it
 * names the table. The integration spec proves the rows; this proves that a
 * query added later cannot forget the rule without failing here.
 */
describe('the reads of ItemService and merged products (plan 0239)', () => {
  const source = readFileSync(join(__dirname, 'item.service.ts'), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n');

  /** The lines that name the table as a source of rows, with their number. */
  const tableReads = source
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(
      ({ text }) =>
        /(FROM|JOIN)\s+"items"\s+\w+/.test(text) ||
        /this\.items\.createQueryBuilder\(/.test(text)
    );

  /**
   * The rows a query names the table in, and the few lines below it where its
   * `WHERE` starts. The ranked branch writes its filter through
   * `rankedWhereSql`, which is checked on its own below. A query that looks a
   * merged row up by its survivor (`"mergedIntoId" = `) is about merged rows
   * on purpose: the delete counts them.
   */
  const window = (line: number) => source.slice(line - 1, line + 6).join('\n');

  it('finds the queries it is about', () => {
    // The ranked page, its count, the listing, the group lateral, and the two
    // member reads. A count far below this would mean the pattern broke.
    expect(tableReads.length).toBeGreaterThanOrEqual(6);
  });

  it.each(tableReads.map(({ text, line }) => [line, text.trim()]))(
    'line %s (%s) carries the merged condition',
    (line) => {
      expect(window(line as number)).toMatch(
        /itemStateSql\(|rankedWhereSql\(|"mergedIntoId" = \$/
      );
    }
  );

  it('puts the condition first among the filters of the ranked branch', () => {
    const start = source.findIndex((text) =>
      text.includes('private rankedMatch(')
    );
    const body = source.slice(start, start + 120).join('\n');
    expect(body).toContain("const filters: string[] = [itemStateSql('i'");
  });

  it('writes one condition, live by default and merged on request', () => {
    expect(itemStateSql('i')).toBe('i."mergedIntoId" IS NULL');
    expect(itemStateSql('mi', true)).toBe('mi."mergedIntoId" IS NOT NULL');
  });
});
