import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarvestDocument } from './harvest-document';
import { HARVEST_DOCUMENT_1_VERSION } from './harvest-document-1.schema';
import { harvestDocumentSchemaId } from './harvest-document-registry';
import { validateHarvestDocument } from './harvest-document-validation';

/**
 * The file import contract (plan 0086, section 6.1 and section 12).
 *
 * The committed fixtures are what a real producer emits, so they are validated
 * whole rather than by a shape written twice: a schema and a spec that both
 * describe the same field agree with each other and with nothing else. The rest
 * of the file is what the schema must **refuse**, which is the half a fixture
 * cannot prove.
 */

const FIXTURES = join(__dirname, '__fixtures__');

const read = (name: string): HarvestDocument =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as HarvestDocument;

/** A deep copy, so one case's mutation is not the next case's input. */
const copy = (document: HarvestDocument): HarvestDocument =>
  JSON.parse(JSON.stringify(document)) as HarvestDocument;

const paths = (document: unknown): string[] =>
  validateHarvestDocument(document).failures.map((failure) => failure.path);

describe('validateHarvestDocument', () => {
  const fixtureNames = readdirSync(FIXTURES).filter((name) =>
    name.endsWith('.json')
  );

  it('has fixtures to validate', () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  describe.each(fixtureNames)('%s', (name) => {
    it('validates', () => {
      const result = validateHarvestDocument(read(name));
      expect(result.failures).toEqual([]);
      expect(result.valid).toBe(true);
    });
  });

  describe('the version', () => {
    it('is the integer 1', () => {
      expect(HARVEST_DOCUMENT_1_VERSION).toBe(1);
      expect(harvestDocumentSchemaId(1)).toBeDefined();
    });

    it('refuses an unknown version, naming the ones it reads', () => {
      const document = {
        ...read('minimal.harvest-document.json'),
        schema_version: 4,
      };
      const result = validateHarvestDocument(document);

      expect(result.valid).toBe(false);
      expect(result.failures).toEqual([
        {
          path: '/schema_version',
          productId: null,
          productIndex: null,
          message: expect.stringContaining('cannot read schema_version 4'),
        },
      ]);
      expect(result.failures[0].message).toContain('it reads 1');
    });

    it('refuses the version written as a string, rather than coercing it', () => {
      // A producer that writes "1" has a bug the first import should name.
      const document = {
        ...read('minimal.harvest-document.json'),
        schema_version: '1',
      };

      expect(paths(document)).toEqual(['/schema_version']);
    });
  });

  describe('the document level fields', () => {
    it('refuses a document with no products, naming the field', () => {
      const document = copy(read('minimal.harvest-document.json')) as Record<
        string,
        unknown
      >;
      delete document['products'];

      expect(paths(document)).toEqual(['/products']);
    });

    it('refuses an empty products array: there is nothing to run', () => {
      const document = {
        ...read('minimal.harvest-document.json'),
        products: [],
      };

      expect(paths(document)).toEqual(['/products']);
    });

    it('refuses a document with no sha256, naming the field', () => {
      const document = copy(read('minimal.harvest-document.json')) as Record<
        string,
        unknown
      >;
      delete document['sha256'];

      expect(paths(document)).toEqual(['/sha256']);
    });

    it('refuses a sha256 that is not a digest', () => {
      const document = {
        ...read('minimal.harvest-document.json'),
        sha256: 'not-a-digest',
      };

      expect(paths(document)).toEqual(['/sha256']);
    });

    it('refuses a validity with only one bound', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.validity = { from: '2026-09-10' } as never;

      expect(paths(document)).toEqual(['/validity/until']);
    });

    it('accepts a document with no validity at all', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete document.validity;

      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('refuses a field the schema does not know', () => {
      const document = {
        ...read('minimal.harvest-document.json'),
        retailer: { name: 'El Jamon' },
      };

      // The leaflet document's own shape, offered to the file import. A typo'd
      // field is refused by name rather than silently ignored.
      expect(paths(document)).toEqual(['']);
      expect(validateHarvestDocument(document).failures[0].message).toContain(
        'additional properties'
      );
    });
  });

  describe('the products', () => {
    it('refuses a price with no currency, naming the product by its id', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete (document.products[0].price as Record<string, unknown>)[
        'currency'
      ];

      const result = validateHarvestDocument(document);

      expect(result.valid).toBe(false);
      expect(result.failures).toEqual([
        {
          path: '/products/0/price/currency',
          productId: 'p-0001',
          productIndex: 0,
          message: expect.stringContaining('currency'),
        },
      ]);
    });

    it('names a product by its index when it carries no id', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete document.products[1].id;
      delete (document.products[1].unit_price as Record<string, unknown>)[
        'label'
      ];

      const [failure] = validateHarvestDocument(document).failures;

      expect(failure.path).toBe('/products/1/unit_price/label');
      expect(failure.productId).toBeNull();
      expect(failure.productIndex).toBe(1);
    });

    it('refuses a product with no name', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete (document.products[2] as Record<string, unknown>)['name'];

      expect(paths(document)).toEqual(['/products/2/name']);
    });

    it('refuses an empty name: it is the key of a product with no id', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.products[2].name = '';

      expect(paths(document)).toEqual(['/products/2/name']);
    });

    it('accepts a product with a price and no unit price', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete document.products[0].unit_price;

      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('accepts a product with a unit price and no price', () => {
      // A per kilogram offer with no pack price. The import writes the unit
      // price alone (plan 0086, section 5).
      const [, unitPriceOnly] = read('minimal.harvest-document.json').products;

      expect(unitPriceOnly.price).toBeUndefined();
      expect(unitPriceOnly.unit_price?.amount).toBe(6.95);
      expect(
        validateHarvestDocument(read('minimal.harvest-document.json')).valid
      ).toBe(true);
    });

    it('accepts a product with neither price nor unit price', () => {
      // DEZA prints none, and a conditional tile states no number a shopper
      // pays for one unit. Both land in the queue and write nothing.
      const [, , neither] = read('minimal.harvest-document.json').products;

      expect(neither.price).toBeUndefined();
      expect(neither.unit_price).toBeUndefined();
    });

    it('refuses a unit price with no label: the label is what is written', () => {
      const document = copy(read('minimal.harvest-document.json'));
      delete (document.products[1].unit_price as Record<string, unknown>)[
        'label'
      ];

      expect(paths(document)).toEqual(['/products/1/unit_price/label']);
    });

    it('carries a duplicate key pair, which the schema does not refuse', () => {
      // Two products with one key is the import's warning to make (plan 0086,
      // section 5), not the schema's: only the import computes the key.
      const products = read('minimal.harvest-document.json').products;
      const [a, b] = products.slice(3);

      expect(a.name).toBe(b.name);
      expect(a.size?.label).toBe(b.size?.label);
      expect(a.external_id).toBeUndefined();
      expect(b.external_id).toBeUndefined();
    });
  });

  describe('extra', () => {
    it('accepts anything at all', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.products[0].extra = {
        page: 3,
        promotion: { type: 'second_unit_discount', paid: [1, 2, 3] },
        loyalty: { required: true, program: 'ifamilia' },
        raw_text: ['0,89 €'],
        confidence: 0.97,
        points: { cost: 120, programme: null },
        anything: { at: { all: [true, null, 'yes', 1.5] } },
      };

      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('accepts an extra on a warning too', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.warnings = [
        { message: 'a tile nobody could read', extra: { whatever: [1, 2] } },
      ];

      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('refuses a warning with no message', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.warnings = [{ product_id: 'p-0001' } as never];

      expect(paths(document)).toEqual(['/warnings/0/message']);
    });
  });

  describe('hints', () => {
    it('are all optional', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.hints = {};

      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('accept a chain id that is not a uuid: an id is not an identity', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.hints = { chain_id: 'el-jamon' };

      // The upload screen looks it up and reports that this deployment has no
      // such chain (admin plan 0014, section 2). Refusing the file would be
      // worse.
      expect(validateHarvestDocument(document).valid).toBe(true);
    });

    it('refuse a source kind that is not an official one', () => {
      const document = copy(read('minimal.harvest-document.json'));
      document.hints = { source_kind: 'USER_RECEIPT' as never };

      expect(paths(document)).toEqual(['/hints/source_kind']);
    });
  });
});
