import { GUARDS_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminBasketsController,
  AdminListsController,
  AdminZonesController,
} from './admin-core.controller';
import {
  AdminAdminsController,
  AdminUsersController,
} from './admin-directory.controller';
import { AdminJwtGuard } from './admin-jwt.guard';

/**
 * The operator can change a row, through the service that owns it (plan 0077).
 *
 * Read off the **committed OpenAPI document**, which `openapi-document.spec.ts`
 * already proves is what the controllers produce, plus the controller metadata,
 * which is the only place a guard exists. Between them they answer the two
 * questions this plan makes worth asking of the route table: is every write the
 * plan describes reachable, and is every field the plan fixes unreachable.
 *
 * The expected routes are written out rather than derived from the controllers. A
 * test that computed them would pass wherever the controllers happened to put
 * them, and half of this plan is about which writes exist.
 */

const document = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'openapi.json'),
    'utf8'
  )
) as {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<
      string,
      { properties?: Record<string, unknown>; required?: string[] }
    >;
  };
};

function operation(method: string, path: string): unknown {
  return document.paths[path]?.[method];
}

function guardsOf(controller: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
}

function propertiesOf(schema: string): string[] {
  const found = document.components.schemas[schema];
  if (!found) {
    throw new Error(`No schema named ${schema} in the committed document`);
  }
  return Object.keys(found.properties ?? {});
}

/** Section 9, verbatim. Sixteen routes, and these are they. */
const ADDED: ReadonlyArray<readonly [string, string]> = [
  ['patch', '/v1/admin/users/{id}'],
  ['patch', '/v1/admin/zones/{id}'],
  ['post', '/v1/admin/zones/{id}/deletion-mark'],
  ['delete', '/v1/admin/zones/{id}/deletion-mark'],
  ['get', '/v1/admin/zones/{id}/members'],
  ['get', '/v1/admin/zones/{id}/members/{membershipId}'],
  ['patch', '/v1/admin/zones/{id}/members/{membershipId}'],
  ['post', '/v1/admin/zones/{id}/members/{membershipId}/approve'],
  ['post', '/v1/admin/zones/{id}/members/{membershipId}/reject'],
  ['patch', '/v1/admin/lists/{id}'],
  ['delete', '/v1/admin/lists/{id}'],
  ['get', '/v1/admin/lists/{id}/lines'],
  ['get', '/v1/admin/lists/{id}/lines/{lineId}'],
  ['patch', '/v1/admin/lists/{id}/lines/{lineId}'],
  ['post', '/v1/admin/lists/{id}/lines/{lineId}/approval'],
  ['delete', '/v1/admin/lists/{id}/lines/{lineId}'],
];

describe('an operator can change a row (plan 0077)', () => {
  describe('the routes exist, and they are under the admin namespace', () => {
    it.each(ADDED)('%s %s', (method, path) => {
      expect(operation(method, path)).toBeDefined();
    });

    it('puts every one of them under /v1/admin', () => {
      for (const [, path] of ADDED) {
        expect(path.startsWith('/v1/admin/')).toBe(true);
      }
    });
  });

  describe('every one of them is behind the operator guard', () => {
    // The guard is on the controller, so asserting it per controller asserts it
    // for every route the controller carries, including any added later.
    it.each([
      ['AdminUsersController', AdminUsersController],
      ['AdminZonesController', AdminZonesController],
      ['AdminListsController', AdminListsController],
      ['AdminBasketsController', AdminBasketsController],
      ['AdminAdminsController', AdminAdminsController],
    ] as ReadonlyArray<readonly [string, object]>)(
      '%s takes an admin token and not a velista one',
      (_name, controller) => {
        expect(guardsOf(controller)).toContain(AdminJwtGuard);
        expect(guardsOf(controller)).not.toContain(JwtAuthGuard);
      }
    );
  });

  /**
   * Section 6. Every field here is a column an operator can see and cannot
   * change, and each is on this list because editing it is wrong rather than
   * because nobody got to it.
   */
  describe('what an operator still cannot change', () => {
    it('accepts no email, verified state or kind on a user', () => {
      const body = propertiesOf('UpdateAdminUserDto');
      expect(body).not.toContain('email');
      expect(body).not.toContain('emailVerifiedAt');
      expect(body).not.toContain('kind');
      // The two that are editable, asserted beside the three that are not, so a
      // change that emptied this body fails here rather than passing quietly.
      expect(body).toEqual(expect.arrayContaining(['username', 'displayName']));
    });

    it('accepts no join code, owner, status or deletion marker on a zone', () => {
      const body = propertiesOf('UpdateAdminZoneDto');
      expect(body).not.toContain('joinCode');
      expect(body).not.toContain('ownerUserId');
      expect(body).not.toContain('status');
      expect(body).not.toContain('markedForDeletionAt');
      expect(body).toEqual(expect.arrayContaining(['name', 'config']));
    });

    it('accepts no status on a membership, because it is four verbs', () => {
      const body = propertiesOf('UpdateAdminMembershipDto');
      expect(body).not.toContain('status');
      expect(body).toEqual(expect.arrayContaining(['role', 'username']));
    });

    it('accepts no reorder and no adoption on a line', () => {
      const body = propertiesOf('UpdateAdminLineDto');
      // Reordering is a whole order rather than a field, and adoption records a
      // choice by the person holding the line, which an operator is not.
      expect(body).not.toContain('position');
      expect(body).not.toContain('adoptItemIds');
      expect(body).toEqual(
        expect.arrayContaining(['content', 'quantity', 'itemIds'])
      );
    });

    it('offers no way to create a list line', () => {
      // `createdByUserId` is not nullable and an operator is not a user, so a
      // created line would be attributed to nobody (section 6.4).
      expect(operation('post', '/v1/admin/lists/{id}/lines')).toBeUndefined();
    });

    it('leaves baskets read only, in full', () => {
      const basketPaths = Object.keys(document.paths).filter((path) =>
        path.startsWith('/v1/admin/baskets')
      );
      expect(basketPaths.length).toBeGreaterThan(0);
      for (const path of basketPaths) {
        expect(Object.keys(document.paths[path])).toEqual(['get']);
      }
    });

    /**
     * Section 6.3, and the one entry on that list which is not a "not yet".
     * A back office that can create back office accounts is a back office where
     * one compromised session is permanent.
     */
    it('has no create, update or delete route for an admin, anywhere', () => {
      const adminPaths = Object.keys(document.paths).filter((path) =>
        path.startsWith('/v1/admin/admins')
      );
      expect(adminPaths).toEqual(['/v1/admin/admins']);
      expect(Object.keys(document.paths['/v1/admin/admins'])).toEqual(['get']);
    });

    it('offers no postal code write', () => {
      // The row an operator would want to fix is the location, which plan 0005
      // already makes fully editable (section 6.5).
      for (const path of Object.keys(document.paths)) {
        if (path.startsWith('/v1/admin/catalog/postal-codes')) {
          expect(Object.keys(document.paths[path])).toEqual(['get']);
        }
      }
    });
  });
});
