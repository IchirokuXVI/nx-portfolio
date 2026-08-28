import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  buildSwaggerDocument,
  type SwaggerOptions,
} from '@portfolio/luna-shopper/platform';
import { openApiComponents } from './openapi-schema';

/**
 * One definition of the gateway's OpenAPI document, shared by the three places
 * that need it: the live `/docs` endpoint, the Nx target that writes the
 * committed `docs/openapi.json`, and the specs that assert the two agree
 * (plan 0019, section 5).
 *
 * `extraSchemas` is resolved lazily, at call time rather than at import time,
 * because the components are hoisted by the response decorators as the
 * controller classes are defined. Reading them earlier would publish an empty
 * map and leave every `$ref` dangling.
 */
export const GATEWAY_DOCS_PATH = 'docs';

export function gatewaySwaggerOptions(): SwaggerOptions {
  return {
    title: 'Luna Shopper API',
    description:
      'Public API for the Luna Shopper shared shopping lists. Response schemas are projected from the same JSON Schemas the services validate their broker messages against, so what is documented here is what the wire carries.',
    path: GATEWAY_DOCS_PATH,
    extraSchemas: openApiComponents(),
  };
}

/** Builds the document a running gateway would serve at `/docs`. */
export function buildGatewayOpenApiDocument(
  app: INestApplication
): OpenAPIObject {
  return buildSwaggerDocument(app, gatewaySwaggerOptions());
}

/** Where the committed artifact lives, relative to the workspace root. */
export const OPENAPI_ARTIFACT_PATH =
  'apps/luna-shopper-backend/gateway/docs/openapi.json';

/** The exact bytes the artifact is written with, so a diff means a real change. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
