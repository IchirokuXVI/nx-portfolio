import {
  ADMIN_DASHBOARD_SCHEMA_IDS,
  allSchemas,
  AUTH_SCHEMA_IDS,
  STATS_SCHEMA_IDS,
} from '@portfolio/luna-shopper/contracts';
import {
  PROBLEM_DETAILS_SCHEMA,
  PROBLEM_DETAILS_SCHEMA_NAME,
} from '@portfolio/luna-shopper/platform';

/**
 * The bridge from the contract JSON Schemas to OpenAPI components (plan 0019,
 * section 2).
 *
 * The documentation is a projection of the contract rather than a copy of it:
 * nothing here describes a payload, it only re-points the `$ref`s of schemas
 * `libs/luna-shopper/contracts/src/schemas` already defines and Ajv already
 * validates. A response shape therefore cannot drift from its documentation,
 * because they are the same object, and the completeness spec that guards the
 * schemas transitively guards the docs.
 */

/** Where OpenAPI expects a component reference to point. */
const COMPONENT_REF_PREFIX = '#/components/schemas/';

/**
 * Turns a `luna://zone/ZoneView` id into the `zone.ZoneView` component name.
 * Slashes are the only illegal character in the ids we mint, and a dot keeps the
 * grouping readable in the Swagger UI's schema list.
 */
export function componentNameFor(schemaId: string): string {
  return schemaId.replace(/^luna:\/\//, '').replace(/\//g, '.');
}

/** A component reference for a contract schema id, ready to drop into a schema. */
export const componentRef = (name: string): { $ref: string } => ({
  $ref: `${COMPONENT_REF_PREFIX}${name}`,
});

const byId = new Map<string, Record<string, unknown>>(
  allSchemas.map((schema) => [
    String(schema['$id']),
    schema as Record<string, unknown>,
  ])
);

/**
 * Deep copies a schema, dropping `$id` (the component key carries the name now)
 * and rewriting every internal `luna://` `$ref` into a component reference. Each
 * id it rewrites is reported so the caller can hoist that subschema too.
 *
 * OpenAPI 3.1 is a superset of JSON Schema 2020-12, so everything else — the
 * nullable `type: ['string', 'null']` unions, `enum`, `format`, `additionalProperties`
 * — passes through untouched and means exactly what it meant to Ajv.
 */
function rewriteRefs(node: unknown, onRef: (id: string) => void): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => rewriteRefs(entry, onRef));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$id') {
      continue;
    }
    if (key === '$ref' && typeof value === 'string') {
      onRef(value);
      out.$ref = `${COMPONENT_REF_PREFIX}${componentNameFor(value)}`;
      continue;
    }
    out[key] = rewriteRefs(value, onRef);
  }
  return out;
}

/** Converts one registry entry into the OpenAPI schema object Swagger accepts. */
export function toOpenApiSchema(
  jsonSchema: Record<string, unknown>
): Record<string, unknown> {
  return rewriteRefs(jsonSchema, () => undefined) as Record<string, unknown>;
}

const components = new Map<string, Record<string, unknown>>();

/** Publishes a schema this module composed itself (an envelope, the problem body). */
export function registerComponent(
  name: string,
  schema: Record<string, unknown>
): string {
  components.set(name, schema);
  return name;
}

/**
 * Publishes a contract schema and, transitively, everything it references, so
 * every rewritten `$ref` resolves in the finished document.
 *
 * An unknown id throws at decoration time, which is process startup: a pattern
 * with no response schema is a boot failure rather than a silently undocumented
 * endpoint. The contracts completeness spec makes that state unreachable; this
 * exists to keep it unreachable.
 */
export function hoistContractSchema(schemaId: string): string {
  const name = componentNameFor(schemaId);
  if (components.has(name)) {
    return name;
  }
  const source = byId.get(schemaId);
  if (!source) {
    throw new Error(
      `No contract schema registered for ${schemaId}; cannot document a response that the contracts library does not describe.`
    );
  }
  // Claim the name before recursing so a self referential schema terminates.
  components.set(name, {});
  const referenced: string[] = [];
  components.set(
    name,
    rewriteRefs(source, (id) => referenced.push(id)) as Record<string, unknown>
  );
  for (const id of referenced) {
    hoistContractSchema(id);
  }
  return name;
}

