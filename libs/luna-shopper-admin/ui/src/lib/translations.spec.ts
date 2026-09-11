import { CONTENT_LOCALES } from '@portfolio/luna-shopper-admin/models';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { APP_AVAILABLE_LOCALES } from './app-locales';
import { LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS } from './translations';

/**
 * **Every key a template pipes through `rokuT` is in the catalogue** (plan 0018,
 * section 3.1).
 *
 * A screen whose keys were never written does not fail, log or look broken to
 * the developer who wrote it: i18next answers a missing key with the key, so
 * `harvest/sources` drew `harvest.sources.heading` where a heading belongs and
 * eleven more like it, and stayed that way until somebody opened it. Twelve
 * strings, one screen, one namespace that was never written at all.
 *
 * ## What it can see, and what it cannot
 *
 * A **literal** key: `'harvest.sources.heading' | rokuT`, and each branch of a
 * ternary written in the template. Those are the ones a reader can resolve
 * without running the app, and the twelve that were missing were all of that
 * shape.
 *
 * A key **built from a value** cannot be: `'harvest.mode.' + option` is one key
 * per member of a union this file would have to know. Those are counted and
 * reported rather than checked, so the number says how much of the app the scan
 * actually covers. A key handed to a component as an input and piped there is
 * the same case from the other end, and is counted the same way.
 */

/** The `ui` scope, from this spec's own location: `src/lib` up to the lib. */
const UI = join(__dirname, '..', '..');

/** Every admin library, `ui` included, and the app beside them. */
const ROOTS = [
  join(UI, '..'),
  join(UI, '..', '..', '..', 'apps', 'luna-shopper-admin', 'src'),
];

/** What a failure's path is relative to, so it reads as a repository path. */
const WORKSPACE = join(UI, '..', '..', '..');

/** Where the pipe is written, with or without arguments after it. */
const PIPE = /\|\s*rokuT/g;

/** A quoted key inside the expression in front of one. */
const LITERAL = /'([A-Za-z][A-Za-z0-9._]*)'/g;

const CATALOGUE = JSON.parse(
  readFileSync(join(UI, 'assets', 'i18n', 'en.json'), 'utf8')
) as Record<string, unknown>;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    if (extname(entry) === '.ts' && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
}

/** The code, without the prose about it. This file's own prose names keys. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * The expression a pipe is applied to: back to the interpolation or the binding
 * that opened it.
 *
 * Crude, and enough for an Angular template. An expression cannot contain `{{`
 * or `="`, so the last one before the pipe is the one that opened it.
 */
function expression(text: string, at: number): string {
  const before = text.slice(0, at);
  const start = Math.max(before.lastIndexOf('{{'), before.lastIndexOf('="'));

  return start === -1 ? '' : before.slice(start + 2);
}

/**
 * Whether the catalogue holds a dotted key, and holds a string there.
 *
 * A plural counts. i18next stores one under a suffix per form and never under
 * the bare name, so `serverDown.retriesLeft` is written as `retriesLeft_one` and
 * `retriesLeft_other` and a template still asks for it by the bare name.
 * `_other` is the form every language has, so it is the one looked for.
 */
function resolves(key: string): boolean {
  const segments = key.split('.');
  const last = segments.pop();
  let at: unknown = CATALOGUE;

  for (const segment of segments) {
    if (typeof at !== 'object' || at === null) {
      return false;
    }

    at = (at as Record<string, unknown>)[segment];
  }

  if (typeof at !== 'object' || at === null || last === undefined) {
    return false;
  }

  const holder = at as Record<string, unknown>;

  return (
    typeof holder[last] === 'string' ||
    typeof holder[`${last}_other`] === 'string'
  );
}

interface Scan {
  /** Every literal key the text pipes. */
  readonly keys: readonly string[];
  /** How many pipes were applied to something this cannot read. */
  readonly built: number;
}

/** Every literal key piped in one file's templates, and what was skipped. */
function keysIn(text: string): Scan {
  const keys: string[] = [];
  let built = 0;

  for (const pipe of text.matchAll(PIPE)) {
    const source = expression(text, pipe.index ?? 0);

    // A key glued to a value. The literal in it is a prefix and not a key, so
    // checking it would report a miss on every one of them.
    if (source.includes('+')) {
      built += 1;
      continue;
    }

    const literals = [...source.matchAll(LITERAL)].map((found) => found[1]);

    if (literals.length === 0) {
      built += 1;
      continue;
    }

    keys.push(...literals);
  }

  return { keys, built };
}

