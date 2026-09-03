import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import {
  bootstrapPlatform,
  ERROR_CODES,
  ERROR_STATUS,
  PROBLEM_DETAILS_SCHEMA_NAME,
  PROBLEM_JSON_CONTENT_TYPE,
} from '@portfolio/luna-shopper/platform';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGatewayOpenApiDocument,
  OPENAPI_ARTIFACT_PATH,
  serializeOpenApiDocument,
} from './openapi-document';

/**
 * The generation spec (plan 0019, section 5).
 *
 * The value of the plan is entirely in whether the documentation matches
 * reality, so this is the deliverable rather than a formality. It builds the real
 * document off the real `AppModule` — every controller, in the versioned paths
 * the gateway actually serves — and asserts that each route says what it returns.
 * Adding a controller and forgetting the decorator fails here.
 *
 * It also owns the committed artifact: run
 * `nx run luna-shopper-backend-gateway:openapi` to rewrite
 * `docs/openapi.json`, and every other run fails when the file on disk no longer
 * matches what the code produces. That is the CI staleness check, riding the test
 * target the pull request workflow already runs.
 */

/**
 * `AppModule` validates the environment as it is imported (`ConfigModule.forRoot`
 * runs inside the `@Module` decorator), so the two required variables are stubbed
 * before the module is loaded, and the module is therefore loaded on demand
 * rather than at the top of the file. Nothing here reaches a broker or a
 * database: the document is built from controller metadata, and no lifecycle
 * hook runs.
 */
async function loadAppModule(): Promise<new () => unknown> {
  process.env.NATS_URL ??= 'nats://localhost:4222';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.AUTH_JWT_PUBLIC_KEY ??= 'documentation-only-public-key';
  // The second trust root (plan 0071, section 3). Required like the first, so the
  // module refuses to load without it, and stubbed here for the same reason: this
  // builds a document from controller metadata and verifies nothing.
  process.env.ADMIN_JWT_PUBLIC_KEY ??= 'documentation-only-admin-public-key';
  const { AppModule } = await import('../app.module');
  return AppModule as unknown as new () => unknown;
}

/** The statuses Nest answers with when a handler carries no `@HttpCode`. */
const DEFAULT_SUCCESS_STATUS: Record<string, string> = {
  get: '200',
  post: '201',
  put: '200',
  patch: '200',
  delete: '200',
};

const HTTP_METHODS = Object.keys(DEFAULT_SUCCESS_STATUS);

interface Operation {
  method: string;
  path: string;
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

function operationsOf(document: OpenAPIObject): Operation[] {
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, unknown>)[method];
      if (operation) {
        operations.push({
          method,
          path,
          responses:
            (operation as { responses?: Operation['responses'] }).responses ??
            {},
        });
      }
    }
  }
  return operations;
}

const isSuccess = (status: string) => status.startsWith('2');
const isRedirect = (status: string) => status.startsWith('3');

/**
 * The routes whose success body is bytes rather than a contract shape.
 *
 * There is one (plan 0045, section 5), and it is listed by name for the same
 * reason the two Google redirects are: a rule that let *any* route opt out of
 * documenting its response would be a rule that stops catching the mistake it
 * exists for, which is a controller added without `@ApiContractResponse`.
 *
 * A comment's recording has no JSON to describe. It is documented with an
 * `audio/*` content entry instead, which the assertion below checks is really
 * there rather than taking the exemption on trust.
 */
const BYTE_BODY_ROUTES = ['GET /v1/comments/{id}/audio'];

const routeOf = (operation: Operation) =>
  `${operation.method.toUpperCase()} ${operation.path}`;

const answersBytes = (operation: Operation) =>
  BYTE_BODY_ROUTES.includes(routeOf(operation));

/** The schema a response body is documented with, if it has one. */
function schemaOf(response: Operation['responses'][string]): unknown {
  const content = response.content ?? {};
  return content['application/json']?.schema;
}

/** Collects every `#/components/schemas/...` name a value references. */
function refsIn(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((entry) => refsIn(entry, found));
    return found;
  }
  if (node === null || typeof node !== 'object') {
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      found.push(value.replace('#/components/schemas/', ''));
    } else {
      refsIn(value, found);
    }
  }
  return found;
}