/**
 * Publishes the `{ tokens?, data }` envelope `POST /v1/zones` and
 * `POST /v1/zones/join` return (plan 0019, section 4).
 *
 * This wrapper is load bearing and, until now, invisible: a client that assumes
 * the zone is the response body rather than `data` fails immediately, and the
 * optional `tokens` is how an anonymous caller receives an identity at all. It
 * is composed here rather than authored in the contracts library because it is a
 * gateway HTTP shape, not a broker message.
 */
export function hoistTokenHandshake(schemaId: string): string {
  const data = hoistContractSchema(schemaId);
  const tokens = hoistContractSchema(AUTH_SCHEMA_IDS.authTokens);
  const name = `${data}.WithMaybeToken`;
  return registerComponent(name, {
    type: 'object',
    description:
      'The result, plus the identity minted for the caller. `tokens` is present only when the request arrived without an `Authorization` header: the endpoint created a temporary user to own the operation, and these are the only credentials that will ever be issued for it. An authenticated caller gets `data` alone.',
    required: ['data'],
    additionalProperties: false,
    properties: {
      tokens: {
        ...componentRef(tokens),
        description: 'Present only when the caller was anonymous.',
      },
      data: componentRef(data),
    },
  });
}

/**
 * Publishes the body of `GET /v1/stats` (plan 0017, section 8.2).
 *
 * Composed here for the same reason the handshake envelope is: no broker message
 * has this shape. The gateway fans out to `stats.identity` and `stats.core` and
 * assembles the answer, so the two blocks are the contract schemas those subjects
 * already define, and only the composition around them is authored here. Either
 * block is `null` when its service did not answer, which is the whole point of
 * the endpoint degrading rather than failing.
 */
export function hoistPlatformStats(): string {
  const identity = hoistContractSchema(STATS_SCHEMA_IDS.identityStats);
  const core = hoistContractSchema(STATS_SCHEMA_IDS.coreStats);
  return registerComponent('stats.PlatformStatsResponse', {
    type: 'object',
    description:
      'Platform totals. Either block is `null` when that service did not answer: a broken service degrades the figure rather than taking down the public page.',
    required: ['identity', 'core', 'measuredAt'],
    additionalProperties: false,
    properties: {
      identity: {
        oneOf: [componentRef(identity), { type: 'null' }],
        description: 'Identity totals, from auth.',
      },
      core: {
        oneOf: [componentRef(core), { type: 'null' }],
        description: 'Zone totals, from core.',
      },
      measuredAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When the snapshot was taken, so the 60 second cache is visible rather than hidden.',
      },
    },
  });
}

/**
 * Publishes the body of the unauthenticated `GET /v1/admin/environment`
 * (`apps/luna-shopper-admin/plans/0001`, section 6).
 *
 * Composed here rather than authored in the contracts library for the reason the
 * two above are: no broker message has this shape. The gateway answers it from its
 * own configuration and asks no service anything.
 *
 * `environment` is a plain string rather than an enum, which is deliberate and
 * matches `admin-auth.AdminMeView`: `ENVIRONMENT_NAME` is a free value, so a
 * deployment may report a name nobody has thought of yet. The back office maps what
 * it receives into its own three names and renders anything else as "unknown"
 * rather than colouring itself from a value it does not understand, so documenting
 * a closed set here would be a promise the configuration does not keep.
 */
