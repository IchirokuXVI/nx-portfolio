import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

/**
 * **Nothing new starts to use the old form** (admin plan 0053, target 14).
 *
 * A record opens on the record page since that plan: one page that reads a
 * row, changes it and adds one. The form it replaces, `ResourceFormPage` over
 * `ResourceForm` and `ResourceFormStore`, still serves the pages that extend
 * it or draw it, and plans 0054 to 0060 take those away one at a time.
 *
 * A test and not a sentence, because the old form is the shorter way to a
 * new screen: one import and a route. Without this, the list of its users
 * would grow while six plans work to empty it.
 *
 * ## What it checks
 *
 * The source files that import one of the three names, or export it on from
 * another file. Each must be in the list below, and each entry of the list
 * must still do so. **So the list can only shrink.** The plan that moves a
 * page deletes its entry, and plan 0060 deletes this spec with the last one.
 *
 * Specs are not read. A spec about the old form draws no screen, and it goes
 * when the file it is about goes.
 */

/** The app, from this spec's own location. */
const APP = join(__dirname, '..');

/** The repository, so that a path in the list reads the same on any machine. */
const ROOT = join(APP, '..', '..', '..');

/** Every admin library beside the app. */
const LIBS = join(ROOT, 'libs', 'luna-shopper-admin');

/** The three names of the old form. */
const OLD_FORM: ReadonlySet<string> = new Set([
  'ResourceFormPage',
  'ResourceForm',
  'ResourceFormStore',
]);

/**
 * Every file that reads the old form today, and why it still does.
 *
 * Do not add to this list. Mount `RecordPage` through `recordRoute`, or
 * through the route factory, which does it for a resource with no page of
 * its own.
 */
const STILL_USES_THE_OLD_FORM: readonly string[] = [
  // The three barrels that offer it to the files below.
  'libs/luna-shopper-admin/data-access/src/index.ts',
  'libs/luna-shopper-admin/feature-resource/src/index.ts',
  'libs/luna-shopper-admin/ui/src/index.ts',
  // The old page itself, over its form and its store.
  'libs/luna-shopper-admin/feature-resource/src/lib/resource-form-page.ts',
  // The route factory, for a resource that names a `detail` or an `editor`.
  'libs/luna-shopper-admin/feature-resource/src/lib/routes.ts',
  // The chain and the shop (plan 0056).
  'libs/luna-shopper-admin/feature-catalog/src/lib/location-form-page.ts',
  'libs/luna-shopper-admin/feature-catalog/src/lib/supermarket-form-page.ts',
  // The `edit` routes of the zone, the person and the list (plans 0057, 0058).
  'libs/luna-shopper-admin/feature-people/src/lib/shoppers-routes.ts',
  // The price form and the price rule form (plan 0060).
  'libs/luna-shopper-admin/feature-catalog/src/lib/price-form-page.ts',
  'libs/luna-shopper-admin/feature-catalog/src/lib/products/price-rules-page.ts',
];

function sourceFiles(root: string): readonly string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    const isSpec =
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.testing.ts') ||
      entry === 'test-setup.ts';

    return entry.endsWith('.ts') && !isSpec ? [path] : [];
  });
}

/**
 * Whether a file imports one of the three names, or exports it on.
 *
 * The file is parsed and nothing is compiled, so a name in a comment or in a
 * string is not a use. A file that only declares one of the three is not a
 * use either: that is where it lives.
 */
function readsTheOldForm(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );

  return source.statements.some((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const named = statement.importClause?.namedBindings;
      return (
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.some((element) =>
          OLD_FORM.has((element.propertyName ?? element.name).text)
        )
      );
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.some((element) =>
        OLD_FORM.has((element.propertyName ?? element.name).text)
      );
    }

    return false;
  });
}

/** A path as the list writes it: from the repository, with forward slashes. */
const named = (path: string) => relative(ROOT, path).split('\\').join('/');

const READERS = [...sourceFiles(APP), ...sourceFiles(LIBS)]
  .filter(readsTheOldForm)
  .map(named)
  .sort();

describe('the old form has no new user', () => {
  it('finds the old form, so that an empty answer is not a broken search', () => {
    expect(READERS).toContain(
      'libs/luna-shopper-admin/feature-resource/src/lib/resource-form-page.ts'
    );
  });

  /**
   * A new screen opens a record with `RecordPage`. If this fails, mount the
   * record page and do not add the file to the list.
   */
  it('is imported by no file outside the list', () => {
    expect(
      READERS.filter((path) => !STILL_USES_THE_OLD_FORM.includes(path))
    ).toEqual([]);
  });

  /** A page that moved takes its entry with it, so the list only shrinks. */
  it('lists no file that stopped importing it', () => {
    expect(
      STILL_USES_THE_OLD_FORM.filter((path) => !READERS.includes(path))
    ).toEqual([]);
  });

  it('names each file once', () => {
    expect(new Set(STILL_USES_THE_OLD_FORM).size).toBe(
      STILL_USES_THE_OLD_FORM.length
    );
  });
});
