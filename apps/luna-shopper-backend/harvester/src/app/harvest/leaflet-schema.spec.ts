import {
  LEAFLET_IMPORT_1_0_SCHEMA_ID,
  validateLeafletDocument,
} from '@portfolio/luna-shopper/contracts';
import ocr from './__fixtures__/eljamon.ocr.json';
import pdftext from './__fixtures__/eljamon.pdftext.json';
import vision from './__fixtures__/eljamon.vision.json';
import { readLeafletDocument } from './leaflet-document.reader';

/**
 * The import contract against the documents it was narrowed from (plan 0081,
 * sections 4 and 9).
 *
 * The three fixtures are the extractor's own committed outputs, copied out of
 * `tmp/leaflet` so the build can see them: 219 offers from the text layer, 218
 * from OCR and 48 from a model reading four sampled pages. A narrowed schema
 * that its own source documents fail is a schema nobody can upload against, and
 * `tmp/` is git ignored, so the copy is the only way the check runs in CI.
 */
describe('the leaflet import schema (plan 0081, section 4)', () => {
  it.each([
    ['the text layer output', pdftext],
    ['the OCR output', ocr],
    ['the vision output', vision],
  ])('accepts %s', (_name, document) => {
    const { valid, failures } = validateLeafletDocument(document);
    expect(failures).toEqual([]);
    expect(valid).toBe(true);
  });

  it('names the schema it validated against by its versioned id', () => {
    // The id carries the version, so a new version is a new file and a new
    // const rather than an edit that silently changes what old documents mean.
    expect(LEAFLET_IMPORT_1_0_SCHEMA_ID).toBe(
      'https://ichirokuxvi.com/schemas/leaflet-import-1.0.json'
    );
  });

  it('refuses a document with no sha256, naming the path', () => {
    const { source, ...rest } = pdftext as unknown as {
      source: Record<string, unknown>;
    };
    const { sha256, ...sourceWithout } = source;
    expect(sha256).toBeDefined();

    const { valid, failures } = validateLeafletDocument({
      ...rest,
      source: sourceWithout,
    });

    expect(valid).toBe(false);
    // Required here and optional in the extractor's schema: section 7's dedupe
    // keys on it, so a document without one cannot be told apart from another.
    expect(failures.some((failure) => failure.path === '/source')).toBe(true);
    expect(failures.some((failure) => failure.message.includes('sha256'))).toBe(
      true
    );
  });

  it('refuses a schema_version this backend cannot read', () => {
    const { valid, failures } = validateLeafletDocument({
      ...(pdftext as object),
      schema_version: '9.9',
    });

    expect(valid).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0].path).toBe('/schema_version');
    // It says what it does read, rather than validating against the newest
    // schema, which would check a document against a shape nobody wrote it for.
    expect(failures[0].message).toContain('1.0');
  });

  it('names the offer a failure is inside, not only its index', () => {
    const document = JSON.parse(JSON.stringify(pdftext)) as {
      offers: { id: string; pricing: { basis: string } }[];
    };
    document.offers[2].pricing.basis = 'per-fortnight';

    const { valid, failures } = validateLeafletDocument(document);

    expect(valid).toBe(false);
    const named = failures.find((failure) =>
      failure.path.startsWith('/offers/2/pricing/basis')
    );
    expect(named?.offerId).toBe(document.offers[2].id);
  });

  it('reading a stored document that no longer validates throws', () => {
    // The runner and an alias accept both read a document back out of a run,
    // and something that validated once and no longer does is worth saying
    // loudly rather than skipping past.
    expect(() => readLeafletDocument({ schema_version: '1.0' })).toThrow(
      /does not match its schema/
    );
  });
});