function scan(): { keys: { key: string; file: string }[]; built: number } {
  const keys: { key: string; file: string }[] = [];
  let built = 0;

  for (const root of ROOTS) {
    for (const path of sourceFiles(root)) {
      const found = keysIn(code(path));
      const file = relative(WORKSPACE, path).split(sep).join('/');

      keys.push(...found.keys.map((key) => ({ key, file })));
      built += found.built;
    }
  }

  return { keys, built };
}

describe('the translation catalogue', () => {
  it('is the one the library ships, for the one locale it ships', () => {
    expect(LUNA_SHOPPER_ADMIN_UI_TRANSLATIONS.namespace).toBe(
      'luna-shopper-admin'
    );
    expect(APP_AVAILABLE_LOCALES).toEqual(['en']);
  });

  it('holds every key a template pipes as a literal', () => {
    const { keys, built } = scan();

    // The scan is worth having only if it reads most of the app, so the number
    // it could not read is asserted to be a minority rather than left implicit.
    expect(keys.length).toBeGreaterThan(built);

    const missing = keys
      .filter(({ key }) => !resolves(key))
      .map(({ key, file }) => `${key} (${file})`);

    // Named in the failure, because the fix is to write the string: the key is
    // what an operator sees on the screen until somebody does.
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  /**
   * The namespace this plan was written about, listed rather than left to the
   * scan, so deleting the screen's strings fails here even if the screen goes
   * with them.
   */
  it('holds the twelve the chain sources screen needs', () => {
    const keys = [
      'harvest.sources.heading',
      'harvest.sources.lead',
      'harvest.sources.empty',
      'harvest.sources.edit',
      'harvest.sources.enabled',
      'harvest.sources.disabled',
      'harvest.sources.field.adapter',
      'harvest.sources.field.workers',
      'harvest.sources.field.rate',
      'harvest.sources.field.lastRunAt',
      'harvest.sources.field.lastSuccessAt',
      'harvest.sources.field.failures',
    ];

    expect(keys.filter((key) => !resolves(key))).toEqual([]);
  });

  /**
   * The content language control's keys (admin plan 0026, section 7).
   *
   * Listed rather than left to the scan, because the option labels are built
   * from a value (`'shell.language.' + locale`) and the scan counts a key like
   * that rather than checking it. One per content locale, and the scan cannot
   * know that list.
   */
  it('holds a name for every language the catalog is read in', () => {
    const keys = [
      'shell.contentLanguage',
      ...CONTENT_LOCALES.map((locale) => `shell.language.${locale}`),
    ];

    expect(keys.filter((key) => !resolves(key))).toEqual([]);
  });

  /**
   * The interface language and the content language are two settings, and this
   * is the line between them. The catalog is read by shoppers, so its names
   * exist in both languages; the back office is read by one operator, in
   * English. Conflating them would make the Spanish name unreadable until
   * somebody translated the admin interface.
   */
  it('ships one interface locale and two content locales', () => {
    expect(APP_AVAILABLE_LOCALES).toEqual(['en']);
    expect(CONTENT_LOCALES).toEqual(['en', 'es']);
  });

  /**
   * The scan proved against the shape it exists to catch, since one that
   * silently matched nothing would pass this file forever.
   */
  it('reads a literal key, a ternary, and skips a key built from a value', () => {
    expect(keysIn(`{{ 'harvest.sources.heading' | rokuT }}`)).toEqual({
      keys: ['harvest.sources.heading'],
      built: 0,
    });

    expect(
      keysIn(`{{
        (source.enabled
          ? 'harvest.sources.enabled'
          : 'harvest.sources.disabled'
        ) | rokuT
      }}`)
    ).toEqual({
      keys: ['harvest.sources.enabled', 'harvest.sources.disabled'],
      built: 0,
    });

    expect(keysIn(`{{ 'harvest.mode.' + option | rokuT }}`)).toEqual({
      keys: [],
      built: 1,
    });

    expect(keysIn(`{{ headingKey() | rokuT }}`)).toEqual({
      keys: [],
      built: 1,
    });
  });

  /** A dotted path that stops on an object is a namespace, not a string. */
  it('resolves a key only when a string is written at it', () => {
    expect(resolves('harvest.sources.heading')).toBe(true);
    expect(resolves('harvest.sources.notAKey')).toBe(false);
    expect(resolves('harvest.sources')).toBe(false);
  });

  /**
   * A plural is written under a suffix and asked for without one, so a scan that
   * did not know that would report the one plural in the app as missing.
   */
  it('resolves a plural through its _other form', () => {
    expect(resolves('serverDown.retriesLeft')).toBe(true);
    expect(CATALOGUE).toMatchObject({
      serverDown: { retriesLeft_other: expect.any(String) },
    });
  });
});
