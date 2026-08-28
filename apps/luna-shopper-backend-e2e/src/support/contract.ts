import { expect } from '@playwright/test';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts a live response against the schema the API publishes for that route
 * (plan 0019, section 5).
 *
 * This is what closes the loop end to end. The docs describe a schema, the
 * schema is the same object the services validate their broker messages against,
 * and here the real server's real response over real HTTP is checked against it.
 * Without this the published document would only be as true as the decorator
 * that named it; with it, a handler that quietly starts returning a different
 * shape fails the suite.
 *
 * The document is read from the committed artifact rather than from a running
 * `/docs`, so the assertion is against what the repository promises a client,
 * which is the copy a frontend vendors.
 */

const ARTIFACT = join(
  __dirname,
  '..',
  '..',
  '..',
  'luna-shopper-backend',
  'gateway',
  'docs',
  'openapi.json'
);

interface OpenApiDocument {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { schema?: { $ref?: string } }> }
        >;
      }
    >
  >;
  components: { schemas: Record<string, unknown> };
}

const document = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as OpenApiDocument;

const DOCUMENT_ID = 'luna://openapi';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({
  $id: DOCUMENT_ID,
  components: { schemas: document.components.schemas },
});

/** The component a route's success response is documented with. */
function documentedSchemaRef(
  method: string,
  path: string,
  status: number
): string {
  const operation = document.paths[path]?.[method.toLowerCase()];
  if (!operation) {
    throw new Error(
      `The published API documents no ${method.toUpperCase()} ${path}. If the route moved, the artifact is stale: regenerate it with \`nx run luna-shopper-backend-gateway:openapi\`.`
    );
  }
  const ref =
    operation.responses[String(status)]?.content?.['application/json']?.schema
      ?.$ref;
  if (!ref) {
    throw new Error(
      `${method.toUpperCase()} ${path} documents no ${status} response body.`
    );
  }
  return ref.replace('#/components/schemas/', '');
}

/**
 * Fails with the Ajv errors when `body` is not what the docs promise for this
 * route. `path` is the OpenAPI path template (`/v1/lists/{id}/lines`), not the
 * concrete URL, because that is how the document keys its operations.
 */
export function expectDocumentedShape(
  method: string,
  path: string,
  status: number,
  body: unknown
): void {
  const name = documentedSchemaRef(method, path, status);
  const validate = ajv.getSchema(
    `${DOCUMENT_ID}#/components/schemas/${name}`
  ) as ValidateFunction | undefined;
  if (!validate) {
    throw new Error(`The published API has no component named ${name}`);
  }
  if (validate(body) !== true) {
    expect(
      validate.errors,
      `${method.toUpperCase()} ${path} answered ${status} with a body that does not match the published ${name} schema`
    ).toEqual([]);
  }
}