export function hoistAdminEnvironment(): string {
  return registerComponent('admin.AdminEnvironmentResponse', {
    type: 'object',
    description:
      'Which deployment answered. Readable with no token, so the back office can draw its per environment accent colour before anybody has signed in.',
    required: ['environment', 'devAutologin'],
    additionalProperties: false,
    properties: {
      environment: {
        type: 'string',
        description:
          'The name this deployment reports itself by, from `ENVIRONMENT_NAME`. Conventionally `production`, `staging` or `development`, but not constrained to them.',
      },
      devAutologin: {
        type: 'boolean',
        description:
          'Whether this deployment will issue an admin token without a password, from `ADMIN_DEV_AUTOLOGIN`. The back office asks rather than deciding for itself that it is in development, so the decision to skip the login screen is the server’s. False everywhere it would matter: auth refuses to boot with the switch on against a non local database.',
      },
    },
  });
}

/**
 * Publishes the body of `GET /v1/admin/dashboard` (plan 0088, section 5).
 *
 * Composed here for the reason `hoistPlatformStats` is: no broker message has
 * this shape. The four blocks are the contract schemas the four subjects already
 * define, and only the composition around them is authored in the gateway.
 *
 * Each block is `oneOf` its schema and `null`, which is the endpoint degrading
 * rather than failing: a harvester that is not deployed costs the harvest block
 * and nothing else. A count inside a block is never null, so a screen can tell
 * "did not answer" from "answered zero".
 */
export function hoistAdminDashboard(): string {
  const window = hoistContractSchema(ADMIN_DASHBOARD_SCHEMA_IDS.window);
  const identity = hoistContractSchema(
    ADMIN_DASHBOARD_SCHEMA_IDS.identityDashboard
  );
  const core = hoistContractSchema(ADMIN_DASHBOARD_SCHEMA_IDS.coreDashboard);
  const catalog = hoistContractSchema(
    ADMIN_DASHBOARD_SCHEMA_IDS.catalogDashboard
  );
  const harvest = hoistContractSchema(
    ADMIN_DASHBOARD_SCHEMA_IDS.harvestDashboard
  );
  const activity = hoistContractSchema(
    ADMIN_DASHBOARD_SCHEMA_IDS.dashboardActivityEntry
  );

  return registerComponent('admin.AdminDashboardResponse', {
    type: 'object',
    description:
      'What the back office opens to. Each block is `null` when that service did not answer, and the response is still 200: one stopped service costs its own block rather than the whole page.',
    required: [
      'window',
      'identity',
      'core',
      'catalog',
      'harvest',
      'activity',
      'measuredAt',
    ],
    additionalProperties: false,
    properties: {
      window: {
        ...componentRef(window),
        description:
          'The days every daily series covers, stated by the gateway so four services fill the same window.',
      },
      identity: {
        oneOf: [componentRef(identity), { type: 'null' }],
        description: 'Users, admins and failed operator logins, from auth.',
      },
      core: {
        oneOf: [componentRef(core), { type: 'null' }],
        description: 'Zones, memberships, lists and baskets, from core.',
      },
      catalog: {
        oneOf: [componentRef(catalog), { type: 'null' }],
        description: 'The catalog totals and the prices written, from catalog.',
      },
      harvest: {
        oneOf: [componentRef(harvest), { type: 'null' }],
        description:
          'Runs, the run in flight and the per chain queues, from the harvester.',
      },
      activity: {
        type: 'array',
        items: componentRef(activity),
        description:
          'The three audit trails merged, newest first, at most twenty, each actor named.',
      },
      measuredAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When the numbers were taken, so a tab opened yesterday is not read as now.',
      },
    },
  });
}

/** Publishes the shared RFC 7807 error body. */
export function hoistProblemDetails(): string {
  return registerComponent(
    PROBLEM_DETAILS_SCHEMA_NAME,
    PROBLEM_DETAILS_SCHEMA as unknown as Record<string, unknown>
  );
}

/**
 * Every component the decorators hoisted, sorted by name.
 *
 * The sort is what makes the committed `docs/openapi.json` a reviewable diff:
 * without it the order would follow whichever controller a module loaded first,
 * and an unrelated import change would rewrite the whole file.
 */
export function openApiComponents(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    [...components.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
}
