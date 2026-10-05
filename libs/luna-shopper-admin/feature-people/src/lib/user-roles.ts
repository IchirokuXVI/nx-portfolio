import {
  ACCOUNT_ROLES,
  orderedRoles,
  type AccountRole,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  fieldMessage,
  type FieldMessage,
  type NamedAction,
} from '@portfolio/luna-shopper-admin/models';
import type { UserRow } from './people-seed';

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

/** The name of the action that gives a role, and of the one that takes it away. */
export const giveRoleAction = (role: AccountRole): string =>
  `give-role-${role}`;
export const takeRoleAction = (role: AccountRole): string =>
  `take-role-${role}`;

/**
 * The roles of an account as named actions (admin plan 0057, section 2.2):
 * for each role, one that gives it and one that takes it away.
 *
 * **A role changes only here**, in the More menu of the person's page, and
 * each change asks first. The switch of plan 0038 wrote from a page that
 * reads, which the record page never does.
 *
 * - Giving is offered to a registered account that does not hold the role. A
 *   guest holds no roles and the server refuses to give it one, so a guest is
 *   offered none.
 * - Taking away is offered to an account that holds the role.
 *
 * What is sent is the whole set with one role changed, which is what the
 * route takes.
 *
 * One function over {@link ACCOUNT_ROLES}, so a new role is one entry there
 * and its words in `en.json`: `people.users.action.giveRole.<role>`,
 * `…takeRole.<role>`, and a body under each of the two questions.
 */
export function roleActions(
  directory: Pick<DirectoryServiceI, 'setUserRoles'>
): readonly NamedAction<UserRow>[] {
  return ACCOUNT_ROLES.flatMap((role): NamedAction<UserRow>[] => [
    {
      name: giveRoleAction(role),
      label: `people.users.action.giveRole.${role}`,
      available: (row) =>
        row.kind !== 'TEMPORARY' && !holdsRole(row, role),
      confirm: {
        heading: 'people.users.confirm.grantRole.heading',
        body: `people.users.confirm.grantRole.body.${role}`,
        confirm: 'people.users.confirm.grantRole.confirm',
      },
      run: (row) =>
        directory.setUserRoles(row.userId, orderedRoles([...row.roles, role])),
    },
    {
      name: takeRoleAction(role),
      label: `people.users.action.takeRole.${role}`,
      available: (row) => holdsRole(row, role),
      confirm: {
        heading: 'people.users.confirm.removeRole.heading',
        body: `people.users.confirm.removeRole.body.${role}`,
        confirm: 'people.users.confirm.removeRole.confirm',
      },
      run: (row) =>
        directory.setUserRoles(
          row.userId,
          row.roles.filter((held) => held !== role)
        ),
    },
  ]);
}

function holdsRole(row: UserRow, role: AccountRole): boolean {
  return (row.roles as readonly string[]).includes(role);
}
