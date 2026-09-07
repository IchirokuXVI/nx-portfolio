import type { DataSource } from 'typeorm';
import { AdminUser } from '../../entities';
import { PasswordService } from '../../password/password.service';

/**
 * Creating an admin is a thing you do on the server (plan 0071, section 6).
 *
 * Two commands and no routes, ever. The admin app may **read** the list, which is
 * plan 0074's user management screen showing operators as a read only section,
 * and may not add, edit or delete one. Changing an admin means having the server,
 * and that is also the entire password recovery story: every recovery channel is
 * also an attack channel, and this table has one user.
 *
 * The functions here take a `DataSource` rather than importing one, for the same
 * reason `seed.ts` does: importing the CLI data source throws the moment
 * `AUTH_DB_URL` is unset, so holding one would make every consumer of this file
 * need a configured database, the tests beside it included.
 */

/**
 * The floor a typed password has to clear, enforced by the command rather than by
 * a route.
 *
 * Twelve rather than the eight the user facing registration asks for. This is one
 * account, chosen by one person, typed rarely, and it is the credential behind
 * every user's data; there is no usability argument on the other side of it.
 */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export interface CreateAdminRequest {
  username: string;
  password: string;
  displayName?: string;
}

/** What the create command prints. No secret is in this shape. */
export interface CreatedAdmin {
  id: string;
  username: string;
}

/**
 * Write one operator row, hashed with the same `PasswordService` the running
 * service uses so argon2 parameters stay in exactly one place.
 *
 * A duplicate username is refused here rather than left to the unique index, so
 * the message says what went wrong instead of naming a constraint.
 */
export async function createAdmin(
  dataSource: DataSource,
  req: CreateAdminRequest
): Promise<CreatedAdmin> {
  const username = req.username.trim();
  if (!username) {
    throw new Error('A username is required.');
  }
  if (req.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `The password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`
    );
  }

  const admins = dataSource.getRepository(AdminUser);
  if (await admins.findOne({ where: { username } })) {
    throw new Error(`An admin named '${username}' already exists.`);
  }

  const saved = await admins.save(
    admins.create({
      username,
      passwordHash: await new PasswordService().hash(req.password),
      displayName: req.displayName?.trim() || null,
      disabledAt: null,
      lastLoginAt: null,
    })
  );

  return { id: saved.id, username: saved.username };
}

/** What the ensure command prints, plus which of the two things it did. */
export interface EnsuredAdmin extends CreatedAdmin {
  created: boolean;
}

export interface EnsureAdminRequest {
  username: string;
  displayName?: string;
  /**
   * Asked for only when a row has to be written.
   *
   * A function rather than a string because the caller's way of producing one is
   * to prompt, and an operator who typed `admin:ensure dev-admin` about an
   * account that already exists should not be asked twice for a password that is
   * then thrown away.
   */
  password: () => Promise<string>;
}

/**
 * Create the operator only when it is missing, so a setup script can run on every
 * `up` (plan 0071, section 8).
 *
 * `createAdmin` refuses a duplicate, which is right for a person typing the
 * command and wrong for `stack.sh`, where the same slot is brought up again and
 * again and the second run must not fail. So this asks first and does nothing
 * when the row is there.
 *
 * **An existing row is never touched.** Not the password, not the display name,
 * and above all not `disabledAt`: a developer who disabled the development admin
 * disabled it on purpose, and an `up` that silently re-enabled it would take that
 * decision back every few minutes. A disabled admin makes autologin fail loudly
 * at the login route instead, which is the outcome that can be read.
 */
export async function ensureAdmin(
  dataSource: DataSource,
  req: EnsureAdminRequest
): Promise<EnsuredAdmin> {
  const username = req.username.trim();
  if (!username) {
    throw new Error('A username is required.');
  }

  const existing = await dataSource
    .getRepository(AdminUser)
    .findOne({ where: { username } });
  if (existing) {
    return { id: existing.id, username: existing.username, created: false };
  }

  const created = await createAdmin(dataSource, {
    username,
    password: await req.password(),
    displayName: req.displayName,
  });
  return { ...created, created: true };
}

/** One row of the list command. No secrets, by construction rather than by care. */
export interface ListedAdmin {
  username: string;
  displayName: string | null;
  disabledAt: string | null;
  lastLoginAt: string | null;
}

/**
 * Every operator, oldest first, so the list reads as the order they were made in.
 *
 * `lastLoginAt` is the column worth having: it answers "is this account still
 * used", which is the question behind every decision to disable one.
 */
export async function listAdmins(
  dataSource: DataSource
): Promise<ListedAdmin[]> {
  const admins = await dataSource
    .getRepository(AdminUser)
    .find({ order: { createdAt: 'ASC' } });

  return admins.map((admin) => ({
    username: admin.username,
    displayName: admin.displayName,
    disabledAt: admin.disabledAt?.toISOString() ?? null,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
  }));
}

/** Renders the list as fixed width columns, with a line saying there are none. */
export function formatAdminList(rows: ListedAdmin[]): string {
  if (rows.length === 0) {
    return 'No admins. Create one with `admin:create <username>`.';
  }

  const header = ['USERNAME', 'DISPLAY NAME', 'DISABLED', 'LAST LOGIN'];
  const body = rows.map((row) => [
    row.username,
    row.displayName ?? '-',
    row.disabledAt ?? '-',
    row.lastLoginAt ?? 'never',
  ]);
  const widths = header.map((_, column) =>
    Math.max(header[column].length, ...body.map((row) => row[column].length))
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();

  return [line(header), ...body.map(line)].join('\n');
}
