import type {
  AuthProvider,
  UserKind,
  UsernamePropagation,
} from '../enums/auth.enums';
import type { PageQuery, Paginated } from '../pagination';
import type { AdminCredential } from './admin-auth.messages';
import type {
  DeleteAccountResult,
  ResendVerificationResult,
} from './auth.messages';

/**
 * The back office's view of the people using velista (plan 0074).
 *
 * A third namespace beside `auth.*` and `adminAuth.*`, and separate for the same
 * reason those two are separate from each other. `auth.*` is what a person may
 * ask about themselves and `adminAuth.*` is how an operator signs in; this is an
 * operator asking about somebody else, which no subject in either of the other
 * two may ever be widened into. A reader who opens this file is looking at
 * everything the back office can learn or do about a user, which is the list
 * worth being able to read in one place.
 *
 * **Every write goes through the service, and never through the row** (plan
 * 0077, section 1). Deleting an account runs the same cascade and emits the same
 * event a person deleting their own account does, and a rename runs the same
 * propagation. There is still no create subject, and the one direct column write
 * here, `displayName`, is direct because nothing derives from it (section 3.2).
 *
 * Three of the five columns worth an operator's attention stay fixed:
 * `email`, `emailVerifiedAt` and `kind`. Each is a decision rather than an
 * omission, recorded in sections 6.1 and 6.2 of plan 0077, and no request shape
 * in this file carries one.
 *
 * Every request carries an {@link AdminCredential}, and auth verifies the token
 * for itself rather than trusting the gateway to have done so. That is plan 0072
 * section 3's property, kept here for the same reason: a gateway route added
 * without its guard still cannot read the user table.
 */
export const ADMIN_USER_PATTERNS = {
  /** A page of users, filtered by section 2's columns. */
  list: 'adminUser.list',
  /** One user, with the credential facts a listing row omits. */
  get: 'adminUser.get',
  /**
   * Names for a set of ids, in one call (plan 0074, section 3).
   *
   * The join between a zone and its owner's name does not exist in SQL and never
   * will: zones live in core's database and users live in auth's. So a screen
   * that wants both makes two calls and joins them in the gateway, and this is
   * the second call. One batched request rather than N, and it answers with only
   * the ids it found: an id belonging to a reaped user is absent rather than an
   * error, because a missing name must never fail the listing it decorates.
   */
  resolveMany: 'adminUser.resolveMany',
  /**
   * Delete somebody's account, running `IdentityService.deleteAccount` exactly as
   * `auth.deleteAccount` does. Auth removes the identity and emits `user.deleted`;
   * core's `AccountDeletionService` then does its half across its own database.
   */
  delete: 'adminUser.delete',
  /**
   * Send the confirmation mail again, past the user facing throttle.
   *
   * The throttle it bypasses is a **gateway** decorator on the user's own route,
   * not a rule inside auth, so bypassing it is a matter of the admin route not
   * carrying it rather than of auth being asked to skip anything. Auth's own
   * refusals still apply: an account with no address, or one already confirmed,
   * is a conflict here exactly as it is there.
   */
  resendVerification: 'adminUser.resendVerification',
  /**
   * Change somebody's username or display name (plan 0077, section 3).
   *
   * **Two fields, and no third.** The email address, whether it is verified, and
   * the account kind are each a column an operator can see and cannot change,
   * for reasons sections 6.1 and 6.2 give in full. None of them appears on
   * {@link UpdateAdminUserRequest}, and `admin-user-immutable-fields.spec.ts`
   * asserts that no route accepts one.
   *
   * The two are not the same kind of write, which is the interesting part.
   * `username` goes through `IdentityService.setUsername`, because a direct
   * column write produces a user whose global name changed and whose name in
   * every zone did not: core rewrites the per zone `zone_memberships.username`
   * from the `user.usernameChanged` event, and nothing reconciles the two
   * afterwards. `displayName` has no service, no event and no consumer, so a
   * direct column write is correct there and is not an exception to the rule.
   */
  update: 'adminUser.update',
} as const;

export type AdminUserPattern =
  (typeof ADMIN_USER_PATTERNS)[keyof typeof ADMIN_USER_PATTERNS];

/**
 * A user as the back office lists them (plan 0074, section 4).
 *
 * More than any user facing route returns, which is the point, and still without
 * `passwordHash`. That field is **never selected**, not merely never serialized:
 * the query names its columns, so the hash does not reach the process that would
 * have to remember not to send it. `admin-user-redaction.spec.ts` asserts it
 * against the response rather than against the mapper, so a future `select: *`
 * fails the test rather than passing it quietly.
 */
