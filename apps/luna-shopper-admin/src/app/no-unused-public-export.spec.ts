import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * **Every name a library's `index.ts` exports is imported by another project**
 * (admin plan 0047, target 8).
 *
 * A test and not a sentence, because a public name costs nothing to add and
 * nothing fails when its last reader goes. Before the remodel the ten
 * libraries exported eight hundred names through `export *`, and more than
 * half of them were read only inside the library that wrote them. A barrel
 * like that says nothing about what a library offers, and every name in it is
 * one more thing a change has to look for readers of.
 *
 * ## What it checks
 *
 * The names of each `libs/luna-shopper-admin/<library>/src/index.ts`, and for
 * each one an import of it from `@portfolio/luna-shopper-admin/<library>` in
 * the app or in another of the ten libraries. A spec of another project
 * counts: admin plan 0047 may not delete a thing a spec reads. A file that
 * exports the name on from the alias counts as well, because it reads it.
 *
 * An import inside the same library does not count. A library reads its own
 * files by their relative path, so its barrel is for everybody else.
 *
 * `Wire` is one name, the namespace of the generated gateway types, and it is
 * checked like any other. What is inside it is generated and is not this
 * spec's business.
 *
 * The files are parsed and nothing is compiled or started, so `export *` is
 * followed by reading the file it names.
 */

/** The app, from this spec's own location. */
const APP = join(__dirname, '..');

/** Every admin library beside it. */
const LIBS = join(APP, '..', '..', '..', 'libs', 'luna-shopper-admin');

/** The alias every library of this app is imported by, less its own name. */
const ALIAS = '@portfolio/luna-shopper-admin/';

const LIBRARIES = readdirSync(LIBS).filter((name) =>
  existsSync(join(LIBS, name, 'src', 'index.ts'))
);

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}

function typeScriptFiles(root: string): readonly string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      return typeScriptFiles(path);
    }
    return entry.endsWith('.ts') ? [path] : [];
  });
}

/** The file a relative specifier names, or `null` when there is none. */
function fileOf(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);

  return (
    [`${base}.ts`, join(base, 'index.ts')].find((path) => existsSync(path)) ??
    null
  );
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

/** Every name a file exports, following `export *` into the file it names. */
function exportedNames(path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) {
    return [];
  }
  seen.add(path);

  const file = parse(path);

  return file.statements.flatMap((statement): string[] => {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;

      if (clause === undefined) {
        const target =
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
            ? fileOf(path, statement.moduleSpecifier.text)
            : null;
        return target === null ? [] : exportedNames(target, seen);
      }

      return ts.isNamespaceExport(clause)
        ? [clause.name.text]
        : clause.elements.map((element) => element.name.text);
    }

    if (!isExported(statement)) {
      return [];
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((declaration) =>
        declaration.name.getText(file)
      );
    }

    const named = statement as ts.Statement & { name?: ts.Identifier };
    return named.name === undefined ? [] : [named.name.text];
  });
}

/**
 * The names a file takes from each library, by the library's alias: what it
 * imports, and what it exports on.
 */
function takenFrom(path: string): ReadonlyMap<string, readonly string[]> {
  const taken = new Map<string, string[]>();

  for (const statement of parse(path).statements) {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      continue;
    }

    const specifier = statement.moduleSpecifier;
    if (
      specifier === undefined ||
      !ts.isStringLiteral(specifier) ||
      !specifier.text.startsWith(ALIAS)
    ) {
      continue;
    }

    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    const names =
      bindings !== undefined &&
      (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
        ? bindings.elements.map(
            // `Wire as W` reads `Wire`.
            (element) => (element.propertyName ?? element.name).text
          )
        : [];

    const library = specifier.text.slice(ALIAS.length);
    taken.set(library, [...(taken.get(library) ?? []), ...names]);
  }

  return taken;
}

/**
 * Every project of this app, and what each of its files takes. Read once:
 * every file is parsed a single time for all ten libraries.
 */
const PROJECTS: ReadonlyMap<
  string,
  readonly ReadonlyMap<string, readonly string[]>[]
> = new Map([
  ['app', typeScriptFiles(APP).map(takenFrom)],
  ...LIBRARIES.map(
    (library) =>
      [library, typeScriptFiles(join(LIBS, library)).map(takenFrom)] as const
  ),
]);

/** The names of one library that some other project takes. */
function readOutside(library: string): ReadonlySet<string> {
  return new Set(
    [...PROJECTS]
      .filter(([project]) => project !== library)
      .flatMap(([, files]) => files)
      .flatMap((taken) => taken.get(library) ?? [])
  );
}

describe('every public export is imported by another project', () => {
  it('finds the ten libraries', () => {
    expect([...LIBRARIES].sort()).toEqual([
      'data-access',
      'feature-auth',
      'feature-brands',
      'feature-catalog',
      'feature-dashboard',
      'feature-harvest',
      'feature-people',
      'feature-resource',
      'models',
      'ui',
    ]);
  });

  it.each(LIBRARIES)('reads what %s exports', (library) => {
    // A barrel the scan could not read would pass the test below.
    expect(
      exportedNames(join(LIBS, library, 'src', 'index.ts')).length
    ).toBeGreaterThan(0);
  });

  it.each(LIBRARIES)(
    'exports nothing from %s that nobody imports',
    (library) => {
      const read = readOutside(library);

      // Named in the failure, because the fix is per name: take it out of the
      // barrel, and delete it where nothing inside the library reads it either.
      expect(
        [...new Set(exportedNames(join(LIBS, library, 'src', 'index.ts')))]
          .filter((name) => !read.has(name))
          .sort()
      ).toEqual([]);
    }
  );
});
