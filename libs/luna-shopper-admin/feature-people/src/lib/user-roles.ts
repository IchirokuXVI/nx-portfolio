import {
  ACCOUNT_ROLES,
  orderedRoles,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  fieldMessage,
  type FieldMessage,
} from '@portfolio/luna-shopper-admin/models';

/** Every role an account can hold (backend plan 0175), by its keyed name. */
export const USER_ROLE_OPTIONS = ACCOUNT_ROLES.map((role) => ({
  value: role,
  label: `people.users.roles.${role}.name`,
}));

/**
 * An account's roles as one cell, for the table and the card (admin plan 0038).
 *
 * A key per combination rather than the names joined, because a cell is drawn
 * by a pure function that cannot translate, and there are two roles. A third
 * role adds its combinations to `en.json` beside it.
 */
export function rolesCell(roles: readonly string[]): FieldMessage {
  const held = orderedRoles(roles);
  if (held.length === 0) {
    return fieldMessage('people.users.roles.cell.none');
  }
  const key = held
    .map((role, index) =>
      index === 0 ? role : role.charAt(0).toUpperCase() + role.slice(1)
    )
    .join('');
  return fieldMessage(`people.users.roles.cell.${key}`);
}