export interface AdminUserView {
  userId: string;
  kind: UserKind;
  username: string;
  displayName: string | null;
  email: string | null;
  /** ISO 8601, or null while the address is unconfirmed or absent. */
  emailVerifiedAt: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

/**
 * One user, read on their own.
 *
 * The two extra fields are the ones an operator answering "why can this person
 * not sign in" needs and a listing row should not pay for: both are separate
 * tables, and a page of fifty rows would be two more queries per row. Neither
 * carries a secret. `hasPassword` says a credential row exists, and says nothing
 * about it; `providers` names the identity providers linked to the account and
 * not the provider side ids they are linked by.
 */
export interface AdminUserDetailView extends AdminUserView {
  /** Whether a password credential exists. Never the hash, and never a hint of it. */
  hasPassword: boolean;
  /** The providers linked to this account, empty for a password only user. */
  providers: AuthProvider[];
}

/**
 * A name for an id, and nothing else (plan 0074, section 3).
 *
 * Deliberately three fields rather than an {@link AdminUserView}: this is the
 * decoration half of a listing that is really about something else, and a
 * decoration that carried an email address would leak one into every screen that
 * only wanted to render a name.
 */
export interface AdminUserRefView {
  userId: string;
  username: string;
  displayName: string | null;
}

/**
 * The filters of plan 0074, section 2.
 *
 * `username` matches the plain `ix_users_username` index, which exists for
 * exactly this and for nothing velista does. `email` has no such index and is a
 * contains match over a column most rows share nothing with, which is acceptable
 * at this table's size and is the kind of thing worth revisiting before it is
 * not.
 *
 * Every filter is independent and every one is optional; a request naming none of
 * them is the whole table, newest first.
 */
export interface ListAdminUsersRequest extends AdminCredential, PageQuery {
  /** Case insensitive substring of the global username. */
  username?: string;
  /** Case insensitive substring of the email address. */
  email?: string;
  kind?: UserKind;
  /** True for confirmed addresses only, false for unconfirmed and absent ones. */
  verified?: boolean;
  /** ISO 8601. Inclusive lower bound on `createdAt`. */
  createdAfter?: string;
  /** ISO 8601. Exclusive upper bound on `createdAt`. */
  createdBefore?: string;
}

export type AdminUserPage = Paginated<AdminUserView>;

/** Read one user by id. */
export interface GetAdminUserRequest extends AdminCredential {
  targetUserId: string;
}

/**
 * Names for up to a page of ids. The gateway sends the ids one listing produced,
 * so the bound is that listing's page size rather than a number stated here.
 */
export interface ResolveAdminUsersRequest extends AdminCredential {
  userIds: string[];
}

/**
 * What was found, and only what was found. An id with no row is simply absent, so
 * the caller renders the id (section 3) rather than failing.
 */
export interface ResolveAdminUsersResult {
  users: AdminUserRefView[];
}

/**
 * Delete somebody else's account.
 *
 * `targetUserId` rather than `userId`, because `userId` on an
 * {@link AdminCredential} is already the operator and the whole difference
 * between this and `auth.deleteAccount` is that the two are different people. A
 * single `userId` field would make an operator deleting themselves and an
 * operator deleting a user the same message.
 */
export interface DeleteAdminUserRequest extends AdminCredential {
  targetUserId: string;
}

export type DeleteAdminUserResult = DeleteAccountResult;

/** Resend somebody else's confirmation mail. */
export interface ResendAdminVerificationRequest extends AdminCredential {
  targetUserId: string;
  /** Locale for the confirmation email; defaults to the request locale. */
  locale?: string;
}

/**
 * Change somebody else's username or display name (plan 0077, section 3).
 *
 * `targetUserId` rather than `userId`, for the reason
 * {@link DeleteAdminUserRequest} gives: `userId` on an {@link AdminCredential}
 * is already the operator, and a single field would make an operator renaming
 * themselves and an operator renaming a user the same message.
 *
 * `displayName` is nullable **and** optional, and the two mean different things.
 * Absent leaves the column alone; null clears it. A display name holds whatever
 * an identity provider supplied, which for a Google sign in is somebody's real
 * full name, so clearing it is a thing an operator asks for on purpose.
 */
export interface UpdateAdminUserRequest extends AdminCredential {
  targetUserId: string;
  username?: string;
  /** Absent leaves it alone. Null clears it. */
  displayName?: string | null;
  /**
   * How far the rename reaches, defaulted exactly as the user facing path
   * defaults it. An operator renaming somebody is doing what that person could
   * do to themselves, so it behaves the same.
   */
  usernamePropagation?: UsernamePropagation;
}

export type UpdateAdminUserResult = AdminUserDetailView;

export type ResendAdminVerificationResult = ResendVerificationResult;
