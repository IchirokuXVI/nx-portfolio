import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export interface SwaggerOptions {
  title: string;
  description: string;
  /** Path the docs are served at, e.g. `docs`. */
  path?: string;
  /**
   * OpenAPI version the document declares. Defaults to 3.1.0, which is a superset
   * of JSON Schema 2020-12 and therefore renders the contract schemas (plan 0019)
   * as they are authored, nullable unions included.
   */
  openApiVersion?: string;
  /**
   * Schemas to publish under `components.schemas` alongside the ones Swagger
   * reflects off DTO classes. This is how the response side of the API is
   * documented from the JSON Schemas that already describe it, with no hand
   * written response DTO class in between (plan 0019, section 2).
   */
  extraSchemas?: Record<string, unknown>;
}

/**
 * Swagger for the gateway's public API (plan 0004, section 5).
 *
 * Bearer auth is described so the docs are usable against a live token. Because
 * controllers are independently versioned (section 4), the versioned path is part
 * of each operation's URL and the document lists every version's endpoints; DTO
 * decorators (added with each feature controller) complete the request shapes,
 * and `extraSchemas` plus the gateway's contract response decorators complete the
 * response ones. Internal services may expose their own docs for their
 * health/debug surface, but the canonical public docs live here.
 */
export function buildSwaggerDocument(
  app: INestApplication,
  options: SwaggerOptions
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion('1.0')
    .setOpenAPIVersion(options.openApiVersion ?? '3.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token'
    )
    // A second scheme, not a second name for the first (plan 0071, section 3).
    // Operator tokens are signed with their own keypair and carry their own
    // audience, so a reader of the docs who pastes a velista token into an admin
    // route should be told which credential the route wants rather than left to
    // discover that both say "bearer" and only one works.
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'admin-token'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const extra = options.extraSchemas;
  if (extra && Object.keys(extra).length > 0) {
    const components = (document.components ??= {});
    components.schemas = {
      ...components.schemas,
      ...(extra as NonNullable<typeof components.schemas>),
    };
  }

  return document;
}

/** Builds the document and serves it (and its JSON) at `options.path`. */
export function setupSwagger(
  app: INestApplication,
  options: SwaggerOptions
): void {
  const document = buildSwaggerDocument(app, options);
  SwaggerModule.setup(options.path ?? 'docs', app, document);
}
