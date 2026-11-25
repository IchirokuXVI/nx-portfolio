import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ExtraAskHandoff, type PendingExtraAsk } from './extra-ask-handoff';

/**
 * The basket's handoff of a question to "Lists and amounts" (velista `0208`,
 * target state 19, spec 18), the piece built to be removed.
 */

const QUESTION: PendingExtraAsk = {
  rowKey: 'row-milk',
  lineId: 'zl-1',
  extra: { above: 2, countable: 2, buyers: [{ userId: 'u-1' }] },
};

describe('ExtraAskHandoff (velista 0208)', () => {
  it('holds the question while its navigation is out, for that row only', async () => {
    const handoff = new ExtraAskHandoff();
    let seen: { other: unknown; own: unknown } | null = null;
    await handoff.send(QUESTION, async () => {
      seen = {
        other: handoff.take('row-bread'),
        own: handoff.take('row-milk'),
      };
      return true;
    });

    expect(seen).toEqual({ other: null, own: QUESTION });
  });

  it('gives the question once', async () => {
    const handoff = new ExtraAskHandoff();
    const taken: unknown[] = [];
    await handoff.send(QUESTION, async () => {
      taken.push(handoff.take('row-milk'), handoff.take('row-milk'));
      return true;
    });

    expect(taken).toEqual([QUESTION, null]);
  });

  it.each([
    ['opened', async () => true],
    ['cancelled', async () => false],
    [
      'failed',
      async () => {
        throw new Error('no route');
      },
    ],
  ])(
    'drops what was not taken once the navigation %s, so a sheet opened later asks nothing',
    async (_how, open) => {
      const handoff = new ExtraAskHandoff();
      await handoff.send(QUESTION, open);

      expect(handoff.take('row-milk')).toBeNull();
    }
  );

  it('keeps only the newest question', async () => {
    const handoff = new ExtraAskHandoff();
    const newer = { ...QUESTION, lineId: 'zl-2' };
    let taken: unknown = null;
    void handoff.send(QUESTION, () => new Promise(() => undefined));
    await handoff.send(newer, async () => {
      taken = handoff.take('row-milk');
      return true;
    });

    expect(taken).toEqual(newer);
  });
});

describe('the handoff is one removable piece (velista 0208, target state 19)', () => {
  /** The feature library's sources, from this spec's own location. */
  const LIB = join(__dirname, '..', '..', '..');

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return sources(full);
      }
      return (entry.endsWith('.ts') || entry.endsWith('.html')) &&
        !entry.endsWith('.spec.ts')
        ? [full]
        : [];
    });
  }

  const files = sources(join(LIB, 'src'));
  const named = (file: string) => relative(LIB, file).split(sep).join('/');
  const lines = (path: string) =>
    readFileSync(join(LIB, path), 'utf8').split(/\r?\n/);

  /** Whether a comment within the five lines above names the plan and the state. */
  const marked = (all: readonly string[], at: number) => {
    const above = all.slice(Math.max(0, at - 5), at + 1).join(' ');
    return /0208/.test(above) && /target state 19/.test(above);
  };

  it('is named by its own file, the basket page and the sheet alone', () => {
    expect(
      files
        .filter((file) =>
          /ExtraAskHandoff|_handoff\b/.test(readFileSync(file, 'utf8'))
        )
        .map(named)
        .sort()
    ).toEqual([
      'src/lib/basket-page/basket-page.ts',
      'src/lib/basket-page/extra-ask-handoff.ts',
      'src/lib/row-lists-sheet/row-lists-sheet.ts',
    ]);
  });

  it('is put by one marked call in the basket page', () => {
    const page = lines('src/lib/basket-page/basket-page.ts');
    const calls = page
      .map((line, at) => ({ line, at }))
      .filter(({ line }) => /this\._handoff\.send\(/.test(line));
    expect(calls).toHaveLength(1);
    expect(marked(page, calls[0].at)).toBe(true);
    // Besides the call: its provider, its import and the injection.
    expect(
      page.filter((line) => /\bExtraAskHandoff\b|this\._handoff\b/.test(line))
        .length
    ).toBe(4);
  });

  it('is taken by one marked read in the sheet', () => {
    const sheet = lines('src/lib/row-lists-sheet/row-lists-sheet.ts');
    const reads = sheet
      .map((line, at) => ({ line, at }))
      .filter(({ line }) => /inject\(ExtraAskHandoff/.test(line));
    expect(reads).toHaveLength(1);
    expect(marked(sheet, reads[0].at)).toBe(true);
    expect(sheet.slice(reads[0].at, reads[0].at + 2).join(' ')).toMatch(
      /\?\.take\(/
    );
    // Besides the read: its import.
    expect(
      sheet.filter((line) => /\bExtraAskHandoff\b/.test(line)).length
    ).toBe(2);
  });
});
