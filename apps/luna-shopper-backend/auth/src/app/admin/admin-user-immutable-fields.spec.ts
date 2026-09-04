import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_USER_PATTERNS,
  ADMIN_USERS_SCHEMA_IDS,
  allSchemas,
  messageContracts,
  validateMessageRequest,
} from '@portfolio/luna-shopper/contracts';
import 'reflect-metadata';
import { AdminController } from './admin.controller';

/**
 * The two lists plan 0077 makes permanent, asserted rather than reviewed.
 *
 * Section 6 is a list of decisions, and every one of them is a column that exists
 * and must not be typed into. A comment saying so survives exactly as long as the
 * next author who reads it, so both halves are checked here against the artifacts
 * a route is actually built from: the contract schema a request is validated
 * against, and the pattern table the controller answers on.
 *
 * **Asserted against the schema, not against a hand written list of fields.** A
 * spec that restated the allowed fields would pass for a request shape that had
 * quietly grown a sixth one, which is the version of this that happens.
 */

/** Nest stores `@MessagePattern` values under this key on the handler. */
const PATTERN_METADATA = 'microservices:pattern';

/** Every subject the admin controller answers, read off its own handlers. */
function controllerPatterns(): string[] {
  const prototype = AdminController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const declared = Reflect.getMetadata(
        PATTERN_METADATA,
        prototype[name] as object
      );
      return (Array.isArray(declared) ? declared : [declared]).filter(
        (pattern): pattern is string => typeof pattern === 'string'
      );
    });
}

function schemaFor(id: string): {
  properties: Record<string, unknown>;
  additionalProperties: boolean;
} {
  const schema = allSchemas.find((candidate) => candidate['$id'] === id);
  if (!schema) {
    throw new Error(`No schema registered for id ${id}`);
  }
  return schema as never;
}

describe('no route accepts a user field section 6 fixed', () => {
  /**
   * The three columns of plan 0077 sections 6.1 and 6.2. Changing an address
   * leaves the credential, the linked providers, the outstanding verifications
   * and every live refresh token pointing at an address the account no longer
   * claims; setting `emailVerifiedAt` asserts the one thing an operator cannot
   * observe; and flipping `kind` produces a registered account with no way to
   * sign in.
   */
  const FIXED = ['email', 'emailVerifiedAt', 'kind'];

  /**
   * The subjects that write. `adminUser.list` takes `kind` and must keep it: it
   * is a filter over a column an operator may read, which is the opposite of the
   * thing being forbidden here.
   */
  const WRITES = [
    ADMIN_USER_PATTERNS.update,
    ADMIN_USER_PATTERNS.delete,
    ADMIN_USER_PATTERNS.resendVerification,
  ];

  it.each(WRITES)('%s names none of them', (subject) => {
    const { properties } = schemaFor(messageContracts[subject].request);

    expect(Object.keys(properties)).toEqual(expect.not.arrayContaining(FIXED));
  });

  it('rejects a payload that carries one anyway', () => {
    const request = {
      userId: 'a1',
      adminToken: 't',
      targetUserId: 'u1',
      username: 'Vela Rápida',
    };

    expect(
      validateMessageRequest(ADMIN_USER_PATTERNS.update, request).valid
    ).toBe(true);

    // Not merely undeclared: the schema closes the object, so a gateway that
    // forwarded an extra field would be refused rather than quietly ignored.
    for (const field of FIXED) {
      const { valid } = validateMessageRequest(ADMIN_USER_PATTERNS.update, {
        ...request,
        [field]: field === 'kind' ? 'REGISTERED' : 'somebody@else.com',
      });
      expect(valid).toBe(false);
    }
  });

  it('closes the update request, so a new field has to be declared here', () => {
    const { additionalProperties } = schemaFor(
      ADMIN_USERS_SCHEMA_IDS.updateRequest
    );

    expect(additionalProperties).toBe(false);
  });
});

describe('an admin can be seen and cannot be changed', () => {
  /**
   * Plan 0071 section 6, kept by plan 0077 section 6.3, and the one entry on that
   * list that is not a "not yet". A back office that can make back office
   * accounts is a back office where one compromised session is permanent, so
   * managing an admin requires the server.
   *
   * The allowed set is written out rather than matched by a verb, so adding any
   * new `adminAuth` subject fails here and has to be justified rather than
   * merely named carefully.
   */
  const ALLOWED = [
    ADMIN_AUTH_PATTERNS.login,
    ADMIN_AUTH_PATTERNS.refresh,
    ADMIN_AUTH_PATTERNS.getAdmin,
    ADMIN_AUTH_PATTERNS.listAdmins,
    ADMIN_AUTH_PATTERNS.devAutologin,
  ];

  it('answers only sign in and read subjects about an admin', () => {
    const admin = controllerPatterns().filter((pattern) =>
      pattern.startsWith('adminAuth.')
    );

    expect(admin.sort()).toEqual([...ALLOWED].sort());
  });

  it('declares no subject that would create, change or remove one', () => {
    expect(Object.values(ADMIN_AUTH_PATTERNS)).toEqual(
      expect.not.arrayContaining([
        'adminAuth.create',
        'adminAuth.update',
        'adminAuth.delete',
        'adminAuth.disable',
      ])
    );
    for (const pattern of Object.values(ADMIN_AUTH_PATTERNS)) {
      expect(pattern).not.toMatch(/create|update|delete|disable|remove/i);
    }
  });

  it('reaches every subject the controller answers, so the check is not partial', () => {
    // The guard on the two assertions above: a controller whose handlers stopped
    // being readable through metadata would make both of them vacuously true.
    const patterns = controllerPatterns();

    expect(patterns).toContain(ADMIN_USER_PATTERNS.update);
    expect(patterns).toEqual(
      expect.arrayContaining([
        ...Object.values(ADMIN_AUTH_PATTERNS),
        ...Object.values(ADMIN_USER_PATTERNS),
      ])
    );
  });
});
