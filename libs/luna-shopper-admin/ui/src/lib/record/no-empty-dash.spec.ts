import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **An empty value reads "None"** (admin plan 0052, section 6). Never a blank
 * and never a dash, so an empty field and a field that failed to load do not
 * look the same.
 *
 * A test and not a sentence, because a dash is the habit: a table cell with
 * nothing in it gets one without anybody deciding it should. `toRecordValue`
 * answers `none` for every empty value and `FieldValue` writes the word, so no
 * part of the record page has a reason to hold either of these:
 *
 * - A string that is only a dash, of any length: in quotes, or alone between
 *   two tags of a template, or as the entity of one.
 * - A fall back to the empty string, `?? ''` or `|| ''`, which is how a value
 *   that is missing becomes a blank on the screen.
 *
 * A source scan, for the reason `ink-on-wash.spec.ts` gives: the defect is a
 * few characters in a file, and rendering every part with every empty value
 * would still only catch the cases somebody thought of.
 */

/** The hyphen, the minus sign and every longer dash. */
const DASH = '[-\\u2010-\\u2015\\u2212]';

/** A string that is nothing but dashes, in any of the three quotes. */
const QUOTED = new RegExp(`(['"\`])\\s*${DASH}+\\s*\\1`, 'g');

/** The same between two tags of a template: `<td>-</td>`. */
const BETWEEN_TAGS = new RegExp(`>\\s*${DASH}+\\s*<`, 'g');

/** A dash written as an entity. */
const ENTITY = /&(?:mdash|ndash|minus|#8211|#8212|#x2013|#x2014);/gi;

/** A missing value turned into a blank. */
const BLANK_FALL_BACK = /(?:\?\?|\|\|)\s*(?:''|""|``)/g;

const PARTS = readdirSync(__dirname).filter(
  (entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts')
);

/** The code, without the prose about it. A comment may name a dash. */
function code(file: string): string {
  return readFileSync(join(__dirname, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function found(pattern: RegExp): string[] {
  return PARTS.flatMap((file) =>
    [...code(file).matchAll(pattern)].map((match) => `${file}: ${match[0]}`)
  );
}

describe('no part of the record page writes a dash or a blank for an empty value', () => {
  it('reads the parts', () => {
    // A scan that found no file would pass every test below.
    expect(PARTS).toEqual(
      expect.arrayContaining([
        'field-row.ts',
        'field-value.ts',
        'locked-value.ts',
        'record-collection.ts',
        'record-section.ts',
        'save-bar.ts',
        'switch.ts',
      ])
    );
  });

  it('finds what it looks for', () => {
    const hit = (pattern: RegExp, text: string) =>
      new RegExp(pattern.source, pattern.flags).test(text);

    expect(hit(QUOTED, "value ?? '-'")).toBe(true);
    expect(hit(QUOTED, 'value ?? "—"')).toBe(true);
    expect(hit(QUOTED, "'––'")).toBe(true);
    expect(hit(BETWEEN_TAGS, '<dd>—</dd>')).toBe(true);
    expect(hit(ENTITY, '<dd>&mdash;</dd>')).toBe(true);
    expect(hit(BLANK_FALL_BACK, "{{ name ?? '' }}")).toBe(true);
    expect(hit(BLANK_FALL_BACK, "name || ''")).toBe(true);

    // A hyphen inside a word or a selector is not a value.
    expect(hit(QUOTED, "'lib-field-value'")).toBe(false);
    expect(hit(QUOTED, "'record-section-' + id")).toBe(false);
    expect(hit(BETWEEN_TAGS, '<span>a - b</span>')).toBe(false);
  });

  it('holds no string that is only a dash', () => {
    expect([
      ...found(QUOTED),
      ...found(BETWEEN_TAGS),
      ...found(ENTITY),
    ]).toEqual([]);
  });

  it('holds no fall back to an empty string', () => {
    expect(found(BLANK_FALL_BACK)).toEqual([]);
  });
});
