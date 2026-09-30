import {
  ACCOUNT_ROLES,
  PERMISSIONS,
  PERMISSIONS_OF,
  permissionsOf,
} from './account-role.enums';

describe('roles and permissions (plan 0175)', () => {
  it('names two roles and one permission, and nothing more', () => {
    expect(ACCOUNT_ROLES).toEqual(['admin', 'premium']);
    expect(PERMISSIONS).toEqual(['shopMap.record']);
  });

  it('lets admin record a shop map and gives premium nothing yet', () => {
    expect(PERMISSIONS_OF.admin).toEqual(['shopMap.record']);
    expect(PERMISSIONS_OF.premium).toEqual([]);
  });

  it('grants only permissions that exist, for every role', () => {
    for (const role of ACCOUNT_ROLES) {
      for (const permission of PERMISSIONS_OF[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('derives nothing from no roles', () => {
    expect(permissionsOf([])).toEqual([]);
  });

  it('derives each permission once, whichever roles grant it', () => {
    expect(permissionsOf(['admin', 'premium', 'admin'])).toEqual([
      'shopMap.record',
    ]);
  });

  it('ignores a value that is not a role', () => {
    expect(permissionsOf(['owner', 'shopMap.record'])).toEqual([]);
  });

  it('cannot be widened at runtime', () => {
    expect(Object.isFrozen(PERMISSIONS_OF)).toBe(true);
    expect(Object.isFrozen(PERMISSIONS_OF.admin)).toBe(true);
  });
});