describe('gateway OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let operations: Operation[];
  let schemas: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [await loadAppModule()],
    }).compile();
    app = moduleRef.createNestApplication();
    // The same call `main.ts` makes, so the generated paths carry the `/v1`
    // prefix the server actually serves and the artifact cannot describe a
    // different URL space than the running gateway.
    bootstrapPlatform(app, { versioning: true });
    document = buildGatewayOpenApiDocument(app);
    operations = operationsOf(document);
    schemas = (document.components?.schemas ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('builds, and declares OpenAPI 3.1', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(operations.length).toBeGreaterThan(40);
  });

  it('leaves the Kubernetes health probes out of the public API', () => {
    expect(
      operations.filter((operation) => operation.path.startsWith('/health'))
    ).toEqual([]);
  });

  describe('every route documents what it returns', () => {
    it('with exactly one success or redirect status', () => {
      const wrong = operations
        .map((operation) => ({
          route: `${operation.method.toUpperCase()} ${operation.path}`,
          statuses: Object.keys(operation.responses).filter(
            (status) => isSuccess(status) || isRedirect(status)
          ),
        }))
        .filter((entry) => entry.statuses.length !== 1);
      expect(wrong).toEqual([]);
    });

    it('at the status Nest actually answers with', () => {
      const wrong = operations
        .map((operation) => {
          const documented = Object.keys(operation.responses).find(isSuccess);
          return {
            route: `${operation.method.toUpperCase()} ${operation.path}`,
            documented,
            expected: DEFAULT_SUCCESS_STATUS[operation.method],
          };
        })
        // A redirect route documents no 2xx at all; it is checked below.
        .filter((entry) => entry.documented !== undefined)
        .filter((entry) => entry.documented !== entry.expected);
      expect(wrong).toEqual([]);
    });

    it('with a non empty schema resolved from the contracts library', () => {
      const undocumented = operations
        .filter(
          (operation) => !Object.keys(operation.responses).some(isRedirect)
        )
        .filter((operation) => !answersBytes(operation))
        .map((operation) => {
          const status = Object.keys(operation.responses).find(isSuccess);
          const schema = status
            ? schemaOf(operation.responses[status])
            : undefined;
          const [name] = refsIn(schema);
          return {
            route: `${operation.method.toUpperCase()} ${operation.path}`,
            component: name,
            resolved:
              name !== undefined && Object.keys(schemas[name] ?? {}).length > 0,
          };
        })
        .filter((entry) => !entry.resolved);
      expect(undocumented).toEqual([]);
    });

    it('and the one route answering bytes says so, and is the only one', () => {
      // The exemption above is only honest if the route it exempts documents
      // *something*. This asserts the audio route really carries an `audio/*`
      // content entry with a binary schema, and that nothing else has quietly
      // grown a non JSON body without being named in `BYTE_BODY_ROUTES`.
      const byteRoutes = operations.filter(answersBytes).map((operation) => {
        const status = Object.keys(operation.responses).find(isSuccess);
        const content = status
          ? (operation.responses[status].content ?? {})
          : {};
        return { route: routeOf(operation), types: Object.keys(content) };
      });

      expect(byteRoutes).toEqual([
        { route: 'GET /v1/comments/{id}/audio', types: ['audio/*'] },
      ]);
    });

    it('and the only routes without a body are the two Google redirects', () => {
      // Both ends of the OAuth round trip, and neither has a payload to describe:
      // one hands the browser to Google, the other hands it back to the app with
      // the token pair in the URL fragment (plan 0023, section 6). The callback
      // used to document `auth.googleLogin` here, which described a body the
      // client never sees.
      const redirects = operations
        .filter((operation) =>
          Object.keys(operation.responses).some(isRedirect)
        )
        .map(
          (operation) => `${operation.method.toUpperCase()} ${operation.path}`
        );
      expect(redirects).toEqual([
        'GET /v1/auth/google',
        'GET /v1/auth/google/callback',
      ]);
    });
  });

  describe('errors are documented from the error catalog', () => {
    it('every route can answer with the problem envelope', () => {
      const missing = operations
        .filter(
          (operation) =>
            !operation.responses[String(ERROR_STATUS[ERROR_CODES.INTERNAL])]
        )
        .map(
          (operation) => `${operation.method.toUpperCase()} ${operation.path}`
        );
      expect(missing).toEqual([]);
    });

    it('as `application/problem+json`, never a bare JSON body', () => {
      const wrong = operations.flatMap((operation) =>
        Object.entries(operation.responses)
          .filter(
            ([status]) => status.startsWith('4') || status.startsWith('5')
          )
          .filter(
            ([, response]) =>
              !(response.content ?? {})[PROBLEM_JSON_CONTENT_TYPE]
          )
          .map(([status]) => `${operation.method} ${operation.path} ${status}`)
      );
      expect(wrong).toEqual([]);
    });

    it('with the envelope published once and its codes taken from ERROR_CODES', () => {
      const problem = schemas[PROBLEM_DETAILS_SCHEMA_NAME];
      expect(problem).toBeDefined();
      const code = (
        problem['properties'] as Record<string, { enum: string[] }>
      )['code'];
      expect(code.enum).toEqual(Object.values(ERROR_CODES));
    });

    it('a guarded route documents 401, an open one does not', () => {
      const unauthorized = String(ERROR_STATUS[ERROR_CODES.UNAUTHORIZED]);
      const byRoute = (method: string, path: string) =>
        operations.find(
          (operation) => operation.method === method && operation.path === path
        );
      expect(
        byRoute('get', '/v1/zones')?.responses[unauthorized]
      ).toBeDefined();
      // Genuinely open: no guard, and nothing to present a token to. `POST /v1/zones`
      // is not the example it once was — a caller who sends an `Authorization` header
      // there is claiming an identity, and a token that is expired, malformed, or
      // names an account that no longer exists is refused with a 401 rather than
      // treated as anonymous (plan 0020, and `asRejectedCredentials`).
      expect(
        byRoute('get', '/v1/zones/by-code/{code}')?.responses[unauthorized]
      ).toBeUndefined();
      expect(
        byRoute('post', '/v1/zones')?.responses[unauthorized]
      ).toBeDefined();
    });

    it('a route with @SkipThrottle does not claim it can rate limit', () => {
      const rateLimited = String(ERROR_STATUS[ERROR_CODES.RATE_LIMITED]);
      const refresh = operations.find(
        (operation) => operation.path === '/v1/auth/refresh'
      );
      expect(refresh?.responses[rateLimited]).toBeUndefined();
    });
  });

  describe('the wrappers a client is most likely to get wrong', () => {
    it('documents `{ tokens?, data }` on the zone handshake routes', () => {
      const create = operations.find(
        (operation) =>
          operation.method === 'post' && operation.path === '/v1/zones'
      );
      expect(create).toBeDefined();
      const [name] = refsIn(schemaOf((create as Operation).responses['201']));
      const envelope = schemas[name];
      expect(Object.keys(envelope['properties'] as object).sort()).toEqual([
        'data',
        'tokens',
      ]);
      expect(envelope['required']).toEqual(['data']);
      // Section 4: the envelope must say *when* `tokens` is there, since that is
      // the whole of how an anonymous caller receives an identity.
      const tokens = (
        envelope['properties'] as Record<string, Record<string, unknown>>
      )['tokens'];
      expect(String(tokens['description'])).toContain('anonymous');
    });

    it('renders a page as a typed `items` array, not an opaque blob', () => {
      const page = schemas['zone.ZonePage'];
      const items = (
        page['properties'] as Record<string, Record<string, unknown>>
      )['items'];
      expect(items['type']).toBe('array');
      expect(refsIn(items['items'])).toEqual(['zone.MyZoneView']);
      expect(String(page['description'])).toContain('nextCursor');
    });
  });

  it('resolves every reference it publishes', () => {
    const dangling = [
      ...refsIn(document.paths),
      ...refsIn(document.components?.schemas),
    ].filter((name) => schemas[name] === undefined);
    expect([...new Set(dangling)]).toEqual([]);
  });

  it('matches the committed artifact', () => {
    const artifact = join(__dirname, '..', '..', '..', 'docs', 'openapi.json');
    const serialized = serializeOpenApiDocument(document);

    if (process.env.LUNA_WRITE_OPENAPI === '1') {
      writeFileSync(artifact, serialized, 'utf8');
      return;
    }

    expect(existsSync(artifact)).toBe(true);
    const committed = readFileSync(artifact, 'utf8');
    if (committed !== serialized) {
      throw new Error(
        `${OPENAPI_ARTIFACT_PATH} is stale. A response shape changed; regenerate it with ` +
          '`npx nx run luna-shopper-backend-gateway:openapi` and commit the diff.'
      );
    }
  });
});
