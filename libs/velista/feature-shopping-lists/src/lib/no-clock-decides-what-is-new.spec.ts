import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The rule velista `0093` turns on, held by a test rather than by a comment
 * (section 13, test 11).
 *
 * **No clock on the client decides anything here.** What is new to a viewer is
 * the server's answer on the server's clock: `BasketRow.mark`,
 * `Basket.unseenChangeCount` and `BasketChange.unseen` are read and never
 * computed. A mark appears and disappears because a read said so.
 *
 * So the files this plan added must hold no `Date.now()` and build no `Date`.
 * The exceptions are named one by one below and each is a different thing:
 *
 * - the **mapper** turns the wire's string into a `Date`, which is what a date
 *   on the client is for, and nothing compares it to anything;
 * - the **sheet** formats that date through `Intl` for display;
 * - the **acknowledger** runs one `setTimeout`, which is a display debounce and
 *   not a window in which a change counts as new.
 *
 * A grep and not a lint rule, for `token-hygiene.spec.ts`'s reason: the
 * workspace runs no custom lint plugin, and a spec fails with the offending
 * file and line and can explain itself.
 */

/** Every file this plan added or changed that is not allowed a clock. */
const WATCHED = [
  '../../../models/src/lib/basket-changes.ts',
  '../../../data-access/src/lib/baskets/basket-change-store.ts',
  '../../../ui/src/lib/basket/changes-banner.ts',
  '../../../ui/src/lib/basket/change-entry.ts',
  'basket-page/seen-target.ts',
  'changes-sheet/changes-sheet.ts',
];

/** `Date.now()`, `new Date(...)` and the two ways to spell a timer. */
const CLOCK = /\bDate\.now\s*\(|\bnew\s+Date\s*\(|\bsetTimeout\s*\(|\bsetInterval\s*\(/;

describe('no clock on this side decides what is new', () => {
  it.each(WATCHED)('%s reads no clock at all', (relative) => {
    const source = readFileSync(join(__dirname, relative), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      // Comments are prose about the rule, and several of these files explain
      // it by naming what they do not do.
      .filter(
        ({ line }) =>
          !line.startsWith('*') && !line.startsWith('//') && CLOCK.test(line)
      );

    expect(offenders).toEqual([]);
  });

  it('allows the mapper its one `Date`, and nothing that compares it', () => {
    // The wire serves a string and the model holds a `Date`. That conversion is
    // `date()` in `primitives`, so even the mapper names no constructor: what
    // this asserts is that it holds no comparison either.
    const source = readFileSync(
      join(
        __dirname,
        '../../../data-access/src/lib/mapping/basket-change-mappers.ts'
      ),
      'utf8'
    );

    expect(CLOCK.test(source)).toBe(false);
  });

  it('allows the acknowledger exactly one timer, and it is the dwell', () => {
    // The one timer in this plan, and it is a display debounce: it decides
    // whether a screen that drew a change was looked at, never whether the
    // change is new.
    const source = readFileSync(
      join(__dirname, 'basket-page/change-acknowledger.ts'),
      'utf8'
    );
    const timers = source.match(/\bsetTimeout\s*\(/g) ?? [];

    expect(timers).toHaveLength(1);
    expect(source).not.toMatch(/\bDate\.now\s*\(|\bnew\s+Date\s*\(/);
  });
});
