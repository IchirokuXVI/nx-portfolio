import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseLegalDocument,
  type LegalDocument,
  type LegalDocumentKind,
} from './legal-document';
import { legalDocumentProblems } from './render';

const ASSETS = join(__dirname, '..', '..', 'assets', 'legal');
const UI_I18N = join(__dirname, '..', '..', '..', 'ui', 'assets', 'i18n');
const KINDS: readonly LegalDocumentKind[] = ['privacy', 'terms'];
const LOCALES = ['en', 'es'] as const;

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function load(kind: LegalDocumentKind, locale: string): LegalDocument {
  const parsed = parseLegalDocument(
    read(join(ASSETS, `${kind}.${locale}.json`))
  );
  if (parsed === null) {
    throw new Error(
      `${kind}.${locale}.json does not have the LegalDocument shape`
    );
  }
  return parsed;
}

/** Every string a reader sees in a document. */
function texts(doc: LegalDocument): string[] {
  return [
    doc.title,
    ...doc.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === 'paragraph'
          ? [block.text]
          : block.kind === 'list'
            ? [...block.items]
            : [...block.head, ...block.rows.flatMap((row) => row.cells)]
      ),
    ]),
  ];
}

/**
 * The four documents (velista `0172`, target 3), read as the files they are.
 */
describe('the legal documents', () => {
  for (const kind of KINDS) {
    for (const locale of LOCALES) {
      describe(`${kind}.${locale}.json`, () => {
        it('has the LegalDocument shape', () => {
          expect(() => load(kind, locale)).not.toThrow();
        });

        it('uses only known placeholders, each behind the condition that gives it a value', () => {
          expect(legalDocumentProblems(load(kind, locale))).toEqual([]);
        });

        it('is titled as the route and the links name it', () => {
          const ui = read(join(UI_I18N, `${locale}.json`)) as {
            legal: Record<LegalDocumentKind, { title: string }>;
          };

          expect(load(kind, locale).title).toBe(ui.legal[kind].title);
        });

        it('uses no dash as punctuation (the owner rule)', () => {
          const dashed = texts(load(kind, locale)).filter((text) =>
            /[–—]| - /.test(text)
          );

          expect(dashed).toEqual([]);
        });
      });
    }

    // What keeps the two languages describing the same sections: the same ids, in the
    // same order, under the same conditions.
    it(`${kind}: the English and the Spanish file have the same sections in the same order`, () => {
      const outline = (doc: LegalDocument) =>
        doc.sections.map((section) => `${section.id}:${section.when ?? ''}`);

      expect(outline(load(kind, 'es'))).toEqual(outline(load(kind, 'en')));
    });

    it(`${kind}: both languages carry the same template version`, () => {
      expect(load(kind, 'es').templateVersion).toBe(
        load(kind, 'en').templateVersion
      );
      expect(load(kind, 'en').templateVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  }
});
