import {
  allSchemas,
  messageContracts,
  messageResponseSchemaId,
  messageSubjects,
  validateSchema,
} from '@portfolio/luna-shopper/contracts';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  componentNameFor,
  hoistContractSchema,
  openApiComponents,
  toOpenApiSchema,
} from './openapi-schema';

/**
 * The round trip spec (plan 0019, section 5).
 *
 * Section 2 rewrites every internal `$ref` into a component reference, and that
 * rewrite is the one step that can silently produce a schema which is well formed
 * and wrong: a `$ref` pointing nowhere degrades into "accepts anything", which no
 * amount of eyeballing the rendered docs would reveal. So for every registered
 * pattern this builds a payload from the contract schema and asserts the two
 * validators agree on it — both accept it, and both reject it once a required
 * field is removed. A dangling reference fails the second half immediately.
 */

const contractsById = new Map<string, Record<string, unknown>>(
  allSchemas.map((schema) => [
    String(schema['$id']),
    schema as Record<string, unknown>,
  ])
);

/** A value satisfying each `format` the contract schemas use. */
const SAMPLE_BY_FORMAT: Record<string, string> = {
  email: 'sample@example.com',
  'date-time': '2026-01-01T00:00:00.000Z',
};

/**
 * The smallest payload a schema accepts: every required property, one element per
 * array, the first value of an enum. Generated rather than hand written, because
 * a hand written fixture per pattern is the second description of every payload
 * this plan exists to avoid.
 */
function sampleOf(schema: Record<string, unknown>): unknown {
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const target = contractsById.get(ref);
    if (!target) {
      throw new Error(`Cannot sample unknown schema ${ref}`);
    }
    return sampleOf(target);
  }

  const values = schema['enum'];
  if (Array.isArray(values)) {
    return values[0];
  }

  // A nullable localized field is written as `anyOf: [ref, null]`; the first
  // branch is the interesting one, since a null sample would exercise nothing.
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && branches.length > 0) {
      return sampleOf(branches[0] as Record<string, unknown>);
    }
  }

  const declared = schema['type'];
  const type = Array.isArray(declared)
    ? declared.find((entry) => entry !== 'null')
    : declared;

  switch (type) {
    case 'string':
      return SAMPLE_BY_FORMAT[String(schema['format'])] ?? 'sample';
    case 'integer':
    case 'number':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 1;
    case 'boolean':
      return true;
    case 'array':
      return [sampleOf((schema['items'] ?? {}) as Record<string, unknown>)];
    case 'object': {
      const properties = (schema['properties'] ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const required = (schema['required'] ?? []) as string[];
      const payload: Record<string, unknown> = {};
      for (const key of required) {
        payload[key] = sampleOf(properties[key] ?? {});
      }
      return payload;
    }
    default:
      // `any()` — the generic event payload. Any JSON value satisfies it.
      return {};
  }
}

/** Every response schema, published exactly as a documented route would publish it. */
const documented = new Map<string, string>(
  messageSubjects.map((subject) => [
    subject,
    hoistContractSchema(messageResponseSchemaId(subject)),
  ])
);

const OPENAPI_ROOT = 'luna://openapi-under-test';

const openApiAjv = new Ajv({ allErrors: true, strict: false });
addFormats(openApiAjv);
openApiAjv.addSchema({
  $id: OPENAPI_ROOT,
  components: { schemas: openApiComponents() },
});

function validateAsDocumented(name: string, payload: unknown): boolean {
  const validate = openApiAjv.getSchema(
    `${OPENAPI_ROOT}#/components/schemas/${name}`
  ) as ValidateFunction | undefined;
  if (!validate) {
    throw new Error(`The document publishes no component named ${name}`);
  }
  return validate(payload) === true;
}

describe('contract schema to OpenAPI bridge', () => {
  describe('component names', () => {
    it('strips the scheme and flattens the path', () => {
      expect(componentNameFor('luna://zone/ZoneView')).toBe('zone.ZoneView');
      expect(componentNameFor('luna://msg/zone.create/request')).toBe(
        'msg.zone.create.request'
      );
    });

    it('produces names OpenAPI accepts as component keys', () => {
      for (const name of Object.keys(openApiComponents())) {
        expect(name).toMatch(/^[a-zA-Z0-9._-]+$/);
      }
    });
  });

  describe('conversion', () => {
    it('drops `$id` and rewrites refs, leaving everything else alone', () => {
      const converted = toOpenApiSchema({
        $id: 'luna://zone/Thing',
        type: 'object',
        required: ['status'],
        properties: {
          status: { $ref: 'luna://enums/ZoneStatus' },
          nested: { type: 'array', items: { $ref: 'luna://zone/ZoneView' } },
          nullable: { type: ['string', 'null'] },
        },
      });

      expect(converted).toEqual({
        type: 'object',
        required: ['status'],
        properties: {
          status: { $ref: '#/components/schemas/enums.ZoneStatus' },
          nested: {
            type: 'array',
            items: { $ref: '#/components/schemas/zone.ZoneView' },
          },
          nullable: { type: ['string', 'null'] },
        },
      });
    });

    it('hoists what a schema references, transitively', () => {
      const components = openApiComponents();
      // ZonePage -> MyZoneView -> ZoneRole/MembershipStatus/ZoneStatus.
      expect(components['zone.ZonePage']).toBeDefined();
      expect(components['zone.MyZoneView']).toBeDefined();
      expect(components['enums.ZoneRole']).toBeDefined();
    });

    it('refuses to document a shape the contracts library does not describe', () => {
      expect(() => hoistContractSchema('luna://nope/Missing')).toThrow(
        /No contract schema registered/
      );
    });
  });

  describe('the published schema and the contract schema agree', () => {
    const cases = messageSubjects.map((subject) => [
      subject,
      messageContracts[subject].response,
    ]);

    it.each(cases)('%s accepts the same payload', (subject, schemaId) => {
      const source = contractsById.get(schemaId as string);
      expect(source).toBeDefined();
      const payload = sampleOf(source as Record<string, unknown>);

      expect(validateSchema(schemaId as string, payload).valid).toBe(true);
      expect(
        validateAsDocumented(
          documented.get(subject as string) as string,
          payload
        )
      ).toBe(true);
    });

    it.each(cases)('%s rejects the same payload', (subject, schemaId) => {
      const source = contractsById.get(schemaId as string) as Record<
        string,
        unknown
      >;
      const required = (source['required'] ?? []) as string[];
      if (required.length === 0) {
        return;
      }
      const payload = sampleOf(source) as Record<string, unknown>;
      delete payload[required[0]];

      // Both halves matter: a `$ref` rewritten to a name nobody published would
      // still accept the payload above, and only a rejection proves the
      // published component is the real schema rather than an empty stand in.
      expect(validateSchema(schemaId as string, payload).valid).toBe(false);
      expect(
        validateAsDocumented(
          documented.get(subject as string) as string,
          payload
        )
      ).toBe(false);
    });
  });
});
