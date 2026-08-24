import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export interface SwaggerOptions {
  title: string;
  description: string;
  /** Path the docs are served at, e.g. `docs`. */
  path?: string;
}

/**
 * Swagger for the gateway's public API (plan 0004, section 5).
 *
 * Bearer auth is described so the docs are usable against a live token. Because
 * controllers are independently versioned (section 4), the versioned path is part
 * of each operation's URL and the document lists every version's endpoints; DTO
 * decorators (added with each feature controller) complete the request/response
 * shapes. Internal services may expose their own docs for their health/debug
 * surface, but the canonical public docs live here.
 */
export function setupSwagger(
  app: INestApplication,
  options: SwaggerOptions
): void {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(options.path ?? 'docs', app, document);
}
