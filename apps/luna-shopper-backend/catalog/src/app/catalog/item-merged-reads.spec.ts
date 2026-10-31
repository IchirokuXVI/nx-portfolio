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
 * names the table, and each read through the repository API must be a read
 * by id that is named below with its reason. The integration spec proves the
 * rows; this proves that a query added later cannot forget the rule without
 * failing here.
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

  /**
   * The reads through the repository API, which cannot carry
   * {@link itemStateSql}: a `find` with no `where` on `mergedIntoId` returns
   * merged rows with the rest. Each one in the service must read rows **by
   * id**, and be named here with the reason a merged row is right for it. A
   * new call in any method, or a call in a method not named here, fails, so a
   * listing written this way cannot slip in beside an allowed read.
   */
  const BY_ID_READS: Record<string, { calls: number; why: string }> = {
    delete: {
      calls: 1,
      why: 'locks the one row being deleted, and refuses it when it is merged',
    },
    teachEans: {
      calls: 2,
      why: 'the products a decision names, then the survivors of the merged ones',
    },
    getMany: {
      calls: 2,
      why: 'the asked ids, then their survivors: a merged id answers its survivor',
    },
    searchOffers: {
      calls: 1,
      why: 'the members the ranked page named, which itemStateSql already filtered',
    },
    load: {
      calls: 1,
      why: 'one product by id; every caller decides what a merged row means',
    },
    withSurvivors: {
      calls: 2,
      why: 'the barcode holders, then the survivors that replace merged ones',
    },
    applyMerge: {
      calls: 1,
      why: 'locks the two rows of a merge, which refuses a merged one',
    },
    loadInOrder: {
      calls: 1,
      why: 'the products a write names by id; the write refuses or allows them',
    },
    lockForEdit: {
      calls: 1,
      why: 'locks the products an edit names; a merged row stays editable',
    },
  };

  /** The class method each line belongs to, read from the indentation. */
  const methodAt = (line: number): string | null => {
    for (let index = line - 1; index >= 0; index--) {
      const match =
        /^ {2}(?:(?:private|protected|public|static|async) )*(\w+)\(/.exec(
          source[index]
        );
      if (match) {
        return match[1];
      }
    }
    return null;
  };

  const repositoryReads = source
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) =>
      /this\.items\.find(One|By|OneBy)?\(|manager\.find(One)?\(Item\b|manager\.createQueryBuilder\(Item\b|getRepository\(Item\)/.test(
        text
      )
    );

  it('reads products through the repository only by id, where it names why', () => {
    const counted = new Map<string, number>();
    for (const { line } of repositoryReads) {
      const method = methodAt(line) ?? `line ${line}`;
      counted.set(method, (counted.get(method) ?? 0) + 1);
    }
    expect(Object.fromEntries(counted)).toEqual(
      Object.fromEntries(
        Object.entries(BY_ID_READS).map(([method, read]) => [
          method,
          read.calls,
        ])
      )
    );
  });

  it.each(repositoryReads.map(({ text, line }) => [line, text.trim()]))(
    'line %s (%s) reads by id',
    (line) => {
      // The `where` of a by id read names `id`, the lock reads of the
      // merge and the delete included.
      expect(source.slice(line - 1, line + 3).join('\n')).toMatch(
        /where: \{ id(: | \})/
      );
    }
  );

  it('writes one condition, live by default and merged on request', () => {
    expect(itemStateSql('i')).toBe('i."mergedIntoId" IS NULL');
    expect(itemStateSql('mi', true)).toBe('mi."mergedIntoId" IS NOT NULL');
  });
});
